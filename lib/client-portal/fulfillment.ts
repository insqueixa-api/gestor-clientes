// lib/client-portal/fulfillment.ts
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { notify, formatClientLabel } from "@/lib/notifications/notify";
import { APP_FIELD_LABELS, AppFieldType } from "@/lib/apps/field-types";

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
  console.error(...args);
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
  newVencimentoISO: string | null
) {
  // ✅ AJUSTE FINO 1: Impede que o webhook marque como "done" se a renovação caiu para manual
  const { data: curr } = await supabaseAdmin.from("client_portal_payments").select("fulfillment_status").eq("id", paymentRowId).single();
  if (curr?.fulfillment_status === "manual_pending") return;

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

  // ✅ Pagamento aprovado que não conseguiu renovar sozinho — antes disso só
  // ficava visível pra quem abrisse a Auditoria por acaso (foi assim que 12
  // pagamentos ficaram presos meses sem ninguém notar). Agora dispara alerta
  // real via Sentry no momento em que acontece.
  Sentry.captureMessage(`fulfillment_error: ${message}`, {
    level: "error",
    tags: { kind: "fulfillment_error", tenant_id: tenantId },
    extra: { paymentRowId, message },
  });

  // ✅ NOVO (achado 08/08/2026, revisão do bot de atendimento): Sentry é
  // ferramenta de monitoramento técnico, NÃO é o sino nem o e-mail do
  // painel — o Márcio não via isso no fluxo normal. Pedido dele: erro de
  // integração/renovação de verdade precisa de sino E e-mail, sempre —
  // mesmo padrão já usado em manual_pending (notifyManual, mais acima
  // neste arquivo). Envolto em try/catch pra nunca quebrar o fluxo de
  // pagamento por causa de uma falha ao notificar.
  try {
    const { data: payment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("client_id, plan_label, period, price_amount, price_currency, mp_payment_id")
      .eq("id", paymentRowId)
      .maybeSingle();

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, server_username, servers(name)")
      .eq("id", payment?.client_id)
      .maybeSingle();
    const serverName = (client?.servers as any)?.name || "Desconhecido";

    await notify({
      tenantId,
      type: "fulfillment_error",
      title: "🔴 Falha técnica na renovação automática",
      message: `Pagamento de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment?.price_currency || "BRL" }).format(payment?.price_amount || 0)} confirmado para ${formatClientLabel(client?.display_name, client?.server_username, serverName)}, mas a renovação automática falhou: ${message}. Acesse a Auditoria pra concluir.`,
      link: "/admin/auditoria",
      sourceId: paymentRowId,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.UNIGESTOR_APP_URL || "https://unigestor.net.br";
    await fetch(`${baseUrl}/api/notifications/manual-renewal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": String(process.env.INTERNAL_API_SECRET) },
      body: JSON.stringify({
        clientName: client?.display_name,
        serverUsername: client?.server_username,
        serverName,
        planLabel: payment?.plan_label || payment?.period,
        amount: payment?.price_amount,
        currency: payment?.price_currency || "BRL",
        mpPaymentId: payment?.mp_payment_id,
        reason: message,
      }),
    });
  } catch (e) {
    safeServerLog("markFulfillmentError: failed to notify", (e as any)?.message);
  }
}

// ============================================================
// Pagamento avulso de licença de app (payment_type='app_renewal')
// ============================================================
// O pagamento em si é automático (MP/Stripe aprova sozinho), mas a
// RENOVAÇÃO de verdade fica pendente de ação manual (pedido do Márcio,
// 28/07/2026): o dinheiro que o cliente paga aqui é a margem/taxa de
// gerenciamento, não a licença em si — a licença de verdade é paga pelo
// Márcio direto ao desenvolvedor do app, por fora do sistema. Por isso
// "fulfillment" aqui só cai pra "manual_pending" (mesmo estado/badge roxo
// já usado pra renovação manual de assinatura IPTV) — a Auditoria mostra
// um botão "Concluir" que abre um painel com os dados do app (device
// id/key, vencimento antigo) e um "Atualizar" que consulta o vencimento
// real no painel do parceiro, depois de o Márcio já ter pago a licença
// por fora. NUNCA chama runFulfillment (isso é só pra assinatura IPTV) —
// pagar a licença de um app não renova a assinatura do cliente nem mexe em
// clients.vencimento.
export async function markAppRenewalPaid(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  origin?: string
) {
  const { data: payment } = await supabaseAdmin
    .from("client_portal_payments")
    .select("client_id, client_app_id, price_amount, price_currency, app_name_snapshot, mp_payment_id")
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId)
    .maybeSingle();

  // ✅ Idempotência (achado em 11/08/2026 — cliente recebeu 2 emails
  // idênticos pela mesma renovação de licença de app): essa função é
  // chamada por 4 caminhos diferentes que podem disparar pro MESMO
  // pagamento — webhook do Mercado Pago/Stripe (que pode reenviar o mesmo
  // evento) E o polling de /client-portal/payment-status (chamado repetidas
  // vezes pelo navegador do cliente enquanto aguarda a confirmação), às
  // vezes quase simultâneos. payment_type='app_renewal' nunca chega a
  // fulfillment_status='done' (fica em 'manual_pending' até o admin
  // concluir na Auditoria), então um guard tipo "só roda se != done" no
  // chamador NUNCA bloqueia reexecução. Update condicional (só troca se
  // ainda não tinha sido marcado) garante que só a primeira chamada de
  // verdade manda o sino + o email — as demais só encontram 0 linhas
  // afetadas e saem sem notificar de novo.
  const { data: updatedRows } = await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "manual_pending",
      fulfillment_error: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId)
    .or("fulfillment_status.is.null,fulfillment_status.eq.pending")
    .select("id");

  if (!updatedRows || updatedRows.length === 0) {
    return; // já tinha sido processado por outra chamada — não notifica de novo
  }

  // ✅ Sino de notificação — mesmo padrão do manual_pending de assinatura
  // IPTV (notifyManual acima). Sem isso, o pagamento cai pra ação manual
  // mas ninguém no admin fica sabendo até abrir a Auditoria por acaso.
  try {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, server_username, servers(name)")
      .eq("id", payment?.client_id)
      .maybeSingle();
    const serverName = (client?.servers as any)?.name || "";

    await notify({
      tenantId,
      type: "manual_pending",
      title: "🟣 Renovação de licença de app pendente",
      message: `Pagamento de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment?.price_currency || "BRL" }).format(payment?.price_amount || 0)} confirmado para ${formatClientLabel(client?.display_name, client?.server_username, serverName)} — licença de "${payment?.app_name_snapshot || "aplicativo"}". Acesse a Auditoria pra concluir.`,
      link: "/admin/auditoria",
      sourceId: paymentRowId,
    });

    // ✅ Email "bonitinho" (pedido do Márcio, 06/08/2026) — antes só a
    // renovação manual de ASSINATURA IPTV mandava email (notifyManual mais
    // abaixo); a de licença de app ficava só no sino, fácil de passar batido.
    // Mesmos dados de configuração (MAC/Device Key/etc.) mostrados no modal
    // "Concluir renovação" da Auditoria — resolvidos aqui pelo
    // apps.fields_config, igual AplicativosLog.tsx faz no admin.
    if (origin) {
      try {
        let fields: { label: string; value: string }[] = [];
        if (payment?.client_app_id) {
          const { data: appRow } = await supabaseAdmin
            .from("client_apps")
            .select("field_values, apps(fields_config)")
            .eq("id", payment.client_app_id)
            .maybeSingle();
          const appMeta = Array.isArray(appRow?.apps) ? appRow.apps[0] : appRow?.apps;
          const fieldsConfig = Array.isArray((appMeta as any)?.fields_config)
            ? (appMeta as any).fields_config
            : [];
          const values = appRow?.field_values || {};
          fields = fieldsConfig
            .map((f: any) => {
              const raw = values[String(f.id)];
              if (!raw) return null;
              const label = String(f.label || "").trim() || APP_FIELD_LABELS[f.type as AppFieldType] || String(f.id);
              return { label, value: String(raw) };
            })
            .filter((f): f is { label: string; value: string } => !!f);
        }

        await fetch(`${origin}/api/notifications/app-renewal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": String(process.env.INTERNAL_API_SECRET) },
          body: JSON.stringify({
            clientName: client?.display_name || "Cliente",
            serverUsername: client?.server_username || "",
            serverName,
            appName: payment?.app_name_snapshot || "Aplicativo",
            amount: payment?.price_amount || 0,
            currency: payment?.price_currency || "BRL",
            paymentRef: payment?.mp_payment_id || null,
            fields,
          }),
        });
      } catch (e) {
        safeServerLog("Erro ao notificar email de renovação de app", e);
      }
    }
  } catch {
    // não bloqueia o fulfillment por falha na notificação
  }
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

  // (correcao) Quita pendencias financeiras e grava resgate de cupom AQUI,
  // logo apos carregar o cliente — ANTES de qualquer caminho que possa
  // cair em notifyManual()/return antecipado (servidor sem integracao,
  // Elite, falha na chamada de renovacao) ou lancar excecao (linhas
  // abaixo). O lado financeiro (pendencia quitada, cupom usado) e
  // verdadeiro assim que o pagamento e confirmado, independente de o
  // provisionamento no painel IPTV ter sucesso na hora ou precisar de
  // acompanhamento manual depois. Fica dentro do runFulfillment (nao nos
  // webhooks) porque tanto o webhook quanto o polling de payment-status
  // chamam runFulfillment - so um deles de fato executa (o outro cai no
  // lock ocupado) - entao isso garante que roda exatamente uma vez, nao
  // importa qual caminho venceu a corrida NEM se o resto da funcao
  // depois cai no fluxo manual ou lanca erro.
  const settledAlertIds = (payment as any).settled_alert_ids || [];
  if (settledAlertIds.length) {
    await supabaseAdmin
      .from("client_alerts")
      .update({ status: "CLOSED", closed_at: new Date().toISOString() })
      .in("id", settledAlertIds)
      .eq("status", "OPEN");
  }

  // coupon_discount_amount NUNCA entra no price_amount do cliente (que usa
  // plan_price_amount, sem desconto, la embaixo) - o desconto vale so pra
  // essa cobranca. Guard por payment_id evita gravar 2x se runFulfillment
  // for chamado de novo pro mesmo pagamento depois de um erro mais abaixo
  // (ex: webhook reprocessando apos throw).
  const couponId = (payment as any).coupon_id || null;
  const couponDiscountAmount = Number((payment as any).coupon_discount_amount || 0);
  if (couponId && couponDiscountAmount > 0) {
    const { count: alreadyRedeemedCount } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("payment_id", payment.id);

    if (!alreadyRedeemedCount) {
      // ⚠️ coupon_redemptions tem UNIQUE(coupon_id, client_id) — rede de
      // segurança pro caso raro de 2 payments (ids diferentes, então locks
      // diferentes) do mesmo cupom+cliente terem sido criados em paralelo
      // antes de qualquer resgate existir (achado em auditoria de
      // segurança). Se cair aqui, o insert falha por violação de unique;
      // logamos em vez de deixar silencioso, mas NÃO travamos o
      // fulfillment por causa disso — o pagamento já foi cobrado/aprovado,
      // só o registro duplicado de resgate é que não deve existir.
      const { error: redeemErr } = await supabaseAdmin.from("coupon_redemptions").insert({
        tenant_id: tenantId,
        coupon_id: couponId,
        client_id: client.id,
        payment_id: payment.id,
        discount_amount: couponDiscountAmount,
        currency: payment.price_currency || (client as any).price_currency || "BRL",
      });

      if (redeemErr) {
        prodLog("fulfillment.coupon_redemption_insert_failed", {
          payment_id: String(payment.id).slice(-6),
          coupon_id: String(couponId).slice(-6),
          code: (redeemErr as any)?.code,
          message: redeemErr.message,
        });
        Sentry.captureMessage("fulfillment: coupon_redemption insert failed", {
          level: "warning",
          tags: { kind: "client_portal_error", where: "coupon_redemption_insert" },
          extra: { payment_id: payment.id, coupon_id: couponId, message: redeemErr.message, code: (redeemErr as any)?.code },
        });
      } else {
        // Cupom pessoal se autodesativa ao ser usado - o Marcio reativa
        // manualmente na proxima indicacao (documentado desde a Fase 1.5).
        const { data: couponRow } = await supabaseAdmin
          .from("coupons")
          .select("client_id")
          .eq("id", couponId)
          .maybeSingle();
        if (couponRow?.client_id) {
          await supabaseAdmin.from("coupons").update({ is_active: false }).eq("id", couponId);
        }
      }
    }
  }

  const login = String((client as any).server_username || "").trim();
  if (!client.server_id || !login) {
    throw new Error("Cliente sem server_id/server_username para renovação.");
  }

  // 2) Servidor
  const { data: srv, error: sErr } = await supabaseAdmin
    .from("servers")
    .select("id,name,panel_integration,whatsapp_session,credits_available") // ✅ ADICIONADO: whatsapp_session + credits_available (necessário p/ alerta de saldo baixo)
    .eq("tenant_id", tenantId)
    .eq("id", client.server_id)
    .single();

  if (sErr || !srv) throw new Error("Servidor não encontrado para renovação.");

  // ============================================================
  // ✅ CHECAGEM DE SALDO BAIXO (≤15) — NÃO BLOQUEANTE
  // Roda assim que o servidor é carregado, independente de integração.
  // Sem await: dispara em background e NUNCA interfere na renovação.
  // Esta é a ÚNICA checagem de saldo do fluxo (a da seção 6 foi removida).
  // ============================================================
  try {
    const creditsNow = Number((srv as any).credits_available);
    if (Number.isFinite(creditsNow) && creditsNow <= 15) {
      prodLog("fulfillment.low_credits", {
        tenant: tenantId.slice(-6),
        server: srv.name,
        credits: creditsNow,
      });

      const lowCreditsSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
      fetch(`${origin}/api/notifications/low-credits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": lowCreditsSecret,
        },
        body: JSON.stringify({
          serverId: srv.id,
          serverName: srv.name,
          credits: creditsNow,
          tenantId: tenantId,
          reason: "Saldo de créditos atingiu o limite crítico de 15 ou menos.",
        }),
      }).catch((e) =>
        safeServerLog("Erro ao enviar e-mail de saldo baixo", e)
      );
    }
  } catch (e) {
    safeServerLog("fulfillment: failed low credits check", (e as any)?.message);
  }

  // ✅ HELPER: Atualiza o banco e dispara o email de alerta simultaneamente
  const notifyManual = async (reason: string) => {
    const manualRef = payment.mp_payment_id || `MAN${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    await supabaseAdmin.from("client_portal_payments").update({ 
      fulfillment_status: "manual_pending",
      // ✅ NÃO mexe no campo "status" — isso é do pagamento, não do fulfillment.
      // Se o pagamento já veio de gateway automático (MP/Stripe), o status
      // "approved" deve permanecer intacto.
      fulfillment_error: reason,
      mp_payment_id: manualRef 
    }).eq("id", payment.id);

    // ✅ NOVO: notificação no sino (tabela notifications)
    await notify({
      tenantId,
      type: "manual_pending",
      title: "🟣 Renovação Manual Pendente",
      message: `Pagamento de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment.price_currency || "BRL" }).format(payment.price_amount)} confirmado para ${formatClientLabel(client.display_name, login, srv.name)}. Acesse a Auditoria para liberar o cliente no servidor.`,
      link: "/admin/auditoria",
      sourceId: payment.id,
    });

    try {
      await fetch(`${origin}/api/notifications/manual-renewal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": String(process.env.INTERNAL_API_SECRET) },
        body: JSON.stringify({
          clientName: client.display_name,
          serverUsername: login,
          serverName: srv.name || "Desconhecido",
          planLabel: payment.plan_label || (client as any).plan_label || payment.period,
          amount: payment.price_amount,
          currency: payment.price_currency || "BRL",
          mpPaymentId: manualRef, // ✅ Passa o ID na notificação
          reason
        })
      });
    } catch (e) { safeServerLog("Erro ao notificar email", e); }

    // ========================================================================
    // ✅ REGISTRAR RENOVAÇÃO MANUAL (E FALLBACKS) COMO "PENDENTE"
    // ========================================================================
    const months = toPeriodMonths(payment.period);
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
        event_type: "RENEWAL_MANUAL",
        message: `Renovação Manual Pendente · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney}`,
        meta: {
          reason,
          mp_payment_id: manualRef, // ✅ Registra o ID gerado nos eventos do cliente
          months,
          server_name: srv.name || null,
          source: "client_portal_manual",
        },
      });
    } catch (e) {
      safeServerLog("fulfillment: failed to insert manual client_events", (e as any)?.message);
    }

    try {
      await supabaseAdmin.from("client_renewals").insert({
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
        status: "PENDING", 
        notes: `[RENOVAÇÃO MANUAL PENDENTE] · ${clientName} (${login}) · ${months} mês(es) · ${formattedMoney} · Ref: ${manualRef} · Motivo: ${reason}`, // ✅ Registra na nota para auditoria fácil
      });
    } catch (e) {
      safeServerLog("fulfillment: failed to insert manual client_renewals", (e as any)?.message);
    }
    // ========================================================================

    return { expDateISO: null };
  };
  
  if (!srv.panel_integration) return await notifyManual("Servidor sem integração configurada.");

  const integrationId = String(srv.panel_integration);

  const { data: integ, error: iErr } = await supabaseAdmin
    .from("server_integrations")
    .select("id,provider")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .single();

  if (iErr || !integ) return await notifyManual("Integração do servidor não encontrada.");

  const provider = String(integ.provider || "").toUpperCase();

  // Se for ELITE (que não tem API), aciona o fluxo manual com notificação
  if (provider === "ELITE") return await notifyManual("Servidor Elite requer renovação manual.");
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
  else throw new Error(`Servidor não suportado: ${provider}`);

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
    const msg = renewJson?.error || `Falha ao renovar no servidor ${provider}. HTTP ${renewRes.status}`;
    return await notifyManual(msg);
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
    // (correcao) usa plan_price_amount (preco do PLANO, sem pendencia somada) -
    // nunca payment.price_amount direto, senao uma pendencia pontual de app
    // (ex: ativacao de R$30) vira o novo preco fixo do cliente pra sempre.
    // plan_price_amount pode ser null em pagamentos antigos (antes dessa
    // coluna existir), dai cai no price_amount mesmo.
    price_amount: payment.plan_price_amount ?? payment.price_amount ?? (client as any).price_amount ?? null,
    price_currency: payment.price_currency || (client as any).price_currency || "BRL",
    vencimento: expDateISO,
    updated_at: new Date().toISOString(),
  };

  updatePayload.is_trial = false;
updatePayload.is_archived = false;
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

  // ✅ Teste virou cliente pago pelo portal — marca o histórico (papa_testes)
  // como convertido, mesmo motivo do update_client (RPC do painel). Casa por
  // WhatsApp + USERNAME exato: a mesma pessoa pode ter mais de um teste no mesmo
  // servidor com usuários diferentes, só o teste do username que converteu de
  // verdade deve virar "Convertido".
  const finalUsername = String((client as any).server_username || "").trim();
  if (updatePayload.is_trial === false && (client as any).whatsapp_username && finalUsername) {
    const { error: papaErr } = await supabaseAdmin
      .from("papa_testes")
      .update({ converted: true, converted_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("whatsapp_username", (client as any).whatsapp_username)
      .eq("username", finalUsername)
      .eq("converted", false);
    if (papaErr) {
      prodLog("fulfillment.papa_testes_mark_converted_failed", {
        tenant: tenantId.slice(-6),
        client_id: String(client.id).slice(-6),
        error: papaErr.message,
      });
    }
  }

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

// 6) Sync e Alerta de Saldo Baixo (Gmail via API Interna)
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

    // ✅ Sorteia entre o texto original e as variantes cadastradas (mesma
    // estratégia anti-detecção usada em billing_enqueue_scheduled) — sem
    // variantes, comportamento idêntico a antes (só o original).
    let pickedContent = String(tmpl?.content || "").trim();
    if (tmpl?.id) {
      const { data: variants } = await supabaseAdmin
        .from("message_template_variants")
        .select("content")
        .eq("tenant_id", tenantId)
        .eq("template_id", tmpl.id);
      const pool = [tmpl.content, ...(variants || []).map((v) => v.content)].filter(
        (c): c is string => !!c && String(c).trim().length > 0,
      );
      if (pool.length > 0) {
        pickedContent = pool[Math.floor(Math.random() * pool.length)].trim();
      }
    }

    messageToSend = pickedContent;
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

    // ✅ NOVO: Se passou sem erros, atualiza a nova coluna whatsapp_status na tabela de auditoria para "sent"
    await supabaseAdmin.from("client_portal_payments").update({ whatsapp_status: "sent" }).eq("id", payment.id);

  } catch (e) {
    safeServerLog("fulfillment: failed whatsapp immediate", (e as any)?.message);
    
    // ✅ NOVO: Se caiu no catch, atualiza a tabela de auditoria como "error" (Mesmo o Plano B agendando depois)
    await supabaseAdmin.from("client_portal_payments").update({ whatsapp_status: "error" }).eq("id", payment.id);

    // ✅ NOVO: notificação no sino (tabela notifications)
    await notify({
      tenantId,
      type: "whatsapp_falha",
      title: "💬 Falha no WhatsApp",
      message: `Uma recarga foi efetuada para ${formatClientLabel(client.display_name, login, srv.name)}, mas o envio do comprovante pelo WhatsApp falhou. Reenvie pela Auditoria.`,
      link: "/admin/auditoria",
      sourceId: payment.id,
    });

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