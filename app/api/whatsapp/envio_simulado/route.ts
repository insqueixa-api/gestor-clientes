// app/api/whatsapp/envio_simulado/route.ts
// "Envio Simulado" — paliativo urgente (pedido do Márcio, 26/07/2026,
// enquanto o envio real via WhatsApp está falhando: sessão sendo deslogada
// pelo WhatsApp). Reaproveita a MESMA resolução de variáveis do envio_agora
// (template, DNS, tabela de preços, pendência, cupom, link de pagamento) —
// mas nunca chama a VM/Baileys e nunca grava client_message_jobs. Só
// devolve o texto já pronto pro admin copiar e colar manualmente no
// WhatsApp Web. Sem sessão nenhuma envolvida de propósito.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function POST(req: Request) {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: authData, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !authData?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const authedUserId = authData.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String(body?.tenant_id || "").trim();
  const message = String(body?.message || "").trim();
  const messageTemplateId = String(body?.message_template_id || "").trim();
  if (!tenantId || !message) {
    return NextResponse.json({ error: "tenant_id e message são obrigatórios" }, { status: 400 });
  }

  // ✅ Sorteia entre o texto do template e as variantes cadastradas (mesma
  // estratégia anti-detecção usada no billing automático, no fulfillment e
  // nos envios manuais) — sem variantes, usa o texto original mesmo.
  let pickedMessage = message;
  if (messageTemplateId) {
    const { data: variants } = await sb
      .from("message_template_variants")
      .select("content")
      .eq("tenant_id", tenantId)
      .eq("template_id", messageTemplateId);
    const pool = [message, ...(variants || []).map((v: any) => v.content)].filter(
      (c): c is string => !!c && String(c).trim().length > 0,
    );
    if (pool.length > 0) {
      pickedMessage = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  const { data: mem, error: memErr } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", authedUserId)
    .maybeSingle();
  if (memErr || !mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rawClientId = String(body?.client_id || "").trim();
  const rawResellerId = String(body?.reseller_id || "").trim();
  const rawRecipientId = String(body?.recipient_id || "").trim();
  const rawRecipientType = String(body?.recipient_type || "").trim();

  let recipientType: "client" | "reseller" | null = null;
  let recipientId = "";
  if (rawRecipientId && (rawRecipientType === "client" || rawRecipientType === "reseller")) {
    recipientType = rawRecipientType;
    recipientId = rawRecipientId;
  } else if (rawResellerId) {
    recipientType = "reseller";
    recipientId = rawResellerId;
  } else if (rawClientId) {
    recipientType = "client";
    recipientId = rawClientId;
  }

  if (!recipientType || !recipientId) {
    return NextResponse.json({ error: "Destino válido (client_id ou reseller_id) é obrigatório" }, { status: 400 });
  }

  const rawResellerServerId = String(body?.reseller_server_id || "").trim();
  const rawCredits = body?.credits_recharged != null ? String(body.credits_recharged) : undefined;

  let wa: any;
  if (recipientType === "reseller") {
    wa = await fetchResellerWhatsApp(sb, tenantId, recipientId, rawResellerServerId, rawCredits);
  } else {
    wa = await fetchClientWhatsApp(sb, tenantId, recipientId);
  }

  if (!wa.phones || wa.phones.length === 0) {
    return NextResponse.json(
      { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} sem whatsapp_username` },
      { status: 400 },
    );
  }

  let manualPaymentVars: Record<string, string> = {};
  try {
    manualPaymentVars = await fetchManualPaymentVars(sb, tenantId);
  } catch {}

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
    } catch {}
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authedUserId);
  const safeUserId = isUuid ? authedUserId : null;

  const previews: { phone: string; label: string; text: string }[] = [];

  for (const contact of wa.phones) {
    const vars =
      recipientType === "reseller"
        ? buildResellerTemplateVars({ resellerRow: wa.row })
        : buildClientTemplateVars({ clientRow: wa.row, isSecondary: contact.is_secondary });

    Object.assign(vars, manualPaymentVars);

    if (recipientType !== "reseller") {
      vars.dns_servidor = dnsServidor;
      vars.tabela_precos = tabelaPrecos;
      vars.pendencia_detalhe = pendenciaDetalhe;
    }

    vars.link_pagamento = await generatePortalLink(sb, {
      tenantId,
      contact: { number: contact.number, username: contact.username, is_secondary: contact.is_secondary },
      createdBy: safeUserId,
      label: contact.is_secondary ? "Envio simulado Secundário" : "Envio simulado",
      expiresAt: null,
      onLog: () => {},
      // ✅ /renew-beta é o destino oficial pra qualquer link gerado via
      // WhatsApp (31/07/2026, pedido do Márcio) — mesmo padrão que o bot já
      // usa (lib/whatsapp/bot-engine.ts, toolGerarLinkPortal).
      dest: "renew-beta",
    });

    if (recipientType !== "reseller") {
      vars.cupom_frase = await getCouponPhraseForClient(sb, tenantId, wa.row);
    }

    previews.push({
      phone: contact.number,
      label: contact.is_secondary ? "Contato secundário" : "Contato principal",
      text: renderTemplate(pickedMessage, vars),
    });
  }

  return NextResponse.json({ ok: true, previews });
}
