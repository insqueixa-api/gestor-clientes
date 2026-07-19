-- Regras de segmentação de cupom, replicando o motor de regras do Billing
-- Automation (app/admin/gerenciador/cobranca/page.tsx): status do cliente,
-- servidor, plano, aplicativo, e uma janela de dias (min/max) antes ou
-- depois de vencimento/cadastro.
--
-- Substitui min_account_age_days (só cobria "cadastro >= N dias") por
-- rule_date_field + rule_days_min/max, que cobre vencimento OU cadastro,
-- com piso E teto (ex: "cadastro entre 1 e 2 anos"). Nenhum cupom em
-- produção usava min_account_age_days até agora, então dropar é seguro.
--
-- Convenção de sinal: dias = diffDays(hoje, data_do_campo) — negativo =
-- campo no futuro (vencimento daqui a 5 dias = -5), positivo = campo no
-- passado (cadastro há 400 dias = +400).

ALTER TABLE coupons
  DROP COLUMN IF EXISTS min_account_age_days,
  ADD COLUMN IF NOT EXISTS target_status text[],
  ADD COLUMN IF NOT EXISTS target_server_ids uuid[],
  ADD COLUMN IF NOT EXISTS target_plan_labels text[],
  ADD COLUMN IF NOT EXISTS target_app_names text[],
  ADD COLUMN IF NOT EXISTS rule_date_field text CHECK (rule_date_field IN ('vencimento','cadastro')),
  ADD COLUMN IF NOT EXISTS rule_days_min integer,
  ADD COLUMN IF NOT EXISTS rule_days_max integer;

COMMENT ON COLUMN coupons.target_status IS 'Status do cliente elegível (ACTIVE/OVERDUE/TRIAL). Null/vazio = ACTIVE+OVERDUE apenas (TRIAL não entra por padrão — não é um fluxo de renovação).';
COMMENT ON COLUMN coupons.target_server_ids IS 'Servidores elegíveis. Null/vazio = todos.';
COMMENT ON COLUMN coupons.target_plan_labels IS 'Planos (plan_label) elegíveis. Null/vazio = todos.';
COMMENT ON COLUMN coupons.target_app_names IS 'Nomes de apps elegíveis (cliente precisa ter pelo menos um) — a view vw_clients_list_active só expõe nome do app, não id, então o match é por nome. Null/vazio = todos.';
COMMENT ON COLUMN coupons.rule_date_field IS 'Campo de data usado em rule_days_min/max: vencimento ou cadastro (created_at). Null = sem janela de dias.';

-- Aplicado em produção em 2026-07-19 (coluna de apps corrigida de
-- target_app_ids/uuid[] pra target_app_names/text[] no mesmo dia — a view
-- só expõe nome do app, não haveria como comparar por id).
