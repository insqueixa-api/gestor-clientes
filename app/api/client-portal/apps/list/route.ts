// app/api/client-portal/apps/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

const APP_FIELD_LABELS: Record<string, string> = {
  date: "Vencimento",
  mac: "Device ID (MAC)",
  device_key: "Device Key",
  email: "E-mail",
  password: "Senha",
  url: "URL",
  obs: "Obs",
};

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

// ✅ Só devolve pro cliente os campos "seguros" pra exibir (mac, device_key,
// usuário/login) — nunca senha, pin ou qualquer coisa que pareça segredo.
// O campo "date" fica de fora daqui porque já vira o "expiration" acima —
// mostrá-lo de novo como chip seria redundante.
function extractDisplayFields(vals: Record<string, any>, config: any[]) {
  const HIDDEN_TYPES = new Set(["password", "pin", "date", "obs"]);
  const HIDDEN_KEY_PATTERN = /senha|password|pin/i;

  return config
    .filter((f: any) => f && f.id && !HIDDEN_TYPES.has(f.type) && !HIDDEN_KEY_PATTERN.test(f.id) && !HIDDEN_KEY_PATTERN.test(f.label || ""))
    .map((f: any) => ({
      label: String(f.label || APP_FIELD_LABELS[f.type] || f.id),
      value: vals[f.id] ?? vals[f.label] ?? null,
    }))
    .filter((f: any) => f.value != null && String(f.value).trim() !== "");
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

    if (!session_token || !client_id) {
      return jsonError("Parâmetros incompletos", 400);
    }
    if (!isPlausibleSessionToken(session_token)) {
      return jsonError("Sessão inválida", 401);
    }
    if (!isUuid(client_id)) {
      return jsonError("Cliente não encontrado", 404);
    }

    // 1. Validar sessão
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      return jsonError("Sessão inválida", 401);
    }

    // 2. Confirmar que o client_id pertence a esse whatsapp (dono ou secundário)
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .or(`whatsapp_username.eq.${sess.whatsapp_username},secondary_whatsapp_username.eq.${sess.whatsapp_username}`)
      .single();

    if (clientErr || !client) {
      return jsonError("Cliente não encontrado", 404);
    }

    // 3. Buscar apps instalados desse cliente
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, app_id, field_values, apps(name, icon_url, fields_config)")
      .eq("client_id", client_id);

    if (rowsErr) {
      return jsonError("Erro interno", 500);
    }

    const apps = (rows || []).map((row: any) => {
      const vals = row.field_values || {};
      const config = Array.isArray(row.apps?.fields_config) ? row.apps.fields_config : [];

      return {
        id: row.id,
        name: row.apps?.name || "Aplicativo",
        icon_url: row.apps?.icon_url || null,
        expiration: extractExpiration(vals, config),
        fields: extractDisplayFields(vals, config),
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
