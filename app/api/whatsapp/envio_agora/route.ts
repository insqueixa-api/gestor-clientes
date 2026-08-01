// app/api/whatsapp/envio_agora/route.ts
//app/api/whatsapp/envio_agora

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { requireAdminTenant } from "@/lib/api/auth";
import { isInternalRequest } from "@/lib/internal-auth";
import { makeSessionKey } from "@/lib/whatsapp/wa-context";
import {
  buildClientTemplateVars,
  buildResellerTemplateVars,
  fetchClientWhatsApp,
  fetchResellerWhatsApp,
  fetchManualPaymentVars,
  generatePortalLink,
  renderTemplate,
  pickRandomDns,
} from "@/lib/whatsapp/template-vars";
import { getCouponPhraseForClient, getPendencyPhraseForClient } from "@/lib/client-portal/coupons";
import { toolConsultarPrecosTexto } from "@/lib/whatsapp/bot-engine";

function safeServerLog(...args: any[]) {
  console.error(...args);
}

export const runtime = "nodejs";

function isInternal(req: Request) {
  return isInternalRequest(req);
}

async function resolveTenantSenderUserId(sb: any, tenantId: string): Promise<string | null> {
  // 1) tenta owner (se existir coluna role)
  try {
    const { data: owner } = await sb
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .maybeSingle();

    if (owner?.user_id) return String(owner.user_id);
  } catch {
    // se não existir coluna role, cai pro fallback abaixo
  }

  // 2) fallback: primeiro membro do tenant
  let first: any = null;

  try {
    const { data } = await sb
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1);

    first = data;
  } catch {
    const { data } = await sb
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .limit(1);

    first = data;
  }

  const u = Array.isArray(first) ? first[0]?.user_id : null;
  return u ? String(u) : null;
}

export const dynamic = "force-dynamic";

const TZ_SP = "America/Sao_Paulo";

type SendNowBody = {
  tenant_id: string;
  client_id?: string;
  reseller_id?: string;
  recipient_id?: string;
  recipient_type?: "client" | "reseller";
  message: string;
  whatsapp_session?: string | null;
  message_template_id?: string | null;
  image_url?: string | null;
  new_expires_at?: string | null;
  credits_recharged?: number | string | null;
};

export async function POST(req: Request) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!baseUrl || !waToken || !supabaseUrl || !serviceKey) {
    safeServerLog("[WA][send_now] Server misconfigured", {
      hasBaseUrl: !!baseUrl,
      hasWaToken: !!waToken,
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceKey: !!serviceKey,
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // =========================
  // 1) Autorização: INTERNAL ou USER
  // =========================
  const internal = isInternal(req);

  // Se alguém mandou x-internal-secret mas está errado -> 401 direto
  const hasInternalHeader = !!req.headers.get("x-internal-secret");
  if (hasInternalHeader && !internal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let authedUserId = "";
  let authTenantId: string | null = null;

  // ✅ USER: exige Bearer + role de admin em tenant_members — mesma fonte
  // de verdade usada no resto do painel (lib/api/auth.ts).
  if (!internal) {
    const auth = await requireAdminTenant(req);
    if (!auth.ok) return auth.res;
    authedUserId = auth.user_id;
    authTenantId = auth.tenant_id;
  }

  // =========================
  // 2) Body
  // =========================
  let body: SendNowBody;

  try {
    body = (await req.json()) as SendNowBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String((body as any).tenant_id || "").trim();
  const message = String((body as any).message || "").trim();
  const messageTemplateId = String((body as any).message_template_id || "").trim();
  let imageUrl = String((body as any).image_url || "").trim() || null;

  if (!tenantId || !message) {
    return NextResponse.json({ error: "tenant_id e message são obrigatórios" }, { status: 400 });
  }

  // ✅ Se veio o ID do template mas não veio a imagem, busca no banco para garantir
  if (!imageUrl && messageTemplateId) {
    try {
      const { data: tpl } = await sb
        .from("message_templates")
        .select("image_url")
        .eq("id", messageTemplateId)
        .single();
      if (tpl?.image_url) {
        imageUrl = tpl.image_url;
      }
    } catch (e) {
      safeServerLog("[WA][send_now] falha ao buscar imagem do template", e);
    }
  }

  // ✅ INTERNAL: resolve um user_id real do tenant para gerar x-session-key válido
  if (internal) {
    const senderUserId = await resolveTenantSenderUserId(sb, tenantId);
    // Alinhado com o padrão de segurança do Cron
    authedUserId = senderUserId || "system";
  }

  // =========================
  // 3) Validação de que o tenant do body é o mesmo do usuário autenticado (apenas USER)
  // =========================
  if (!internal && tenantId !== authTenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // =========================
  // 4) Identificação do destino
  // =========================

  const rawClientId = String((body as any).client_id || "").trim();
  const rawResellerId = String((body as any).reseller_id || "").trim();
  const rawTestId = String((body as any).test_id || "").trim();
  const rawRecipientId = String((body as any).recipient_id || "").trim();
  const rawRecipientType = String((body as any).recipient_type || "").trim();

  let recipientType: "client" | "reseller" | null = null;
  let recipientId = "";

  if (rawRecipientId && (rawRecipientType === "client" || rawRecipientType === "reseller" || rawRecipientType === "test")) {
    recipientType = rawRecipientType === "reseller" ? "reseller" : "client";
    recipientId = rawRecipientId;
  } else if (rawResellerId) {
    recipientType = "reseller";
    recipientId = rawResellerId;
  } else if (rawClientId) {
    recipientType = "client";
    recipientId = rawClientId;
  } else if (rawTestId) {
    recipientType = "client";
    recipientId = rawTestId;
  }

  if (!tenantId || !message || !recipientType || !recipientId) {
    return NextResponse.json(
      { error: "tenant_id, message e destino válido (client_id ou reseller_id) são obrigatórios" },
      { status: 400 }
    );
  }

  const rawResellerServerId = String((body as any).reseller_server_id || "").trim();
  const rawCredits = (body as any).credits_recharged != null ? String((body as any).credits_recharged) : undefined;

  // ✅ pega SEMPRE do destino certo
  let wa: any;
  if (recipientType === "reseller") {
    wa = await fetchResellerWhatsApp(sb, tenantId, recipientId, rawResellerServerId, rawCredits);
  } else {
    wa = await fetchClientWhatsApp(sb, tenantId, recipientId);
  }

  // Validação 1: Conta sem números salvos
  if (!wa.phones || wa.phones.length === 0) {
    return NextResponse.json(
      { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} sem whatsapp_username` },
      { status: 400 }
    );
  }

  // Validação 2: Opt-in (Se for falso, BLOQUEIA TUDO para ambos, retorna 400)
  if (!wa.whatsapp_opt_in) {
    return NextResponse.json(
      { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não permite receber mensagens` },
      { status: 400 }
    );
  }

  // Validação 3: Snooze (Se for verdadeiro, BLOQUEIA TUDO para ambos, retorna 409)
  if (wa.dont_message_until) {
    const until = new Date(wa.dont_message_until);

    if (isNaN(until.getTime())) {
      return NextResponse.json(
        { error: `Cliente não quer receber mensagens (data inválida): ${wa.dont_message_until}` },
        { status: 409 }
      );
    }

    if (until > new Date()) {
      const formatted = new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ_SP,
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(until);

      return NextResponse.json(
        { error: `Cliente não quer receber mensagens até: ${formatted}` },
        { status: 409 }
      );
    }
  }

  // ✅ NOVO: Lê a sessão requisitada do body e gera a chave correspondente
  const targetSession = String((body as any).whatsapp_session || "default");
  const sessionKey = makeSessionKey(tenantId, authedUserId, targetSession === "session2" ? 2 : 1);

  safeServerLog("[WA][send_now]", {
    tenantId,
    recipientType,
    recipientId_suffix: recipientId ? recipientId.slice(-6) : null,
    authedUserId_prefix: authedUserId ? String(authedUserId).slice(0, 8) : null,
    total_contacts: wa.phones.length,
  });

  // Puxa as variáveis dos Gateways Manuais uma única vez para a conta
  let manualPaymentVars: Record<string, string> = {};
  try {
    manualPaymentVars = await fetchManualPaymentVars(sb, tenantId);
  } catch (e: any) {
    safeServerLog("[WA][send_now][manual_payments] falhou", e?.message ?? e);
  }

  // ✅ {dns_servidor}/{tabela_precos}/{pendencia_detalhe} — pedido do Márcio
  // (25/07/2026): essas 3 tags existiam só no bot de atendimento, causando
  // confusão (mesma tag, uma tela resolvia e a outra mandava o texto cru
  // "{tabela_precos}" pro cliente). Mesmas funções que o bot já usa
  // (toolConsultarPrecosTexto, getPendencyPhraseForClient), calculadas 1x
  // pra conta inteira (não muda entre o contato principal/secundário).
  let dnsServidor = "";
  let tabelaPrecos = "";
  let pendenciaDetalhe = "";
  if (recipientType !== "reseller") {
    try {
      if (wa.row?.server_id) {
        const { data: srv } = await sb.from("servers").select("dns").eq("id", wa.row.server_id).maybeSingle();
        dnsServidor = pickRandomDns(Array.isArray(srv?.dns) ? srv.dns : []);
      }
      tabelaPrecos = await toolConsultarPrecosTexto(sb, tenantId, wa.row);
      pendenciaDetalhe = await getPendencyPhraseForClient(sb, tenantId, wa.row.id, wa.row.price_currency || "BRL");
    } catch (e: any) {
      safeServerLog("[WA][send_now][dns_tabela_pendencia] falhou", e?.message ?? e);
    }
  }

  // ✅ Jitter anti-flood: chamadas internas (webhook/renovação) esperam
  // um tempo aleatório antes de bater na VM, evitando pico simultâneo
  if (internal) {
    const jitterMs = Math.floor(Math.random() * 8000) + 1000; // 1s a 9s
    await new Promise((r) => setTimeout(r, jitterMs));
  }

  const results = [];

  // ==========================================
  // LOOP DE DISPARO
  // ==========================================
  for (let i = 0; i < wa.phones.length; i++) {
    const contact = wa.phones[i];

    // ✅ Delay entre contatos do mesmo cliente (principal → secundário)
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 5000));
    }

    const vars =
      recipientType === "reseller"
        ? buildResellerTemplateVars({ resellerRow: wa.row })
        : buildClientTemplateVars({ clientRow: wa.row, isSecondary: contact.is_secondary });

    Object.assign(vars, manualPaymentVars); // ✅ Injeta o PIX e o IBAN na mensagem final

    if (recipientType !== "reseller") {
      vars.dns_servidor = dnsServidor;
      vars.tabela_precos = tabelaPrecos;
      vars.pendencia_detalhe = pendenciaDetalhe;
    }

    // ✅ LINK DO PORTAL — crítico, gerado via lib (mesmo RPC, mesmos logs, mesmo fallback)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authedUserId);
    const safeUserId = isUuid ? authedUserId : null;
    const actionLabel = internal ? "Envio automático" : "Envio manual";

    vars.link_pagamento = await generatePortalLink(sb, {
      tenantId,
      contact: { number: contact.number, username: contact.username, is_secondary: contact.is_secondary },
      createdBy: safeUserId,
      label: contact.is_secondary ? `${actionLabel} Secundário` : actionLabel,
      expiresAt: null,
      onLog: safeServerLog,
      // ✅ /renew-beta é o destino oficial pra qualquer link gerado via
      // WhatsApp (31/07/2026, pedido do Márcio) — mesmo padrão que o bot já
      // usa (lib/whatsapp/bot-engine.ts, toolGerarLinkPortal).
      dest: "renew-beta",
    });

    if (recipientType !== "reseller") {
      vars.cupom_frase = await getCouponPhraseForClient(sb, tenantId, wa.row);
    }

    const renderedMessage = renderTemplate(message, vars);

    try {
      const sendController = new AbortController();
      // ✅ 30s (era 15s) — a VM agora simula "digitando..." (5-10s) + presença
      // "disponível" antes de mandar (pedido do Márcio, 26/07/2026), então o
      // envio real passou a demorar mais só nesse preparo, sem contar a rede.
      const sendTimeout = setTimeout(() => sendController.abort(), 30_000);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${waToken}`,
            "x-session-key": sessionKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            phone: contact.number,
            message: renderedMessage,
            ...(imageUrl ? { image_url: imageUrl } : {}),
          }),
          signal: sendController.signal,
        });
      } finally {
        clearTimeout(sendTimeout);
      }

      const raw = await res.text();
      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!res.ok) {
        safeServerLog("[WA][vm_send] http_error", { status: res.status, to_suffix: contact.number.slice(-4) });
        results.push({ phone: contact.number, error: raw || "Falha ao enviar", status: 502 });
      } else if (
        (parsed && (parsed.ok === false || !!parsed.error)) ||
        /not\s*connected|disconnected|qr|invalid|blocked|logout|session/i.test(String(raw || ""))
      ) {
        safeServerLog("[WA][vm_send] logical_error", { to_suffix: contact.number.slice(-4) });
        results.push({ phone: contact.number, error: "Falha ao enviar (WA backend)", status: 502 });
      } else {
        safeServerLog("[WA][vm_send] ok", {
          to_suffix: contact.number.slice(-4),
          wa_id: parsed?.id ?? parsed?.messageId ?? parsed?.msg_id ?? null,
        });
        results.push({ phone: contact.number, ok: true, status: 200 });
      }
    } catch (err: any) {
      results.push({ phone: contact.number, error: err?.message, status: 500 });
    }
  }

  // Mantendo o mesmo padrão de erro 502 global se todos os números falharam
  const allFailed = results.length > 0 && results.every((r) => r.status !== 200);

  // ✅ NOVO: Grava no histórico (client_message_jobs) para aparecer na listagem
  try {
    const insertPayload: any = {
      tenant_id: tenantId,
      message: message, // Grava o texto do template (variáveis brutas)
      message_template_id: messageTemplateId || null,
      image_url: imageUrl,
      status: allFailed ? "FAILED" : "SENT",
      send_at: new Date().toISOString(),
      sent_at: allFailed ? null : new Date().toISOString(),
      error_message: allFailed ? "Falha ao enviar via API do WhatsApp" : null,
      whatsapp_session: targetSession,
      created_by: authedUserId && authedUserId !== "system" ? authedUserId : null,
    };

    if (recipientType === "reseller") {
      insertPayload.reseller_id = recipientId;
    } else {
      insertPayload.client_id = recipientId;
    }

    await sb.from("client_message_jobs").insert(insertPayload);
  } catch (err) {
    safeServerLog("[WA][send_now] falha ao gravar log em client_message_jobs", err);
    Sentry.captureException(err, { tags: { kind: "data_loss_risk", where: "client_message_jobs_insert" } });
  }

  if (allFailed) {
    return NextResponse.json({ error: "Falha ao enviar" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    recipient_type: recipientType,
    recipient_id: recipientId,
    disparos: results,
  });
}