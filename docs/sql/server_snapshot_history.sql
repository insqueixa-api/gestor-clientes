-- ✅ 08/10/2026, pedido do Márcio — "carimbo" de servidor no histórico.
-- O histórico pertence ao servidor onde aconteceu, não ao servidor ATUAL da
-- conta: se o cliente migrar NaTV → Fast amanhã, o que foi pago até hoje
-- continua sendo NaTV. Base pra mesclar contas (ex: Sandra) sem que
-- histórico "pule" de servidor.
--
-- Já existia: client_renewals.server_id (todas as 1.394 preenchidas) e
-- server_credit_usage.server_id. Faltava:
--   • client_portal_payments (Log do Portal) → server_id / server_username /
--     server_name, preenchidos no INSERT por gatilho (cobre os 5 caminhos de
--     pagamento + baixas manuais sem mexer em cada um).
--   • client_events (Linha do Tempo) → meta.server_id / server_name /
--     server_username, idem.
-- Preenchimento do passado: com o servidor atual de cada conta — correto
-- porque nunca houve migração de servidor registrada (0 eventos
-- MIGRATE_SERVER em 08/10/2026).
-- Nada aqui muda valor, status ou contagem — só acrescenta o carimbo.

-- ── Log do Portal ────────────────────────────────────────────────────────
alter table public.client_portal_payments add column if not exists server_id uuid references public.servers(id) on delete set null;
alter table public.client_portal_payments add column if not exists server_username text;
alter table public.client_portal_payments add column if not exists server_name text;
create index if not exists client_portal_payments_server_idx on public.client_portal_payments(server_id);

create or replace function public.stamp_portal_payment_server()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null and new.server_id is null then
    select c.server_id, c.server_username, s.name
      into new.server_id, new.server_username, new.server_name
      from clients c left join servers s on s.id = c.server_id
     where c.id = new.client_id;
  end if;
  return new;
exception when others then
  -- carimbo é informativo: nunca pode impedir um pagamento de ser gravado
  raise warning 'stamp_portal_payment_server: %', sqlerrm;
  return new;
end $$;

revoke all on function public.stamp_portal_payment_server() from public, anon, authenticated;

drop trigger if exists trg_portal_payments_stamp_server on public.client_portal_payments;
create trigger trg_portal_payments_stamp_server
before insert on public.client_portal_payments
for each row execute function public.stamp_portal_payment_server();

-- ── Linha do Tempo ───────────────────────────────────────────────────────
create or replace function public.stamp_client_event_server()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid; v_user text; v_name text;
begin
  if new.client_id is not null and not (coalesce(new.meta, '{}'::jsonb) ? 'server_id') then
    select c.server_id, c.server_username, s.name
      into v_sid, v_user, v_name
      from clients c left join servers s on s.id = c.server_id
     where c.id = new.client_id;
    if v_sid is not null then
      new.meta := coalesce(new.meta, '{}'::jsonb)
                  || jsonb_build_object('server_id', v_sid, 'server_username', v_user, 'server_name', v_name);
    end if;
  end if;
  return new;
exception when others then
  raise warning 'stamp_client_event_server: %', sqlerrm;
  return new;
end $$;

revoke all on function public.stamp_client_event_server() from public, anon, authenticated;

drop trigger if exists trg_client_events_stamp_server on public.client_events;
create trigger trg_client_events_stamp_server
before insert on public.client_events
for each row execute function public.stamp_client_event_server();
