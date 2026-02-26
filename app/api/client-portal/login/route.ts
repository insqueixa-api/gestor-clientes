import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function isPlausibleToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

function isPlausiblePin(p: string) {
  return /^\d{4}$/.test(p);
}

async function validateTurnstile(cfToken: string, ip: string): Promise<boolean> {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) {
    safeServerLog("[PORTAL][login] TURNSTILE_SECRET_KEY not configured");
    return false;
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: cfToken, remoteip: ip }),
    });
    const json = await res.json();
    return json?.success === true;
  } catch {
    safeServerLog("[PORTAL][login] turnstile fetch failed");
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      safeServerLog("[PORTAL][login] Server misconfigured");
      return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const token      = String(body?.token     ?? "").trim();
    const pin        = String(body?.pin       ?? "").trim();
    const cfToken    = String(body?.cfToken   ?? "").trim();

    // Validações básicas antes de qualquer IO
    if (!isPlausibleToken(token) || !isPlausiblePin(pin) || !cfToken) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Turnstile validado no servidor — bots não passam daqui
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const humanVerified = await validateTurnstile(cfToken, ip);
    if (!humanVerified) {
      return NextResponse.json({ error: "captcha_failed" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    // Chama o RPC com service_role
    const { data, error } = await supabaseAdmin.rpc("portal_start_session", {
      p_token: token,
      p_pin:   pin,
    });

    if (error) {
      safeServerLog("[PORTAL][login] rpc error");
      // Resposta genérica — não revela se o token ou PIN é o problema
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row?.session_token) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { session_token: row.session_token, expires_at: row.expires_at },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    safeServerLog("[PORTAL][login] unexpected", err?.message);
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
