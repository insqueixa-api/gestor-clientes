-- client_message_jobs nunca teve coluna updated_at, mas o self-healing do
-- cron (app/api/whatsapp/envio_programado/route.ts, "revive jobs travados em
-- SENDING") sempre filtrou por ela — gerando erro 42703 a cada 2min desde
-- sempre (achado via log do Supabase em 24/07/2026). Mesmo padrão já usado em
-- coupons/client_app_requests (função set_updated_at() já existe no banco).
ALTER TABLE public.client_message_jobs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_client_message_jobs_updated_at ON client_message_jobs;
CREATE TRIGGER trg_client_message_jobs_updated_at
  BEFORE UPDATE ON client_message_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
