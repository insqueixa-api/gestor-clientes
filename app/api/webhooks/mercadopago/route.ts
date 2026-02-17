import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("🔔 Webhook MP recebido:", JSON.stringify(body, null, 2));

    // MP envia: { type: "payment", action: "payment.updated", data: { id: "123" } }
    if (body.type !== "payment") {
      return NextResponse.json({ ok: true, message: "Tipo não processado" });
    }

    const paymentId = body.data?.id;
    if (!paymentId) {
      return NextResponse.json({ ok: true, message: "ID não encontrado" });
    }

    // 1. Buscar pagamento no nosso banco
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("client_portal_payments")
      .select("*, payment_gateways(config)")
      .eq("mp_payment_id", String(paymentId))
      .eq("status", "pending")
      .single();

    if (payErr || !payment) {
      console.log("⚠️ Pagamento não encontrado ou já processado:", paymentId);
      return NextResponse.json({ ok: true });
    }

    // 2. Buscar detalhes do pagamento no MP
    const gateway = (payment.payment_gateways as any);
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${gateway.config.access_token}` },
    });

    if (!mpRes.ok) {
      console.error("❌ Erro ao buscar pagamento no MP:", await mpRes.text());
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    const mpPayment = await mpRes.json();
    console.log("💳 Status MP:", mpPayment.status);

    // 3. Atualizar status no banco
    if (mpPayment.status !== "approved") {
      await supabaseAdmin
        .from("client_portal_payments")
        .update({ status: mpPayment.status })
        .eq("id", payment.id);

      return NextResponse.json({ ok: true, message: "Status atualizado mas não aprovado" });
    }

    // 4. Marcar como processando (evitar duplicação)
    await supabaseAdmin
      .from("client_portal_payments")
      .update({ status: "processing" })
      .eq("id", payment.id);

    // 5. Buscar dados do cliente + servidor
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select(`
        id, display_name, server_username, whatsapp_username,
        screens, plan_label, price_amount, price_currency, vencimento,
        server_id, servers(id, name, type, api_url, api_username, api_password)
      `)
      .eq("id", payment.client_id)
      .single();

    if (!client) {
      console.error("❌ Cliente não encontrado:", payment.client_id);
      return NextResponse.json({ ok: true });
    }

    const server = (client.servers as any);
    const PERIOD_MONTHS: Record<string, number> = {
      MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12,
    };
    const months = PERIOD_MONTHS[payment.period] || 1;

    // 6. Renovar no servidor (NaTV/FastTV)
    let newExpiry: string | null = null;

    try {
      if (server?.type === "NATV" || server?.type === "FASTTV") {
        const renewRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/panel/renew`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              server_id: client.server_id,
              username: client.server_username,
              months,
            }),
          }
        );

        const renewData = await renewRes.json();
        if (renewData.ok && renewData.expiry) {
          newExpiry = renewData.expiry;
          console.log("✅ Renovado no servidor:", newExpiry);
        }
      }
    } catch (renewErr) {
      console.error("⚠️ Erro ao renovar no servidor:", renewErr);
    }

    // 7. Calcular novo vencimento (fallback se servidor falhar)
    if (!newExpiry) {
      const currentVenc = new Date(client.vencimento || Date.now());
      const base = currentVenc > new Date() ? currentVenc : new Date();
      base.setMonth(base.getMonth() + months);
      newExpiry = base.toISOString();
      console.log("⚠️ Vencimento calculado manualmente:", newExpiry);
    }

    // 8. Atualizar cadastro do cliente
    await supabaseAdmin
      .from("clients")
      .update({
        plan_label: payment.plan_label,
        price_amount: payment.price_amount,
        vencimento: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.client_id);

    console.log("✅ Cliente atualizado no banco");

    // 9. Registrar renovação no histórico
    await supabaseAdmin.from("renewals").insert({
      tenant_id: payment.tenant_id,
      client_id: payment.client_id,
      plan_label: payment.plan_label,
      price_amount: payment.price_amount,
      months,
      new_vencimento: newExpiry,
      payment_method: "pix_mercadopago",
      mp_payment_id: String(paymentId),
      renewed_at: new Date().toISOString(),
    });

    console.log("✅ Histórico registrado");

    // 10. Marcar pagamento como aprovado
    await supabaseAdmin
      .from("client_portal_payments")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        new_vencimento: newExpiry,
      })
      .eq("id", payment.id);

    console.log("✅ Pagamento aprovado no banco");

    // 11. Enviar WhatsApp de confirmação
    try {
      const vencFormatted = new Date(newExpiry).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: payment.tenant_id,
          whatsapp_username: client.whatsapp_username,
          template: "renewal_confirmation",
          variables: {
            name: client.display_name,
            plan: payment.plan_label,
            server: server?.name || "Servidor",
            vencimento: vencFormatted,
          },
        }),
      });

      console.log("✅ WhatsApp enviado");
    } catch (waErr) {
      console.error("⚠️ Erro WhatsApp:", waErr);
    }

    console.log("🎉 Pagamento processado com sucesso:", paymentId);
    return NextResponse.json({ ok: true });

  } catch (err: any) {
    console.error("❌ Erro webhook MP:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// GET para testar se webhook está ativo
export async function GET() {
  return NextResponse.json({ 
    ok: true, 
    message: "Webhook Mercado Pago ativo",
    timestamp: new Date().toISOString() 
  });
}
