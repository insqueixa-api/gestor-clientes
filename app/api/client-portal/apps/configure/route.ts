// app/api/client-portal/apps/configure/route.ts
// "Reconfigurar" do Bloco 3 — chama de verdade o painel do parceiro
// (Duplecast/GerenciaApp-family/IboSol/IboPro/QuickPlayer), server-to-server
// via x-internal-secret. Espelha handleConfigApp de novo_cliente.tsx, mas
// sem sessão admin — os dados (username/senha/servidor) vêm de `clients`.
import { NextRequest, NextResponse, after } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { PIN_HANDLERS, extractFieldByType, findFieldByType, internalAppUrl, buildM3uUrlFromDns, logAppActivity } from "@/lib/apps/panel";

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
    if (!handler || !(handler as any).useApi) {
      return jsonError("Esse aplicativo não tem integração automática disponível.", 400);
    }

    // ⚠️ Removido em 25/07/2026 (pedido do Márcio): a licença do app é paga
    // ao DESENVOLVEDOR do app, não a ele — o pagamento pelo portal
    // ("Renovar aplicativo") é só uma cobrança avulsa opcional, nunca um
    // pré-requisito. O app funciona normalmente até a validade dele vencer
    // de verdade no painel do parceiro (checável via "check"), e mesmo
    // vencido continua sendo possível reconfigurar — quem decide isso é o
    // painel do parceiro, não o nosso sistema. Achado em produção: a trava
    // bloqueava retroativamente dezenas de clientes reais que já usavam o
    // app normalmente antes dessa coluna existir.

    const macValue = extractFieldByType(fieldsConfig, values, "mac");
    if (!macValue) {
      return jsonError("Preencha o Device ID (MAC) antes de configurar.", 400);
    }
    const deviceKey = extractFieldByType(fieldsConfig, values, "device_key");

    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("server_username, server_password, server_id, m3u_url")
      .eq("id", client_id)
      .single();
    if (clientErr || !client) return jsonError("Cliente não encontrado", 404);

    const { data: server } = await supabaseAdmin
      .from("servers")
      .select("name, dns")
      .eq("id", client.server_id)
      .maybeSingle();
    const serverNameClean = String(server?.name || "Servidor").replace(/\s+/g, "");
    const finalServerName = `${client.server_username}_${serverNameClean}`;

    let m3uUrl = String(client.m3u_url || "").trim();
    if (!m3uUrl) {
      m3uUrl = buildM3uUrlFromDns(
        Array.isArray(server?.dns) ? server.dns : [],
        client.server_username,
        client.server_password || "",
      );
    }

    const { data: integ } = await supabaseAdmin
      .from("app_integrations")
      .select("api_url, pin")
      .eq("app_name", integrationType)
      .maybeSingle();

    const payloadPassword = PIN_HANDLERS.has((handler as any).actionPrefix)
      ? integ?.pin || ""
      : client.server_password || "";

    const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
    const apiEndpointUrl = internalAppUrl((handler as any).apiEndpoint);

    // ✅ "Configurar" agora é deletar (tolerante a "não encontrado") + criar
    // — pedido do Márcio (25/07/2026): muitos clientes já têm o app
    // configurado de verdade no painel do parceiro de antes do Bloco 3
    // existir. Sem isso, adicionar esse app pelo portal e clicar Configurar
    // podia colidir com uma entrada antiga pro mesmo MAC. O resultado do
    // delete nunca é checado aqui de propósito — "nada pra apagar" é
    // exatamente o caso normal (app nunca configurado antes).
    try {
      const deletePayload = (handler as any).buildDeletePayload({
        username: client.server_username,
        finalServerName,
        serverName: serverNameClean,
        macValue,
        appName,
        password: payloadPassword,
      });
      await fetch(apiEndpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ ...deletePayload, base_url: integ?.api_url || "", deviceKey }),
      });
    } catch {
      // best-effort — segue pro create de qualquer jeito
    }

    const payload = (handler as any).buildCreatePayload({
      username: client.server_username,
      password: payloadPassword,
      macValue,
      finalServerName,
      serverName: serverNameClean,
      m3uUrl,
      appName,
      serverId: client.server_id,
    });

    const apiRes = await fetch(apiEndpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ ...payload, base_url: integ?.api_url || "", deviceKey }),
    });
    const apiJson = await apiRes.json().catch(() => ({} as any));

    if (!apiJson?.ok) {
      after(() =>
        logAppActivity(supabaseAdmin, {
          tenantId: ctx.tenant_id,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "configure_failed",
          detail: { error: apiJson?.error || "Falha ao configurar no painel do parceiro." },
        }),
      );
      return jsonError(apiJson?.error || "Falha ao configurar no painel do parceiro.", 400);
    }

    // ✅ GERENCIAAPP: o create sempre manda "hoje + 1 ano" fixo pro payload
    // deles (achado do Márcio, 25/07/2026: não é vencimento real, é só o
    // que o payload de criação deles exige). Busca o vencimento de verdade
    // logo em seguida via "check" — mesma chamada do botão "Verificar
    // validade" — e usa esse valor se vier; só cai pro valor do create se o
    // check falhar por qualquer motivo.
    let expireDate = apiJson.expireDate || null;
    if ((handler as any).actionPrefix === "GERENCIAAPP") {
      try {
        const checkRes = await fetch(apiEndpointUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
          body: JSON.stringify({
            action: "check",
            base_url: integ?.api_url || "",
            username: finalServerName,
            macValue,
          }),
        });
        const checkJson = await checkRes.json().catch(() => ({} as any));
        if (checkJson?.ok && checkJson.expireDate) expireDate = checkJson.expireDate;
      } catch {
        // mantém o expireDate do create como fallback
      }
    }

    // Persiste o vencimento (real, quando disponível) na própria linha.
    const dateField = findFieldByType(fieldsConfig, "date");
    if (expireDate && dateField) {
      const fieldKey = String(dateField.id || dateField.label);
      await supabaseAdmin
        .from("client_apps")
        .update({ field_values: { ...values, [fieldKey]: expireDate } })
        .eq("id", client_app_id);
    }

    after(() =>
      logAppActivity(supabaseAdmin, {
        tenantId: ctx.tenant_id,
        clientId: client_id,
        clientAppId: client_app_id,
        appName,
        event: "configured",
        detail: expireDate ? { expireDate } : null,
      }),
    );

    return NextResponse.json(
      { ok: true, expireDate, message: apiJson.message || "Configurado com sucesso." },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
