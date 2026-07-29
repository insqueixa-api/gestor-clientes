// app/api/admin/apps/check-validity/route.ts
//
// "Atualizar" do painel "Concluir renovação de licença" da Auditoria
// (AppRenewalModal.tsx) — mesma lógica de app/api/client-portal/apps/
// check-validity/route.ts, mas autenticado como admin (Bearer = access_token
// da sessão do admin, checa tenant_members) em vez de sessão do portal.
// Usado depois de o Márcio já ter pago a licença de verdade ao
// desenvolvedor do app, por fora do sistema — só confirma o vencimento
// real no painel do parceiro, sem criar/alterar nada lá.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getIntegrationHandler } from "@/lib/integrations";
import { CHECK_VALIDITY_HANDLERS, extractFieldByType, internalAppUrl } from "@/lib/apps/panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const tenantId = String(body?.tenant_id || "").trim();
  const clientAppId = String(body?.client_app_id || "").trim();
  if (!tenantId || !clientAppId) {
    return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400 });
  }

  const { data: mem, error: memErr } = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (memErr || !mem) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, client_id, field_values, apps(name, integration_type, fields_config)")
      .eq("id", clientAppId)
      .eq("tenant_id", tenantId)
      .single();
    if (rowErr || !row) return NextResponse.json({ ok: false, error: "Aplicativo não encontrado" }, { status: 404 });

    const integrationType = String((row as any).apps?.integration_type || "").trim().toUpperCase();
    const fieldsConfig: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const values = row.field_values || {};
    const appName = (row as any).apps?.name || "Aplicativo";

    const handler = integrationType ? getIntegrationHandler(integrationType) : null;
    if (!handler || !(handler as any).useApi || !CHECK_VALIDITY_HANDLERS.has((handler as any).actionPrefix)) {
      return NextResponse.json({ ok: false, error: "Verificação de validade não disponível para este aplicativo." }, { status: 400 });
    }

    const macValue = extractFieldByType(fieldsConfig, values, "mac");
    if (!macValue) {
      return NextResponse.json({ ok: false, error: "Device ID (MAC) não preenchido." }, { status: 400 });
    }
    const deviceKey = extractFieldByType(fieldsConfig, values, "device_key");

    // GerenciaApp-family busca por "username_servidor" — precisa dos dados
    // do servidor do cliente (mesma regra de check-validity/route.ts do
    // portal).
    let username = "";
    if ((handler as any).actionPrefix === "GERENCIAAPP") {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("server_username, server_id")
        .eq("id", row.client_id)
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
      return NextResponse.json({ ok: false, error: apiJson?.error || "Falha ao consultar o painel do parceiro." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, expireDate: apiJson.expireDate || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno" }, { status: 500 });
  }
}
