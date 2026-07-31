// app/api/client-portal/apps/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, AppFieldType } from "@/lib/apps/field-types";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { CHECK_VALIDITY_HANDLERS, buildM3uUrlFromDns } from "@/lib/apps/panel";
import { renderTemplate, pickRandomDns } from "@/lib/whatsapp/template-vars";

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

function extractExpiration(vals: Record<string, any>, config: any[]) {
  let expiration =
    vals["Vencimento"] || vals["vencimento"] || vals["VENCIMENTO"] || null;

  if (!expiration) {
    const dateField = config.find(
      (f: any) => f.type === "date" || /vencimento/i.test(f.label || ""),
    );
    if (dateField) {
      expiration = vals[dateField.id] || vals[dateField.label] || null;
    }
  }

  if (!expiration) {
    const possibleDate = Object.values(vals).find(
      (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v),
    );
    if (possibleDate) expiration = possibleDate;
  }

  return expiration || null;
}

// ✅ Campos que o cliente pode ver e editar (mac, device_key, obs, url,
// email) — nunca senha/pin (HIDDEN_CLIENT_FIELD_TYPES) nem o próprio "date"
// (esse já vira "expiration" acima; editar data manual não faz sentido,
// quem atualiza é a chamada "Reconfigurar").
function extractEditableFields(vals: Record<string, any>, config: any[]) {
  return config
    .filter(
      (f: any) =>
        f &&
        f.id &&
        f.type !== "date" &&
        !HIDDEN_CLIENT_FIELD_TYPES.includes(f.type as AppFieldType),
    )
    .map((f: any) => {
      // ✅ Rótulo padrão por TIPO tem prioridade sobre o label customizado
      // do app (igual o admin já faz em novo_cliente.tsx) — sem isso, um
      // app cujo campo MAC foi cadastrado com label solto "MAC" mostrava
      // "MAC" no portal e "Device ID (MAC)" no admin pro mesmo campo.
      // "obs" já vem como "Ambiente" de APP_FIELD_LABELS (fonte única).
      const label = APP_FIELD_LABELS[f.type as AppFieldType] || f.label || f.id;
      return {
        id: String(f.id),
        type: String(f.type || ""),
        label: String(label),
        value: vals[f.id] ?? vals[f.label] ?? "",
      };
    });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) {
      return jsonError("Sessão inválida ou cliente não encontrado", 401);
    }

    // ✅ Paralelizado (pedido do Márcio, 26/07/2026, lentidão sentida ao
    // carregar os apps) — as duas queries são independentes entre si (só
    // precisam de client_id), eram 2 round-trips sequenciais.
    const [{ data: rows, error: rowsErr }, { data: pendingRequests }] = await Promise.all([
      supabaseAdmin
        .from("client_apps")
        .select("id, app_id, field_values, apps(name, icon_url, fields_config, integration_type, cost_type, license_price, license_period, portal_setup_instructions, access_code, is_active, discontinued_replacement_name)")
        .eq("client_id", client_id),
      // ✅ Pra apps sem integração automática, o portal mostra "Solicitar
      // configuração"/"Exclusão solicitada" quando já existe um pedido
      // pendente (setup ou removal) — evita duplicar pedido e avisa o
      // cliente que já está na fila do admin.
      supabaseAdmin
        .from("client_app_requests")
        .select("client_app_id, action")
        .eq("client_id", client_id)
        .eq("status", "pending"),
    ]);

    if (rowsErr) {
      return jsonError("Erro interno", 500);
    }

    const pendingSetupByAppId = new Set(
      (pendingRequests || []).filter((r: any) => r.action === "setup").map((r: any) => r.client_app_id),
    );
    const pendingRemovalByAppId = new Set(
      (pendingRequests || []).filter((r: any) => r.action === "removal").map((r: any) => r.client_app_id),
    );

    // ✅ Variáveis nas instruções de configuração (25/07/2026, pedido do
    // Márcio) — mesmo motor {variavel} dos templates de mensagem do
    // WhatsApp (renderTemplate, lib/whatsapp/template-vars.ts), pra não
    // reinventar. "usuario_app"/"senha_app"/"dns_servidor" usam o MESMO
    // nome já usado lá de propósito (mesma variável, sem duplicar
    // convenção); "m3u_url" é nova. Só busca client/server (2 queries a
    // mais) quando pelo menos 1 app tem instrução cadastrada — não vale a
    // pena pra maioria das contas, que não usa esse campo.
    const hasAnyInstructions = (rows || []).some((r: any) => r.apps?.portal_setup_instructions);
    let instructionVars: Record<string, string> | null = null;
    if (hasAnyInstructions) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("server_username, server_password, server_id, m3u_url")
        .eq("id", client_id)
        .maybeSingle();
      const { data: server } = client?.server_id
        ? await supabaseAdmin.from("servers").select("dns").eq("id", client.server_id).maybeSingle()
        : { data: null };
      const dns = pickRandomDns(Array.isArray(server?.dns) ? server.dns : []);
      const m3uUrl =
        String(client?.m3u_url || "").trim() ||
        (dns ? buildM3uUrlFromDns([dns], client?.server_username || "", client?.server_password || "") : "");
      instructionVars = {
        usuario_app: client?.server_username || "",
        senha_app: client?.server_password || "",
        dns_servidor: dns,
        m3u_url: m3uUrl,
      };
    }

    // ✅ Badges copiáveis pras variáveis usadas nas instruções (31/07/2026,
    // pedido do Márcio) — "{codigo}"/"{usuario_app}"/"{senha_app}"/
    // "{dns_servidor}" já substituem inline no texto acima, mas o cliente
    // não consegue COPIAR um valor de dentro de um parágrafo. Aqui, além da
    // substituição, cada variável realmente referenciada no texto CRU vira
    // também um campo com botão de copiar, igual Device ID/MAC/Key — só as
    // que o texto de fato usa (evita mostrar "Código: —" pra apps que nunca
    // pediram código).
    const VARIABLE_FIELD_LABELS: Record<string, string> = {
      codigo: "Código",
      usuario_app: "Usuário",
      senha_app: "Senha",
      dns_servidor: "DNS",
    };
    function buildVariableFields(rawInstructions: string | null | undefined, codigo: string) {
      const raw = String(rawInstructions || "");
      if (!raw) return [];
      const vals: Record<string, string> = { codigo, ...(instructionVars || {}) };
      return Object.entries(VARIABLE_FIELD_LABELS)
        .filter(([key]) => raw.includes(`{${key}}`))
        .map(([key, label]) => ({ id: key, label, value: vals[key] || "" }))
        .filter((f) => f.value);
    }

    const apps = (rows || []).map((row: any) => {
      const vals = row.field_values || {};
      const config = Array.isArray(row.apps?.fields_config) ? row.apps.fields_config : [];
      const integrationType = row.apps?.integration_type || null;
      // ✅ Voltado atrás em 25/07/2026 (pedido do Márcio): vencimento é uma
      // validade REAL do app no painel do parceiro (7-15 dias pra app novo,
      // renovável) — não tem nada a ver com "cost_type"/licença paga. Só
      // "parceria" (custo já embutido no plano do servidor) não tem
      // vencimento próprio pra mostrar. Todo o resto mostra, inclusive apps
      // vencidos (o cliente pode reconfigurar mesmo assim).
      //
      // ✅ Lê SÓ do catálogo (apps.cost_type) — achado em produção
      // (25/07/2026): o snapshot por instância (field_values._config_cost)
      // não é confiável pra decidir isso. O admin sempre grava "paid" por
      // padrão ao adicionar um app (novo_cliente.tsx, addAppToClient), e
      // ninguém tinha motivo pra corrigir isso antes porque o campo era só
      // cosmético — resultado: apps "parceria" de verdade (ex: Quick Player
      // Pro) ficavam com _config_cost="paid" salvo e mostravam vencimento
      // indevidamente. Import em massa também nunca preenche esse campo.
      const isPartnership = row.apps?.cost_type === "partnership";
      const handler = integrationType ? getIntegrationHandler(integrationType) : null;
      // ✅ "has_integration" decide se o botão "Reconfigurar" aparece — precisa
      // refletir automação REAL (handler.useApi), não só a presença de
      // integration_type. IBOSOL, por ex., tem handler cadastrado mas
      // useApi:false (bloqueio Cloudflare, ver ibosol.ts) — sem essa checagem
      // o botão aparecia e sempre falhava ao clicar.
      const canCheckValidity =
        !isPartnership && !!handler && (handler as any).useApi && CHECK_VALIDITY_HANDLERS.has((handler as any).actionPrefix);

      return {
        id: row.id,
        app_id: row.app_id,
        name: row.apps?.name || "Aplicativo",
        icon_url: row.apps?.icon_url || null,
        has_integration: !!handler && (handler as any).useApi,
        can_check_validity: canCheckValidity,
        has_pending_setup_request: pendingSetupByAppId.has(row.id),
        has_pending_removal_request: pendingRemovalByAppId.has(row.id),
        expiration: isPartnership ? null : extractExpiration(vals, config),
        is_partnership: isPartnership,
        fields: extractEditableFields(vals, config),
        portal_setup_instructions:
          row.apps?.portal_setup_instructions && instructionVars
            ? renderTemplate(row.apps.portal_setup_instructions, { ...instructionVars, codigo: row.apps?.access_code || "" })
            : row.apps?.portal_setup_instructions || null,
        variable_fields: buildVariableFields(row.apps?.portal_setup_instructions, row.apps?.access_code || ""),
        license_price:
          row.apps?.cost_type === "paid" && Number(row.apps?.license_price) > 0
            ? Number(row.apps.license_price)
            : null,
        license_period: row.apps?.license_period || null,
        is_active: row.apps?.is_active !== false,
        discontinued_replacement_name: row.apps?.discontinued_replacement_name || null,
        // ✅ Família GerenciaApp (IBO Revenda, Zone X, VU Revenda, Facilita,
        // Uni Revenda, GPC Roku/Android/LG — todos mapeiam pro mesmo
        // integration_type "GERENCIAAPP", ver lib/integrations/index.ts):
        // reconfigurar JÁ atualiza o vencimento de verdade (o create manda
        // uma data, depois o check busca a real), então "renovar" pra esses
        // é só reconfigurar de novo — grátis, sem cobrança de licença.
        // Pedido do Márcio, 28/07/2026.
        is_gerenciaapp_family: integrationType === "GERENCIAAPP",
      };
    });

    return NextResponse.json(
      { ok: true, data: apps },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
