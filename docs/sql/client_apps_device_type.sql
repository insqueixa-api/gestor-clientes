-- =====================================================================
-- 02/10/2026 — Aparelho escolhido ao adicionar o app (pedido do Márcio)
-- =====================================================================
-- Quando o app é adicionado pelo seletor (admin ou portal) depois de
-- escolher o aparelho (ex: "Samsung (Tizen)"), guarda a chave aqui
-- (lib/apps/device-types.ts ou nome de aparelho cadastrado à mão).
-- Mostrado só no admin. Null = adicionado pela busca/filtro (sem aparelho)
-- ou antes desta coluna existir.
alter table public.client_apps add column if not exists device_type text;
