// app/api/whatsapp/bot/agent/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Migrado pro motor de árvore (bot_menu_nodes/bot_menu_steps) + RAG de resposta
// direta — mesma arquitetura já validada no chat-admin. O Gemini aqui só é
// usado para: (1) gerar embeddings de busca, e (2) classificar se uma imagem
// é comprovante de pagamento. Nenhuma geração de texto livre acontece mais.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { generatePortalLink, renderTemplate, buildClientTemplateVars } from "@/lib/whatsapp/template-vars";
import {
  type MenuNode,
  HUMAN_REQUESTED_MSG,
  BOT_GAVE_UP_MSG,
  isEscalationTrigger,
  isBackToMenuTrigger,
  isSimpleConfirmation,
  isLinkOnly,
  classifyRecentJob,
  checkRecentPortalPayment,
  paymentAutoConfirmedMsg,
  PAYMENT_MANUAL_PENDING_MSG,
  PAYMENT_FULFILLMENT_ERROR_MSG,
  detectMenuContextFromTree,
  getAllRootsAsMenuText,
  getRootNodes,
  findRootByNumber,
  extractSingleDigitSelection,
  hasSemanticSignal,
  getNodeById,
  getChildren,
  getSteps,
  renderChildrenMenu,
  findChildByNumber,
  findChildByKeyword,
  matchAccountFromText,
  nodeNeedsAccount,
  RESOLUTION_QUESTION,
  isResolutionResolved,
  isResolutionNotResolved,
  isConfirmSwitchYes,
  resolveClientProvider,
  pickCompatibleSemanticMatch,
  type ServerProvider,
} from "@/lib/whatsapp/bot-menu";
import { callGemini, generateEmbedding, searchBotKnowledgeCandidates, pickCompatibleKnowledgeMatch, searchMenuIntentCandidates, classifyIsAcknowledgment } from "@/lib/whatsapp/gemini-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Helpers internos ──────────────────────────────────────────────────────────

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.log(...args);
}

function isInternalAuth(req: Request): boolean {
  const secret = String(process.env.UNIGESTOR_BOT_INTERNAL_SECRET || "").trim();
  const provided = String(req.headers.get("x-internal-secret") || "").trim();
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Envio de resposta via WA service (real, produção) ────────────────────────

async function sendWAMessage(sessionKey: string, phone: string, message: string) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (!baseUrl || !waToken) {
    safeLog("[BOT][agent] WA env vars ausentes");
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${baseUrl}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${waToken}`,
        "x-session-key": sessionKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, message }),
      signal: controller.signal,
    });
    if (!res.ok) {
      safeLog("[BOT][agent] Erro ao enviar WA:", res.status, await res.text().catch(() => ""));
    }
  } catch (e: any) {
    safeLog("[BOT][agent] Timeout/erro ao enviar WA:", e?.message);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Ferramentas (chamadas diretas, disparadas pelas special_actions da árvore) ─

async function toolGerarLinkPortal(sb: any, tenantId: string, rawClient: any, isSecondary: boolean): Promise<string> {
  const phone = isSecondary ? rawClient.secondary_whatsapp_username : rawClient.whatsapp_username;
  if (!phone) return "(link não disponível — cliente sem WhatsApp)";
  return generatePortalLink(sb, {
    tenantId,
    contact: { number: phone, username: phone, is_secondary: isSecondary },
    createdBy: null,
    label: "Bot de atendimento",
    expiresAt: null,
    onLog: safeLog,
  });
}

// Mantém a lógica completa original (checagem Elite excluindo ANNUAL) —
// mais completa que a versão simplificada usada no chat-admin.
async function toolConsultarPrecosTexto(sb: any, tenantId: string, client: any): Promise<string> {
  const PERIOD_LABELS: Record<string, string> = {
    MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral",
    SEMIANNUAL: "Semestral", ANNUAL: "Anual",
  };
  const ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

  let planTableId = client.plan_table_id;
  if (!planTableId) {
    const { data: def } = await sb
      .from("plan_tables").select("id")
      .eq("tenant_id", tenantId).eq("is_system_default", true)
      .eq("currency", client.price_currency || "BRL").eq("is_active", true)
      .maybeSingle();
    if (def) planTableId = def.id;
  }
  if (!planTableId) return "(tabela de preços não encontrada)";

  let isElite = false;
  if (client.server_id) {
    const { data: srv } = await sb.from("servers").select("panel_integration").eq("id", client.server_id).single();
    if (srv?.panel_integration) {
      const { data: integ } = await sb.from("server_integrations").select("provider").eq("id", srv.panel_integration).single();
      if (integ?.provider?.toUpperCase() === "ELITE") isElite = true;
    }
  }

  const { data: items } = await sb
    .from("plan_table_items")
    .select("period, plan_table_item_prices(screens_count, price_amount)")
    .eq("plan_table_id", planTableId);

  const screens = Number(client.screens || 1);

  const linhas = (items || [])
    .filter((item: any) => !isElite || item.period !== "ANNUAL")
    .map((item: any) => {
      let valor = 0;
      if (client.price_amount > 0 && PERIOD_LABELS[item.period] === client.plan_label) {
        valor = client.price_amount;
      } else {
        const exact = item.plan_table_item_prices?.find((p: any) => p.screens_count === screens);
        if (exact) valor = exact.price_amount;
      }
      return { periodo: PERIOD_LABELS[item.period] || item.period, valor, order: ORDER.indexOf(item.period) };
    })
    .filter((p: any) => p.valor > 0)
    .sort((a: any, b: any) => a.order - b.order)
    .map((p: any) => `- ${p.periodo}: ${client.price_currency || "BRL"} ${Number(p.valor).toFixed(2)}`);

  return linhas.length ? linhas.join("\n") : "(nenhum preço configurado)";
}

async function toolVerificarCloudflare(): Promise<{ operacional: boolean }> {
  try {
    const res = await fetch("https://www.cloudflarestatus.com/api/v2/status.json", { signal: AbortSignal.timeout(5_000) });
    const data = await res.json();
    return { operacional: data?.status?.indicator === "none" };
  } catch {
    return { operacional: true };
  }
}

async function toolRecomendarAppsTexto(sb: any, tenantId: string, serverId: string | null): Promise<string> {
  const { data: apps } = await sb
    .from("apps").select("name, cost_type, partner_server_id, license_price, license_period")
    .eq("tenant_id", tenantId).eq("is_hidden", false);
  if (!apps) return "(nenhum app configurado)";

  const parceiros = (apps as any[]).filter(a => a.cost_type === "partnership" && a.partner_server_id === serverId).map(a => a.name);
  const gratis = (apps as any[]).filter(a => a.cost_type === "free" && !a.partner_server_id).map(a => a.name);
  const pagos = (apps as any[]).filter(a => a.cost_type === "paid" && !a.partner_server_id).map(a => {
    const preco = a.license_price ? `R$ ${Number(a.license_price).toFixed(2).replace(".", ",")}` : "";
    const periodo = a.license_period === "annual" ? "/ano" : a.license_period === "lifetime" ? " (vitalício)" : "";
    return `${a.name}${preco ? ` (${preco}${periodo})` : ""}`;
  });

  const linhas = [
    parceiros.length ? `Parceiros do seu servidor: ${parceiros.join(", ")}` : null,
    gratis.length ? `Gratuitos: ${gratis.join(", ")}` : null,
    pagos.length ? `Pagos: ${pagos.join(", ")}` : null,
  ].filter(Boolean);
  return linhas.join("\n") || "(nenhuma recomendação disponível)";
}

// ── Variáveis de template pra um nó específico ───────────────────────────────

async function buildVarsForNode(sb: any, tenantId: string, node: MenuNode, client: any, rawClient: any): Promise<Record<string, any>> {
  const vars = buildClientTemplateVars({ clientRow: rawClient, isSecondary: client.is_secondary }) as Record<string, any>;
  // ✅ Correção: buildClientTemplateVars espera nomes de coluna diferentes
  // dos que a tabela `clients` realmente usa (row.username, row.plan_name,
  // row.server_name) — sem isso, essas 3 variáveis ficavam vazias em
  // silêncio, sem erro nenhum. Sobrescreve com os valores certos.
  vars.usuario_app = client.server_username || "";
  vars.plano_nome = client.plan_label || "";
  vars.servidor_nome = client.server_name || "";
  const actions = node.special_actions || [];
  if (actions.includes("gerar_link_portal")) {
    vars.link_pagamento = await toolGerarLinkPortal(sb, tenantId, rawClient, client.is_secondary);
  }
  if (actions.includes("consultar_precos")) {
    vars.tabela_precos = await toolConsultarPrecosTexto(sb, tenantId, client);
  }
  if (actions.includes("recomendar_app")) {
    vars.apps_recomendados = await toolRecomendarAppsTexto(sb, tenantId, client.server_id || null);
  }
  return vars;
}

// ── Gate checks — rodam antes de mostrar os filhos de um nó ─────────────────

async function runGateChecks(node: MenuNode, client: any, sb: any, tenantId: string): Promise<{ messages: string[]; markRead?: boolean } | null> {
  const actions = node.special_actions || [];

  if (actions.includes("check_servidor_vencimento") && client?.server_is_offline) {
    return { messages: ["Identificamos uma instabilidade interna no servidor que já está sendo verificada pela nossa equipe. Em breve tudo estará normalizado! Por enquanto, tente acessar de tempos em tempos — quando voltar, funciona normalmente, sem precisar fazer nada. 🙏"], markRead: true };
  }

  if (actions.includes("check_renovacao_recente")) {
    const status = await checkRecentPortalPayment(sb, tenantId, [client?.id].filter(Boolean));
    if (status === "auto_confirmed") return { messages: [paymentAutoConfirmedMsg(client.display_name?.split(" ")[0] || "")], markRead: true };
    if (status === "manual_pending") return { messages: [PAYMENT_MANUAL_PENDING_MSG], markRead: true };
    if (status === "fulfillment_error") return { messages: [PAYMENT_FULFILLMENT_ERROR_MSG], markRead: false };
  }

  return null;
}

// ── Execução de um nó folha ──────────────────────────────────────────────────

async function executeLeaf(node: MenuNode, client: any, rawClient: any, sb: any, tenantId: string): Promise<{ messages: string[]; escalate?: boolean; markRead?: boolean; nextState: string; transferReason?: string | null }> {
  const actions = node.special_actions || [];

  if (actions.includes("escalar_imediatamente") || actions.includes("coletar_relato_e_escalar")) {
    const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
    const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
    // ✅ Repassa transfer_situation_label pro Márcio ver o motivo real da
    // transferência — antes esse campo só ia pro safeLog (silenciado em
    // produção) e nunca chegava a lugar nenhum.
    return { messages: steps.length ? steps : [HUMAN_REQUESTED_MSG], escalate: true, markRead: false, nextState: "__clear__", transferReason: node.transfer_situation_label || null };
  }

  if (actions.includes("redirecionar_instalacao")) {
    const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
    const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
    return { messages: steps, escalate: false, nextState: "__redirect_instalacao__" };
  }

  if (actions.includes("verificar_cloudflare")) {
    const cf = await toolVerificarCloudflare();
    const msg = cf.operacional
      ? "Verifiquei aqui e não identificamos instabilidade externa no momento. Vamos tentar: desligue o modem da tomada por 5 minutos e reabra o aplicativo. Se persistir, me avisa!"
      : "Identificamos que a instabilidade vem de um serviço externo chamado Cloudflare, que faz a ponte entre você e nosso servidor. O time deles já está atuando para corrigir. A normalização deve ocorrer em breve. Obrigado pela paciência! 💙";
    return { messages: [msg], nextState: node.closing_message ? `awaiting_resolution:${node.id}` : "geral" };
  }

  if (actions.includes("check_servidor_vencimento")) {
    const vencido = client?.vencimento ? new Date(client.vencimento).getTime() < Date.now() : false;
    let msg: string;
    if (vencido) {
      const link = await toolGerarLinkPortal(sb, tenantId, rawClient, client.is_secondary);
      msg = `Vi aqui que seu acesso está vencido — por isso o sinal parou. 😊\n\nPara renovar:\n👉 ${link}\nSenha: últimos 4 dígitos do seu WhatsApp`;
    } else {
      msg = "Seu acesso está em dia! Vamos tentar o reset padrão: desligue o modem da tomada por 5 minutos, depois a TV, e teste de novo. Se persistir, me avisa!";
    }
    return { messages: [msg], nextState: node.closing_message ? `awaiting_resolution:${node.id}` : "geral" };
  }

  if (actions.includes("free_text_rag")) {
    const steps = await getSteps(sb, node.id);
    return { messages: steps.length ? steps : ["Pode me contar com detalhes o que está acontecendo? 😊"], nextState: "geral" };
  }

  const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
  const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
  return {
    messages: steps.length ? steps : ["(nenhuma resposta cadastrada — avise o Márcio)"],
    nextState: node.closing_message ? `awaiting_resolution:${node.id}` : "geral",
  };
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!isInternalAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    safeLog("[BOT][agent] GEMINI_API_KEY não configurada");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { tenant_id, session_key, phone, remoteJid, text, media_base64, media_type, mime_type, awaiting_payment_type, payment_clarification_attempts, bot_state } = body;

  const jidToCheck = remoteJid || phone || "";
  if (jidToCheck.includes("@g.us")) {
    safeLog(`[BOT][agent] Mensagem de grupo ignorada: ${jidToCheck}`);
    return NextResponse.json({ ok: true, action: "ignored_group" });
  }

  if (!tenant_id || !session_key || !phone) {
    return NextResponse.json({ error: "Parâmetros obrigatórios ausentes" }, { status: 400 });
  }

  // ── 1. Identificar cliente ──────────────────────────────────────────────
  const { data: clientMatches, error: clientErr } = await sb
    .from("clients")
    .select(`
      id, display_name, secondary_display_name,
      whatsapp_username, secondary_whatsapp_username,
      server_username, server_password,
      vencimento, screens, plan_label, plan_table_id,
      price_amount, price_currency, technology,
      server_id, is_trial, is_archived,
      servers (name, dns, is_offline, offline_since, offline_reason)
    `)
    .eq("tenant_id", tenant_id)
    .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

  if (clientErr || !clientMatches?.length) {
    safeLog("[BOT][agent] Número não identificado como cliente:", phone);
    return NextResponse.json({ ok: true, action: "silence" });
  }

  const clients = clientMatches.map((raw) => {
    const isSec = raw.secondary_whatsapp_username === phone;
    const dnsArray: string[] = (raw.servers as any)?.dns || [];
    const srv = raw.servers as any;
    return {
      ...raw,
      display_name: isSec ? (raw.secondary_display_name || raw.display_name || "Cliente") : (raw.display_name || "Cliente"),
      server_name: srv?.name || "Servidor",
      server_dns: dnsArray,
      server_is_offline: srv?.is_offline ?? false,
      server_offline_since: srv?.offline_since ?? null,
      server_offline_reason: srv?.offline_reason ?? null,
      is_secondary: isSec,
    };
  });

  const firstName = clients[0].display_name.split(" ")[0];

  // ✅ Provider do servidor do cliente (NATV/FAST/ELITE) — usado pra filtrar
  // conteúdo restrito a um servidor específico, tanto na árvore quanto no
  // RAG da base de conhecimento (ex: "Dados de acesso FastTV" só deve
  // aparecer pra clientes de servidor Fast). Baseado na 1ª conta do
  // cliente — clientes com múltiplas contas em servidores diferentes usam a
  // conta principal como referência (mesma simplificação já usada em
  // `firstName`/`clients[0]` pelo resto do arquivo).
  const clientProvider: ServerProvider | null = await resolveClientProvider(sb, clients[0]?.server_id || null);

  // ── 2. Mídia — lógica determinística (inalterada) ────────────────────────
  if (media_base64 && media_type) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: recentPayments } = await sb
      .from("client_portal_payments")
      .select("id, fulfillment_status, whatsapp_status")
      .eq("tenant_id", tenant_id)
      .in("client_id", clients.map((c: any) => c.id))
      .gte("created_at", sixHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1);

    const recentPayment = recentPayments?.[0];

    if (recentPayment?.whatsapp_status === "sent") {
      const msg = `Oi ${firstName}! 😊 Recebi seu comprovante, mas sua renovação já foi processada automaticamente pelo portal — tudo certo com seu acesso!\n\nPara os próximos pagamentos pelo portal, não precisa enviar comprovante. Tudo acontece de forma automática. ✅`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "auto_confirmed", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if (recentPayment?.fulfillment_status === "manual_pending") {
      const msg = `Oi ${firstName}! Recebi seu comprovante. ✅\n\nSua renovação está em análise e será concluída em breve. Qualquer dúvida é só chamar!`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "manual_pending", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if (recentPayment?.fulfillment_status === "error") {
      const msg = `Oi ${firstName}! Recebi seu comprovante. ✅\n\nSeu pagamento foi confirmado! Só tivemos uma instabilidade técnica na finalização automática, mas o Márcio já foi notificado e vai concluir sua renovação em instantes.`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "fulfillment_error", mark_read: false, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if (!recentPayment) {
      let analysisPayload: any = {
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mime_type || (media_type === "image" ? "image/jpeg" : "application/pdf"), data: media_base64 } },
            { text: `Analise esta imagem/documento. É um comprovante de pagamento financeiro (transferência PIX, TED, DOC, recibo bancário ou similar)?\n\nResponda SOMENTE com este JSON:\n{"is_receipt":true}\nou\n{"is_receipt":false}\n\nResponda APENAS o JSON, sem markdown, sem explicação.` },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 64 },
      };

      let parsed: any = null;
      try {
        const analysisResult = await callGemini(geminiKey, analysisPayload, 20_000);
        const rawText = analysisResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      } catch (e: any) {
        safeLog("[BOT][agent] Erro ao analisar imagem:", e?.message);
        return NextResponse.json({ ok: true, action: "silence", mark_read: true });
      }

      if (!parsed?.is_receipt) {
        return NextResponse.json({ ok: true, action: "silence", mark_read: true });
      }

      const msg = `Vi que você informou que está pago! Só confirma uma coisa: foi feito direto pelo portal ou via PIX/transferência manual?`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({
        ok: true, action: "awaiting_payment_type", mark_read: true, bot_response: msg,
        display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
      });
    }

    return NextResponse.json({ ok: true, action: "silence" });
  }

  // ── 3. Mensagem de texto ─────────────────────────────────────────────────
  if (!text?.trim()) {
    return NextResponse.json({ ok: true, action: "silence" });
  }
  const trimmed = text.trim();

  // ── Escalonamento explícito — prioridade máxima ─────────────────────────
  if (isEscalationTrigger(trimmed)) {
    safeLog("[BOT][agent] Escalonamento explícito detectado:", trimmed);
    await sendWAMessage(session_key, phone, HUMAN_REQUESTED_MSG);
    return NextResponse.json({
      ok: true, action: "escalated", escalate: true, mark_read: false, next_state: "__clear__",
      bot_response: HUMAN_REQUESTED_MSG,
      display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
    });
  }

  // ── Voltar ao menu principal — atalho reservado, mesma prioridade máxima
  // do escalonamento. Funciona em qualquer estado (dentro de submenu,
  // aguardando conta, aguardando resolução, ou até na conversa livre).
  if (isBackToMenuTrigger(trimmed)) {
    safeLog("[BOT][agent] Voltar ao menu principal detectado:", trimmed);
    const menuMsg = await getAllRootsAsMenuText(sb, tenant_id, clientProvider);
    const msg = `Voltando ao menu principal! 😊\n\n${menuMsg}`;
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({
      ok: true, action: "back_to_menu", mark_read: true, next_state: "aguardando_resposta",
      bot_response: msg,
      display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
    });
  }

  // ── "Portal ou PIX?" — checado antes do roteamento de menu ──────────────
  if (awaiting_payment_type === true) {
    const mentionsPix = /\b(pix|transfer[eê]ncia|manual|ted|doc|dep[oó]sito)\b/i.test(trimmed);
    const mentionsPortal = /\b(portal|link|site)\b/i.test(trimmed);

    if (mentionsPix && !mentionsPortal) {
      const msg1 = `Entendido! O Márcio vai cuidar da sua renovação assim que possível 😊`;
      await sendWAMessage(session_key, phone, msg1);
      const msg2 = `Já fica a dica: se renovar direto pelo portal usando o link que te mandei, o processo é automático — você nem precisa enviar comprovante nem esperar a confirmação manual. #FicaADica`;
      await sendWAMessage(session_key, phone, msg2);
      return NextResponse.json({
        ok: true, action: "payment_pix_confirmed", mark_read: false, bot_response: `${msg1}\n\n${msg2}`,
        display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
      });
    }

    if (mentionsPortal && !mentionsPix) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recheck } = await sb
        .from("client_portal_payments")
        .select("id, fulfillment_status, whatsapp_status")
        .eq("tenant_id", tenant_id).in("client_id", clients.map((c: any) => c.id))
        .gte("created_at", sixHoursAgo).order("created_at", { ascending: false }).limit(1);

      const found = recheck?.[0];
      if (found?.whatsapp_status === "sent") {
        const msg = `Ah, encontrei aqui! 😊 Sua renovação pelo portal já foi processada automaticamente — tudo certo com seu acesso!`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "payment_portal_confirmed", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }

      const msg = `Hmm, ainda não encontrei o registro por aqui — deixa comigo, já vou verificar direto com o Márcio pra confirmar. 🙏`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "payment_portal_not_found", mark_read: false, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if ((payment_clarification_attempts || 0) >= 2) {
      await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
      return NextResponse.json({ ok: true, action: "payment_type_gave_up", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    const msg = `Desculpa, não entendi — foi pelo portal (aquele link que te mandei) ou via PIX/transferência manual?`;
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({ ok: true, action: "awaiting_payment_type", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ── Helpers de conta ──────────────────────────────────────────────────────
  function resolveAccount(t: string): { client: any; rawClient: any } | null {
    if (clients.length <= 1) return { client: clients[0], rawClient: clientMatches[0] };
    const idx = matchAccountFromText(clients, t);
    if (idx === null) return null;
    return { client: clients[idx], rawClient: clientMatches[idx] };
  }
  function askAccountMessage(): string {
    const lista = clients.map((c: any, i: number) => `- Conta ${i + 1}: ${c.display_name} (${c.server_username || "n/i"}) — ${c.server_name}`).join("\n");
    return `Você tem mais de uma conta — qual delas se refere? Pode responder com "conta 1", "conta 2" ou o nome do servidor:\n\n${lista}`;
  }

  async function enterNode(node: MenuNode, resolved: { client: any; rawClient: any } | null, attempt: 1 | 2): Promise<any> {
    if (nodeNeedsAccount(node) && !resolved) {
      resolved = resolveAccount(trimmed);
      if (!resolved) {
        if (attempt === 2) {
          await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
          return NextResponse.json({ ok: true, action: "conta_desistiu", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", transfer_reason: node.transfer_situation_label || null, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
        }
const msg = askAccountMessage();
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "pede_conta", mark_read: true, bot_response: msg, next_state: `conta:${node.id}`, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
    }
    const client = resolved?.client || clients[0];
    const rawClient = resolved?.rawClient || clientMatches[0];

    const children = await getChildren(sb, node.id, clientProvider);

    if (children.length > 0) {
      const gate = await runGateChecks(node, client, sb, tenant_id);
      if (gate) {
        for (const m of gate.messages) await sendWAMessage(session_key, phone, m);
        return NextResponse.json({ ok: true, action: "gate_resolved", mark_read: gate.markRead ?? true, bot_response: gate.messages.join("\n\n"), next_state: "geral", display_name: client?.display_name || null, server_name: client?.server_name || null });
      }
      // ✅ Se a MESMA mensagem que trouxe até aqui já é específica o
      // suficiente pra bater com um filho direto (ex: "tela preta" bate na
      // raiz "Problema técnico" E no filho "Tela preta com som"), pula a
      // etapa de mostrar o submenu e entra direto nele — sem pular os gate
      // checks da raiz, que já rodaram normalmente acima.
      const directChild = findChildByKeyword(children, trimmed);
      if (directChild) return enterNode(directChild, null, 1);

      const vars = await buildVarsForNode(sb, tenant_id, node, client, rawClient);
      const preMsgs = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
      for (const m of preMsgs) await sendWAMessage(session_key, phone, m);
      const menuMsg = renderChildrenMenu(children, undefined, true);
      await sendWAMessage(session_key, phone, menuMsg);
      return NextResponse.json({ ok: true, action: "menu_shown", mark_read: true, bot_response: [...preMsgs, menuMsg].join("\n\n"), next_state: `menunode:${node.id}`, display_name: client?.display_name || null, server_name: client?.server_name || null });
    }

    const result = await executeLeaf(node, client, rawClient, sb, tenant_id);

    if (result.nextState === "__redirect_instalacao__") {
      for (const m of result.messages) await sendWAMessage(session_key, phone, m);
      const { data: instalacaoRoot } = await sb.from("bot_menu_nodes").select("*").eq("tenant_id", tenant_id).eq("slug", "instalacao").maybeSingle();
      if (instalacaoRoot) return enterNode(instalacaoRoot as MenuNode, null, 1);
      await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
      return NextResponse.json({ ok: true, action: "instalacao_nao_encontrada", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", display_name: client?.display_name || null, server_name: client?.server_name || null });
    }

    for (const m of result.messages) await sendWAMessage(session_key, phone, m);
    return NextResponse.json({
      ok: true, action: "leaf_executed", escalate: result.escalate, mark_read: result.markRead ?? true,
      bot_response: result.messages.join("\n\n"), next_state: result.nextState,
      transfer_reason: result.transferReason || null,
      display_name: client?.display_name || null, server_name: client?.server_name || null,
    });
  }

  // ✅ Pergunta antes de trocar de assunto no meio de um submenu, em vez de
  // já trocar direto — o bot pode estar interpretando errado (por palavra-
  // chave ou por significado). Só troca se o cliente confirmar de propósito;
  // qualquer coisa diferente disso mantém ele onde estava.
  function askConfirmSwitch(targetNode: MenuNode, originNode: MenuNode) {
    const msg = `Antes de mudar de assunto: você quer saber sobre *${targetNode.label}* agora? Responda **sim** pra mudar, ou continue me contando sobre o que estávamos vendo. 😊`;
    return sendWAMessage(session_key, phone, msg).then(() =>
      NextResponse.json({
        ok: true, action: "confirm_switch_asked", mark_read: true, bot_response: msg,
        next_state: `confirm_switch:${targetNode.id}:${originNode.id}`,
        display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null,
      })
    );
  }

  // ── Estado: confirmação antes de trocar de assunto ───────────────────────
  const confirmSwitchMatch = /^confirm_switch:([a-f0-9-]+):([a-f0-9-]+)$/.exec(bot_state || "");
  if (confirmSwitchMatch) {
    const [, targetId, originId] = confirmSwitchMatch;
    if (isConfirmSwitchYes(trimmed)) {
      const target = await getNodeById(sb, targetId);
      if (target) return enterNode(target, null, 1);
    }
    // Não confirmou (respondeu "não" ou qualquer coisa pouco clara) — por
    // segurança, volta pro submenu de onde saiu em vez de arriscar mudar de
    // assunto sem certeza.
    const origin = await getNodeById(sb, originId);
    if (!origin) return NextResponse.json({ ok: true, action: "erro_no_estado", mark_read: true, next_state: "__clear__" });
    const originChildren = await getChildren(sb, origin.id, clientProvider);
    const msg = renderChildrenMenu(originChildren, "Combinado, seguimos por aqui! Escolha uma das opções:", true);
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({ ok: true, action: "confirm_switch_declined", mark_read: true, bot_response: msg, next_state: `menunode:${origin.id}`, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ── Estado: aguardando resolução de conta ────────────────────────────────
  // ✅ Corrigido: se chegamos aqui com bot_state = "conta:<id>", significa
  // que JÁ perguntamos uma vez — esta resposta do cliente é a última
  // chance antes de escalonar. Sem essa correção, o cálculo de attempt
  // nunca avançava, e o bot podia perguntar "qual conta?" pra sempre.
  const contaMatch = /^conta:([a-f0-9-]+)$/.exec(bot_state || "");
  if (contaMatch) {
    const node = await getNodeById(sb, contaMatch[1]);
    if (!node) return NextResponse.json({ ok: true, action: "erro_no_estado", mark_read: true, next_state: "__clear__" });
    return enterNode(node, null, 2);
  }

  // ── Estado: aguardando "resolveu ou não" ─────────────────────────────────
  const resolutionMatch = /^awaiting_resolution:([a-f0-9-]+)$/.exec(bot_state || "");
  if (resolutionMatch) {
    const node = await getNodeById(sb, resolutionMatch[1]);
    if (isResolutionResolved(trimmed)) {
      const msg = node?.closing_message || "Que bom! Fico feliz que resolveu 😊";
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "resolvido", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }
    if (isResolutionNotResolved(trimmed)) {
      safeLog("[BOT][agent] Transferência:", node?.transfer_situation_label);
      await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
      // ✅ transfer_situation_label agora viaja até o evento do Monitor
      // (sessionManager.js) em vez de morrer só no safeLog.
      return NextResponse.json({ ok: true, action: "nao_resolvido_escalado", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", transfer_reason: node?.transfer_situation_label || null, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }
    await sendWAMessage(session_key, phone, RESOLUTION_QUESTION);
    return NextResponse.json({ ok: true, action: "resolution_retry", mark_read: true, bot_response: RESOLUTION_QUESTION, next_state: bot_state, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ── Estado: dentro de um nó com filhos (escolhendo opção) ────────────────
  // ✅ Redesenhado: na 1ª resposta que não bate número nem palavra-chave do
  // submenu atual, o bot NÃO tenta mais interpretar/trocar de assunto — só
  // pede pra escolher uma das opções. Antes, qualquer texto livre já
  // disparava a detecção de troca de contexto (keyword de outro assunto ou
  // significado), o que dava margem pra interpretação errada logo de cara
  // (ex: "acho que venceu o aplicativo" batendo com a keyword "venceu" de
  // Renovação/pagamento). Só na 2ª tentativa seguida sem bater nada é que o
  // bot tenta detectar troca de assunto — e se isso também falhar, escalona
  // (mesmo padrão de paciência de 2 tentativas usado no resto do bot).
  const menuNodeMatch = /^menunode:([a-f0-9-]+)$/.exec(bot_state || "");
  const menuNodeRetryMatch = /^menunode_retry:([a-f0-9-]+)$/.exec(bot_state || "");
  if (menuNodeMatch || menuNodeRetryMatch) {
    const nodeId = (menuNodeMatch || menuNodeRetryMatch)![1];
    const isSecondMiss = !!menuNodeRetryMatch;
    const currentNode = await getNodeById(sb, nodeId);
    if (!currentNode) return NextResponse.json({ ok: true, action: "erro_no_estado", mark_read: true, next_state: "__clear__" });

    const children = await getChildren(sb, currentNode.id, clientProvider);
    const numeric = extractSingleDigitSelection(trimmed);
    const chosen = (numeric ? findChildByNumber(children, numeric) : null) || findChildByKeyword(children, trimmed);

    if (chosen) return enterNode(chosen, null, 1);

    if (!isSecondMiss) {
      const msg = renderChildrenMenu(children, "Não entendi — pode escolher uma das opções abaixo, por favor? 😊", true);
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "menu_retry", mark_read: true, bot_response: msg, next_state: `menunode_retry:${currentNode.id}`, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    // ✅ 2ª tentativa seguida sem bater número/keyword — agora sim tenta
    // detectar troca de assunto de verdade (palavra-chave de outro nó raiz,
    // ou por significado), antes de desistir e escalonar.
    const switched = await detectMenuContextFromTree(sb, tenant_id, trimmed, clientProvider);
    if (switched && switched.id !== currentNode.id && switched.parent_id === null) {
      return askConfirmSwitch(switched, currentNode);
    }

    if (hasSemanticSignal(trimmed)) {
      try {
        const embedding = await generateEmbedding(geminiKey, trimmed);
        const candidates = embedding ? await searchMenuIntentCandidates(sb, tenant_id, embedding) : [];
        const node = await pickCompatibleSemanticMatch(sb, candidates, clientProvider);
        if (node && node.id !== currentNode.id) {
          return askConfirmSwitch(node, currentNode);
        }
      } catch (e: any) {
        safeLog("[BOT][agent] Erro na detecção semântica (troca de contexto):", e?.message);
      }
    }

    await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
    return NextResponse.json({ ok: true, action: "menu_retry_escalado", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", transfer_reason: currentNode.transfer_situation_label || null, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ── Item 5: reação a mensagem automática recente ─────────────────────────
  // ✅ Redesenhado: em vez de regex tentando adivinhar "isso é só
  // cordialidade?" (que falhava em mensagens reais com o nome da pessoa —
  // ex: "Boa tarde Márcio, ótimo sábado!"), uma chamada mínima ao Gemini
  // decide true/false com o contexto certo. Zero geração de texto livre.
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentJob } = await sb
      .from("client_message_jobs")
      .select(`sent_at, automation_id, message_template_id, billing_automations ( name, type )`)
      .eq("tenant_id", tenant_id).in("client_id", clients.map((c: any) => c.id))
      .eq("status", "SENT").gte("sent_at", twentyFourHoursAgo)
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();

    let templateInfo: any = null;
    if (recentJob?.message_template_id) {
      const { data: tpl } = await sb.from("message_templates").select("name, category").eq("id", recentJob.message_template_id).maybeSingle();
      templateInfo = tpl || null;
    }
    const jobKind = classifyRecentJob(recentJob, templateInfo);
    safeLog("[BOT][agent] Item5 — job recente classificado como:", jobKind);

    const JOB_CONTEXT: Record<string, string> = {
      payment_confirmation: "Confirmação automática de que o pagamento/renovação foi processado com sucesso.",
      vencimento: "Lembrete automático de que o acesso está vencendo em breve.",
      pos_venda_satisfacao: "Pesquisa de satisfação perguntando como está sendo a experiência do cliente.",
      pos_venda_fidelidade: "Mensagem automática de acompanhamento de fidelidade do cliente.",
      pos_venda_generico: "Mensagem automática de acompanhamento pós-venda.",
    };

    if (jobKind !== "none" && JOB_CONTEXT[jobKind]) {
      const isAck = await classifyIsAcknowledgment(geminiKey, JOB_CONTEXT[jobKind], trimmed);

      if (isAck) {
        const ACK_MESSAGES: Record<string, string> = {
          payment_confirmation: `Que bom, ${firstName}! 😊 Fico feliz que deu tudo certo com sua renovação. Qualquer coisa é só chamar!`,
          vencimento: `Sem pressa! Pode ficar tranquilo — quando for renovar, é só acessar o portal que está tudo pronto. Se precisar de ajuda, é só chamar! 😊`,
          pos_venda_satisfacao: `Muito obrigado pelo retorno, ${firstName}! 🙏 Fico feliz que esteja gostando. Qualquer coisa, é só chamar!`,
          pos_venda_fidelidade: `Que bom, ${firstName}! 😊 Fico feliz em saber. Qualquer coisa, é só chamar!`,
          pos_venda_generico: `Que bom, ${firstName}! 😊 Fico feliz em saber. Qualquer coisa, é só chamar!`,
        };
        const ACK_ACTIONS: Record<string, string> = {
          payment_confirmation: "payment_ack",
          vencimento: "vencimento_ack",
          pos_venda_satisfacao: "satisfaction_ack",
          pos_venda_fidelidade: "pos_venda_ack",
          pos_venda_generico: "pos_venda_ack",
        };
        const msg = ACK_MESSAGES[jobKind];
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: ACK_ACTIONS[jobKind], mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
    }
  } catch (e: any) {
    safeLog("[BOT][agent] Erro Item5:", e?.message);
  }

  // ── Confirmação simples / link puro ─────────────────────────────────────
  if (isSimpleConfirmation(trimmed)) {
    safeLog("[BOT][agent] Confirmação simples ignorada:", trimmed);
    return NextResponse.json({ ok: true, action: "silence_confirmation", mark_read: true });
  }
  if (isLinkOnly(trimmed)) {
    safeLog("[BOT][agent] Link puro ignorado:", trimmed.slice(0, 80));
    return NextResponse.json({ ok: true, action: "silence", mark_read: true });
  }

  // ── Estado "geral" / "geral_retry" — resposta direta do RAG ──────────────
  // ✅ Agora com 1 chance de reformular antes de escalonar, no mesmo padrão
  // de paciência usado no resto da árvore — antes, qualquer falta de match
  // no RAG (ou falha passageira do Gemini) escalonava na 1ª tentativa.
  if (bot_state === "geral" || bot_state === "geral_retry") {
    const isRetry = bot_state === "geral_retry";
    try {
      const embedding = await generateEmbedding(geminiKey, trimmed);
      const candidates = embedding ? await searchBotKnowledgeCandidates(sb, tenant_id, embedding) : [];
      const top = await pickCompatibleKnowledgeMatch(sb, candidates, clientProvider);
      if (top) {
        const vars = buildClientTemplateVars({ clientRow: clientMatches[0], isSecondary: clients[0]?.is_secondary }) as any;
        // ✅ Mesma correção do buildVarsForNode — sem isso, {usuario_app},
        // {plano_nome} e {servidor_nome} ficariam vazios em qualquer
        // resposta vinda do RAG direto (estado "geral").
        vars.usuario_app = clients[0]?.server_username || "";
        vars.plano_nome = clients[0]?.plan_label || "";
        vars.servidor_nome = clients[0]?.server_name || "";
        const msg = renderTemplate(top.content, vars);
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "rag_direct", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
    } catch (e: any) {
      safeLog("[BOT][agent] Erro RAG:", e?.message);
    }

    if (!isRetry) {
      const msg = "Não encontrei uma resposta certeira pra isso 🤔 Pode tentar explicar de outro jeito ou com mais detalhes?";
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "rag_sem_match_retry", mark_read: true, bot_response: msg, next_state: "geral_retry", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
    return NextResponse.json({ ok: true, action: "rag_sem_match", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ── Primeira mensagem / paciência de 2 tentativas ────────────────────────
  // ✅ Seleção por número no menu raiz — antes só funcionava dentro de
  // submenus. Checada primeiro por ser a via mais barata e sem ambiguidade
  // nenhuma: nem precisa de palavra-chave, nem de Gemini.
  if (extractSingleDigitSelection(trimmed) !== null) {
    const roots = await getRootNodes(sb, tenant_id, clientProvider);
    const chosenRoot = findRootByNumber(roots, trimmed);
    if (chosenRoot) return enterNode(chosenRoot, null, 1);
  }

  const detected = await detectMenuContextFromTree(sb, tenant_id, trimmed, clientProvider);
  if (detected) return enterNode(detected, null, 1);

  // ✅ Fallback semântico: nenhuma palavra-chave bateu — antes de desistir/
  // mostrar o menu genérico, tenta por SIGNIFICADO (embedding) contra os
  // nós raiz. Cobre frases naturais como "estou com problemas na minha tv,
  // pode me ajudar?", que não contém nenhuma palavra-chave exata cadastrada
  // mas claramente significa "Problema técnico".
  // ⚠️ Piso de tamanho: saudações/small talk ("Olá, tudo bem?") são curtas
  // e não carregam sinal semântico suficiente pra comparar com nada — nem
  // tenta nesse caso, evita gastar Gemini à toa e falso positivo.
  const hasEnoughSignal = hasSemanticSignal(trimmed);
  try {
    const embedding = hasEnoughSignal ? await generateEmbedding(geminiKey, trimmed) : null;
    const candidates = embedding ? await searchMenuIntentCandidates(sb, tenant_id, embedding) : [];
    const node = await pickCompatibleSemanticMatch(sb, candidates, clientProvider);
    if (node) return enterNode(node, null, 1);
  } catch (e: any) {
    safeLog("[BOT][agent] Erro na detecção semântica de categoria:", e?.message);
  }

  if (bot_state === "aguardando_resposta_2") {
    await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
    return NextResponse.json({ ok: true, action: "escalated_menu", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  if (!bot_state || bot_state === "aguardando_resposta") {
    if (!bot_state) {
      const msg1 = "Olá! 😊 Sou o assistente do Márcio. Me diga, como posso te ajudar?";
      await sendWAMessage(session_key, phone, msg1);
      const menuMsg = await getAllRootsAsMenuText(sb, tenant_id, clientProvider);
      await sendWAMessage(session_key, phone, menuMsg);
      return NextResponse.json({ ok: true, action: "menu_intro", mark_read: true, bot_response: `${msg1}\n\n${menuMsg}`, next_state: "aguardando_resposta", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }
    // ✅ Reforça a seleção por número (em vez de convidar texto livre, que
    // dispararia o fallback semântico à toa) e mostra o menu de novo, caso
    // o cliente tenha perdido a lista original.
    const retryMenu = await getAllRootsAsMenuText(sb, tenant_id, clientProvider);
    const msg = `Sem pressa! 😊 ${retryMenu}`;
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({ ok: true, action: "menu_retry", mark_read: true, bot_response: msg, next_state: "aguardando_resposta_2", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // fallback de segurança — nunca deveria chegar aqui
  await sendWAMessage(session_key, phone, BOT_GAVE_UP_MSG);
  return NextResponse.json({ ok: true, action: "estado_desconhecido", escalate: true, mark_read: false, bot_response: BOT_GAVE_UP_MSG, next_state: "__clear__", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
}