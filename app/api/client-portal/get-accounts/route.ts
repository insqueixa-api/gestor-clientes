import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ✅ Nunca cachear respostas do portal
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeToken(v: unknown) {
  return String(v ?? "").trim();
}

function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

// ✅ Log “cego”: em produção não imprime detalhes
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const session_token = normalizeToken((body as any)?.session_token);

    if (!session_token) {
      return NextResponse.json(
        { ok: false, error: "Token não fornecido" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // ✅ reduz “lixo” e oráculo
    if (!isPlausibleSessionToken(session_token)) {
      return NextResponse.json(
        { ok: false, error: "Sessão inválida" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    // 1. Validar sessão
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      safeServerLog("get-accounts: invalid/expired session");
      return NextResponse.json(
        { ok: false, error: "Sessão inválida" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    // 2. Buscar contas do cliente
    const { data: accounts, error: accErr } = await supabaseAdmin
      .from("clients")
      .select(`
        id,
        display_name,
        server_username,
        screens,
        plan_label,
        vencimento,
        price_amount,
        price_currency,
        plan_table_id,
        is_trial,
        is_archived,
        servers (name)
      `)
      .eq("tenant_id", sess.tenant_id)
      .eq("whatsapp_username", sess.whatsapp_username)
      .order("vencimento", { ascending: true });

    if (accErr) {
      safeServerLog("get-accounts: query error", accErr?.message);
      // ✅ não vaza schema/colunas
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const mapped = (accounts || []).map((acc: any) => ({
      id: acc.id,
      display_name: acc.display_name || "Sem nome",
      server_username: acc.server_username || "",
      server_name: acc.servers?.name || "Servidor",
      screens: acc.screens || 1,
      plan_label: acc.plan_label || "Mensal",
      vencimento: acc.vencimento,
      price_amount: acc.price_amount || 0,
      price_currency: acc.price_currency || "BRL",
      plan_table_id: acc.plan_table_id,
      is_trial: acc.is_trial || false,
      is_archived: acc.is_archived || false,
    }));

    return NextResponse.json(
      { ok: true, data: mapped },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    safeServerLog("get-accounts: unexpected error", err?.message);

    // ✅ não vaza detalhe nenhum
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
