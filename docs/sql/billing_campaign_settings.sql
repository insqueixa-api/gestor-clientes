-- Configuração única por tenant da "janela de disparo" compartilhada entre
-- todas as billing_automations — pedido do Márcio (26/07/2026): em vez de
-- cada automação disparar num horário fixo próprio (09:40, 09:50, 10:00...),
-- todas passam a disparar a partir de um único horário de início
-- (window_start), em ordem embaralhada entre si, com intervalo aleatório
-- entre mensagens — elimina o padrão de horário robótico, um dos sinais
-- que o WhatsApp usa pra identificar disparo automatizado em massa.
--
-- ✅ Sem horário final: não existe corte de janela. Se o volume de um dia
-- não couber antes do cron parar de rodar de 1 em 1 min (ele passa a rodar
-- de 10 em 10 min depois de um certo horário, por configuração externa do
-- Márcio), a fila simplesmente continua e vai sendo drenada nos próximos
-- ticks — client_message_jobs não tem prazo de expiração, então nada se
-- perde, só atrasa. Decisão explícita do Márcio: não comprimir nem cortar.
--
-- billing_automations continua existindo, mas passa a valer só como REGRA
-- (público-alvo + template) — schedule_time/schedule_days/delay_min por
-- automação deixam de ser lidos por billing_enqueue_scheduled (ver
-- docs/sql/billing_enqueue_scheduled_campaign_window.sql).
create table if not exists public.billing_campaign_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  window_start time not null default '09:30',
  delay_min_secs int not null default 120,
  delay_max_secs int not null default 300,
  schedule_days int[] not null default '{0,1,2,3,4,5,6}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_campaign_settings enable row level security;

create policy "bcs_select_by_tenant" on public.billing_campaign_settings
  for select using (is_tenant_allowed(tenant_id, auth.uid()));

create policy "bcs_insert_by_tenant" on public.billing_campaign_settings
  for insert with check (is_tenant_allowed(tenant_id, auth.uid()));

create policy "bcs_update_by_tenant" on public.billing_campaign_settings
  for update using (is_tenant_allowed(tenant_id, auth.uid()))
  with check (is_tenant_allowed(tenant_id, auth.uid()));

create policy "bcs_delete_by_tenant" on public.billing_campaign_settings
  for delete using (is_tenant_allowed(tenant_id, auth.uid()));
