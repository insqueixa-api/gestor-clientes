// app/api/client-portal/get-accounts/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { touchPortalSession } from "@/lib/client-portal/session";

export const dynamic = "force-dynamic";

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}


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

// ✅ Log estruturado — sempre ativo (antes o corpo do "if" era vazio e
// silenciava todo erro desta rota mesmo em produção).
function safeServerLog(...args: any[]) {
  console.error("[get-accounts]", ...args);
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      safeServerLog("get-accounts: Server misconfigured");
      Sentry.captureMessage("get-accounts: Server misconfigured", { level: "error", tags: { kind: "client_portal_error", route: "get-accounts" } });
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const body = await req.json().catch(() => ({}));
    const session_token = normalizeToken((body as any)?.session_token);


if (!session_token) {
  return NextResponse.json(
    { ok: false, error: "Sessão inválida" },
    { status: 401, headers: NO_STORE_HEADERS }
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

    // ✅ Não bloqueia a resposta (mesmo padrão de validatePortalClient em
    // lib/client-portal/session.ts) — bookkeeping, não precisa do round-trip.
    after(() => touchPortalSession(supabaseAdmin, session_token));

    // 2. Buscar contas do cliente
    const { data: accounts, error: accErr } = await supabaseAdmin
      .from("clients")
      .select(`
        id,
        display_name,
        secondary_display_name,
        whatsapp_username,
        secondary_whatsapp_username,
        server_username,
      screens,
      plan_label,
      dados_extras,
        vencimento,
        price_amount,
        price_currency,
        plan_table_id,
        is_trial,
        is_archived,
        technology,
        servers (name)
      `)
      .eq("tenant_id", sess.tenant_id)
      .or(`whatsapp_username.eq.${sess.whatsapp_username},secondary_whatsapp_username.eq.${sess.whatsapp_username}`)
      .order("vencimento", { ascending: true });

    if (accErr) {
      safeServerLog("get-accounts: query error", accErr?.message);
      Sentry.captureMessage("get-accounts: query error", { level: "error", tags: { kind: "client_portal_error", route: "get-accounts" }, extra: { message: accErr?.message } });
      // ✅ não vaza schema/colunas
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const clientIds = (accounts || []).map((acc: any) => String(acc.id || "")).filter(Boolean);
    let pendingManualRenewalByClientId = new Set<string>();

    if (clientIds.length > 0) {
      const { data: pendingManualRenewals } = await supabaseAdmin
        .from("client_portal_payments")
        .select("client_id")
        .eq("tenant_id", sess.tenant_id)
        .eq("payment_method", "online")
        .eq("status", "approved")
        .eq("fulfillment_status", "manual_pending")
        .in("client_id", clientIds)
        .or("payment_type.is.null,payment_type.neq.app_renewal");

      pendingManualRenewalByClientId = new Set(
        (pendingManualRenewals || []).map((row: any) => String(row.client_id || "")).filter(Boolean)
      );
    }

    const mapped = (accounts || []).map((acc: any) => {
      // ✅ Descobre se quem está logado agora é o contato secundário
      const isSecondary = acc.secondary_whatsapp_username === sess.whatsapp_username;
      
      return {
        id: acc.id,
        // ✅ Mostra o nome correto de quem logou
        display_name: isSecondary ? (acc.secondary_display_name || "Sem nome") : (acc.display_name || "Sem nome"),
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
        technology: acc.technology || "IPTV",
        modalidade: acc.dados_extras?.modalidade || null,
        has_pending_manual_renewal: pendingManualRenewalByClientId.has(String(acc.id)),
      };
    });

    return NextResponse.json(
      { ok: true, data: mapped },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    safeServerLog("get-accounts: unexpected error", err?.message);
    Sentry.captureException(err, { tags: { kind: "client_portal_error", route: "get-accounts" } });

    // ✅ não vaza detalhe nenhum
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
