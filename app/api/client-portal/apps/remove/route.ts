// app/api/client-portal/apps/remove/route.ts
// "Remover" do Bloco 3 — tenta apagar do painel do parceiro (se o app tiver
// integração) e, em seguida, apaga a linha client_apps. Espelha
// handleDeleteApp de novo_cliente.tsx, server-to-server.
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { PIN_HANDLERS, extractFieldByType, internalAppUrl } from "@/lib/apps/panel";

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
      .select("id, field_values, apps(integration_type, fields_config)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const integrationType = String((row as any).apps?.integration_type || "").trim().toUpperCase();
    const fieldsConfig: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const values = row.field_values || {};
    const handler = integrationType ? getIntegrationHandler(integrationType) : null;

    // Só tenta apagar do painel se o app tiver integração de verdade — do
    // contrário só existe a linha local, e removê-la já basta.
    if (handler && (handler as any).useApi) {
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
        appName: (row as any).apps?.name,
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
    }

    const { error: delErr } = await supabaseAdmin.from("client_apps").delete().eq("id", client_app_id);
    if (delErr) return jsonError("Erro interno", 500);

    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
