-- docs/sql/app_download_logos.sql
-- ✅ 04/10/2026, pedido do Márcio: as 3 logos de download (Computador /
-- Downloader / iPhone) sobem pela tela de Aplicativos (escolher ou colar),
-- valem pra TODOS os apps da conta, e o portal reaproveita (as rotas do
-- portal mandam a URL junto com o download).
create table if not exists public.app_download_logos (
  tenant_id uuid primary key,
  pc_logo_url text,
  downloader_logo_url text,
  ios_logo_url text,
  updated_at timestamptz not null default now()
);
alter table public.app_download_logos enable row level security;
drop policy if exists tenant_isolation on public.app_download_logos;
create policy tenant_isolation on public.app_download_logos
  using (tenant_id = (select tenant_members.tenant_id from tenant_members where tenant_members.user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_members.tenant_id from tenant_members where tenant_members.user_id = auth.uid() limit 1));

-- ✅ R2: as 3 colunas entram em _r2_refs_blob() (senão a limpeza de órfãos
-- apagaria as logos) — rodado em 04/10/2026, ver a definição atual no banco.
