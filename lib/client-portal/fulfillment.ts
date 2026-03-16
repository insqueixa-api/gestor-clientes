import { createClient } from "@supabase/supabase-js";

// ============================================================
// Tipos
// ============================================================
export interface FulfillmentParams {
  supabaseAdmin: any;
  tenantId: string;
  origin: string;
  payment: any;
}

// ============================================================
// Helpers internos
// ============================================================
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

// ✅ Log estruturado para Vercel (sempre ativo, nunca vaza dados sensíveis)
export function prodLog(event: string, meta: Record<string, unknown> = {}) {
  const line = {
    ts: new Date().toISOString(),
    event,
    ...meta,
  };
  console.log("[FULFILLMENT]", JSON.stringify(line));
}

const MONTHS_BY_PERIOD: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export function toPeriodMonths(periodRaw: unknown) {
  const p = String(periodRaw || "").toUpperCase().trim();
  return MONTHS_BY_PERIOD[p] ?? 1;
}

// ============================================================
// Lock
// ============================================================
export async function tryAcquireFulfillmentLock(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string
) {
  const { data, error } = await supabaseAdmin.rpc(
    "client_portal_try_acquire_fulfillment_lock",
    {
      p_tenant_id: tenantId,
      p_payment_row_id: paymentRowId,
      p_zombie_seconds: 180,
    }
  );

  if (error) {
    safeServerLog("tryAcquireFulfillmentLock(rpc) error:", error.message);
    return { acquired: false, mode: "rpc_error" };
  }

  const acquired = Array.isArray(data) ? !!data[0]?.acquired : !!(data as any)?.acquired;
  return { acquired, mode: acquired ? "rpc_acquired" : "rpc_no_match" };
}

// ============================================================
// Mark done / error
// ============================================================
export async function markFulfillmentDone(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  newVencimentoISO: string
) {
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

export async function markFulfillmentError(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  message: string
) {
  await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "error",
      fulfillment_error: message,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

// ============================================================
// runFulfillment
// ============================================================
export async function runFulfillment(params: FulfillmentParams) {
  const { supabaseAdmin, tenantId, origin, payment } = params;

  // 1) Carrega cliente
  const { data: client, error: cErr } = await supabaseAdmin
    .from("clients")
    .select("id,tenant_id,display_name,server_username,server_password,external_user_id,technology,server_id,whatsapp_username,price_currency,is_trial,screens")
    .eq("tenant_id", tenantId)
    .eq("id", payment.client_id)
    .single();

  if (cErr || !client) throw new Error("Cliente não encontrado para renovação.");
  prodLog("fulfillment.start", {
  tenant: tenantId.slice(-6),
  client_id: String(client.id).slice(-6),
  client_name: String((client as any).display_name || "").slice(0, 20),
  provider: "pending",
  period: payment.period,
  amount: payment.price_amount,
  currency: payment.price_currency,
  mp_payment_id: String(payment.mp_payment_id).slice(-6),
});

  const login = String((client as any).server_username || "").trim();
  if (!client.server_id || !login) {
    throw new Error("Cliente sem server_id/server_username para renovação.");
  }

  // 2) Servidor
  const { data: srv, error: sErr } = await supabaseAdmin
    .from("servers")
    .select("id,name,panel_integration,whatsapp_session") // ✅ ADICIONADO: whatsapp_session
    .eq("tenant_id", tenantId)
    .eq("id", client.server_id)
    .single();

  if (sErr || !srv) throw new Error("Servidor não encontrado para renovação.");
  if (!srv.panel_integration) throw new Error("Servidor sem integração (panel_integration).");

  const integrationId = String(srv.panel_integration);

  const { data: integ, error: iErr } = await supabaseAdmin
    .from("server_integrations")
    .select("id,provider")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .single();

  if (iErr || !integ) throw new Error("Integração não encontrada para renovação.");

const provider = String(integ.provider || "").toUpperCase();
  const months = toPeriodMonths(payment.period);
  prodLog("fulfillment.provider_resolved", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    provider,
    months,
    server_id: String(client.server_id).slice(-6),
  });

  // 3) Chamar renew
  let renewPath = "";
  if (provider === "FAST") renewPath = "/api/integrations/fast/renew-client";
  else if (provider === "NATV") renewPath = "/api/integrations/natv/renew-client";
  else if (provider === "ELITE") renewPath = "/api/integrations/elite/renew";
  else throw new Error(`Provedor não suportado: ${provider}`);

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
  if (!internalSecret) throw new Error("INTERNAL_API_SECRET missing");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-internal-secret": internalSecret,
  };

  const payload: any = {
    tenant_id: tenantId,
    integration_id: integrationId,
    username: login,
    months,
  };

  if (provider === "ELITE") {
    payload.external_user_id = client.external_user_id || login;
    payload.technology = client.technology || "IPTV";
  }

  const renewRes = await fetch(`${origin}${renewPath}`, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  const renewJson = await renewRes.json().catch(() => null);

if (!renewRes.ok || !renewJson?.ok) {
    prodLog("fulfillment.renew_failed", {
      tenant: tenantId.slice(-6),
      client_id: String(client.id).slice(-6),
      provider,
      http_status: renewRes.status,
    });
    const msg = renewJson?.error || `Falha ao renovar no provedor ${provider}. HTTP ${renewRes.status}`;
    throw new Error(msg);
  }

  let expDateISO = renewJson?.data?.exp_date_iso;
  let newPassword = provider === "NATV" ? (renewJson?.data?.password ?? null) : null;

  prodLog("fulfillment.renew_ok", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    provider,
    exp_date_found: !!expDateISO,
  });

  // Segunda chance Elite
  let newExternalId = null; // ✅ Preparado para capturar o ID
  if (!expDateISO && provider === "ELITE") {
    await new Promise(resolve => setTimeout(resolve, 1500));

    const syncRes = await fetch(`${origin}/api/integrations/elite/renew/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        integration_id: integrationId,
        external_user_id: client.external_user_id,
        username: login,
        technology: client.technology,
        tenant_id: tenantId,
      }),
    });

    const syncJson = await syncRes.json().catch(() => null);
    if (syncRes.ok && syncJson?.ok) {
      prodLog("fulfillment.elite_sync_ok", {
        tenant: tenantId.slice(-6),
        client_id: String(client.id).slice(-6),
        exp_date_found: !!(syncJson.expires_at_iso || syncJson.exp_date),
      });
      expDateISO = syncJson.expires_at_iso || syncJson.exp_date;
      if (syncJson.password) newPassword = syncJson.password;
      if (syncJson.external_user_id) newExternalId = syncJson.external_user_id; // ✅ Captura o ID real caçado!
    }
  }

// 3.5) Fallback de Segurança (Passo 3)
  if (!expDateISO) {
    prodLog("fulfillment.date_fallback_used", {
      tenant: tenantId.slice(-6),
      client_id: String(client.id).slice(-6),
      provider,
      fallback_months: months
    });
    
    // Calcula a data de segurança baseada no vencimento atual ou data de hoje
    const vencDate = (client as any).vencimento ? new Date((client as any).vencimento) : null;
    const isActive = vencDate != null && vencDate > new Date();
    const baseDate = isActive ? vencDate : new Date();
    
    const targetDate = new Date(baseDate);
    targetDate.setMonth(targetDate.getMonth() + months);
    
    expDateISO = targetDate.toISOString();
  }

  // 4) Atualizar cliente (Blindado)
  const updatePayload: any = {
    plan_label: payment.plan_label || (client as any).plan_label || null, // ✅ Protegido
    price_amount: payment.price_amount || (client as any).price_amount || null, // ✅ Protegido
    price_currency: payment.price_currency || (client as any).price_currency || "BRL",
    vencimento: expDateISO,
    updated_at: new Date().toISOString(),
  };

  if ((client as any)?.is_trial === true) updatePayload.is_trial = false;
  if (newPassword) updatePayload.server_password = String(newPassword);
  if (newExternalId) updatePayload.external_user_id = String(newExternalId); // ✅ Salva o ID real no banco!

  const { error: upClientErr } = await supabaseAdmin
    .from("clients")
    .update(updatePayload)
    .eq("tenant_id", tenantId)
    .eq("id", client.id);

  if (upClientErr) throw new Error(`Falha ao atualizar cliente: ${upClientErr.message}`);
  prodLog("fulfillment.client_updated", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    new_vencimento: expDateISO,
    external_id_updated: !!newExternalId
  });

  // 5) Logs
  const totalPaid = payment.price_amount != null ? Number(payment.price_amount) : 0;
  const safeCurrency = String(payment.price_currency || client.price_currency || "BRL").toUpperCase().trim();
  const unitPrice = months > 0 ? Number((totalPaid / months).toFixed(2)) : totalPaid;
  const qtyScreens = Number((client as any).screens ?? 1);
  const clientName = String((client as any).display_name || "Cliente").trim();
  const formattedMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: safeCurrency }).format(totalPaid);

  try {
    await supabaseAdmin.from("client_events").insert({
      tenant_id: tenantId,
      client_id: client.id,
      event_type: "RENEWAL",
      message: `Renovação via Portal do Cliente · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney}`,
      meta: {
        mp_payment_id: String(payment.mp_payment_id),
        months,
        provider,
        server_name: srv.name || null,
        new_vencimento: expDateISO,
        source: "client_portal",
      },
    });
  } catch (e) {
    safeServerLog("fulfillment: failed to insert client_events", (e as any)?.message);
  }

try {
    const { error: renErr } = await supabaseAdmin.from("client_renewals").insert({
      tenant_id: tenantId,
      client_id: client.id,
      server_id: client.server_id,
      months,
      screens: qtyScreens,
      currency: safeCurrency,
      unit_price: unitPrice,
      total_amount: totalPaid,
      credits_per_month: 1,
credits_used: months * qtyScreens,
      status: "PAID",
      // REMOVIDO: new_vencimento (Coluna não existe na tabela client_renewals no banco)
      notes: `Renovação via Portal do Cliente · ${clientName} (${login}) · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney} · MP: ${String(payment.mp_payment_id)}`,
    });

    if (renErr) {
      await supabaseAdmin.from("client_events").insert({
        tenant_id: tenantId,
        client_id: client.id,
        event_type: "SYSTEM",
        message: `[ERRO FINANCEIRO] Falha ao registrar renovação no Servidor: ${renErr.message}`,
      });
    }
  } catch (e) {
    safeServerLog("fulfillment: failed to insert client_renewals", (e as any)?.message);
  }

// 6) Sync
  try {
    let syncPath = "";
    if (provider === "FAST") syncPath = "/api/integrations/fast/sync";
    else if (provider === "NATV") syncPath = "/api/integrations/natv/sync";
    else if (provider === "ELITE") syncPath = "/api/integrations/elite/sync";

    if (syncPath) {
      await fetch(`${origin}${syncPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          tenant_id: tenantId, 
          integration_id: integrationId 
        }),
      });
    }
  } catch (e) {
    safeServerLog("fulfillment: failed sync", (e as any)?.message);
  }

  // 7) WhatsApp
  let messageToSend = "";
  let imageToSend: string | null = null; // ✅ Variável para guardar a imagem
  let templateIdToSend: string | null = null; // ✅ Variável para guardar o ID do template
  const targetSession = srv.whatsapp_session || "default";

  try {
    const { data: tmpl } = await supabaseAdmin
      .from("message_templates")
      .select("id, content, image_url") // ✅ AGORA BUSCA A IMAGEM E O ID
      .eq("tenant_id", tenantId)
      .or("name.ilike.%pagamento%,name.ilike.%pago%,name.ilike.%realizado%")
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();

    messageToSend = String(tmpl?.content || "").trim();
    imageToSend = tmpl?.image_url || null; // ✅ Guarda a imagem
    templateIdToSend = tmpl?.id || null;   // ✅ Guarda o ID
    if (!messageToSend) throw new Error("Template de pagamento não encontrado.");

    const waRes = await fetch(`${origin}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers: { ...headers, Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tenant_id: tenantId,
        client_id: client.id,
        message: messageToSend,
        image_url: imageToSend, // ✅ ENVIA A IMAGEM NO ENVIO IMEDIATO
        message_template_id: templateIdToSend, // ✅ OPCIONAL: Envia o ID para constar no histórico
        whatsapp_session: targetSession,
      }),
    });

    // Avalia se o servidor (VM) estava offline ou se deu erro 500
    const waJson = await waRes.json().catch(() => null);
    if (!waRes.ok || waJson?.ok === false) {
      throw new Error("A API de envio imediato recusou a mensagem ou VM estava offline.");
    }

  } catch (e) {
    safeServerLog("fulfillment: failed whatsapp immediate", (e as any)?.message);
    
    // ✅ PLANO B: Se falhou (mas temos a mensagem montada), salva direto na fila do Cron (+2 min)
    if (messageToSend) {
      try {
        const retryDate = new Date(Date.now() + 2 * 60 * 1000); // Exato momento de agora + 2 minutos
        
        await supabaseAdmin.from("client_message_jobs").insert({
          tenant_id: tenantId,
          client_id: client.id,
          message: messageToSend,
          image_url: imageToSend, // ✅ SALVA A IMAGEM NO AGENDAMENTO DO CRON
          message_template_id: templateIdToSend, // ✅ SALVA O ID DO TEMPLATE
          send_at: retryDate.toISOString(), // Salva em UTC corretamente
          status: "SCHEDULED",
          whatsapp_session: targetSession,
          created_by: "system_fulfillment" // Identifica que foi o robô quem agendou
        });
        
        prodLog("fulfillment.whatsapp_retry_scheduled", { 
          tenant: tenantId.slice(-6),
          client_id: String(client.id).slice(-6)
        });
      } catch (retryErr) {
        // Se der problema até pra salvar no banco, engole em silêncio. A TV já foi paga e liberada.
        safeServerLog("fulfillment: failed to schedule retry", (retryErr as any)?.message);
      }
    }
  }

  prodLog("fulfillment.done", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    provider,
    months,
    amount: payment.price_amount,
    currency: payment.price_currency,
  });

  return { expDateISO };
}