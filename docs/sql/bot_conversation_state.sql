-- Persistência do estado de conversa do bot (bot_state) — pedido do Márcio,
-- 05/08/2026: hoje esse estado só existe em memória RAM da VM
-- (whatsapp-service/src/sessionManager.js, `contactStates = new Map()`) —
-- se a VM reiniciar (deploy, crash, reboot programado), TODAS as conversas
-- em andamento perdem o "ponto onde estavam" silenciosamente, sem erro
-- visível, e voltam pro início na próxima mensagem do cliente.
--
-- Decisão: persistir no Supabase, não em disco da VM (Márcio pediu
-- explicitamente "se não for na Vercel, sendo no Supabase, pode
-- persistir") — e a persistência acontece do lado da rota Next.js
-- (app/api/whatsapp/bot/agent/route.ts), sem precisar mexer/redeployar o
-- serviço da VM: ela continua mandando `bot_state` no payload (fast path,
-- sem round-trip extra na maioria das vezes); a rota só usa o Supabase como
-- FALLBACK quando `bot_state` chega vazio (ex: logo após a VM reiniciar), e
-- sempre grava o `next_state` de volta aqui como cópia durável.
create table if not exists public.bot_conversation_state (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  session_key text not null,
  phone      text not null,
  state      text not null,
  updated_at timestamptz not null default now(),
  primary key (session_key, phone)
);

create index if not exists idx_bot_conversation_state_tenant
  on public.bot_conversation_state (tenant_id);

alter table public.bot_conversation_state enable row level security;

-- Mesmo padrão de policy das outras tabelas do projeto — na prática só é
-- lida/escrita via client de service role (bypassa RLS), mas mantém a
-- mesma defesa em profundidade das demais tabelas por tenant.
create policy "bcs_select_by_tenant" on public.bot_conversation_state
  for select using (is_tenant_allowed(tenant_id, auth.uid()));

create policy "bcs_insert_by_tenant" on public.bot_conversation_state
  for insert with check (is_tenant_allowed(tenant_id, auth.uid()));

create policy "bcs_update_by_tenant" on public.bot_conversation_state
  for update using (is_tenant_allowed(tenant_id, auth.uid()))
  with check (is_tenant_allowed(tenant_id, auth.uid()));

create policy "bcs_delete_by_tenant" on public.bot_conversation_state
  for delete using (is_tenant_allowed(tenant_id, auth.uid()));
