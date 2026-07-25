-- Reorganiza os horários pra deixar limpeza + vacuum semanal em sequência
-- clara, em vez de duas janelas separadas (06:30 diário + 07:00 domingo).
-- Sem risco real de conflito antes (o Postgres so faria um job esperar o
-- outro), mas assim fica mais simples de acompanhar.
--
-- Limpeza diária de órfãos: 06:30 → 06:20 UTC (10 min mais cedo)
SELECT cron.schedule(
  'sync_catalog_limpar_daily',
  '20 6 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://unigestor.net.br/api/catalogo/limpar',
      headers := '{"Authorization": "Bearer 5f69b42084838eb6106b5eadea61265a1e3844b27fe4c28720b113bc3ad22f4e", "Content-Type": "application/json"}'::jsonb,
      body    := '{"servidor": "TODOS"}'::jsonb
    );
  $$
);

-- Vacuum semanal: passa a rodar no antigo horário da limpeza (06:30 UTC),
-- só aos domingos — 10 minutos depois da limpeza diária já ter rodado.
SELECT cron.schedule(
  'vacuum_catalog_weekly',
  '30 6 * * 0',
  $$
    VACUUM (FULL, ANALYZE) public.catalog_episodes;
    VACUUM (FULL, ANALYZE) public.catalog_master;
    VACUUM (FULL, ANALYZE) public.catalog_availability;
  $$
);
