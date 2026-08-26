// lib/apps/duplecast-renewal.ts
//
// Renovação do Duplecast usando 1 código disponível da conta de revenda
// (achado 26/08/2026, pedido do Márcio) — ao pagar a renovação pelo Portal,
// consome 1 código (sempre "1 Year", mesmo período do plano cobrado —
// apps.license_period="annual" — confirmado ao vivo na lista de códigos)
// e confirma o vencimento real direto no dispositivo (mac+device_key), sem
// confiar só na resposta da ativação em si. Ver whatsapp-service/src/
// duplecastClient.js (action "renew_code") pra lógica real na VM — login de
// revenda, escolhe o 1º código "unused" sozinho, ativa, reloga como
// dispositivo e lê "Expire on ..." de volta.
import { SupabaseClient } from "@supabase/supabase-js";
import { findFieldByType } from "@/lib/apps/panel";

export async function renewDuplecastWithCode(
  supabaseAdmin: SupabaseClient,
  params: {
    tenantId: string;
    clientAppId: string;
    macValue: string;
    deviceKey: string;
    fieldsConfig: any[];
    fieldValues: Record<string, string>;
  },
): Promise<{ ok: true; expireDate: string; code: string } | { ok: false; error: string }> {
  const { data: partner } = await supabaseAdmin
    .from("api_integrations")
    .select("login_email, login_password, api_url, credits_available")
    .eq("tenant_id", params.tenantId)
    .eq("provider", "DUPLECAST")
    .eq("is_active", true)
    .maybeSingle();

  if (!partner?.login_email || !partner?.login_password || !partner?.api_url) {
    return { ok: false, error: "Parceiro Duplecast sem credenciais configuradas (Configurações → Parceiros)." };
  }

  const vmBaseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const vmToken = process.env.UNIGESTOR_WA_TOKEN;
  if (!vmBaseUrl || !vmToken) {
    return { ok: false, error: "VM não configurada (UNIGESTOR_WA_BASE_URL/UNIGESTOR_WA_TOKEN)." };
  }

  let vmJson: any;
  try {
    const siteRoot = new URL(partner.api_url).origin;
    const vmRes = await fetch(`${vmBaseUrl.replace(/\/$/, "")}/duplecast/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${vmToken}` },
      body: JSON.stringify({
        action: "renew_code",
        baseUrl: siteRoot,
        username: partner.login_email,
        password: partner.login_password,
        macValue: params.macValue,
        deviceKey: params.deviceKey,
      }),
      // ✅ 58s (mesmo orçamento de app/api/integrations/apps/duplecast/
      // route.ts) — dá espaço pro retry de 2 tentativas do Cloudflare na VM.
      signal: AbortSignal.timeout(58000),
    });
    vmJson = await vmRes.json().catch(() => ({} as any));
    if (!vmRes.ok || !vmJson?.ok) {
      return { ok: false, error: vmJson?.error || `Falha na VM (HTTP ${vmRes.status}).` };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao conectar com a VM." };
  }

  // ⚠️ Não confia só em `activated` (status HTTP do POST de ativação) — exige
  // também o `expireDate` lido de volta direto do dispositivo (mesma
  // filosofia de resolveAppativaAppRenewal: reconfirma na fonte, nunca só no
  // que o parceiro respondeu na hora).
  if (!vmJson.activated || !vmJson.expireDate) {
    return { ok: false, error: "Duplecast não confirmou a ativação — confira manualmente o painel." };
  }

  const dateField = findFieldByType(params.fieldsConfig, "date");
  if (dateField) {
    const fieldKey = String(dateField.id || dateField.label);
    await supabaseAdmin
      .from("client_apps")
      .update({ field_values: { ...params.fieldValues, [fieldKey]: vmJson.expireDate } })
      .eq("id", params.clientAppId);
  }

  // ✅ Decrementa localmente (best-effort) em vez de re-sincronizar — evita
  // outro round-trip pelo Cloudflare só pra isso; o botão "Sincronizar" na
  // aba Parceiros sempre corrige se ficar dessincronizado.
  try {
    await supabaseAdmin
      .from("api_integrations")
      .update({
        credits_available: Math.max(0, Number(partner.credits_available ?? 0) - 1),
        credits_last_sync_at: new Date().toISOString(),
      })
      .eq("tenant_id", params.tenantId)
      .eq("provider", "DUPLECAST");
  } catch {
    // não bloqueia a renovação por falha ao atualizar o contador local
  }

  return { ok: true, expireDate: vmJson.expireDate, code: vmJson.code };
}
