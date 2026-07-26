-- Variações ("clones") de uma mensagem pronta (message_templates) — pedido
-- do Márcio (26/07/2026): a automação de cobrança usa a mesma mensagem
-- praticamente idêntica pra cada cliente, e isso é um dos sinais que o
-- WhatsApp usa pra identificar "mensagem em massa/automatizada" (achado
-- real: 401/loggedOut repetido no aparelho vinculado depois de restrição
-- de conta). A ideia é ter pelo menos 5 variações de texto por mensagem,
-- sorteadas aleatoriamente a cada disparo (billing_enqueue_scheduled) —
-- cada cliente do mesmo lote pode receber uma redação diferente.
create table if not exists public.message_template_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  template_id uuid not null references public.message_templates(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_template_variants_template_id
  on public.message_template_variants(template_id);
create index if not exists idx_message_template_variants_tenant_id
  on public.message_template_variants(tenant_id);

alter table public.message_template_variants enable row level security;

-- Mesmo padrão de RLS de message_templates (is_tenant_allowed já existe).
create policy "mtv_select_by_tenant" on public.message_template_variants
  for select using (is_tenant_allowed(tenant_id, auth.uid()));
create policy "mtv_insert_by_tenant" on public.message_template_variants
  for insert with check (is_tenant_allowed(tenant_id, auth.uid()));
create policy "mtv_update_by_tenant" on public.message_template_variants
  for update using (is_tenant_allowed(tenant_id, auth.uid()))
  with check (is_tenant_allowed(tenant_id, auth.uid()));
create policy "mtv_delete_by_tenant" on public.message_template_variants
  for delete using (is_tenant_allowed(tenant_id, auth.uid()));
