-- docs/sql/apps_download_info.sql
-- ✅ 04/10/2026, pedido do Márcio: download por aparelho no cadastro do app.
--   pc_url          → Computador: botão "Baixar"
--   downloader_code → Android / Google TV / Fire TV: código do app Downloader
--   ios_url         → iPhone: link oficial da App Store (evita app falso)
-- Vazio = cai no que a AtivaApp manda (appativa_meta.downloader_code / links).
alter table public.apps add column if not exists download_info jsonb not null default '{}'::jsonb;
