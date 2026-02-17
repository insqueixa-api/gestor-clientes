import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { session_token, client_id, period, price_amount } = await req.json();

    if (!session_token || !client_id || !period || !price_amount) {
      return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400 });
    }

    // 1. Validar sessão
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
    }

    // 2. Buscar dados do cliente
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, display_name, whatsapp_username, plan_label, price_currency, screens, servers(name)")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ ok: false, error: "Cliente não encontrado" }, { status: 404 });
    }

    const PERIOD_LABELS: Record<string, string> = {
      MONTHLY: "Mensal",
      BIMONTHLY: "Bimestral",
      QUARTERLY: "Trimestral",
      SEMIANNUAL: "Semestral",
      ANNUAL: "Anual",
    };

    const planLabel = PERIOD_LABELS[period] || period;
    const serverName = (client.servers as any)?.name || "Servidor";
    const displayName = client.display_name || "Cliente";
    const currency = client.price_currency || "BRL";

    // 3. Buscar gateway ativo (prioridade)
    const { data: gateways } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", sess.tenant_id)
      .eq("is_active", true)
      .eq("is_online", true)
      .contains("currency", [currency])
      .order("priority", { ascending: true });

    if (!gateways || gateways.length === 0) {
      // Nenhum gateway online — busca fallback manual
      const { data: manual } = await supabaseAdmin
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", sess.tenant_id)
        .eq("type", "pix_manual")
        .eq("is_active", true)
        .eq("is_manual_fallback", true)
        .single();

      if (!manual) {
        return NextResponse.json({ ok: false, error: "Nenhum método de pagamento configurado" }, { status: 503 });
      }

      // Retorna dados do PIX Manual
      return NextResponse.json({
        ok: true,
        payment_method: "manual",
        pix_key: manual.config.pix_key,
        pix_key_type: manual.config.pix_key_type,
        holder_name: manual.config.holder_name,
        bank_name: manual.config.bank_name,
        instructions: manual.config.instructions,
        price_amount,
        currency,
      });
    }

    // 4. Tentar criar pagamento com cada gateway
    let lastError = null;

    for (const gateway of gateways) {
      try {
        if (gateway.type === "mercadopago") {
          const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${gateway.config.access_token}`,
              "X-Idempotency-Key": `${client_id}-${period}-${Date.now()}`,
            },
            body: JSON.stringify({
              transaction_amount: Number(price_amount),
              description: `${displayName} - Plano ${planLabel} - ${serverName}`,
              payment_method_id: "pix",
              payer: {
                email: `${client.whatsapp_username}@unigestor.net.br`,
                first_name: displayName.split(" ")[0],
                last_name: displayName.split(" ").slice(1).join(" ") || "Cliente",
              },
              notification_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mercadopago`,
              metadata: {
                client_id,
                tenant_id: sess.tenant_id,
                session_token,
                period,
                price_amount,
                plan_label: planLabel,
                gateway_id: gateway.id,
              },
              date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            }),
          });

          const mpData = await mpResponse.json();

          if (mpResponse.ok && mpData.id) {
            // Salvar pagamento pendente
            await supabaseAdmin.from("client_portal_payments").insert({
              tenant_id: sess.tenant_id,
              client_id,
              gateway_id: gateway.id,
              gateway_type: gateway.type,
              mp_payment_id: String(mpData.id),
              session_token,
              period,
              plan_label: planLabel,
              price_amount: Number(price_amount),
              price_currency: currency,
              status: "pending",
              pix_qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
              pix_qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            });

            return NextResponse.json({
              ok: true,
              payment_method: "online",
              gateway_name: gateway.name,
              payment_id: mpData.id,
              pix_qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
              pix_qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            });
          }

          lastError = mpData.message || "Erro ao criar pagamento";
        }
      } catch (err: any) {
        lastError = err.message;
        console.error(`Erro gateway ${gateway.name}:`, err);
        continue;
      }
    }

    // Todos os gateways falharam — tentar fallback manual
    const { data: manual } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", sess.tenant_id)
      .eq("type", "pix_manual")
      .eq("is_active", true)
      .eq("is_manual_fallback", true)
      .single();

    if (manual) {
      return NextResponse.json({
        ok: true,
        payment_method: "manual",
        pix_key: manual.config.pix_key,
        pix_key_type: manual.config.pix_key_type,
        holder_name: manual.config.holder_name,
        bank_name: manual.config.bank_name,
        instructions: manual.config.instructions,
        price_amount,
        currency,
      });
    }

    return NextResponse.json({
      ok: false,
      error: lastError || "Erro ao criar pagamento",
    }, { status: 500 });

  } catch (err: any) {
    console.error("Erro create-payment:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
