-- 18/09/2026, pedido do Márcio (auditoria de segurança): bloquear o IP por
-- um tempo depois de 5 tentativas de login erradas na tela de admin
-- (/login) — hoje só existia o Turnstile (freia bot automatizado) e o
-- limite genérico do Supabase, sem nada que trave um IP insistindo com
-- senhas erradas pro MESMO e-mail ou testando vários. Tabela pequena
-- (chave = IP), só acessível via service_role (app/login/actions.ts usa o
-- client admin direto) — sem RLS pra anon/authenticated de propósito.
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  ip text PRIMARY KEY,
  failed_count int NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies: só service_role acessa.
