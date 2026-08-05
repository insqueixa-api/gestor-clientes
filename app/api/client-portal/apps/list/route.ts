// app/api/client-portal/apps/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, AppFieldType } from "@/lib/apps/field-types";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { CHECK_VALIDITY_HANDLERS, buildM3uUrlFromDns, buildM3uUrlSecondary, natvMirrorBaseUrl } from "@/lib/apps/panel";
import { buildPortalVariableFields } from "@/lib/apps/portal-variable-rules";
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
      // ✅ Label customizado do app (construtor de campos no admin, pedido
      // do Márcio 05/08/2026) tem prioridade sobre o rótulo padrão do tipo —
      // é assim que o admin renomeia "Device Key" pro nome real que o app
      // em questão usa, e isso precisa refletir aqui igual reflete no
      // admin. Cai pro rótulo padrão só se o app ainda não tem label salvo
      // (apps antigos, de antes desse campo existir).
      const customLabel = String(f.label || "").trim();
      const label = customLabel || APP_FIELD_LABELS[f.type as AppFieldType] || f.id;
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
        .select("id, app_id, field_values, apps(name, icon_url, fields_config, integration_type, cost_type, license_price, license_period, portal_setup_instructions, access_code, portal_variable_fields, is_active, discontinued_replacement_name)")
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

    const clientAppIds = (rows || []).map((r: any) => r.id).filter(Boolean);
    let pendingManualRenewalByAppId = new Set<string>();
    if (clientAppIds.length > 0) {
      const { data: pendingManualPayments } = await supabaseAdmin
        .from("client_portal_payments")
        .select("client_app_id")
        .eq("tenant_id", ctx.tenant_id)
        .eq("client_id", client_id)
        .eq("payment_type", "app_renewal")
        .eq("status", "approved")
        .eq("fulfillment_status", "manual_pending")
        .in("client_app_id", clientAppIds);

      pendingManualRenewalByAppId = new Set(
        (pendingManualPayments || []).map((p: any) => String(p.client_app_id || "")).filter(Boolean),
      );
    }

    // ✅ Variáveis nas instruções de configuração (25/07/2026, pedido do
    // Márcio) — mesmo motor {variavel} dos templates de mensagem do
    // WhatsApp (renderTemplate, lib/whatsapp/template-vars.ts), pra não
    // reinventar. "usuario_app"/"senha_app"/"dns_servidor" usam o MESMO
    // nome já usado lá de propósito (mesma variável, sem duplicar
    // convenção); "m3u_url" é nova. Só busca client/server (2 queries a
    // mais) quando pelo menos 1 app tem instrução cadastrada — não vale a
    // pena pra maioria das contas, que não usa esse campo.
    const hasAnyInstructions = (rows || []).some(
      (r: any) => r.apps?.portal_setup_instructions || (Array.isArray(r.apps?.portal_variable_fields) && r.apps.portal_variable_fields.length > 0),
    );
    let instructionVars: Record<string, string> | null = null;
    if (hasAnyInstructions) {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("server_username, server_password, server_id, m3u_url")
        .eq("id", client_id)
        .maybeSingle();
      const { data: server } = client?.server_id
        ? await supabaseAdmin.from("servers").select("name, dns").eq("id", client.server_id).maybeSingle()
        : { data: null };
      const dns = pickRandomDns(Array.isArray(server?.dns) ? server.dns : []);
      const username = client?.server_username || "";
      const password = client?.server_password || "";
      const m3uUrl =
        String(client?.m3u_url || "").trim() ||
        (dns ? buildM3uUrlFromDns([dns], username, password) : "");

      // ✅ "Rota 2" (31/07/2026, pedido do Márcio) — mesmo mirror que o
      // Reconfigurar > Secundária já usa (buildM3uUrlSecondary): só existe
      // de verdade pro NaTV (sem "s" do https + prefixo "r2."), então pra
      // qualquer outro servidor isso fica vazio de propósito (o badge some
      // sozinho — buildVariableFields já filtra campo sem valor). Reaproveita
      // a MESMA dns já sorteada acima (não sorteia outra), pra "DNS Rota 2" e
      // "Link M3U Rota 2" sempre baterem com o mesmo host.
      const isNaTv = String(server?.name || "").trim().toUpperCase() === "NATV";
      const dnsR2 = isNaTv && dns ? natvMirrorBaseUrl(dns) : "";
      const m3uUrlR2 = isNaTv && dns ? buildM3uUrlSecondary([dns], username, password, server?.name) : "";
      const dnsForPortal = dnsR2 && Math.random() < 0.5 ? dnsR2 : dns;

      instructionVars = {
        name: String(server?.name || "").trim(),
        usuario_app: username,
        senha_app: password,
        dns_servidor: dnsForPortal,
        m3u_url: m3uUrl,
        dns_servidor_r2: dnsR2,
        m3u_url_r2: m3uUrlR2,
      };
    }

    // ✅ Badges copiáveis (31/07/2026, pedido do Márcio) — DESACOPLADO do
    // texto de portal_setup_instructions de propósito: antes o badge
    // aparecia sempre que o texto usava {token}, o que duplicava a mesma
    // informação (escrita por extenso no parágrafo E repetida como badge
    // logo abaixo — "ficou horroroso", palavras do Márcio). Agora
    // apps.portal_variable_fields é uma lista explícita, escolhida pelo
    // admin (Gerenciador > Aplicativo), independente do que o texto livre
    // menciona ou não.
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
      const hasIntegration = !!handler && (handler as any).useApi;
      // ✅ "Solicitar configuração" (pedido ao suporte via client_app_requests)
      // só existe pra app PAGO sem integração — pedido do Márcio, 31/07/2026:
      // parceria/gratuito sem integração é 100% self-service (o cliente só
      // olha os dados/instruções e configura sozinho no app dele), nunca gera
      // pendência no log do admin. Só sobrou "pago sem integração" pra apps
      // que ainda não têm automação (ex: extensão do Chrome) — aí sim precisa
      // do suporte pra ativar a licença manualmente.
      const requiresAdminSetup = !hasIntegration && row.apps?.cost_type === "paid";

      return {
        id: row.id,
        app_id: row.app_id,
        name: row.apps?.name || "Aplicativo",
        icon_url: row.apps?.icon_url || null,
        has_integration: hasIntegration,
        can_check_validity: canCheckValidity,
        requires_admin_setup: requiresAdminSetup,
        has_pending_setup_request: pendingSetupByAppId.has(row.id),
        has_pending_removal_request: pendingRemovalByAppId.has(row.id),
        has_pending_manual_renewal: pendingManualRenewalByAppId.has(String(row.id)),
        expiration: isPartnership ? null : extractExpiration(vals, config),
        is_partnership: isPartnership,
        fields: extractEditableFields(vals, config),
        portal_setup_instructions:
          row.apps?.portal_setup_instructions && instructionVars
            ? renderTemplate(row.apps.portal_setup_instructions, { ...instructionVars, codigo: row.apps?.access_code || "" })
            : row.apps?.portal_setup_instructions || null,
        variable_fields: buildPortalVariableFields(
          row.apps?.portal_variable_fields,
          { codigo: row.apps?.access_code || "", ...(instructionVars || {}) },
        ),
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
