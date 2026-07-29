// app/api/client-portal/apps/renew-gerenciaapp/route.ts
//
// "Renovar licença — Grátis" da família GerenciaApp (IBO Revenda, Zone X,
// VU Revenda, Facilita, Uni Revenda, GPC Roku/Android/LG). Pedido do
// Márcio (28/07/2026): diferente do "Reconfigurar" (que apaga e recria a
// playlist do zero, pro caso de o app estar com falha), renovar é só
// ESTENDER o vencimento — o painel do GerenciaApp guarda um único
// `expire_date` POR MAC (compartilhado entre todas as playlists daquele
// dispositivo, confirmado ao vivo), então editar só essa data já atualiza
// o vencimento de verdade, sem tocar em MAC/playlist/M3U nenhuma.
//
// Delete-então-create (usado pelo Reconfigurar) tem um risco real que essa
// rota evita de propósito: se sobrar uma playlist duplicada por qualquer
// motivo (residual de uma tentativa anterior, por exemplo), a verificação
// por nome do create pode ficar travada mirando sempre na entrada errada —
// achado em produção nesse MAC real. Editar só a data não tem esse
// problema: não cria nem apaga nenhuma playlist.
import { NextRequest, NextResponse, after } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { extractFieldByType, findFieldByType, internalAppUrl, logAppActivity } from "@/lib/apps/panel";

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
      .select("id, field_values, apps(name, integration_type, fields_config)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    appName = (row as any).apps?.name || "Aplicativo";
    const integrationType = String((row as any).apps?.integration_type || "").trim().toUpperCase();
    const fieldsConfig: any[] = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const values = row.field_values || {};

    const handler = integrationType ? getIntegrationHandler(integrationType) : null;
    if (!handler || (handler as any).actionPrefix !== "GERENCIAAPP") {
      return jsonError("Essa renovação gratuita só está disponível pra família GerenciaApp.", 400);
    }

    const macValue = extractFieldByType(fieldsConfig, values, "mac");
    if (!macValue) {
      return jsonError("Preencha o Device ID (MAC) antes de renovar.", 400);
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
      body: JSON.stringify({ action: "renew", base_url: integ?.api_url || "", macValue }),
    });
    const apiJson = await apiRes.json().catch(() => ({} as any));

    if (!apiJson?.ok) {
      after(() =>
        logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "configure_failed",
          detail: { error: apiJson?.error || "Falha ao renovar no painel do parceiro.", renew: true },
        }),
      );
      return NextResponse.json(
        {
          ok: false,
          error: "Houve uma falha ao renovar a licença. Tente mais uma vez — se continuar falhando, fale com o suporte.",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const expireDate = apiJson.expireDate || null;
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
        tenantId,
        clientId: client_id,
        clientAppId: client_app_id,
        appName,
        event: "configured",
        detail: { expireDate, renew: true },
      }),
    );

    return NextResponse.json(
      { ok: true, expireDate, message: apiJson.message || "Licença renovada com sucesso." },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (e: any) {
    if (tenantId && client_app_id) {
      try {
        await logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "configure_failed",
          detail: { error: e?.message || "Erro interno inesperado.", unexpected: true, renew: true },
        });
      } catch {
        // não deixa o log derrubar a resposta de erro
      }
    }
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
