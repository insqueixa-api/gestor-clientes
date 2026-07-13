// app/api/whatsapp/bot/chat-admin/route.ts
// Motor genérico orientado pela árvore (bot_menu_nodes/bot_menu_steps).
// Gemini só é usado para gerar o embedding da busca no RAG — nenhuma
// geração de texto livre acontece neste arquivo.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePortalLink, renderTemplate, buildClientTemplateVars } from "@/lib/whatsapp/template-vars";
import {
  type MenuNode,
  isEscalationTrigger,
  isBackToMenuTrigger,
  isSimpleConfirmation,
  isLinkOnly,
  isGreetingOnly,
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
  isConnectivityObjection,
  CONNECTIVITY_OBJECTION_MSG,
  CONNECTIVITY_OBJECTION_INSISTENT_MSG,
  isConfirmSwitchYes,
  resolveClientProvider,
  pickCompatibleSemanticMatch,
  buildInvalidMenuRetry,
  pickInvalidIntro,
  withResolutionQuestionIfNeeded,
  type ServerProvider,
} from "@/lib/whatsapp/bot-menu";
import {
  getFlowSettings,
  nodeAsksResolution,
  parseFlowTarget,
  makeRedirectState,
  MAX_REDIRECT_DEPTH,
  type FlowSettings,
} from "@/lib/whatsapp/bot-flow-settings";
import { generateEmbedding, searchBotKnowledgeCandidates, pickCompatibleKnowledgeMatch, searchMenuIntentCandidates, classifyIsAcknowledgment } from "@/lib/whatsapp/gemini-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.log(...args);
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Ferramentas (chamadas diretas, sem Gemini decidir quando usar) ──────────

async function toolGerarLinkPortal(sb: any, tenantId: string, rawClient: any, isSecondary: boolean = false): Promise<string> {
  const phone = isSecondary ? rawClient.secondary_whatsapp_username : rawClient.whatsapp_username;
  if (!phone) return "(link não disponível — cliente sem WhatsApp)";
  return generatePortalLink(sb, {
    tenantId,
    contact: { number: phone, username: phone, is_secondary: isSecondary },
    createdBy: null,
    label: "Teste admin bot",
    expiresAt: null,
    onLog: safeLog,
  });
}

// ✅ Alinhado com a versão do agent/route.ts (produção) — inclui a
// checagem de servidor Elite, que exclui o período Anual da tabela.
// Sem isso, o simulador podia mostrar um preço que nunca existiria de
// verdade pra um cliente Elite, divergindo do comportamento real.
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
      if (client.price_amount > 0 && PERIOD_LABELS[item.period] === client.plan_label) valor = client.price_amount;
      else {
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

// ── Variáveis de template ────────────────────────────────────────────────────

async function buildVarsForNode(sb: any, tenantId: string, node: MenuNode, client: any, rawClient: any): Promise<Record<string, any>> {
  const vars = buildClientTemplateVars({ clientRow: rawClient, isSecondary: client.is_secondary }) as Record<string, any>;
  // ✅ Correção: buildClientTemplateVars espera nomes de coluna diferentes
  // dos que a tabela `clients` realmente usa (row.username, row.plan_name,
  // row.server_name) — sem isso, essas 3 variáveis ficavam vazias em
  // silêncio, sem erro nenhum. Sobrescreve com os valores certos.
  vars.usuario_app = client.server_username || "";
  vars.plano_nome = client.plan_label || "";
  vars.servidor_nome = client.server_name || "";
  // ✅ Mesma correção do agent/route.ts: em vez de exigir marcar "Gerar
  // link do portal"/"Consultar tabela de preços" no nó, o bot detecta
  // sozinho pela presença de {link_pagamento}/{tabela_precos} no texto.
  const stepsText = (await getSteps(sb, node.id)).join(" ");
  if (stepsText.includes("{link_pagamento}")) {
    vars.link_pagamento = await toolGerarLinkPortal(sb, tenantId, rawClient, client.is_secondary);
  }
  if (stepsText.includes("{tabela_precos}")) {
    vars.tabela_precos = await toolConsultarPrecosTexto(sb, tenantId, client);
  }
  return vars;
}

// ── Gate checks — rodam ANTES de mostrar os filhos de um nó com children ────
// Retorna null se pode seguir normalmente, ou { messages, markRead } se deve
// responder direto e não mostrar as opções.
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

// ── Execução de um nó FOLHA (sem filhos) ─────────────────────────────────────
function leafAfterMessages(
  node: MenuNode,
  messages: string[],
  opts: { escalate?: boolean; markRead?: boolean; transferReason?: string | null; forceState?: string } = {}
): { messages: string[]; escalate?: boolean; markRead?: boolean; nextState: string; transferReason?: string | null } {
  if (opts.forceState) {
    return {
      messages,
      escalate: opts.escalate,
      markRead: opts.markRead,
      nextState: opts.forceState,
      transferReason: opts.transferReason || null,
    };
  }
  if (node.redirect_to_node_id) {
    return {
      messages,
      escalate: false,
      markRead: opts.markRead ?? true,
      nextState: makeRedirectState(node.redirect_to_node_id),
      transferReason: opts.transferReason || null,
    };
  }
  if ((node.special_actions || []).includes("redirecionar_instalacao")) {
    return {
      messages,
      escalate: false,
      markRead: opts.markRead ?? true,
      nextState: "__redirect_instalacao__",
      transferReason: opts.transferReason || null,
    };
  }
  if (nodeAsksResolution(node)) {
    return {
      messages,
      escalate: opts.escalate,
      markRead: opts.markRead ?? true,
      nextState: `awaiting_resolution:${node.id}`,
      transferReason: opts.transferReason || null,
    };
  }
  return {
    messages,
    escalate: opts.escalate,
    markRead: opts.markRead ?? true,
    nextState: opts.escalate ? "__clear__" : "geral",
    transferReason: opts.transferReason || null,
  };
}

async function executeLeaf(
  node: MenuNode,
  client: any,
  rawClient: any,
  sb: any,
  tenantId: string,
  flow: FlowSettings
): Promise<{ messages: string[]; escalate?: boolean; markRead?: boolean; nextState: string; transferReason?: string | null }> {
  const actions = node.special_actions || [];

  if (actions.includes("escalar_imediatamente") || actions.includes("coletar_relato_e_escalar")) {
    const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
    const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
    return leafAfterMessages(node, steps.length ? steps : [flow.human_requested_message], {
      escalate: true,
      markRead: false,
      transferReason: node.transfer_situation_label || null,
      forceState: "__clear__",
    });
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
    return leafAfterMessages(node, [msg]);
  }

  if (actions.includes("free_text_rag")) {
    const steps = await getSteps(sb, node.id);
    return leafAfterMessages(node, steps.length ? steps : ["Pode me contar com detalhes o que está acontecendo? 😊"], {
      forceState: "geral",
    });
  }

  const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
  const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
  return leafAfterMessages(node, steps.length ? steps : ["(nenhuma resposta cadastrada — avise o Márcio)"]);
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: authData } = await sb.auth.getUser(token);
  if (!authData?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: member } = await sb.from("tenant_members").select("tenant_id").eq("user_id", authData.user.id).limit(1).maybeSingle();
  if (!member?.tenant_id) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 403 });
  const tenantId = member.tenant_id;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const { message, bot_state } = body;
  // ✅ Sanitiza pra só dígitos antes de usar no filtro .or() do Supabase —
  // mesmo formato que o telefone real já chega pronto do sessionManager.js
  // no fluxo de produção. Sem isso, vírgula/parênteses no campo phone
  // podiam distorcer a sintaxe do filtro.
  const phone = String(body.phone || "").replace(/\D/g, "") || null;
  if (!message?.trim()) return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });
  const trimmed = message.trim();

  // ── Clientes (multi-conta) ────────────────────────────────────────────────
  let clients: any[] = [];
  let clientMatchesRaw: any[] = [];
  if (phone) {
    const { data: clientMatches } = await sb
      .from("clients")
      .select(`id, display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username, server_username, server_password, vencimento, screens, plan_label, plan_table_id, price_amount, price_currency, technology, server_id, servers (name, dns, is_offline, offline_reason)`)
      .eq("tenant_id", tenantId)
      .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

    if (clientMatches?.length) {
      clientMatchesRaw = clientMatches;
      clients = clientMatches.map((raw) => {
        const isSec = raw.secondary_whatsapp_username === phone;
        const srv = raw.servers as any;
        return {
          ...raw,
          display_name: isSec ? (raw.secondary_display_name || raw.display_name || "Cliente") : (raw.display_name || "Cliente"),
          server_name: srv?.name || "Servidor",
          server_is_offline: srv?.is_offline ?? false,
          server_offline_reason: srv?.offline_reason ?? null,
          is_secondary: isSec,
        };
      });
    }
  }
  if (!clients.length) {
    clients = [{ id: null, display_name: "Cliente Teste", server_name: "Servidor Teste", plan_label: "Mensal", screens: 1, vencimento: null, price_currency: "BRL", price_amount: 0, plan_table_id: null, server_id: null, whatsapp_username: null, server_is_offline: false, server_offline_reason: null }];
    clientMatchesRaw = [clients[0]];
  }
  const firstName = clients[0].display_name.split(" ")[0];

  const flow = await getFlowSettings(sb, tenantId);

  // ✅ Provider do servidor do cliente — mesma correção do agent/route.ts,
  // usado pra filtrar conteúdo restrito a um servidor específico.
  const clientProvider: ServerProvider | null = await resolveClientProvider(sb, clients[0]?.server_id || null);

  const history: any[] = []; // reservado (não usamos mais Gemini conversacional aqui)
  const sentMessages: string[] = [];
  function send(text: string) { if (text?.trim()) sentMessages.push(text); }

  // ✅ Traduz o next_state técnico (ex: "menunode:6d0aea8b-...") pra algo que
  // você reconhece na hora (o nome do nó), em vez do UUID cru — só pra
  // exibição no rodapé de debug do simulador, o valor técnico continua
  // indo normalmente em next_state pro front controlar o fluxo.
  async function resolveStateLabel(nextState: string | undefined | null): Promise<string | null> {
    if (!nextState || nextState === "__clear__") return null;
    if (nextState === "geral") return "Conversa livre";
    if (nextState === "geral_retry") return "Conversa livre (2ª tentativa)";
    if (nextState === "aguardando_resposta") return "Aguardando 1ª resposta do menu";
    if (nextState === "aguardando_resposta_2") return "Aguardando resposta (última tentativa)";
    const confirmSwitchM = /^confirm_switch:([a-f0-9-]+):([a-f0-9-]+)$/.exec(nextState);
    if (confirmSwitchM) {
      const [, targetId, originId] = confirmSwitchM;
      const target = await getNodeById(sb, targetId);
      const origin = await getNodeById(sb, originId);
      return `Confirmando troca para: ${target?.label || "nó removido"} (estava em: ${origin?.label || "nó removido"})`;
    }
    const m = /^(menunode_retry|menunode|conta|awaiting_resolution_retry|awaiting_resolution):([a-f0-9-]+)$/.exec(nextState);
    if (m) {
      const node = await getNodeById(sb, m[2]);
      const label = node?.label || "nó removido";
      const prefix =
        m[1] === "menunode" ? "Dentro de"
        : m[1] === "menunode_retry" ? "Dentro de (2ª tentativa)"
        : m[1] === "conta" ? "Perguntando qual conta em"
        : m[1] === "awaiting_resolution_retry" ? "Aguardando se resolveu (após objeção) em"
        : "Aguardando se resolveu em";
      return `${prefix}: ${label}`;
    }
    return nextState;
  }

  async function finish(opts: { action: string; next_state?: string; escalate?: boolean; mark_read?: boolean; transfer_reason?: string | null }) {
    return NextResponse.json({
      ok: true,
      response: sentMessages.join("\n\n"),
      updated_history: history,
      action: opts.action,
      escalate: opts.escalate ?? false,
      mark_read: opts.mark_read,
      next_state: opts.next_state,
      next_state_label: await resolveStateLabel(opts.next_state),
      transfer_reason: opts.transfer_reason ?? null,
    });
  }

  // ── Item 1: escalonamento explícito — prioridade máxima ─────────────────
  if (isEscalationTrigger(trimmed)) {
    send(flow.human_requested_message);
    return finish({ action: "escalated", escalate: true, mark_read: false, next_state: "__clear__" });
  }

  // ── Voltar ao menu principal — atalho reservado, mesma prioridade máxima
  // do escalonamento. Funciona em qualquer estado.
  if (isBackToMenuTrigger(trimmed)) {
    send(`Voltando ao menu principal! 😊\n\n${await getAllRootsAsMenuText(sb, tenantId, clientProvider)}`);
    return finish({ action: "back_to_menu", mark_read: true, next_state: "aguardando_resposta" });
  }

  // ── Checagem global: servidor offline ou acesso vencido ─────────────────
  // ✅ Mesma correção do agent/route.ts: antes só rodava se o nó específico
  // tivesse o checkbox marcado — agora roda sempre, antes de qualquer
  // roteamento de menu, exceto quando já está no meio de um fluxo
  // específico ou quando a mensagem é só uma saudação pura.
  const FRESH_STATES = new Set([null, undefined, "", "geral", "geral_retry", "aguardando_resposta", "aguardando_resposta_2"]);
  if (FRESH_STATES.has(bot_state) && !isGreetingOnly(trimmed)) {
    if (clients[0]?.server_is_offline) {
      // ✅ Mesma correção do agent/route.ts: usa a justificativa cadastrada
      // no servidor (offline_reason) quando existir.
      const reason = clients[0]?.server_offline_reason?.trim();
      const msg = reason
        ? `Identificamos uma instabilidade: ${reason}. Já está sendo verificada pela nossa equipe — assim que normalizar, volta a funcionar sozinho, sem precisar fazer nada. 🙏`
        : "Identificamos uma instabilidade interna no servidor que já está sendo verificada pela nossa equipe. Em breve tudo estará normalizado! Por enquanto, tente acessar de tempos em tempos — quando voltar, funciona normalmente, sem precisar fazer nada. 🙏";
      send(msg);
      return finish({ action: "gate_offline_global", mark_read: true, next_state: "geral" });
    }
    const vencido = clients[0]?.vencimento ? new Date(clients[0].vencimento).getTime() < Date.now() : false;
    if (vencido) {
      const link = await toolGerarLinkPortal(sb, tenantId, clientMatchesRaw[0], clients[0].is_secondary);
      const msg = `Vi aqui que seu acesso está vencido — por isso o sinal parou. 😊\n\nPara renovar:\n👉 ${link}\nSenha: últimos 4 dígitos do seu WhatsApp`;
      send(msg);
      return finish({ action: "gate_vencido_global", mark_read: true, next_state: "geral" });
    }
  }

  // ── Item 5: reação a mensagem automática recente — antes de qualquer menu ─
  // ✅ Mesma correção do agent: chamada mínima ao Gemini decide true/false
  // com o contexto certo, em vez de regex que falhava em mensagens reais.
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentJob } = await sb
      .from("client_message_jobs")
      .select(`sent_at, automation_id, message_template_id, billing_automations ( name, type )`)
      .eq("tenant_id", tenantId).in("client_id", clients.map((c) => c.id).filter(Boolean))
      .eq("status", "SENT").gte("sent_at", twentyFourHoursAgo)
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();

    let templateInfo: any = null;
    if (recentJob?.message_template_id) {
      const { data: tpl } = await sb.from("message_templates").select("name, category").eq("id", recentJob.message_template_id).maybeSingle();
      templateInfo = tpl || null;
    }
    const jobKind = classifyRecentJob(recentJob, templateInfo);

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
          vencimento: "Sem pressa! Pode ficar tranquilo — quando for renovar, é só acessar o portal que está tudo pronto. Se precisar de ajuda, é só chamar! 😊",
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
        send(ACK_MESSAGES[jobKind]);
        return finish({ action: ACK_ACTIONS[jobKind], mark_read: true });
      }
    }
  } catch (e: any) {
    safeLog("[BOT][chat-admin] Erro Item5:", e?.message);
  }

  // ── Confirmação simples / link puro ─────────────────────────────────────
  if (isSimpleConfirmation(trimmed)) return finish({ action: "silence_confirmation", mark_read: true });
  if (isLinkOnly(trimmed)) return finish({ action: "silence", mark_read: true });

  // ── Helper: resolve conta (única, ou tenta casar por texto) ──────────────
  function resolveAccount(text: string): { client: any; rawClient: any; index: number } | null {
    if (clients.length <= 1) return { client: clients[0], rawClient: clientMatchesRaw[0], index: 0 };
    const idx = matchAccountFromText(clients, text);
    if (idx === null) return null;
    return { client: clients[idx], rawClient: clientMatchesRaw[idx], index: idx };
  }

  function askAccountMessage(): string {
    const lista = clients.map((c, i) => `- Conta ${i + 1}: ${c.display_name} (${c.server_username || "n/i"}) — ${c.server_name}`).join("\n");
    return `Você tem mais de uma conta — qual delas se refere? Pode responder com "conta 1", "conta 2" ou o nome do servidor:\n\n${lista}`;
  }

  // ── Executa um nó (root ou folha), incluindo gate checks e resolução de conta ──
  async function enterNode(
    node: MenuNode,
    resolved: { client: any; rawClient: any } | null,
    attempt: 1 | 2,
    redirectDepth: number = 0
  ): Promise<any> {
    if (redirectDepth > MAX_REDIRECT_DEPTH) {
      send(flow.escalate_message);
      return finish({ action: "redirect_loop", escalate: true, mark_read: false, next_state: "__clear__" });
    }

    if ((await nodeNeedsAccount(sb, node)) && !resolved) {
      resolved = resolveAccount(trimmed);
      if (!resolved) {
        if (attempt === 2) {
          send(flow.escalate_message);
          return finish({ action: "conta_desistiu", escalate: true, mark_read: false, next_state: "__clear__", transfer_reason: node.transfer_situation_label || null });
        }
        send(askAccountMessage());
        return finish({ action: "pede_conta", mark_read: true, next_state: `conta:${node.id}` });
      }
    }
    const client = resolved?.client || clients[0];
    const rawClient = resolved?.rawClient || clientMatchesRaw[0];

    const children = await getChildren(sb, node.id, clientProvider);

    if (children.length > 0) {
      const gate = await runGateChecks(node, client, sb, tenantId);
      if (gate) {
        gate.messages.forEach(send);
        return finish({ action: "gate_resolved", mark_read: gate.markRead ?? true, next_state: "geral" });
      }
      const directChild = findChildByKeyword(children, trimmed);
      if (directChild) return enterNode(directChild, null, 1, redirectDepth);

      const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
      (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars)).forEach(send);
      send(renderChildrenMenu(children, undefined, true));
      return finish({ action: "menu_shown", mark_read: true, next_state: `menunode:${node.id}` });
    }

    const result = await executeLeaf(node, client, rawClient, sb, tenantId, flow);

    const redirectMatch = /^__redirect_node__:([0-9a-f-]{36})$/i.exec(result.nextState || "");
    if (redirectMatch || result.nextState === "__redirect_instalacao__") {
      result.messages.forEach(send);
      let target: MenuNode | null = null;
      if (redirectMatch) {
        target = await getNodeById(sb, redirectMatch[1]);
      } else {
        const { data: instalacaoRoot } = await sb.from("bot_menu_nodes").select("*").eq("tenant_id", tenantId).eq("slug", "instalacao").maybeSingle();
        target = (instalacaoRoot as MenuNode) || null;
      }
      if (target) return enterNode(target, null, 1, redirectDepth + 1);
      send(flow.escalate_message);
      return finish({ action: "redirect_destino_ausente", escalate: true, mark_read: false, next_state: "__clear__" });
    }

    let allMsgs = result.messages;
    if ((result.nextState || "").startsWith("awaiting_resolution:")) {
      allMsgs = withResolutionQuestionIfNeeded(result.messages);
    }
    allMsgs.forEach(send);
    return finish({ action: "leaf_executed", escalate: result.escalate, mark_read: result.markRead ?? true, next_state: result.nextState, transfer_reason: result.transferReason || null });
  }

  async function applyFlowTarget(
    rawTarget: string | null | undefined,
    fallback: "success" | "escalate",
    node: MenuNode | null,
    resolvedMsg?: string
  ): Promise<any> {
    const target = parseFlowTarget(rawTarget);
    const kind = target.kind === "default" ? fallback : target.kind;

    if (kind === "node" && target.kind === "node") {
      const dest = await getNodeById(sb, target.nodeId);
      if (dest) return enterNode(dest, null, 1, 0);
      send(flow.escalate_message);
      return finish({ action: "target_node_missing", escalate: true, mark_read: false, next_state: "__clear__", transfer_reason: node?.transfer_situation_label || null });
    }
    if (kind === "success") {
      send(target.kind === "default" && resolvedMsg?.trim() ? resolvedMsg.trim() : flow.success_message);
      return finish({ action: "resolvido", mark_read: true, next_state: "geral" });
    }
    if (kind === "end") {
      return finish({ action: "flow_end", mark_read: true, next_state: "geral" });
    }
    send(flow.escalate_message);
    return finish({ action: "nao_resolvido_escalado", escalate: true, mark_read: false, next_state: "__clear__", transfer_reason: node?.transfer_situation_label || null });
  }

  // ✅ Pergunta antes de trocar de assunto no meio de um submenu, em vez de
  // já trocar direto — mesma correção do agent/route.ts.
  async function askConfirmSwitch(targetNode: MenuNode, originNode: MenuNode) {
    send(`Antes de mudar de assunto: você quer saber sobre *${targetNode.label}* agora? Responda **sim** pra mudar, ou continue me contando sobre o que estávamos vendo. 😊`);
    return finish({ action: "confirm_switch_asked", mark_read: true, next_state: `confirm_switch:${targetNode.id}:${originNode.id}` });
  }

  // ── Estado: confirmação antes de trocar de assunto ───────────────────────
  const confirmSwitchMatch = /^confirm_switch:([a-f0-9-]+):([a-f0-9-]+)$/.exec(bot_state || "");
  if (confirmSwitchMatch) {
    const [, targetId, originId] = confirmSwitchMatch;
    if (isConfirmSwitchYes(trimmed)) {
      const target = await getNodeById(sb, targetId);
      if (target) return enterNode(target, null, 1);
    }
    // Não confirmou — por segurança, volta pro submenu de onde saiu.
    const origin = await getNodeById(sb, originId);
    if (!origin) return finish({ action: "erro_no_estado", mark_read: true, next_state: "__clear__" });
    const originChildren = await getChildren(sb, origin.id, clientProvider);
    send(renderChildrenMenu(originChildren, "Combinado, seguimos por aqui! Escolha uma das opções:", true));
    return finish({ action: "confirm_switch_declined", mark_read: true, next_state: `menunode:${origin.id}` });
  }

  // ── Estado: aguardando resolução de conta ────────────────────────────────
  // ✅ Corrigido (mesmo fix já aplicado em agent/route.ts): se chegamos aqui
  // com bot_state = "conta:<id>", significa que JÁ perguntamos uma vez — esta
  // resposta do cliente é a última chance antes de escalonar. A versão
  // anterior guardava a tentativa num segundo formato de estado ("conta2:")
  // que o código nunca chegava a produzir, então o contador nunca avançava
  // e o bot ficava perguntando "qual conta?" pra sempre.
  const contaMatch = /^conta:([a-f0-9-]+)$/.exec(bot_state || "");
  if (contaMatch) {
    const node = await getNodeById(sb, contaMatch[1]);
    if (!node) return finish({ action: "erro_no_estado", mark_read: true, next_state: "__clear__" });
    return enterNode(node, null, 2);
  }

  // ── Estado: aguardando "resolveu ou não" ─────────────────────────────────
  const resolutionMatch = /^awaiting_resolution:([a-f0-9-]+)$/.exec(bot_state || "");
  const resolutionRetryMatch = /^awaiting_resolution_retry:([a-f0-9-]+)$/.exec(bot_state || "");
  if (resolutionMatch || resolutionRetryMatch) {
    const nodeId = (resolutionMatch || resolutionRetryMatch)![1];
    const alreadyObjected = !!resolutionRetryMatch;
    const node = await getNodeById(sb, nodeId);
    if (isResolutionResolved(trimmed)) {
      return applyFlowTarget(node?.on_resolved_target, "success", node, node?.closing_message || undefined);
    }
    if (isResolutionNotResolved(trimmed)) {
      safeLog("[BOT][chat-admin] Transferência:", node?.transfer_situation_label);
      return applyFlowTarget(node?.on_not_resolved_target, "escalate", node);
    }
    // ✅ Objeção mais comum na prática (mesma correção do agent/route.ts):
    // "mas minha internet está boa" ou "mas Netflix/YouTube funciona
    // normal" — a 2ª vez em diante usa uma versão mais direta e insistente
    // em vez de repetir a mesma explicação.
    if (isConnectivityObjection(trimmed)) {
      const msg = alreadyObjected
        ? CONNECTIVITY_OBJECTION_INSISTENT_MSG
        : `${CONNECTIVITY_OBJECTION_MSG}\n\n${RESOLUTION_QUESTION}`;
      send(msg);
      return finish({ action: "resolution_objection", mark_read: true, next_state: `awaiting_resolution_retry:${nodeId}` });
    }
    send(RESOLUTION_QUESTION);
    return finish({ action: "resolution_retry", mark_read: true, next_state: bot_state });
  }

  // ── Estado: dentro de um nó com filhos (escolhendo opção) ────────────────
  // ✅ Redesenhado (mesma correção do agent/route.ts): na 1ª resposta que não
  // bate número nem palavra-chave do submenu atual, o bot NÃO tenta mais
  // interpretar/trocar de assunto — só pede pra escolher uma opção. Só na 2ª
  // tentativa seguida sem bater nada é que tenta detectar troca de contexto,
  // e se isso também falhar, escalona.
  const menuNodeMatch = /^menunode:([a-f0-9-]+)$/.exec(bot_state || "");
  const menuNodeRetryMatch = /^menunode_retry:([a-f0-9-]+)$/.exec(bot_state || "");
  if (menuNodeMatch || menuNodeRetryMatch) {
    const nodeId = (menuNodeMatch || menuNodeRetryMatch)![1];
    const isSecondMiss = !!menuNodeRetryMatch;
    const currentNode = await getNodeById(sb, nodeId);
    if (!currentNode) return finish({ action: "erro_no_estado", mark_read: true, next_state: "__clear__" });

    const children = await getChildren(sb, currentNode.id, clientProvider);
    const numeric = extractSingleDigitSelection(trimmed);
    const chosen = (numeric ? findChildByNumber(children, numeric) : null) || findChildByKeyword(children, trimmed);

    if (chosen) return enterNode(chosen, null, 1);

    if (!isSecondMiss) {
      const intro = pickInvalidIntro(currentNode, 1, flow.menu_invalid_intro_1, flow.menu_invalid_intro_2);
      send(buildInvalidMenuRetry(children, intro, true));
      return finish({ action: "menu_retry", mark_read: true, next_state: `menunode_retry:${currentNode.id}` });
    }

    const switched = await detectMenuContextFromTree(sb, tenantId, trimmed, clientProvider);
    if (switched && switched.id !== currentNode.id && switched.parent_id === null) {
      return askConfirmSwitch(switched, currentNode);
    }

    if (hasSemanticSignal(trimmed)) {
      try {
        const embedding = await generateEmbedding(geminiKey, trimmed);
        const candidates = embedding ? await searchMenuIntentCandidates(sb, tenantId, embedding) : [];
        const node = await pickCompatibleSemanticMatch(sb, candidates, clientProvider);
        if (node && node.id !== currentNode.id) {
          return askConfirmSwitch(node, currentNode);
        }
      } catch (e: any) {
        safeLog("[BOT][chat-admin] Erro na detecção semântica (troca de contexto):", e?.message);
      }
    }

    const intro2 = pickInvalidIntro(currentNode, 2, flow.menu_invalid_intro_1, flow.menu_invalid_intro_2);
    send(buildInvalidMenuRetry(children, intro2, true));
    send(flow.escalate_message);
    return finish({ action: "menu_retry_escalado", escalate: true, mark_read: false, next_state: "__clear__", transfer_reason: currentNode.transfer_situation_label || null });
  }

  // ── Estado "geral" / "geral_retry" — resposta direta do RAG ──────────────
  // ✅ Agora com 1 chance de reformular antes de escalonar, no mesmo padrão
  // de paciência usado no resto da árvore — antes, qualquer falta de match
  // no RAG (ou falha passageira do Gemini) escalonava na 1ª tentativa.
  if (bot_state === "geral" || bot_state === "geral_retry") {
    const isRetry = bot_state === "geral_retry";
    try {
      const embedding = await generateEmbedding(geminiKey, trimmed);
      const candidates = embedding ? await searchBotKnowledgeCandidates(sb, tenantId, embedding) : [];
      const top = await pickCompatibleKnowledgeMatch(sb, candidates, clientProvider);
      if (top) {
        const vars = buildClientTemplateVars({ clientRow: clientMatchesRaw[0], isSecondary: clients[0]?.is_secondary }) as any;
        // ✅ Mesma correção do buildVarsForNode — sem isso, {usuario_app},
        // {plano_nome} e {servidor_nome} ficariam vazios em qualquer
        // resposta vinda do RAG direto (estado "geral").
        vars.usuario_app = clients[0]?.server_username || "";
        vars.plano_nome = clients[0]?.plan_label || "";
        vars.servidor_nome = clients[0]?.server_name || "";
        send(renderTemplate(top.content, vars));
        return finish({ action: "rag_direct", mark_read: true, next_state: "geral" });
      }
    } catch (e: any) {
      safeLog("[BOT][chat-admin] Erro RAG:", e?.message);
    }

    if (!isRetry) {
      send("Não encontrei uma resposta certeira pra isso 🤔 Pode tentar explicar de outro jeito ou com mais detalhes?");
      return finish({ action: "rag_sem_match_retry", mark_read: true, next_state: "geral_retry" });
    }

    send(flow.escalate_message);
    return finish({ action: "rag_sem_match", escalate: true, mark_read: false, next_state: "__clear__" });
  }

  // ── Primeira mensagem / paciência de 2 tentativas ────────────────────────
  if (extractSingleDigitSelection(trimmed) !== null) {
    const roots = await getRootNodes(sb, tenantId, clientProvider);
    const chosenRoot = findRootByNumber(roots, trimmed);
    if (chosenRoot) return enterNode(chosenRoot, null, 1);
  }

  const detected = await detectMenuContextFromTree(sb, tenantId, trimmed, clientProvider);
  if (detected) return enterNode(detected, null, 1);

  const hasEnoughSignal = hasSemanticSignal(trimmed);
  try {
    const embedding = hasEnoughSignal ? await generateEmbedding(geminiKey, trimmed) : null;
    const candidates = embedding ? await searchMenuIntentCandidates(sb, tenantId, embedding) : [];
    const node = await pickCompatibleSemanticMatch(sb, candidates, clientProvider);
    if (node) {
      return enterNode(node, null, 1);
    }
  } catch (e: any) {
    safeLog("[BOT][chat-admin] Erro na detecção semântica de categoria:", e?.message);
  }

  if (bot_state === "aguardando_resposta_2") {
    // 2ª inválida no menu raiz: intro diferente + menu, depois escala
    const roots = await getRootNodes(sb, tenantId, clientProvider);
    send(buildInvalidMenuRetry(roots, flow.invalid_retry_message_2, false));
    send(flow.escalate_message);
    return finish({ action: "escalated_menu", escalate: true, mark_read: false, next_state: "__clear__" });
  }

  if (!bot_state || bot_state === "aguardando_resposta") {
    if (!bot_state) {
      send(flow.greeting_message);
      send(await getAllRootsAsMenuText(sb, tenantId, clientProvider));
      return finish({ action: "menu_intro", mark_read: true, next_state: "aguardando_resposta" });
    }
    const roots = await getRootNodes(sb, tenantId, clientProvider);
    send(buildInvalidMenuRetry(roots, flow.invalid_retry_message_1, false));
    return finish({ action: "menu_retry", mark_read: true, next_state: "aguardando_resposta_2" });
  }

  send(flow.escalate_message);
  return finish({ action: "estado_desconhecido", escalate: true, mark_read: false, next_state: "__clear__" });
}