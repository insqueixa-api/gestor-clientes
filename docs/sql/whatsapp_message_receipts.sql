-- ✅ 04/10/2026, pedido do Márcio ("temos como guardar o recibo ✓✓ de cada
-- mensagem?"): até aqui o sistema só sabia que a WhatsApp ACEITOU a
-- mensagem (/send → 200). Se ela chegou no celular / foi lida, ninguém
-- guardava — o serviço da VM só ouvia o status de ERRO.
--
-- 1 linha por mensagem enviada (wa_message_id = id da mensagem no
-- WhatsApp, devolvido pelo /send). Duas fontes escrevem aqui, em qualquer
-- ordem (o recibo de entrega pode chegar ANTES da rota de envio gravar o
-- vínculo com o job — envio_agora só grava o job depois do loop):
--   • rotas de envio (envio_agora/envio_programado): tenant_id, job_id,
--     phone, is_secondary — via upsert só dessas colunas;
--   • VM (via /api/whatsapp/receipts → whatsapp_receipt_apply): horários
--     de entrega/leitura, contagem de pedidos de reenvio, erro.
-- Por isso nada aqui é NOT NULL além do id, e os horários usam coalesce
-- (o 1º recibo vale, nunca regride).

create table if not exists public.whatsapp_message_receipts (
  wa_message_id text primary key,
  tenant_id uuid,
  job_id uuid references public.client_message_jobs(id) on delete cascade,
  phone text,
  is_secondary boolean not null default false,
  delivered_at timestamptz,
  read_at timestamptz,
  retry_requests integer not null default 0,
  error_at timestamptz,
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_message_receipts_job_idx on public.whatsapp_message_receipts(job_id);
create index if not exists whatsapp_message_receipts_created_idx on public.whatsapp_message_receipts(created_at);

alter table public.whatsapp_message_receipts enable row level security;

drop policy if exists admin_select_own_tenant on public.whatsapp_message_receipts;
create policy admin_select_own_tenant on public.whatsapp_message_receipts
  for select to authenticated
  using (exists (select 1 from public.tenant_members tm
                 where tm.user_id = auth.uid() and tm.tenant_id = whatsapp_message_receipts.tenant_id));

drop policy if exists service_role_all on public.whatsapp_message_receipts;
create policy service_role_all on public.whatsapp_message_receipts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Aplica um lote de recibos vindos da VM. p_items = [{id, delivered, read,
-- retries, error}] — delivered/read são ISO (ou null), retries é INCREMENTO.
-- Lido sem entregue registrado (recibo de entrega perdido) também conta
-- como entregue.
create or replace function public.whatsapp_receipt_apply(p_items jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  it jsonb;
  v_read timestamptz;
  v_delivered timestamptz;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    continue when coalesce(it->>'id', '') = '';
    v_read := nullif(it->>'read', '')::timestamptz;
    v_delivered := coalesce(nullif(it->>'delivered', '')::timestamptz, v_read);

    insert into whatsapp_message_receipts as r
      (wa_message_id, delivered_at, read_at, retry_requests, error_at, error_reason)
    values (
      it->>'id',
      v_delivered,
      v_read,
      coalesce((it->>'retries')::int, 0),
      case when coalesce(it->>'error', '') <> '' then now() end,
      nullif(left(it->>'error', 300), '')
    )
    on conflict (wa_message_id) do update set
      delivered_at   = coalesce(r.delivered_at, excluded.delivered_at),
      read_at        = coalesce(r.read_at, excluded.read_at),
      retry_requests = r.retry_requests + excluded.retry_requests,
      error_at       = coalesce(r.error_at, excluded.error_at),
      error_reason   = coalesce(r.error_reason, excluded.error_reason),
      updated_at     = now();
  end loop;

  -- Recibo que nunca foi ligado a um job (ex: envio_avulso, que não grava
  -- em client_message_jobs) não aparece em lugar nenhum — limpa depois de 2
  -- dias pra não acumular.
  delete from whatsapp_message_receipts
   where job_id is null and created_at < now() - interval '2 days';
end;
$$;

revoke all on function public.whatsapp_receipt_apply(jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_receipt_apply(jsonb) to service_role;
