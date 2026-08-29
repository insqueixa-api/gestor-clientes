-- Investigação urgente (Danielle63230, 29/08/2026): o link do Portal dela
-- estava morto — o token tinha sido apagado pela limpeza diária
-- (cleanup_orphaned_portal_tokens, cron limpeza_diaria_tokens_portal,
-- 08:30 UTC). Achado ao investigar: essa limpeza apaga EXATAMENTE 1 linha
-- por dia, todo dia, há pelo menos 10 dias — mas não tem ninguém perto dos
-- 61 dias de atraso (critério de auto_purge_expired_clients_daily) nem
-- trial criado nos últimos 20 dias, então a hipótese óbvia ("token de
-- cliente purgado") está descartada. Alguma outra coisa cria 1 token por
-- dia que não bate com nenhum cliente. Sem log, não dá pra saber qual —
-- este arquivo só ADICIONA o log, não muda o comportamento de limpeza.
--
-- Depois de rodar, conferir amanhã de manhã (ou no próximo ciclo de
-- 08:30 UTC):
--   select * from client_portal_token_cleanup_log order by deleted_at desc;
--
-- ✅ 29/08/2026: guarda o `token` também (não só os metadados) — pedido do
-- Márcio, pra dar pra restaurar na hora (update direto na tabela, igual fiz
-- com a Danielle) se acontecer de apagar algo que devia ter ficado. Mesmo
-- nível de sensibilidade que client_portal_tokens já tem hoje (token em
-- texto puro = acesso direto ao Portal de quem for dono dele) — protegido
-- do mesmo jeito, RLS sem policy, só service_role.

create table if not exists public.client_portal_token_cleanup_log (
  id uuid primary key default gen_random_uuid(),
  deleted_at timestamptz not null default now(),
  tenant_id uuid,
  whatsapp_username text,
  phone_anchor text,
  token text,
  token_label text,
  token_created_at timestamptz,
  token_created_by uuid,
  token_last_used_at timestamptz
);

-- Se já rodou a versão anterior deste arquivo (sem a coluna token), esta
-- linha adiciona ela sem precisar recriar a tabela — no-op se já existir
-- (seja porque acabou de ser criada acima, seja porque já rodou antes).
alter table public.client_portal_token_cleanup_log add column if not exists token text;

alter table public.client_portal_token_cleanup_log enable row level security;
-- Sem policy de propósito — só service_role (que ignora RLS) escreve/lê,
-- mesmo padrão de cron_health.

create or replace function public.cleanup_orphaned_portal_tokens()
returns void
language plpgsql
security definer
as $function$
begin
  with orphans as (
    delete from public.client_portal_tokens t
    where NOT EXISTS (
      select 1
      from public.clients c
      where c.tenant_id = t.tenant_id
        and (
          public.normalize_phone(c.whatsapp_username) = public.normalize_phone(t.whatsapp_username)
          or
          public.normalize_phone(c.secondary_whatsapp_username) = public.normalize_phone(t.whatsapp_username)
        )
    )
    returning tenant_id, whatsapp_username, phone_anchor, token, label, created_at, created_by, last_used_at
  )
  insert into public.client_portal_token_cleanup_log (
    tenant_id, whatsapp_username, phone_anchor, token, token_label, token_created_at, token_created_by, token_last_used_at
  )
  select tenant_id, whatsapp_username, phone_anchor, token, label, created_at, created_by, last_used_at
  from orphans;
end;
$function$;
