-- Backup manual da lista "Números Permitidos" (chamadas que passam pelo
-- filtro de rejeição automática no WhatsApp) — pedido do Márcio, 10/08/2026.
--
-- Motivo: a lista vive só num arquivo em disco na VM
-- (whatsapp-service/src/sessionManager.js, auth/_config/<sessionKey>/
-- wa-config.json). Um Hard Reset em si não apaga esse arquivo (ele mora
-- fora da pasta de credenciais que o hard reset limpa), mas o Márcio já
-- perdeu a lista "algumas vezes" — a causa raiz era um bug no front (ver
-- app/admin/settings/whatsapp/page.tsx: qualquer saveConfig() disparado
-- antes do 1º fetchConfig() bem-sucedido mandava allowedNumbers=[] e
-- SOBRESCREVIA a lista real, mesmo em ações sem relação nenhuma como
-- "Rejeitar Chamadas" — corrigido). Esta tabela é uma segunda camada de
-- segurança: backup/restore manual, puro texto, sem lógica automática.
create table if not exists public.whatsapp_allowed_numbers_backup (
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  session_label  text not null check (session_label in ('principal', 'secundario')),
  allowed_numbers jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  primary key (tenant_id, session_label)
);

comment on table public.whatsapp_allowed_numbers_backup is
  'Backup manual (botão "Backup"/"Importar" na tela WhatsApp) da lista allowedNumbers que hoje só existe em disco na VM.';
