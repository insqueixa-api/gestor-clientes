// app/api/integrations/key-expiry-check/route.ts
// ✅ 05/10/2026, pedido do Márcio: chave de API de servidor com validade
// (Elite: 90 dias) avisa no sino E por e-mail 2 dias antes de vencer.
// Chamada 1x/dia pelo pg_cron (job api_key_expiry_check_daily). O segredo do
// cron fica SÓ no Vault ("api_key_expiry_cron_secret") e é conferido no
// próprio banco (RPC check_vault_cron_secret, só service_role) — sem env var
// na Vercel. A chave do Elite em si fica em server_integrations.api_token.
//
// - sino: notify() faz upsert por (tenant, tipo, integração) → 1 aviso só,
//   atualizado a cada dia com a contagem; some sozinho quando a chave é
//   trocada (validade nova > 2 dias → resolveNotification);
// - e-mail: 1 por validade (api_token_expiry_alerted_for guarda pra qual
//   validade já foi mandado) + 1 no dia em que vence de fato.
import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/api/auth";
import { notify, resolveNotification } from "@/lib/notifications/notify";
import { sendAdminEmail } from "@/lib/notifications/send-admin-email";
import { formatDateBR } from "@/lib/date-br";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WARN_DAYS = 2;
const DAY_MS = 86400000;

function providerLabel(p: string) {
  const u = String(p || "").toUpperCase();
  if (u === "NATV") return "NaTV";
  if (u === "FAST") return "Fast";
  if (u === "ELITE") return "Elite";
  return u || "Servidor";
}

export async function POST(req: Request) {
  const sb = adminSupabase();
  const received = (req.headers.get("authorization") || "").replace(/^Bearers+/i, "").trim();
  const { data: allowed } = await sb.rpc("check_vault_cron_secret", {
    p_name: "api_key_expiry_cron_secret",
    p_secret: received,
  });
  if (allowed !== true) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: rows, error } = await sb
    .from("server_integrations")
    .select("id, tenant_id, provider, integration_name, api_token_expires_at, api_token_expiry_alerted_for, api_token_expired_alerted_for, is_active")
    .eq("is_active", true)
    .not("api_token_expires_at", "is", null);
  if (error) {
    console.error("[KEY-EXPIRY] falha ao ler integrações", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.UNIGESTOR_APP_URL || "https://unigestor.net.br";
  const link = "/admin/settings/api-server";
  const result: { id: string; days: number; action: string }[] = [];

  for (const r of rows || []) {
    const exp = new Date(r.api_token_expires_at as string);
    const days = Math.ceil((exp.getTime() - Date.now()) / DAY_MS);
    const name = `${providerLabel(r.provider)}${r.integration_name ? ` (${r.integration_name})` : ""}`;

    if (days > WARN_DAYS) {
      // chave trocada/renovada → fecha o aviso antigo, se houver
      await resolveNotification(r.tenant_id, "chave_api_vencendo", r.id);
      result.push({ id: r.id, days, action: "ok" });
      continue;
    }

    const expired = days <= 0;
    const title = expired ? `🔑 Chave da API ${name} venceu` : `🔑 Chave da API ${name} vence em ${days} dia${days === 1 ? "" : "s"}`;
    const message = expired
      ? `A chave de API da integração ${name} venceu em ${formatDateBR(exp)}. Testes, renovações e saldo desse servidor param de funcionar até você gerar uma chave nova no painel e trocar em Configurações → Integrações.`
      : `A chave de API da integração ${name} vence em ${formatDateBR(exp)}. Gere uma chave nova no painel do servidor (mesmas permissões) e troque em Configurações → Integrações antes disso.`;

    try {
      await notify({ tenantId: r.tenant_id, type: "chave_api_vencendo", title, message, link, sourceId: r.id });
    } catch (e) {
      console.error("[KEY-EXPIRY] falha no sino", (e as any)?.message);
    }

    // e-mail: 1x no aviso de 2 dias e 1x quando vence de fato
    const expKey = exp.toISOString();
    const alreadyWarned = r.api_token_expiry_alerted_for && new Date(r.api_token_expiry_alerted_for).toISOString() === expKey;
    const alreadyExpired = r.api_token_expired_alerted_for && new Date(r.api_token_expired_alerted_for).toISOString() === expKey;
    const shouldEmail = expired ? !alreadyExpired : !alreadyWarned;

    if (shouldEmail) {
      const html = `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
          <div style="background-color: ${expired ? "#991b1b" : "#d97706"}; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">${title}</h2>
          </div>
          <div style="padding: 20px;">
            <p style="margin-top: 0;">${message}</p>
            <div style="text-align: center; margin: 30px 0 10px;">
              <a href="${baseUrl}${link}" style="background-color: #10b981; color: white; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-weight: bold; font-size: 13px;">Abrir Integrações</a>
            </div>
          </div>
          <div style="background-color: #0f141a; text-align: center; padding: 20px 15px; font-size: 11px; color: #eaeaea;">
            Este é um e-mail automático do UniGestor.
          </div>
        </div>`;
      try {
        await sendAdminEmail(title, html);
        await sb
          .from("server_integrations")
          .update(expired ? { api_token_expired_alerted_for: expKey } : { api_token_expiry_alerted_for: expKey })
          .eq("id", r.id);
      } catch (e) {
        console.error("[KEY-EXPIRY] falha no e-mail", (e as any)?.message);
      }
    }
    result.push({ id: r.id, days, action: shouldEmail ? "sino+email" : "sino" });
  }

  return NextResponse.json({ ok: true, checked: result.length, result });
}
