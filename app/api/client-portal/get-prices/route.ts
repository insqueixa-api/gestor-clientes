import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

export async function POST(req: NextRequest) {
  try {
    const { session_token, client_id } = await req.json();

    if (!session_token || !client_id) {
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

    // 2. Buscar dados do cliente
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("screens, plan_label, price_amount, price_currency, plan_table_id")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ ok: false, error: "Cliente não encontrado" }, { status: 404 });
    }

    // 3. Buscar tabela de preços do cliente ou fallback para padrão BRL
    let planTableId = client.plan_table_id;

    if (!planTableId) {
      // Buscar tabela padrão BRL
      const { data: defaultTable } = await supabaseAdmin
        .from("plan_tables")
        .select("id, currency")
        .eq("tenant_id", sess.tenant_id)
        .eq("is_system_default", true)
        .eq("currency", "BRL")
        .eq("is_active", true)
        .single();

      if (!defaultTable) {
        return NextResponse.json({ ok: false, error: "Tabela de preços não encontrada" }, { status: 404 });
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
      return NextResponse.json({ ok: false, error: "Erro ao buscar preços" }, { status: 500 });
    }

    // 5. Processar preços com override do cliente
    const prices = (priceData || []).map((item: any) => {
      const exact = item.plan_table_item_prices?.find(
        (p: any) => p.screens_count === client.screens
      );
      const fallback = item.plan_table_item_prices?.find(
        (p: any) => p.screens_count === 1
      );

      let price = exact?.price_amount ?? (fallback?.price_amount ? fallback.price_amount * client.screens : 0);

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

    return NextResponse.json({ 
      ok: true, 
      data: prices,
      currency: client.price_currency || "BRL"
    });

  } catch (err: any) {
    console.error("Erro get-prices:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}