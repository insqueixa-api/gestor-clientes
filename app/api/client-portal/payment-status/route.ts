import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MONTHS_BY_PERIOD: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

function toPeriodMonths(periodRaw: unknown) {
  const p = String(periodRaw || "").toUpperCase().trim();
  return MONTHS_BY_PERIOD[p] ?? 1;
}

function fmtBRDateFromISO(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function fetchPayment(tenantId: string, paymentId: string) {
  const { data, error } = await supabaseAdmin
    .from("client_portal_payments")
    .select(
      "id,tenant_id,client_id,mp_payment_id,status,period,plan_label,price_amount,price_currency,new_vencimento,fulfillment_status,fulfillment_error"
    )
    .eq("tenant_id", tenantId)
    .eq("mp_payment_id", String(paymentId))
    .single();

  if (error) throw error;
  return data as any;
}

async function refreshMercadoPagoStatusIfPending(tenantId: string, payment: any) {
  // Só faz sentido pro MP e se estiver pendente
  if (String(payment.status) !== "pending") return payment;

  // Busca gateway ativo do tipo mercadopago
  const { data: gateway, error: gwErr } = await supabaseAdmin
    .from("payment_gateways")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("type", "mercadopago")
    .eq("is_active", true)
    .single();

  if (gwErr || !gateway?.config?.access_token) {
    // Sem token, não dá pra consultar no MP — retorna como está
    return payment;
  }

  try {
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${String(payment.mp_payment_id)}`,
      {
        headers: {
          Authorization: `Bearer ${gateway.config.access_token}`,
        },
      }
    );

    if (!mpRes.ok) return payment;

    const mpData = await mpRes.json();
    const newStatus = String(mpData?.status || "").toLowerCase();

    // Atualiza somente se mudou
    if (newStatus && newStatus !== String(payment.status)) {
      const { error: upErr } = await supabaseAdmin
        .from("client_portal_payments")
        .update({ status: newStatus })
        .eq("tenant_id", tenantId)
        .eq("id", payment.id);

      if (!upErr) {
        payment.status = newStatus;
      }
    }
  } catch (e) {
    console.error("Erro consultando Mercado Pago:", e);
  }

  return payment;
}

async function tryAcquireFulfillmentLock(tenantId: string, paymentRowId: string) {
  // Atomiza: só 1 request consegue trocar pending -> processing
  const { data, error } = await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "processing",
      fulfillment_started_at: new Date().toISOString(),
      fulfillment_attempts: supabaseAdmin.rpc ? undefined : undefined, // (não usa)
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId)
    .or("fulfillment_status.is.null,fulfillment_status.eq.pending")
    .select("id,fulfillment_status")
    .single();

  if (error) return { acquired: false, row: null as any };
  if (!data) return { acquired: false, row: null as any };
  return { acquired: true, row: data };
}

async function markFulfillmentDone(tenantId: string, paymentRowId: string, newVencimentoISO: string) {
  await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "done",
      fulfilled_at: new Date().toISOString(),
      new_vencimento: newVencimentoISO,
      fulfillment_error: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

async function markFulfillmentError(tenantId: string, paymentRowId: string, message: string) {
  await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "error",
      fulfillment_error: message,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

async function runFulfillment(params: {
  tenantId: string;
  origin: string;
  payment: any;
}) {
  const { tenantId, origin, payment } = params;

  // 1) Carrega cliente com dados necessários
  const { data: client, error: cErr } = await supabaseAdmin
    .from("clients")
    .select("id,tenant_id,display_name,username,server_id,whatsapp_username,price_currency")
    .eq("tenant_id", tenantId)
    .eq("id", payment.client_id)
    .single();

  if (cErr || !client) throw new Error("Cliente não encontrado para fulfillment.");

  if (!client.server_id || !client.username) {
    throw new Error("Cliente sem server_id/username para renovação automática.");
  }

  // 2) Descobrir integração do servidor
  const { data: srv, error: sErr } = await supabaseAdmin
    .from("servers")
    .select("id,name,panel_integration")
    .eq("tenant_id", tenantId)
    .eq("id", client.server_id)
    .single();

  if (sErr || !srv) throw new Error("Servidor não encontrado para fulfillment.");
  if (!srv.panel_integration) throw new Error("Servidor sem integração (panel_integration).");

  const integrationId = String(srv.panel_integration);

  const { data: integ, error: iErr } = await supabaseAdmin
    .from("server_integrations")
    .select("id,provider")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .single();

  if (iErr || !integ) throw new Error("Integração não encontrada para fulfillment.");

  const provider = String(integ.provider || "").toUpperCase();
  const months = toPeriodMonths(payment.period);

  // 3) Chamar renew-client (NaTV/FAST) — usa teu endpoint interno
  const renewPath =
    provider === "FAST" ? "/api/integrations/fast/renew-client" : "/api/integrations/natv/renew-client";

  const internalSecret = process.env.INTERNAL_API_SECRET;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (internalSecret) headers["x-internal-secret"] = internalSecret;

  const renewRes = await fetch(`${origin}${renewPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      integration_id: integrationId,
      username: String(client.username),
      months,
    }),
  });

  const renewJson = await renewRes.json().catch(() => null);

  if (!renewRes.ok || !renewJson?.ok) {
    const msg =
      renewJson?.error ||
      `Falha ao renovar no provedor ${provider}. HTTP ${renewRes.status}`;
    throw new Error(msg);
  }

  const expDateISO = renewJson?.data?.exp_date_iso;
  if (!expDateISO) throw new Error("API de integração não retornou exp_date_iso.");

  const newPassword = provider === "NATV" ? (renewJson?.data?.password ?? null) : null;

  // 4) Atualizar cliente (plano/valor/vencimento/senha NATV)
  const updatePayload: any = {
    plan_label: payment.plan_label ?? null,
    price_amount: payment.price_amount ?? null,
    // mantém a moeda do cliente (ou usa do pagamento se existir)
    price_currency: payment.price_currency ?? client.price_currency ?? "BRL",
    vencimento: expDateISO,
    updated_at: new Date().toISOString(),
  };

  // Só atualiza senha se NATV trouxe
  if (newPassword) {
    updatePayload.server_password = String(newPassword);
  }

  const { error: upClientErr } = await supabaseAdmin
    .from("clients")
    .update(updatePayload)
    .eq("tenant_id", tenantId)
    .eq("id", client.id);

  if (upClientErr) {
    throw new Error(`Falha ao atualizar cliente no banco: ${upClientErr.message}`);
  }

  // 5) Gravar evento/log (não quebra fulfillment se falhar)
  try {
    await supabaseAdmin.from("client_events").insert({
      tenant_id: tenantId,
      client_id: client.id,
      event_type: "RENEWAL",
      message: `Portal: pagamento aprovado e renovação automática via ${srv.name || provider}.`,
      meta: {
        mp_payment_id: String(payment.mp_payment_id),
        months,
        provider,
        server_name: srv.name || null,
        new_vencimento: expDateISO,
      },
    });
  } catch (e) {
    console.error("Falha ao inserir client_events:", e);
  }

  // 6) Sync créditos (não quebra fulfillment se falhar)
  try {
    const syncPath = provider === "FAST" ? "/api/integrations/fast/sync" : "/api/integrations/natv/sync";
    await fetch(`${origin}${syncPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ integration_id: integrationId }),
    });
  } catch (e) {
    console.error("Falha sync integração:", e);
  }

  // 7) Enviar WhatsApp (não quebra fulfillment se falhar)
  try {
    const vencBR = fmtBRDateFromISO(expDateISO);
    const msg =
      `✅ Pagamento confirmado!\n` +
      `Sua assinatura foi renovada com sucesso.\n` +
      `📅 Novo vencimento: ${vencBR}\n\n` +
      `Se precisar de ajuda, responda esta mensagem.`;

    await fetch(`${origin}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tenant_id: tenantId,
        client_id: client.id,
        message: msg,
        whatsapp_session: "default",
      }),
    });
  } catch (e) {
    console.error("Falha ao enviar WhatsApp:", e);
  }

  return { expDateISO };
}

export async function POST(req: NextRequest) {
  try {
    const { session_token, payment_id } = await req.json();

    if (!session_token || !payment_id) {
      return NextResponse.json(
        { ok: false, error: "Parâmetros incompletos" },
        { status: 400 }
      );
    }

    // 1) Validar sessão (fonte da verdade do tenant)
    const { data: sess, error: sErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sErr || !sess?.tenant_id) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });
    }

    const tenantId = String(sess.tenant_id);
    const origin = req.nextUrl.origin;

    // 2) Buscar pagamento
    let payment = await fetchPayment(tenantId, String(payment_id));

    // 3) Se pending, tenta atualizar pelo MP (quando houver)
    payment = await refreshMercadoPagoStatusIfPending(tenantId, payment);

    // 4) Se não aprovado, devolve o status atual
    if (String(payment.status) !== "approved") {
      return NextResponse.json({
        ok: true,
        status: String(payment.status),
        new_vencimento: payment.new_vencimento ?? null,
      });
    }

    // 5) Se aprovado, mas fulfillment ainda não terminou, roda o fulfillment 1x
    const fStatus = String(payment.fulfillment_status || "pending");

    if (fStatus === "done") {
      return NextResponse.json({
        ok: true,
        status: "approved",
        new_vencimento: payment.new_vencimento ?? null,
      });
    }

    if (fStatus === "error") {
      // Para o front parar (ele trata rejected/cancelled) — depois você melhora a UI
      return NextResponse.json({
        ok: true,
        status: "rejected",
        error: payment.fulfillment_error || "Falha ao concluir renovação. Procure o suporte.",
      });
    }

    // fStatus: pending/processing/null
    if (fStatus === "processing") {
      // mantém polling sem mexer no front
      return NextResponse.json({
        ok: true,
        status: "pending",
      });
    }

    // tenta adquirir lock
    const lock = await tryAcquireFulfillmentLock(tenantId, payment.id);
    if (!lock.acquired) {
      return NextResponse.json({ ok: true, status: "pending" });
    }

    // Executa fulfillment
    try {
      const { expDateISO } = await runFulfillment({ tenantId, origin, payment });
      await markFulfillmentDone(tenantId, payment.id, expDateISO);

      return NextResponse.json({
        ok: true,
        status: "approved",
        new_vencimento: expDateISO,
      });
    } catch (e: any) {
      const msg = e?.message || "Falha no fulfillment. Procure o suporte.";
      console.error("Fulfillment error:", e);
      await markFulfillmentError(tenantId, payment.id, msg);

      return NextResponse.json({
        ok: true,
        status: "rejected",
        error: msg,
      });
    }
  } catch (err: any) {
    console.error("Erro payment-status:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// GET pra testar rota
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "API payment-status ativa",
    timestamp: new Date().toISOString(),
  });
}
