import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { session_token, payment_id } = await req.json();

    if (!session_token || !payment_id) {
      return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400 });
    }

    // 1. Validar sessão
    const { data: sess } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (!sess) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
    }

    // 2. Buscar pagamento
    const { data: payment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("status, new_vencimento, plan_label, price_amount, gateway_type, mp_payment_id")
      .eq("mp_payment_id", String(payment_id))
      .eq("tenant_id", sess.tenant_id)
      .single();

    if (!payment) {
      return NextResponse.json({ ok: false, error: "Pagamento não encontrado" }, { status: 404 });
    }

    // 3. Se ainda pendente e for MP, consultar status diretamente na API
    if (payment.status === "pending" && payment.gateway_type === "mercadopago") {
      const { data: gateway } = await supabaseAdmin
        .from("payment_gateways")
        .select("config")
        .eq("tenant_id", sess.tenant_id)
        .eq("type", "mercadopago")
        .eq("is_active", true)
        .single();

      if (gateway) {
        try {
          const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
            headers: { Authorization: `Bearer ${gateway.config.access_token}` },
          });

          if (mpRes.ok) {
            const mpData = await mpRes.json();
            
            // Atualizar status local se mudou
            if (mpData.status !== "pending" && mpData.status !== payment.status) {
              await supabaseAdmin
                .from("client_portal_payments")
                .update({ status: mpData.status })
                .eq("mp_payment_id", String(payment_id));

              return NextResponse.json({
                ok: true,
                status: mpData.status,
                new_vencimento: payment.new_vencimento,
              });
            }
          }
        } catch (err) {
          console.error("Erro ao consultar Mercado Pago:", err);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      status: payment.status,
      new_vencimento: payment.new_vencimento,
    });

  } catch (err: any) {
    console.error("Erro payment-status:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
