// lib/apps/gpc-roku-registry.ts
//
// Registro de validade por MAC pro GPC Roku (achado 26/08/2026, pedido do
// Márcio — ver docs/sql/gpc_roku_activations.sql): único membro cobrado da
// família GerenciaApp, ele quem controla ativação/validade, não o parceiro.
// Usado por lib/apps/orchestration.ts (configureClientApp, na criação/
// reconfiguração), lib/client-portal/fulfillment.ts (markAppRenewalPaid, no
// pagamento da renovação) e app/api/admin/apps/gpc-roku/mark-paid/route.ts
// (Márcio marca manualmente quando o cliente paga por fora do Portal) —
// nunca duplicar a query/chamada nesses 3 lugares.
import { SupabaseClient } from "@supabase/supabase-js";
import { findFieldByType, internalAppUrl } from "@/lib/apps/panel";

export type GpcRokuActivation = {
  id: string;
  tenant_id: string;
  mac: string;
  client_id: string | null;
  client_app_id: string | null;
  status: "trial" | "paid";
  valid_until: string;
};

export function normalizeMac(mac: string): string {
  return String(mac || "").trim().toUpperCase();
}

export async function getGpcRokuActivation(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  mac: string,
): Promise<GpcRokuActivation | null> {
  const { data } = await supabaseAdmin
    .from("gpc_roku_activations")
    .select("id, tenant_id, mac, client_id, client_app_id, status, valid_until")
    .eq("tenant_id", tenantId)
    .eq("mac", normalizeMac(mac))
    .maybeSingle();
  return (data as GpcRokuActivation) || null;
}

export async function upsertGpcRokuActivation(
  supabaseAdmin: SupabaseClient,
  params: {
    tenantId: string;
    mac: string;
    clientId?: string | null;
    clientAppId?: string | null;
    status: "trial" | "paid";
    validUntil: string;
    // ✅ "Quem fez" (26/08/2026, pedido do Márcio, painel de gerenciamento)
    // — e-mail do admin (ação manual) ou "Sistema (...)" (automático).
    // Omitido (undefined) = não mexe no valor já salvo (JSON.stringify
    // remove a chave, então o upsert não sobrescreve activated_by na
    // linha existente — usado quando só client_id/client_app_id mudam
    // numa reconfiguração de MAC já conhecido).
    activatedBy?: string;
  },
): Promise<void> {
  await supabaseAdmin
    .from("gpc_roku_activations")
    .upsert(
      {
        tenant_id: params.tenantId,
        mac: normalizeMac(params.mac),
        client_id: params.clientId ?? null,
        client_app_id: params.clientAppId ?? null,
        status: params.status,
        valid_until: params.validUntil,
        activated_by: params.activatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,mac" },
    );
}

// Sempre `YYYY-MM-DD` — mesmo formato usado em client_apps.field_values
// (campo tipo "date") e no expire_date que os handlers do GerenciaApp
// mandam pro parceiro.
export function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ✅ Núcleo único do "marca como pago, 10 anos a contar de agora" — chamado
// tanto quando o cliente paga pelo Portal (lib/client-portal/fulfillment.ts)
// quanto quando o Márcio marca manualmente pelo admin porque o cliente pagou
// por fora (app/api/admin/apps/gpc-roku/mark-paid/route.ts). Só troca o
// vencimento no painel real do GerenciaApp + grava no registro — quem chama
// decide o que fazer depois (notificar, mandar WhatsApp, marcar pagamento
// como concluído etc.), porque isso difere entre os 2 casos.
export async function renewGpcRokuTenYears(
  supabaseAdmin: SupabaseClient,
  params: {
    tenantId: string;
    clientId: string;
    clientAppId: string;
    macValue: string;
    fieldsConfig: any[];
    fieldValues: Record<string, string>;
    // ✅ Quem acionou (26/08/2026, painel de gerenciamento): e-mail do admin
    // quando chamado pelo botão manual "Marcar como pago"; sem isso (fluxo
    // automático de pagamento no Portal), assume o texto padrão abaixo.
    activatedBy?: string;
  },
): Promise<{ ok: true; expireDate: string } | { ok: false; error: string }> {
  const { data: integ } = await supabaseAdmin
    .from("app_integrations")
    .select("api_url")
    .eq("app_name", "GERENCIAAPP")
    .maybeSingle();

  const targetExpire = new Date();
  targetExpire.setFullYear(targetExpire.getFullYear() + 10);
  const targetExpireDate = formatDateOnly(targetExpire);

  let apiJson: any;
  try {
    const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
    const apiRes = await fetch(internalAppUrl("/api/integrations/apps/gerenciaapp"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({
        action: "renew",
        base_url: integ?.api_url || "",
        macValue: params.macValue,
        expire_date: targetExpireDate,
      }),
    });
    apiJson = await apiRes.json().catch(() => ({} as any));
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao conectar no GerenciaApp." };
  }

  if (!apiJson?.ok) {
    return { ok: false, error: `GerenciaApp: ${apiJson?.error || "falha ao renovar"}` };
  }

  await upsertGpcRokuActivation(supabaseAdmin, {
    tenantId: params.tenantId,
    mac: params.macValue,
    clientId: params.clientId,
    clientAppId: params.clientAppId,
    status: "paid",
    validUntil: targetExpireDate,
    activatedBy: params.activatedBy || "Sistema (pagamento no Portal)",
  });

  const dateField = findFieldByType(params.fieldsConfig, "date");
  if (dateField) {
    const fieldKey = String(dateField.id || dateField.label);
    await supabaseAdmin
      .from("client_apps")
      .update({ field_values: { ...params.fieldValues, [fieldKey]: targetExpireDate } })
      .eq("id", params.clientAppId);
  }

  return { ok: true, expireDate: targetExpireDate };
}
