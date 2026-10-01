-- =====================================================================
-- 30/09/2026 — Refactor de aplicativos, fase 1: classificação (nível)
-- =====================================================================
-- docs/apps-refactor/PLANO.md, decisão 3. Vários apps por nível:
--   tier = quantidade de ESTRELAS: 1 a 5 (5 = melhor), null = sem
--   classificação (trocado de "1 = Top" pra estrelas no mesmo dia, nada classificado ainda).
-- "Configuração manual" NÃO é coluna: é derivado (app sem integração).
-- tier_order fica pra ordenar dentro do nível (arrastar) numa próxima etapa.
-- Aditivo — nada existente muda.
alter table public.apps
  add column if not exists tier smallint,
  add column if not exists tier_order integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'apps_tier_check') then
    alter table public.apps add constraint apps_tier_check check (tier is null or tier between 1 and 5);
  end if;
end $$;
