// lib/apps/admin-renewal-notify.ts
// ✅ 03/10/2026, pedido do Márcio ("ativou, envia a mensagem se estiver
// marcado" — igual o Portal, "coloca em todos"): aviso por WhatsApp das
// renovações/ativações de licença feitas pelo ADMIN — AtivaApp, GPC Roku
// (marcar pago), DupleCast (código) e GerenciaApp (renovação grátis).
// Mesmo template "Aplicativo Renovado" do Portal (sendAppRenewalWhatsapp),
// já com o nome do app e o vencimento novo. Fail-soft: nunca lança.
import { SupabaseClient } from "@supabase/supabase-js";
import { sendAppRenewalWhatsapp } from "@/lib/client-portal/fulfillment";

export async function notifyClientAppRenewal(
  supabaseAdmin: SupabaseClient,
  params: { clientAppId: string; expireDate: string | null },
): Promise<void> {
  try {
    const { data: row } = await supabaseAdmin
      .from("client_apps")
      .select("tenant_id, client_id, apps(name), clients(whatsapp_opt_in, servers(whatsapp_session))")
      .eq("id", params.clientAppId)
      .maybeSingle();
    if (!row) return;
    const one = (v: any) => (Array.isArray(v) ? v[0] : v);
    const app = one((row as any).apps);
    const client = one((row as any).clients);
    if (client?.whatsapp_opt_in === false) return; // cliente não aceita WhatsApp
    const server = one(client?.servers);
    await sendAppRenewalWhatsapp(supabaseAdmin, {
      tenantId: (row as any).tenant_id,
      clientId: (row as any).client_id,
      origin: "",
      whatsappSession: server?.whatsapp_session || "default",
      appName: app?.name || "Aplicativo",
      appVencimento: params.expireDate,
    });
  } catch {
    // best-effort — a renovação já foi gravada
  }
}
