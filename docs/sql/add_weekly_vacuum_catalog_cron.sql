-- Cron semanal pra devolver ao disco o espaço morto que a limpeza diária de
-- órfãos (catalog_episodes/catalog_master/catalog_availability) deixa pra
-- trás. VACUUM comum só marca o espaço como "reaproveitável" pra próximas
-- inserções na MESMA tabela — não encolhe o arquivo. Só VACUUM FULL devolve
-- o espaço de verdade ao disco (e reduz o que aparece como "Database Size"
-- no painel do Supabase).
--
-- VACUUM (FULL) não pode rodar dentro de uma função/transação — por isso
-- vai direto no comando do pg_cron, sem chamar função nenhuma.
--
-- Semanal (não diário): a limpeza diária de órfãos, com o bug já corrigido,
-- deve remover poucas linhas por dia — bloat semanal deve ser pequeno.
-- VACUUM FULL trava a tabela por alguns segundos enquanto roda; rodar toda
-- semana evita fazer isso todo dia à toa.
--
-- Roda domingo às 07:00 UTC (04:00 em Brasília), depois do horário em que
-- a limpeza diária de órfãos já rodou (06:30 UTC).
SELECT cron.schedule(
  'vacuum_catalog_weekly',
  '0 7 * * 0',
  $$
    VACUUM (FULL, ANALYZE) public.catalog_episodes;
    VACUUM (FULL, ANALYZE) public.catalog_master;
    VACUUM (FULL, ANALYZE) public.catalog_availability;
  $$
);
