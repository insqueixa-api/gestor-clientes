// app/api/client-portal/apps/detail/route.ts
// Página de detalhe por app (/renew-beta/apps/[id]) — mesmos dados de
// apps/list, só que pra 1 app específico, mais as instruções curadas pelo
// admin (apps.portal_setup_instructions) que a lista não carrega (evita
// mandar um texto grande em toda carga do Bloco 3).
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getIntegrationHandler } from "@/lib/integrations";
import { CHECK_VALIDITY_HANDLERS } from "@/lib/apps/panel";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, AppFieldType } from "@/lib/apps/field-types";

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
  let expiration = vals["Vencimento"] || vals["vencimento"] || vals["VENCIMENTO"] || null;
  if (!expiration) {
    const dateField = config.find((f: any) => f.type === "date" || /vencimento/i.test(f.label || ""));
    if (dateField) expiration = vals[dateField.id] || vals[dateField.label] || null;
  }
  if (!expiration) {
    const possibleDate = Object.values(vals).find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
    if (possibleDate) expiration = possibleDate;
  }
  return expiration || null;
}

function extractEditableFields(vals: Record<string, any>, config: any[]) {
  const HIDDEN_KEY_PATTERN = /senha|password|pin/i;
  return config
    .filter(
      (f: any) =>
        f &&
        f.id &&
        f.type !== "date" &&
        !HIDDEN_CLIENT_FIELD_TYPES.includes(f.type as AppFieldType) &&
        !HIDDEN_KEY_PATTERN.test(f.id) &&
        !HIDDEN_KEY_PATTERN.test(f.label || ""),
    )
    .map((f: any) => {
      const label = f.label || (f.type === "obs" ? "Ambiente" : APP_FIELD_LABELS[f.type as AppFieldType]) || f.id;
      return { id: String(f.id), type: String(f.type || ""), label: String(label), value: vals[f.id] ?? vals[f.label] ?? "" };
    });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) return jsonError("Erro interno", 500);

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const client_app_id = normalizeStr(body?.client_app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, app_id, field_values, apps(name, icon_url, fields_config, integration_type, info_url, portal_setup_instructions)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const { data: pendingRequests } = await supabaseAdmin
      .from("client_app_requests")
      .select("action")
      .eq("client_app_id", client_app_id)
      .eq("status", "pending");
    const hasPendingSetup = (pendingRequests || []).some((r: any) => r.action === "setup");
    const hasPendingRemoval = (pendingRequests || []).some((r: any) => r.action === "removal");

    const vals = row.field_values || {};
    const config = Array.isArray((row as any).apps?.fields_config) ? (row as any).apps.fields_config : [];
    const integrationType = (row as any).apps?.integration_type || null;
    const isPartnership = String(vals["_config_cost"] || "") === "partnership";
    const handler = integrationType ? getIntegrationHandler(integrationType) : null;
    const canCheckValidity =
      !isPartnership && !!handler && (handler as any).useApi && CHECK_VALIDITY_HANDLERS.has((handler as any).actionPrefix);

    return NextResponse.json(
      {
        ok: true,
        data: {
          id: row.id,
          app_id: row.app_id,
          name: (row as any).apps?.name || "Aplicativo",
          icon_url: (row as any).apps?.icon_url || null,
          info_url: (row as any).apps?.info_url || null,
          has_integration: !!handler && (handler as any).useApi,
          can_check_validity: canCheckValidity,
          has_pending_setup_request: hasPendingSetup,
          has_pending_removal_request: hasPendingRemoval,
          expiration: isPartnership ? null : extractExpiration(vals, config),
          fields: extractEditableFields(vals, config),
          portal_setup_instructions: (row as any).apps?.portal_setup_instructions || null,
        },
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
