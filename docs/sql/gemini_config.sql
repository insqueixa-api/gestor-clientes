-- ✅ 08/10/2026, pedido do Márcio: configuração do Gemini no painel
-- (Configurações → API de Integrações → Parceiros: 2 cards lado a lado,
-- "Gemini Paga" e "Gemini Gratuita"), em vez de só em env var e código. Se
-- o Google aposentar/sobrecarregar um modelo, ele troca a ordem aqui sem
-- deploy.
--   • cada chave tem a SUA ordem de modelos (primário, secundário, ...);
--   • ordem de tentativa: paga × modelos da paga, depois gratuita × modelos
--     da gratuita (lib/whatsapp/gemini-client.ts::callGemini);
--   • lista de modelos disponíveis (botão "Buscar modelos") + último teste.
-- Só o servidor lê/grava (rotas /api/admin/settings/gemini/*, service
-- role): a chave nunca vai pro navegador. Sem linha aqui, o código cai nas
-- env vars GEMINI_API_KEY_PAID / GEMINI_API_KEY e na lista padrão.

drop table if exists public.gemini_config;
create table public.gemini_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  paid_api_key text,
  paid_models text[] not null default array['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'],
  free_api_key text,
  free_models text[] not null default array['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'],
  available_models jsonb not null default '[]'::jsonb,
  models_synced_at timestamptz,
  last_test jsonb,
  last_test_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.gemini_config enable row level security;

drop policy if exists service_role_all on public.gemini_config;
create policy service_role_all on public.gemini_config
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
