-- docs/sql/system_health_checks.sql
-- 31/08/2026, pedido do Márcio: painel "Sistema" (renomeado de "Crons")
-- reflete tudo que é externo/infraestrutura, não só os cron jobs — VMs
-- (Hetzner/Google), sessões WhatsApp (principal/secundária), proxy
-- dedicado, e status de Supabase/Vercel/Cloudflare/Gemini (grátis+paga).
--
-- Mesmo padrão de cron_health (lib/cron-health.ts): RLS ligado, SEM
-- policy nenhuma — só service_role lê/escreve (via rotas), o browser nunca
-- bate direto nessa tabela. Escrita só pela rota de checagem
-- (app/api/cron/system-health-check/route.ts), disparada por um pg_cron a
-- cada 5min — a página só LÊ o que já está aqui (cache), nunca dispara
-- checagem nenhuma sozinha; só o botão "Sincronizar agora" força uma
-- rodada nova sob demanda.
CREATE TABLE IF NOT EXISTS system_health_checks (
  check_key   text PRIMARY KEY,
  label       text NOT NULL,
  group_key   text NOT NULL,   -- 'infra' | 'whatsapp' | 'externos'
  status      text NOT NULL CHECK (status IN ('ok', 'warn', 'fail')),
  detail      text,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE system_health_checks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Config key/value genérico (só 1 chave por enquanto: validade do proxy
-- dedicado ProxyBR). NÃO é env var de propósito — o proxy vai sendo
-- renovado periodicamente e um env var ficaria obsoleto (exigiria mim +
-- redeploy toda vez). Editável direto na tela "Sistema"
-- (PATCH /api/system-health/proxy-expires) — a ProxyBR não tem API pública
-- de conta/assinatura pra consultar isso sozinho (confirmado 31/08/2026).
-- ============================================================
CREATE TABLE IF NOT EXISTS system_config (
  config_key   text PRIMARY KEY,
  config_value text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

INSERT INTO system_config (config_key, config_value)
VALUES ('proxy_expires_at', '2026-08-31')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================
-- pg_cron: dispara a rota de checagem a cada 5min, o tempo todo (não é
-- pesado — 1 chamada HTTP curta pra Vercel a cada 5min, que por sua vez
-- faz ~9 checagens EXTERNAS curtas em paralelo, timeouts de 6-8s cada).
-- Reaproveita o secret 'cron_control_secret' que JÁ existe no Vault (mesmo
-- x-cron-secret usado pelo reboot da VM do WhatsApp) — mesmo padrão de
-- função + net.http_post usado em billing_native_cron_migration.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION public.system_health_check_trigger()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_control_secret';

  if v_secret is null then
    raise warning '[system_health_check] cron_control_secret ausente no Vault';
    return;
  end if;

  perform net.http_post(
    url := 'https://unigestor.net.br/api/cron/system-health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$function$;

SELECT cron.schedule(
  'system_health_check_5min',
  '*/5 * * * *',
  $$SELECT public.system_health_check_trigger();$$
);
