-- 18/09/2026, pedido do Márcio: MFA (TOTP) opcional pro admin, com um
-- caminho de recuperação caso ele perca o celular/app autenticador — envia
-- um código de 6 dígitos pro WhatsApp OU e-mail JÁ CADASTRADOS (nunca um
-- contato digitado na hora, pra ninguém conseguir redirecionar a
-- recuperação) e desativa o MFA se o código bater. Só acessível via
-- service_role (as 2 rotas de API fazem toda a leitura/escrita) — sem
-- policy nenhuma pra anon/authenticated de propósito.
CREATE TABLE IF NOT EXISTS public.mfa_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_requests_user_created
  ON public.mfa_recovery_requests (user_id, created_at DESC);

ALTER TABLE public.mfa_recovery_requests ENABLE ROW LEVEL SECURITY;
-- Sem policies: só service_role acessa (as rotas de API usam o client admin).
