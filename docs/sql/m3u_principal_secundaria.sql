-- =====================================================================
-- 02/10/2026 — Lista M3U principal e secundária separadas
-- =====================================================================
-- Pedido do Márcio: antes existia só clients.m3u_url e o "Reconfigurar >
-- Secundária" SOBRESCREVIA ela — depois disso o "Principal" mandava a
-- secundária de novo e não dava pra saber qual lista estava em cada app.
-- Regra nova (lib/apps/m3u-lists.ts):
--   * m3u_url            = principal (vem da integração / criação / Gerar no admin)
--   * m3u_url_secondary  = secundária (NaTV: http://r2.|r3.<dns>; outros:
--                          outro domínio, nunca o mesmo da principal)
--   * Configurar = usa a que está salva; Reconfigurar = rotaciona e salva.
--   * client_apps.m3u_list / m3u_list_at = qual lista foi pro app e quando.
alter table public.clients add column if not exists m3u_url_secondary text;
alter table public.client_apps
  add column if not exists m3u_list text,
  add column if not exists m3u_list_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_apps_m3u_list_check') then
    alter table public.client_apps add constraint client_apps_m3u_list_check
      check (m3u_list is null or m3u_list in ('principal', 'secundaria'));
  end if;
end $$;

-- Backfill NaTV: quem está com o espelho (http://r2.<dns>) salvo como
-- principal na verdade está com a SECUNDÁRIA — move pra coluna nova e
-- remonta a principal no formato normal (https://<dns>, mesmo login).
update public.clients c
set m3u_url_secondary = c.m3u_url,
    m3u_url = regexp_replace(c.m3u_url, '^https?://r[0-9]+\.', 'https://')
from public.servers s
where s.id = c.server_id
  and upper(trim(s.name)) = 'NATV'
  and c.m3u_url ~* '^https?://r[0-9]+\.';
