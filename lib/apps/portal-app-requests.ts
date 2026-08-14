// lib/apps/portal-app-requests.ts
//
// Cria (idempotente) um pedido de configuração em client_app_requests +
// notifica o admin — usado tanto pelo botão manual "Solicitar configuração"
// (apps sem integração automática) quanto pela escalada automática do
// "Reconfigurar" (app COM integração automática, mas que falhou 2x seguidas
// — ver app/api/client-portal/apps/configure/route.ts). Extraído daqui pra
// não duplicar o insert+notify entre os dois casos.
import { SupabaseClient } from "@supabase/supabase-js";
import { notify, formatClientLabel } from "@/lib/notifications/notify";

export async function fileAppSetupRequest(
  supabaseAdmin: SupabaseClient,
  params: {
    tenantId: string;
    clientId: string;
    clientAppId: string;
    appName: string;
    fieldValues: Record<string, unknown> | null;
  },
): Promise<{ id: string; already_pending: boolean }> {
  const { tenantId, clientId, clientAppId, appName, fieldValues } = params;

  // Idempotente: se já existe um pedido pendente pra esse app, não duplica.
  const { data: existing } = await supabaseAdmin
    .from("client_app_requests")
    .select("id")
    .eq("client_app_id", clientAppId)
    .eq("action", "setup")
    .eq("status", "pending")
    .maybeSingle();

  if (existing) return { id: existing.id, already_pending: true };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("client_app_requests")
    .insert({
      tenant_id: tenantId,
      client_id: clientId,
      client_app_id: clientAppId,
      app_name: appName,
      fields_snapshot: fieldValues || {},
      action: "setup",
      status: "pending",
    })
    .select("id")
    .single();

  if (insErr || !inserted) throw new Error("Erro ao criar pedido de configuração.");

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("display_name, server_username, servers(name)")
    .eq("id", clientId)
    .maybeSingle();

  await notify({
    tenantId,
    type: "app_setup_pending",
    title: "📱 Configuração de app solicitada",
    message: `${formatClientLabel(client?.display_name, client?.server_username, (client?.servers as any)?.name)} pediu ajuda pra configurar "${appName}" pelo portal.`,
    link: "/admin/auditoria?view=aplicativos",
    sourceId: inserted.id,
  });

  return { id: inserted.id, already_pending: false };
}
