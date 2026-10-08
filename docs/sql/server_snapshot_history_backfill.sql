-- ✅ 08/10/2026: preenche o carimbo de servidor nos registros que já
-- existiam (ver server_snapshot_history.sql). Servidor atual de cada conta =
-- servidor onde aconteceu (nunca houve migração registrada). Idempotente:
-- só toca o que ainda está sem carimbo. Não muda valor/status de nada.

update public.client_portal_payments p
   set server_id = c.server_id,
       server_username = c.server_username,
       server_name = s.name
  from public.clients c
  left join public.servers s on s.id = c.server_id
 where c.id = p.client_id
   and p.server_id is null
   and c.server_id is not null;

update public.client_events e
   set meta = coalesce(e.meta, '{}'::jsonb)
              || jsonb_build_object('server_id', c.server_id, 'server_username', c.server_username, 'server_name', s.name)
  from public.clients c
  left join public.servers s on s.id = c.server_id
 where c.id = e.client_id
   and not (coalesce(e.meta, '{}'::jsonb) ? 'server_id')
   and c.server_id is not null;
