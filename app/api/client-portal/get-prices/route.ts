import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

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

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
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
    // ✅ pega também whatsapp_username para travar autorização do client_id
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      safeServerLog("get-prices: invalid/expired session");
      return jsonError("Sessão inválida", 401);
    }

    // 2. Buscar dados do cliente
    // ✅ CRÍTICO: garante que o client_id é do mesmo whatsapp da sessão
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("screens, plan_label, price_amount, price_currency, plan_table_id, whatsapp_username")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .eq("whatsapp_username", sess.whatsapp_username)
      .single();

    if (clientErr || !client) {
      safeServerLog("get-prices: client not found or not owned");
      return jsonError("Cliente não encontrado", 404);
    }

    // 3. Buscar tabela de preços do cliente ou fallback para padrão BRL
    let planTableId = client.plan_table_id;

    if (!planTableId) {
      // Buscar tabela padrão BRL
      const { data: defaultTable, error: defErr } = await supabaseAdmin
        .from("plan_tables")
        .select("id, currency")
        .eq("tenant_id", sess.tenant_id)
        .eq("is_system_default", true)
        .eq("currency", "BRL")
        .eq("is_active", true)
        .single();

      if (defErr || !defaultTable) {
        return jsonError("Tabela de preços não encontrada", 404);
      }

      planTableId = defaultTable.id;
    }

    // 4. Buscar preços da tabela
    const { data: priceData, error: pricesErr } = await supabaseAdmin
      .from("plan_table_items")
      .select(`
        period,
        plan_table_item_prices (
          screens_count,
          price_amount
        )
      `)
      .eq("plan_table_id", planTableId);

    if (pricesErr || !priceData) {
      safeServerLog("get-prices: prices query error", pricesErr?.message);
      return jsonError("Erro interno", 500);
    }

    // 5. Processar preços com override do cliente
    const prices = (priceData || []).map((item: any) => {
      const exact = item.plan_table_item_prices?.find(
        (p: any) => p.screens_count === client.screens
      );
      const fallback = item.plan_table_item_prices?.find(
        (p: any) => p.screens_count === 1
      );

      let price =
        exact?.price_amount ??
        (fallback?.price_amount ? fallback.price_amount * client.screens : 0);

      // Override: se o cliente tem price_amount definido E o período bate com o plano atual
      if (client.price_amount && PERIOD_LABELS[item.period] === client.plan_label) {
        price = client.price_amount;
      }

      return {
        period: item.period,
        price_amount: Number(price),
      };
    });

    // 6. Ordenar por período
    const ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
    prices.sort((a, b) => ORDER.indexOf(a.period) - ORDER.indexOf(b.period));

    return NextResponse.json(
      {
        ok: true,
        data: prices,
        currency: client.price_currency || "BRL",
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    safeServerLog("get-prices: unexpected error", err?.message);
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
