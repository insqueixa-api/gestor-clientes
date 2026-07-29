// app/api/client-portal/apps/remove/route.ts
// "Excluir Aplicativo" do Bloco 3 — caminhos possíveis (pedido do Marcio,
// 25/07/2026, revisado 26/07/2026):
//   - App com integração automática (has_integration/handler.useApi): tenta
//     apagar do painel do parceiro e, se der certo, apaga a linha
//     client_apps na sequência — tudo automático, mesmo comportamento de
//     sempre (espelha handleDeleteApp de novo_cliente.tsx).
//   - App sem integração MAS ainda ativo no catálogo (útil só como
//     registro/lembrete, ex: IboSol hoje ou qualquer app 100% manual): não
//     tem como desconfigurar sozinho, então cria um PEDIDO DE REMOÇÃO em
//     client_app_requests (action='removal') + notifica o admin. A linha
//     client_apps só é apagada de verdade quando o admin "Conclui" o pedido
//     na Auditoria (aba Aplicativos) — até lá o app continua aparecendo pro
//     cliente, marcado como "exclusão solicitada".
//   - App DESCONTINUADO (apps.is_active=false, ex: DuplexPlay): sempre apaga
//     na hora, mesmo sem integração — esperar o admin "concluir" um pedido
//     não faz sentido nenhum quando não existe mais painel de parceiro vivo
//     pra desconfigurar. Achado em teste real (26/07/2026): cliente seguia a
//     própria instrução "exclua e configure um novo" e ficava travado com
//     "exclusão solicitada" pra sempre, sem conseguir sair do DuplexPlay
//     sozinho.
import { NextRequest, NextResponse, after } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { PIN_HANDLERS, extractFieldByType, internalAppUrl, logAppActivity } from "@/lib/apps/panel";
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
  let tenantId = "";
  let client_id = "";
  let client_app_id = "";
  let appName = "Aplicativo";
  let supabaseAdmin: ReturnType<typeof makeSupabaseAdmin> = null;

  try {
    supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    client_id = normalizeStr(body?.client_id);
    client_app_id = normalizeStr(body?.client_app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    tenantId = ctx.tenant_id;
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, field_values, apps(name, integration_type, fields_config, is_active)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    appName = (row as any).apps?.name || "Aplicativo";
    const integrationType = String((row as any).apps?.integration_type || "").trim().toUpperCase();
    const fieldsConfig: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const values = row.field_values || {};
    // ✅ CLOUDDY (28/07/2026): tem handler real, mas o login exige resolver
    // um Cloudflare Turnstile — só possível no navegador de verdade do
    // admin (via extensão), nunca no portal. Tratado como "sem integração"
    // aqui — cai no fluxo de pedido manual (client_app_requests) abaixo,
    // igual qualquer app manual — mesmo tendo useApi:true pro admin.
    const handler = integrationType && integrationType !== "CLOUDDY" ? getIntegrationHandler(integrationType) : null;
    const hasWorkingIntegration = !!handler && (handler as any).useApi;
    const appIsActive = (row as any).apps?.is_active !== false;

    // ✅ Sem integração de verdade E ainda ativo no catálogo — vira pedido
    // pro admin, não apaga nada agora. Idempotente: se já existe pedido
    // pendente pra esse app, só confirma (não duplica notificação). App
    // descontinuado pula direto pro delete abaixo, mesmo sem integração.
    if (!hasWorkingIntegration && appIsActive) {
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
          tenant_id: tenantId,
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
        tenantId,
        type: "app_removal_pending",
        title: "🗑️ Exclusão de app solicitada",
        message: `${client?.display_name || "Cliente"} pediu pra remover "${appName}" do portal.`,
        link: "/admin/auditoria?view=aplicativos",
        sourceId: inserted.id,
      });

      return NextResponse.json({ ok: true, data: { pending_admin: true, already_requested: false } }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // ✅ App com integração real — desconfigura no painel do parceiro antes
    // de apagar. App descontinuado sem integração (ex: DuplexPlay) pula essa
    // parte inteira — não existe painel de parceiro vivo pra chamar — e vai
    // direto pro delete abaixo.
    let apiJson: { ok?: boolean; error?: string } | null = null;
    if (hasWorkingIntegration) {
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
      apiJson = await apiRes.json().catch(() => ({} as any));
    }

    // ✅ Remove localmente de qualquer jeito — mesmo comportamento do admin
    // (o botão "REMOVER" de novo_cliente.tsx nunca depende do painel do
    // parceiro pra tirar o app da conta do cliente). Antes, uma falha aqui
    // (app nunca configurado = nada pra apagar no parceiro, MAC vazio, etc.)
    // travava o app na conta do cliente pra sempre, sem nenhuma saída. Se a
    // exclusão no parceiro falhou, loga pro admin conferir manualmente —
    // client_apps já não existe mais, então perder esse rastro pioraria.
    const { error: delErr } = await supabaseAdmin.from("client_apps").delete().eq("id", client_app_id);
    if (delErr) return jsonError("Erro interno", 500);

    after(() =>
      logAppActivity(supabaseAdmin, {
        tenantId,
        clientId: client_id,
        clientAppId: null,
        appName,
        event: !hasWorkingIntegration || apiJson?.ok ? "removed" : "removed_partner_failed",
        detail: !hasWorkingIntegration || apiJson?.ok ? null : { error: apiJson?.error || "Falha ao remover do painel do parceiro." },
      }),
    );

    return NextResponse.json({ ok: true, data: { pending_admin: false } }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (e: any) {
    if (tenantId && client_app_id) {
      try {
        await logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "removed_partner_failed",
          detail: { error: e?.message || "Erro interno inesperado.", unexpected: true },
        });
      } catch {
        // não deixa o log derrubar a resposta de erro
      }
    }
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
