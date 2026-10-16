// app/api/client-portal/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { startResellerSessionFromToken } from "@/lib/reseller-portal/session";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// ✅ Log estruturado — sempre ativo (antes o corpo do "if" era vazio e
// silenciava todo erro desta rota mesmo em produção).
function safeServerLog(...args: any[]) {
  console.error("[login]", ...args);
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

async function validateTurnstile(cfToken: string, ip: string): Promise<boolean> {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) {
    safeServerLog("[PORTAL][login] TURNSTILE_SECRET_KEY not configured");
    console.error("[login: TURNSTILE_SECRET_KEY not configured]", { kind: "client_portal_error", route: "login" });
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
  } catch (err) {
    safeServerLog("[PORTAL][login] turnstile fetch failed");
    console.error("[client_portal_error:login:turnstile_fetch]", { message: (err as any)?.message, kind: "client_portal_error", route: "login", where: "turnstile_fetch" });
    return false;
  }
}

// mesma regra de public.normalize_phone (minúsculo, só letras e números)
const digitsOnly = (v: unknown) => String(v ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

/**
 * Link ativo cujas contas foram todas desvinculadas do portal → bloqueado.
 * Devolve o WhatsApp do admin (mesma busca do validate-session).
 */
async function blockedByInactivity(
  supabaseAdmin: NonNullable<ReturnType<typeof makeSupabaseAdmin>>,
  token: string,
): Promise<{ supportWhatsapp: string | null } | null> {
  const { data: tok } = await supabaseAdmin
    .from("client_portal_tokens")
    .select("tenant_id, whatsapp_username, phone_anchor, expires_at")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();
  if (!tok || (tok.expires_at && new Date(tok.expires_at).getTime() <= Date.now())) return null;

  const whats = digitsOnly(tok.whatsapp_username);
  const anchor = digitsOnly(tok.phone_anchor);
  const [{ data: unlinked }, { data: members }] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select("whatsapp_username, secondary_whatsapp_username, phone_e164, secondary_phone_e164")
      .eq("tenant_id", tok.tenant_id)
      .not("deep_archived_at", "is", null),
    supabaseAdmin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tok.tenant_id)
      .in("role", ["ADMIN", "admin", "owner"])
      .limit(1),
  ]);
  const match = (unlinked || []).some(
    (c: any) =>
      (whats && (digitsOnly(c.whatsapp_username) === whats || digitsOnly(c.secondary_whatsapp_username) === whats)) ||
      (anchor && (digitsOnly(c.phone_e164) === anchor || digitsOnly(c.secondary_phone_e164) === anchor)),
  );
  if (!match) return null;

  let supportWhatsapp: string | null = null;
  if (members?.[0]?.user_id) {
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("whatsapp_username")
      .eq("id", members[0].user_id)
      .maybeSingle();
    supportWhatsapp = prof?.whatsapp_username || null;
  }
  return { supportWhatsapp };
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      safeServerLog("[PORTAL][login] Server misconfigured");
      console.error("[login: Server misconfigured]", { kind: "client_portal_error", route: "login" });
      return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const token      = String(body?.token     ?? "").trim();
    const cfToken    = String(body?.cfToken   ?? "").trim();

    // Validações básicas antes de qualquer IO (PIN não é mais exigido no login)
    if (!isPlausibleToken(token) || !cfToken) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Turnstile validado no servidor — bots não passam daqui
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const humanVerified = await validateTurnstile(cfToken, ip);
    if (!humanVerified) {
      return NextResponse.json({ error: "captcha_failed" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    // Chama o RPC com service_role (login depende só do token mágico)
    const { data, error } = await supabaseAdmin.rpc("portal_start_session", {
      p_token: token,
    });

    const row = !error && Array.isArray(data) ? data[0] : null;

    if (!row?.session_token) {
      // ✅ 06/10/2026: token que NÃO é de cliente pode ser o link do Portal
      // da Revenda (tabelas próprias, lib/reseller-portal/session.ts). Só
      // roda quando o caminho do cliente já recusou — cliente não muda nada.
      const reseller = await startResellerSessionFromToken(supabaseAdmin, token).catch(() => null);
      if (reseller) {
        return NextResponse.json(
          { session_token: reseller.session_token, expires_at: reseller.expires_at, kind: "reseller" },
          { status: 200, headers: NO_STORE_HEADERS },
        );
      }
      // ✅ 16/10/2026, pedido do Márcio: link válido de conta DESVINCULADA do
      // portal (deep_archived_at) — o link continua ativo, mas a pessoa não
      // tem mais conta no portal. Em vez de "Tente novamente", avisa que o
      // acesso está bloqueado por inatividade e manda pro suporte.
      const blocked = await blockedByInactivity(supabaseAdmin, token).catch(() => null);
      if (blocked) {
        return NextResponse.json(
          { error: "access_blocked", support_whatsapp: blocked.supportWhatsapp },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }
      if (error && !String(error.message || "").includes("invalid_credentials")) {
        safeServerLog("[PORTAL][login] rpc error");
        console.error("[login: rpc error (portal_start_session)]", { kind: "client_portal_error", route: "login", message: error?.message });
      }
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { session_token: row.session_token, expires_at: row.expires_at },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    safeServerLog("[PORTAL][login] unexpected", err?.message);
    console.error("[client_portal_error:login]", { message: err?.message, kind: "client_portal_error", route: "login" });
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
