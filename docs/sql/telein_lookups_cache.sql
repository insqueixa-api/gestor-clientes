-- Cache de consultas à Telein (identificação de operadora por telefone) —
-- pedido do Márcio, 11/08/2026: toda consulta gastava crédito de novo,
-- mesmo pra número já checado antes, e código ainda não mapeado (ex: "78")
-- virava "Celular/Fixo" genérico pra sempre, sem chance de corrigir depois
-- sem gastar outra consulta. Essa tabela guarda o código CRU que a Telein
-- devolveu pra cada número — a resolução pro nome da operadora usa o mapa
-- em lib/telein.ts, então assim que um código novo for mapeado ali, todo
-- número já cacheado com aquele código resolve sozinho, sem nova chamada.
create table if not exists public.telein_lookups (
  phone_digits text primary key,
  raw_code     text not null,
  queried_at   timestamptz not null default now()
);

comment on table public.telein_lookups is
  'Cache de respostas cruas da Telein por número — evita reconsultar (gastar crédito) o mesmo telefone; ver lib/telein.ts.';
