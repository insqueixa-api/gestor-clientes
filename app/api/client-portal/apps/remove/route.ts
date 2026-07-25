// app/api/client-portal/apps/remove/route.ts
// "Excluir Aplicativo" do Bloco 3 — dois caminhos (pedido do Marcio,
// 25/07/2026):
//   - App com integração automática (has_integration/handler.useApi): tenta
//     apagar do painel do parceiro e, se der certo, apaga a linha
//     client_apps na sequência — tudo automático, mesmo comportamento de
//     sempre (espelha handleDeleteApp de novo_cliente.tsx).
//   - App sem integração (útil só como registro/lembrete, ex: IboSol hoje
//     ou qualquer app 100% manual): não tem como desconfigurar sozinho, então
//     cria um PEDIDO DE REMOÇÃO em client_app_requests (action='removal') +
//     notifica o admin. A linha client_apps só é apagada de verdade quando
//     o admin "Conclui" o pedido na Auditoria (aba Aplicativos) — até lá o
//     app continua aparecendo pro cliente, marcado como "exclusão
//     solicitada".
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { PIN_HANDLERS, extractFieldByType, internalAppUrl } from "@/lib/apps/panel";
import { notify } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const client_app_id = normalizeStr(body?.client_app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, field_values, apps(name, integration_type, fields_config)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const appName = (row as any).apps?.name || "Aplicativo";
    const integrationType = String((row as any).apps?.integration_type || "").trim().toUpperCase();
    const fieldsConfig: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const values = row.field_values || {};
    const handler = integrationType ? getIntegrationHandler(integrationType) : null;
    const hasWorkingIntegration = !!handler && (handler as any).useApi;

    // ✅ Sem integração de verdade — vira pedido pro admin, não apaga nada
    // agora. Idempotente: se já existe pedido pendente pra esse app, só
    // confirma (não duplica notificação).
    if (!hasWorkingIntegration) {
      const { data: existing } = await supabaseAdmin
        .from("client_app_requests")
        .select("id")
        .eq("client_app_id", client_app_id)
        .eq("action", "removal")
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ ok: true, data: { pending_admin: true, already_requested: true } }, { status: 200, headers: NO_STORE_HEADERS });
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("client_app_requests")
        .insert({
          tenant_id: ctx.tenant_id,
          client_id,
          client_app_id,
          app_name: appName,
          fields_snapshot: values,
          action: "removal",
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr || !inserted) return jsonError("Erro interno", 500);

      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("display_name")
        .eq("id", client_id)
        .maybeSingle();

      await notify({
        tenantId: ctx.tenant_id,
        type: "app_removal_pending",
        title: "🗑️ Exclusão de app solicitada",
        message: `${client?.display_name || "Cliente"} pediu pra remover "${appName}" do portal.`,
        link: "/admin/auditoria?view=aplicativos",
        sourceId: inserted.id,
      });

      return NextResponse.json({ ok: true, data: { pending_admin: true, already_requested: false } }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // ✅ App com integração real — desconfigura no painel do parceiro e
    // apaga a linha na sequência, tudo automático (comportamento de sempre).
    const macValue = extractFieldByType(fieldsConfig, values, "mac");
    const deviceKey = extractFieldByType(fieldsConfig, values, "device_key");

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("server_username, server_password, server_id")
      .eq("id", client_id)
      .single();

    const { data: server } = client?.server_id
      ? await supabaseAdmin.from("servers").select("name").eq("id", client.server_id).maybeSingle()
      : { data: null };
    const serverNameClean = String(server?.name || "Servidor").replace(/\s+/g, "");
    const finalServerName = client ? `${client.server_username}_${serverNameClean}` : "";

    const { data: integ } = await supabaseAdmin
      .from("app_integrations")
      .select("api_url, pin")
      .eq("app_name", integrationType)
      .maybeSingle();

    const payloadPassword = PIN_HANDLERS.has((handler as any).actionPrefix)
      ? integ?.pin || ""
      : client?.server_password || "";

    const payload = (handler as any).buildDeletePayload({
      username: client?.server_username || "",
      finalServerName,
      serverName: serverNameClean,
      macValue,
      appName,
      password: payloadPassword,
    });

    const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
    const apiRes = await fetch(internalAppUrl((handler as any).apiEndpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ ...payload, base_url: integ?.api_url || "", deviceKey }),
    });
    const apiJson = await apiRes.json().catch(() => ({} as any));

    if (!apiJson?.ok) {
      return jsonError(apiJson?.error || "Falha ao remover do painel do parceiro.", 400);
    }

    const { error: delErr } = await supabaseAdmin.from("client_apps").delete().eq("id", client_app_id);
    if (delErr) return jsonError("Erro interno", 500);

    return NextResponse.json({ ok: true, data: { pending_admin: false } }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
