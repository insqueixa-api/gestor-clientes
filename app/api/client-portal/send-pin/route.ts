import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ✅ Nunca cachear resposta do portal
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const GENERIC_OK = {
  ok: true,
  message: "Se o link estiver válido, enviaremos instruções no WhatsApp.",
};

function normalizeToken(v: unknown) {
  return String(v ?? "").trim();
}

// ✅ reduz brute force/oráculo e evita lixo (não substitui validação no banco)
function isPlausibleToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

// ✅ log “cego”: nada de imprimir token/stack em produção
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
if (!supabaseAdmin) {
  safeServerLog("[PORTAL][pin_reset] Server misconfigured");
  return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
}


    const body = await req.json().catch(() => ({} as any));
    const token = normalizeToken((body as any)?.token ?? (body as any)?.t);

    // ✅ resposta “cega” (evita enumeração/oráculo)
    if (!token || !isPlausibleToken(token)) {
      return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
    }

    // ✅ A RPC resolve tenant/whatsapp internamente de forma segura
    const { error } = await supabaseAdmin.rpc("portal_request_pin_reset", { p_token: token });

    if (error) {
      safeServerLog("[PORTAL][pin_reset] rpc error");
      return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err: any) {
    safeServerLog("[PORTAL][pin_reset] unexpected", err?.message);
    return NextResponse.json(GENERIC_OK, { status: 200, headers: NO_STORE_HEADERS });
  }
}
