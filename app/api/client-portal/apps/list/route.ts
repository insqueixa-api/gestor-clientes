// app/api/client-portal/apps/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, AppFieldType } from "@/lib/apps/field-types";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { CHECK_VALIDITY_HANDLERS } from "@/lib/apps/panel";

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
      // "Obs" (genérico, herdado do admin) vira "Ambiente" no portal —
      // mais claro pro cliente preencher onde o aparelho fica (sala, quarto...).
      const label =
        (f.type === "obs" ? "Ambiente" : APP_FIELD_LABELS[f.type as AppFieldType]) || f.label || f.id;
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

    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, app_id, field_values, apps(name, icon_url, fields_config, integration_type, cost_type, license_price, license_period)")
      .eq("client_id", client_id);

    if (rowsErr) {
      return jsonError("Erro interno", 500);
    }

    // ✅ Pra apps sem integração automática, o portal mostra "Solicitar
    // configuração"/"Exclusão solicitada" quando já existe um pedido
    // pendente (setup ou removal) — evita duplicar pedido e avisa o
    // cliente que já está na fila do admin.
    const { data: pendingRequests } = await supabaseAdmin
      .from("client_app_requests")
      .select("client_app_id, action")
      .eq("client_id", client_id)
      .eq("status", "pending");
    const pendingSetupByAppId = new Set(
      (pendingRequests || []).filter((r: any) => r.action === "setup").map((r: any) => r.client_app_id),
    );
    const pendingRemovalByAppId = new Set(
      (pendingRequests || []).filter((r: any) => r.action === "removal").map((r: any) => r.client_app_id),
    );

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
      const costType = String(vals["_config_cost"] || row.apps?.cost_type || "").trim();
      const isPartnership = costType === "partnership";
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
        fields: extractEditableFields(vals, config),
        license_price:
          row.apps?.cost_type === "paid" && Number(row.apps?.license_price) > 0
            ? Number(row.apps.license_price)
            : null,
        license_period: row.apps?.license_period || null,
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
