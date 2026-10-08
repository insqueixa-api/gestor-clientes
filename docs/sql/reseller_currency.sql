-- docs/sql/reseller_currency.sql
-- 08/10/2026 — moeda da revenda (pedido do Márcio): BRL, USD ou EUR no
-- cadastro da revenda. Fora do BRL a revenda vê TODOS os preços convertidos
-- pelo câmbio salvo do tenant (tenant_fx_rates, mesma conta do portal do
-- cliente — lib/fx.ts convertAmount, arredonda pra cima) e paga pelo Stripe
-- (cartão). O registro continua em BRL (amount_brl = preço do sistema); o
-- valor efetivamente cobrado fica em charge_amount/charge_currency.

alter table public.resellers
  add column if not exists price_currency text not null default 'BRL'
  check (price_currency in ('BRL', 'USD', 'EUR'));

alter table public.reseller_credit_orders
  add column if not exists charge_currency text not null default 'BRL' check (charge_currency in ('BRL', 'USD', 'EUR')),
  add column if not exists charge_amount numeric(12, 2);

alter table public.reseller_app_orders
  add column if not exists charge_currency text not null default 'BRL' check (charge_currency in ('BRL', 'USD', 'EUR')),
  add column if not exists charge_amount numeric(12, 2);

-- pedidos antigos (todos BRL): cobrado = valor em BRL
update public.reseller_credit_orders set charge_amount = amount_brl where charge_amount is null;
update public.reseller_app_orders set charge_amount = amount_brl where charge_amount is null;
