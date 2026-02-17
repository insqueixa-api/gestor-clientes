import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { session_token, plan_table_id, screens } = await req.json();

    if (!session_token || !plan_table_id || !screens) {
      return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400 });
    }

    // 1. Validar sessão
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
    }

    // 2. Buscar preços
    const { data, error } = await supabaseAdmin
      .from("plan_table_items")
      .select(`
        period,
        plan_table_item_prices (
          screens_count,
          price_amount
        )
      `)
      .eq("plan_table_id", plan_table_id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const prices = (data || []).map((item: any) => {
      const exact = item.plan_table_item_prices?.find(
        (p: any) => p.screens_count === screens
      );
      const fallback = item.plan_table_item_prices?.find(
        (p: any) => p.screens_count === 1
      );
      const price = exact?.price_amount ?? (fallback?.price_amount ? fallback.price_amount * screens : 0);

      return {
        period: item.period,
        price_amount: Number(price),
      };
    });

    // Ordenar por período
    const ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
    prices.sort((a, b) => ORDER.indexOf(a.period) - ORDER.indexOf(b.period));

    return NextResponse.json({ ok: true, data: prices });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}