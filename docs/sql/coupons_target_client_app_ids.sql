-- =====================================================================
-- 30/09/2026 — Cupom pessoal por INSTALAÇÃO de app (não só por nome)
-- =====================================================================
-- Pedido do Márcio (Vera tem 2 DupleCast — Sala e Quarto; o cupom "VERA"
-- 50% DupleCast só descontava 1 deles). target_app_names (nome) continua
-- existindo e sendo preenchido (compatibilidade, chips do admin); quando
-- target_client_app_ids está preenchido, ELE decide quais instalações
-- (client_apps.id) o cupom cobre, e o desconto vale em cada uma que
-- estiver no pagamento. Cupom antigo (só nome) cobre todas as instalações
-- daquele app.
alter table public.coupons
  add column if not exists target_client_app_ids uuid[];

-- Cupom VERA (já existente): passa a cobrir as 2 instalações de DupleCast
-- dela, que era a intenção ao criar.
update public.coupons c
set target_client_app_ids = (
  select array_agg(ca.id order by ca.created_at)
  from public.client_apps ca
  join public.apps a on a.id = ca.app_id
  where ca.client_id = c.client_id
    and a.name = any(c.target_app_names)
)
where c.code = 'VERA'
  and c.target_client_app_ids is null
  and c.client_id is not null
  and c.target_app_names is not null;
