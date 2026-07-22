// app/api/client-portal/apps/check-validity/route.ts
// Botão "Verificar validade" do Bloco 3 — só consulta o vencimento real no
// painel do parceiro (Duplecast/IboSol/IboPro/GerenciaApp-family), sem
// criar/alterar nada. Só disponível pros apps que não são parceria (esses
// não têm vencimento próprio rastreado) e cuja integração suporta uma
// consulta somente leitura (CHECK_VALIDITY_HANDLERS).
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { CHECK_VALIDITY_HANDLERS, extractFieldByType, findFieldByType, internalAppUrl } from "@/lib/apps/panel";

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

    // ✅ App "parceria" não tem vencimento próprio rastreado — não faz
    // sentido "verificar validade".
    const values = row.field_values || {};
    if (String(values["_config_cost"] || "") === "partnership") {
      return jsonError("Esse aplicativo não tem vencimento próprio — está incluso no plano.", 400);
    }

    const appName = (row as any).apps?.name || "Aplicativo";
    const integrationType = String((row as any).apps?.integration_type || "").trim().toUpperCase();
    const fieldsConfig: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];

    const handler = integrationType ? getIntegrationHandler(integrationType) : null;
    if (!handler || !(handler as any).useApi || !CHECK_VALIDITY_HANDLERS.has((handler as any).actionPrefix)) {
      return jsonError("Verificação de validade não disponível para este aplicativo.", 400);
    }

    const macValue = extractFieldByType(fieldsConfig, values, "mac");
    if (!macValue) {
      return jsonError("Preencha o Device ID (MAC) antes de verificar.", 400);
    }
    const deviceKey = extractFieldByType(fieldsConfig, values, "device_key");

    // ✅ GerenciaApp-family busca por "username_servidor" (igual ao delete),
    // não só pelo MAC — precisa dos dados do servidor do cliente.
    let username = "";
    if ((handler as any).actionPrefix === "GERENCIAAPP") {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("server_username, server_id")
        .eq("id", client_id)
        .single();
      const { data: server } = client?.server_id
        ? await supabaseAdmin.from("servers").select("name").eq("id", client.server_id).maybeSingle()
        : { data: null };
      const serverNameClean = String(server?.name || "Servidor").replace(/\s+/g, "");
      username = client ? `${client.server_username}_${serverNameClean}` : "";
    }

    const { data: integ } = await supabaseAdmin
      .from("app_integrations")
      .select("api_url")
      .eq("app_name", integrationType)
      .maybeSingle();

    const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
    const apiRes = await fetch(internalAppUrl((handler as any).apiEndpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({
        action: "check",
        macValue,
        mac: macValue,
        mac_address: macValue,
        username,
        deviceKey,
        app_name: appName,
        base_url: integ?.api_url || "",
      }),
    });
    const apiJson = await apiRes.json().catch(() => ({} as any));

    if (!apiJson?.ok) {
      return jsonError(apiJson?.error || "Falha ao consultar o painel do parceiro.", 400);
    }

    const dateField = findFieldByType(fieldsConfig, "date");
    if (apiJson.expireDate && dateField) {
      const fieldKey = String(dateField.id || dateField.label);
      await supabaseAdmin
        .from("client_apps")
        .update({ field_values: { ...values, [fieldKey]: apiJson.expireDate } })
        .eq("id", client_app_id);
    }

    return NextResponse.json(
      { ok: true, expireDate: apiJson.expireDate || null },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
