-- =====================================================================
-- 02/10/2026 — Refactor de aplicativos: snapshot da AtivaApp por app
-- =====================================================================
-- docs/apps-refactor/PLANO.md. Guarda os dados que a AtivaApp devolve pro
-- app vinculado (logo, avaliação, classe, descrição, plano, links por
-- plataforma, código Downloader) — formato em lib/apps/appativa-catalog.ts.
-- É o PADRÃO: icon_url / tier / device_types preenchidos à mão continuam
-- valendo por cima (override). Atualizado pelo Sync do catálogo
-- (api/integrations/appativa/list-apps) e ao salvar o app no modal.
-- Aditivo — nada existente muda.
alter table public.apps
  add column if not exists appativa_meta jsonb;
