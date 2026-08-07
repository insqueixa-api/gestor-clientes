-- idx_epg_programas_inicio (btree solto em "inicio", 744 kB) — confirmado
-- não usado por nenhuma query real. O único consumidor de epg_programas no
-- projeto é app/api/epg/sync/sync-claro/route.ts (real, ativo via cron
-- 'epg_sync_daily' todo dia às 05:30 UTC — não é código do projeto antigo):
--   - upsert onConflict "id_exibicao" — não usa inicio
--   - delete().lt("fim", corte) — filtra por "fim", não por "inicio"
--   - order("id_canal").order("inicio") — usa id_canal PRIMEIRO, então já é
--     coberto pelo índice composto idx_epg_programas_canal_inicio
--     (id_canal, inicio), que continua existindo e é bastante usado.
-- Os únicos 3 scans desse índice na vida dele batem com consulta manual
-- avulsa (Supabase Studio), não com o app.

DROP INDEX IF EXISTS public.idx_epg_programas_inicio;
