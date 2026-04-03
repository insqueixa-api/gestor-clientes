import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function getBearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function formatBRDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function diasRestantes(iso: string | null): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  const diff = d.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function computeStatus(row: any): string {
  if (row.is_archived) return "ARCHIVED";
  if (row.is_trial) return "TRIAL";
  if (!row.vencimento) return "ACTIVE";
  return new Date(row.vencimento).getTime() < Date.now() ? "OVERDUE" : "ACTIVE";
}

function normalizePhoneDigits(v: string): string {
  return String(v || "").replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  const sb = makeSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE_HEADERS });
  }

  // 1) API Key
  const rawKey = getBearerToken(req);
  if (!rawKey || !rawKey.startsWith("ugs_")) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_api_key" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const keyHash = hashApiKey(rawKey);

  const { data: keyRow, error: keyErr } = await sb
    .from("tenant_api_keys")
    .select("id, tenant_id, is_active")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (keyErr || !keyRow) {
    return NextResponse.json({ ok: false, error: "invalid_api_key" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  if (!keyRow.is_active) {
    return NextResponse.json({ ok: false, error: "api_key_revoked" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const tenantId = String(keyRow.tenant_id);

  // Atualiza last_used_at em background
  sb.from("tenant_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id)
    .then(() => {});

  // 2) Body
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const whatsappUsername = String(body?.whatsapp_username || "").trim().replace(/\D/g, "");

  if (!whatsappUsername || whatsappUsername.length < 8) {
    return NextResponse.json({ ok: false, error: "whatsapp_username_required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // 3) Busca clientes (ativos + arquivados) por whatsapp principal ou secundário
  const { data: clients, error: clientsErr } = await sb
    .from("clients")
    .select(`
      id,
      display_name,
      name_prefix,
      phone_e164,
      secondary_display_name,
      secondary_name_prefix,
      secondary_phone_e164,
      whatsapp_username,
      secondary_whatsapp_username,
      server_username,
      server_password,
      vencimento,
      is_trial,
      is_archived,
      screens,
      plan_label,
      price_amount,
      price_currency,
      technology,
      m3u_url,
      servers (name)
    `)
    .eq("tenant_id", tenantId)
    .or(`whatsapp_username.eq.${whatsappUsername},secondary_whatsapp_username.eq.${whatsappUsername}`)
    .order("vencimento", { ascending: false });

  if (clientsErr) {
    return NextResponse.json({ ok: false, error: "query_error" }, { status: 500, headers: NO_STORE_HEADERS });
  }

  if (!clients || clients.length === 0) {
    return NextResponse.json({ ok: true, count: 0, clients: [] }, { status: 200, headers: NO_STORE_HEADERS });
  }

  // 4) Gera portal token + monta resposta
  const appUrl = String(process.env.UNIGESTOR_APP_URL || "https://unigestor.net.br").replace(/\/+$/, "");

  const result = await Promise.all(
    clients.map(async (c: any) => {
      const status = computeStatus(c);
      const dias = diasRestantes(c.vencimento);

      // Portal token
      let portalLink: string | null = null;
      try {
        const { data: tokData } = await sb.rpc("portal_admin_create_token_for_whatsapp_v2", {
          p_tenant_id: tenantId,
          p_whatsapp_username: whatsappUsername,
          p_created_by: null,
          p_label: "API Bot",
          p_expires_at: null,
        });
        const tok = Array.isArray(tokData) ? tokData[0]?.token : null;
        if (tok) portalLink = `${appUrl}/#t=${encodeURIComponent(tok)}`;
      } catch {}

      // Portal PIN (últimos 4 dígitos do whatsapp_username)
      const pinDigits = normalizePhoneDigits(c.whatsapp_username || whatsappUsername);
      const portalPin = pinDigits.length >= 4 ? pinDigits.slice(-4) : pinDigits.padStart(4, "0");

      return {
        client_name: [c.name_prefix, c.display_name].filter(Boolean).join(" ") || "—",
        status,
        is_trial: Boolean(c.is_trial),
        is_archived: Boolean(c.is_archived),
        server_name: (c.servers as any)?.name || "—",
        technology: c.technology || "—",
        phone_primary: c.phone_e164 || null,
        phone_secondary: c.secondary_phone_e164 || null,
        whatsapp_primary: c.whatsapp_username || null,
        whatsapp_secondary: c.secondary_whatsapp_username || null,
        secondary_contact: c.secondary_display_name
          ? {
              name: [c.secondary_name_prefix, c.secondary_display_name].filter(Boolean).join(" "),
              phone: c.secondary_phone_e164 || null,
              whatsapp: c.secondary_whatsapp_username || null,
            }
          : null,
        plan: `${c.plan_label || "—"} · ${c.screens || 1} tela${(c.screens || 1) > 1 ? "s" : ""}`,
        price: c.price_amount
          ? `${Number(c.price_amount).toFixed(2).replace(".", ",")} ${c.price_currency || "BRL"}`
          : "—",
        vencimento: formatBRDateTime(c.vencimento),
        vencimento_iso: c.vencimento || null,
        dias_restantes: dias,
        credentials: {
          username: c.server_username || null,
          password: c.server_password || null,
        },
        m3u_url: c.m3u_url || null,
        portal_link: portalLink,
        portal_pin: portalPin,
      };
    })
  );

  return NextResponse.json(
    { ok: true, count: result.length, clients: result },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}