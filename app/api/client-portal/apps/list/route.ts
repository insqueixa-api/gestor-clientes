// app/api/client-portal/apps/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { APP_FIELD_LABELS, HIDDEN_CLIENT_FIELD_TYPES, AppFieldType } from "@/lib/apps/field-types";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";

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

// ✅ Campos que o cliente pode ver e editar (mac, device_key, url, email) —
// nunca senha/pin/obs (HIDDEN_CLIENT_FIELD_TYPES) nem o próprio "date"
// (esse já vira "expiration" acima; editar data manual não faz sentido,
// quem atualiza é a chamada "Reconfigurar").
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
    .map((f: any) => ({
      id: String(f.id),
      type: String(f.type || ""),
      label: String(f.label || APP_FIELD_LABELS[f.type as AppFieldType] || f.id),
      value: vals[f.id] ?? vals[f.label] ?? "",
    }));
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
      .select("id, app_id, field_values, apps(name, icon_url, fields_config, integration_type)")
      .eq("client_id", client_id);

    if (rowsErr) {
      return jsonError("Erro interno", 500);
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("m3u_url")
      .eq("id", client_id)
      .maybeSingle();

    const apps = (rows || []).map((row: any) => {
      const vals = row.field_values || {};
      const config = Array.isArray(row.apps?.fields_config) ? row.apps.fields_config : [];
      const integrationType = row.apps?.integration_type || null;

      return {
        id: row.id,
        app_id: row.app_id,
        name: row.apps?.name || "Aplicativo",
        icon_url: row.apps?.icon_url || null,
        has_integration: !!integrationType,
        expiration: extractExpiration(vals, config),
        fields: extractEditableFields(vals, config),
      };
    });

    return NextResponse.json(
      { ok: true, data: apps, m3u_url: client?.m3u_url || null },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
