// lib/whatsapp/bot-engine.ts
// ─────────────────────────────────────────────────────────────────────────────
// Motor único da árvore do bot (bot_menu_nodes/bot_menu_steps) — usado tanto
// pelo agent/route.ts (produção, WhatsApp real) quanto pelo chat-admin/route.ts
// (simulador do painel). Antes duplicado nos dois arquivos e mantido em
// sincronia manualmente; agora uma fonte única. Edite APENAS aqui.
// ─────────────────────────────────────────────────────────────────────────────

import { generatePortalLink, renderTemplate, buildClientTemplateVars, toBRDate, pickRandomDns, extractAppLogoTokens } from "@/lib/whatsapp/template-vars";
import { getCouponPhraseForClient, getPendencyPhraseForClient } from "@/lib/client-portal/coupons";
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
  pickCompatibleSemanticMatch,
  buildInvalidMenuRetry,
  pickInvalidIntro,
  withResolutionQuestionIfNeeded,
  type ServerProvider,
} from "@/lib/whatsapp/bot-menu";
import {
  nodeAsksResolution,
  parseFlowTarget,
  makeRedirectState,
  MAX_REDIRECT_DEPTH,
  type FlowSettings,
} from "@/lib/whatsapp/bot-flow-settings";
import {
  generateEmbedding,
  searchBotKnowledgeCandidates,
  pickCompatibleKnowledgeMatch,
  searchMenuIntentCandidates,
  classifyIsAcknowledgment,
} from "@/lib/whatsapp/gemini-client";

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.log(...args);
}

export type SendFn = (text: string) => void | Promise<void>;

export type BotEngineParams = {
  sb: any;
  tenantId: string;
  geminiKey: string;
  flow: FlowSettings;
  clients: any[];
  clientMatchesRaw: any[];
  clientProvider: ServerProvider | null;
  trimmed: string;
  botState: string | null | undefined;
  /** true só quando o agent está no meio do fluxo "Portal ou PIX?" — chat-admin nunca seta. */
  awaitingPaymentType?: boolean;
  /** Entra direto nesse nó, ignorando toda a classificação por texto — usado
   * quando quem disparou o turno não foi uma mensagem de texto (ex: imagem
   * classificada como "app expirado"), então não faz sentido tentar casar
   * palavra-chave/semântica em cima de `trimmed`. */
  forceNodeId?: string;
  send: SendFn;
  /** Envia a "figurinha" de um app ({NomeDoApp+logo}) — imagem + nome como
   * legenda. Opcional: se omitido (ex: simulador sem essa capacidade), o
   * token só vira o nome do app no texto, sem tentar mandar imagem nenhuma. */
  sendImage?: (url: string, caption: string) => void | Promise<void>;
  /** prefixo dos console.log de debug (ex: "[BOT][agent]" / "[BOT][chat-admin]"). */
  logPrefix?: string;
};

export type BotEngineResult = {
  action: string;
  escalate?: boolean;
  markRead?: boolean;
  nextState?: string | null;
  transferReason?: string | null;
};

// ── Ferramentas (chamadas diretas, disparadas pelas special_actions da árvore) ─

async function toolGerarLinkPortal(sb: any, tenantId: string, rawClient: any, isSecondary: boolean = false): Promise<string> {
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

// Mantém a checagem de servidor Elite (exclui o período Anual da tabela) —
// já reconciliada entre agent/chat-admin antes desta unificação.
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

// ✅ {cupom_frase} pro bot (retenção/fidelidade, onlyBotVisible: true) —
// o `rawClient`/`client` que chega aqui vem direto da tabela `clients`
// crua (agent/route.ts), sem computed_status/created_at/apps_names, que é
// exatamente o que findEligibleCoupon/matchesTargeting precisam (mesma
// classe de bug já corrigida em create-payment/validate-coupon: sem
// computed_status, cupom sem target_status explícito nunca bate). Por
// isso busca um clientRow completo na view antes de checar elegibilidade
// — só quando a tag realmente aparece no texto de destino.
async function toolConsultarCupomBotTexto(sb: any, tenantId: string, client: any): Promise<string> {
  const { data: viewRow } = await sb
    .from("vw_clients_list_active")
    .select("id, computed_status, server_id, plan_name, apps_names, vencimento, created_at, price_currency, price_amount, whatsapp_username, screens, plan_table_id")
    .eq("tenant_id", tenantId)
    .eq("id", client.id)
    .maybeSingle();

  return getCouponPhraseForClient(sb, tenantId, viewRow || client, { onlyBotVisible: true });
}

// ✅ Resolve {cupom_frase}/{pendencia_detalhe} sob demanda (só quando o
// texto de destino usa a tag) — compartilhado entre buildVarsForNode
// (mensagens de nó) e o estado "geral"/RAG (resposta direta de artigo da
// Base de Conhecimento), que monta seu próprio `vars` separado e por isso
// precisaria da mesma resolução duplicada sem este helper.
async function resolveCouponPendencyVars(sb: any, tenantId: string, client: any, targetText: string): Promise<Record<string, any>> {
  const vars: Record<string, any> = {};
  if (targetText.includes("{cupom_frase}")) {
    vars.cupom_frase = await toolConsultarCupomBotTexto(sb, tenantId, client);
  }
  if (targetText.includes("{pendencia_detalhe}")) {
    vars.pendencia_detalhe = await getPendencyPhraseForClient(sb, tenantId, client.id, client.price_currency || "BRL");
  }
  return vars;
}

async function buildVarsForNode(
  sb: any, tenantId: string, node: MenuNode, client: any, rawClient: any, provider: ServerProvider | null
): Promise<Record<string, any>> {
  const vars = buildClientTemplateVars({ clientRow: rawClient, isSecondary: client.is_secondary }) as Record<string, any>;
  vars.usuario_app = client.server_username || "";
  vars.plano_nome = client.plan_label || "";
  vars.servidor_nome = client.server_name || "";
  vars.dns_servidor = pickRandomDns(client.server_dns);
  const stepsText = (await getSteps(sb, node.id, provider)).join(" ");
  if (stepsText.includes("{link_pagamento}")) {
    vars.link_pagamento = await toolGerarLinkPortal(sb, tenantId, rawClient, client.is_secondary);
  }
  if (stepsText.includes("{tabela_precos}")) {
    vars.tabela_precos = await toolConsultarPrecosTexto(sb, tenantId, client);
  }
  Object.assign(vars, await resolveCouponPendencyVars(sb, tenantId, client, stepsText));
  return vars;
}

// ✅ Busca o vencimento ATUAL do cliente (pode já ter sido estendido pela
// renovação automática que gerou o "auto_confirmed") pra confirmar a data
// certa na mensagem, em vez de repetir só um "tudo certo" genérico.
async function fetchFreshDueDate(sb: any, clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null;
  try {
    const { data } = await sb.from("clients").select("vencimento").eq("id", clientId).maybeSingle();
    if (!data?.vencimento) return null;
    return toBRDate(new Date(data.vencimento));
  } catch {
    return null;
  }
}

// ── Gate checks — rodam antes de mostrar os filhos de um nó com children ────
async function runGateChecks(node: MenuNode, client: any, sb: any, tenantId: string): Promise<{ messages: string[]; markRead?: boolean } | null> {
  const actions = node.special_actions || [];

  if (actions.includes("check_servidor_vencimento") && client?.server_is_offline) {
    return { messages: ["Identificamos uma instabilidade interna no servidor que já está sendo verificada pela nossa equipe. Em breve tudo estará normalizado! Por enquanto, tente acessar de tempos em tempos — quando voltar, funciona normalmente, sem precisar fazer nada. 🙏"], markRead: true };
  }

  if (actions.includes("check_renovacao_recente")) {
    const status = await checkRecentPortalPayment(sb, tenantId, [client?.id].filter(Boolean));
    if (status === "auto_confirmed") {
      const dueStr = await fetchFreshDueDate(sb, client?.id);
      return { messages: [paymentAutoConfirmedMsg(client.display_name?.split(" ")[0] || "", dueStr)], markRead: true };
    }
    if (status === "manual_pending") return { messages: [PAYMENT_MANUAL_PENDING_MSG], markRead: true };
    if (status === "fulfillment_error") return { messages: [PAYMENT_FULFILLMENT_ERROR_MSG], markRead: false };
  }

  return null;
}

function leafAfterMessages(
  node: MenuNode,
  messages: string[],
  opts: { escalate?: boolean; markRead?: boolean; transferReason?: string | null; forceState?: string } = {}
): { messages: string[]; escalate?: boolean; markRead?: boolean; nextState: string; transferReason?: string | null } {
  if (opts.forceState) {
    return { messages, escalate: opts.escalate, markRead: opts.markRead, nextState: opts.forceState, transferReason: opts.transferReason || null };
  }
  if (node.redirect_to_node_id) {
    return { messages, escalate: false, markRead: opts.markRead ?? true, nextState: makeRedirectState(node.redirect_to_node_id), transferReason: opts.transferReason || null };
  }
  if ((node.special_actions || []).includes("redirecionar_instalacao")) {
    return { messages, escalate: false, markRead: opts.markRead ?? true, nextState: "__redirect_instalacao__", transferReason: opts.transferReason || null };
  }
  if (nodeAsksResolution(node)) {
    return { messages, escalate: opts.escalate, markRead: opts.markRead ?? true, nextState: `awaiting_resolution:${node.id}`, transferReason: opts.transferReason || null };
  }
  return { messages, escalate: opts.escalate, markRead: opts.markRead ?? true, nextState: opts.escalate ? "__clear__" : "geral", transferReason: opts.transferReason || null };
}

async function executeLeaf(
  node: MenuNode, client: any, rawClient: any, sb: any, tenantId: string, flow: FlowSettings, provider: ServerProvider | null
): Promise<{ messages: string[]; escalate?: boolean; markRead?: boolean; nextState: string; transferReason?: string | null }> {
  const actions = node.special_actions || [];

  // ✅ Antes só funcionava como gate ANTES de mostrar submenu (nó com filhos)
  // — num nó FOLHA (ex: "Já paguei, aguardando confirmação") essa checagem
  // nunca rodava. Confirma automaticamente pagamento + confirmação já
  // enviada (com o vencimento atualizado); só cai pro resto (coletar
  // relato e escalar pro Márcio) se realmente não achar nada.
  if (actions.includes("check_renovacao_recente")) {
    const status = await checkRecentPortalPayment(sb, tenantId, [client?.id].filter(Boolean));
    if (status === "auto_confirmed") {
      const dueStr = await fetchFreshDueDate(sb, client?.id);
      return leafAfterMessages(node, [paymentAutoConfirmedMsg(client.display_name?.split(" ")[0] || "", dueStr)], { forceState: "geral" });
    }
    if (status === "manual_pending") {
      return leafAfterMessages(node, [PAYMENT_MANUAL_PENDING_MSG], { forceState: "geral" });
    }
    if (status === "fulfillment_error") {
      return leafAfterMessages(node, [PAYMENT_FULFILLMENT_ERROR_MSG], { markRead: false, forceState: "geral" });
    }
    // status === "none" → segue pro resto (ex: coletar_relato_e_escalar)
  }

  if (actions.includes("escalar_imediatamente") || actions.includes("coletar_relato_e_escalar")) {
    const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient, provider);
    const steps = (await getSteps(sb, node.id, provider)).map((s) => renderTemplate(s, vars));
    return leafAfterMessages(node, steps.length ? steps : [flow.human_requested_message], {
      escalate: true, markRead: false, transferReason: node.transfer_situation_label || null, forceState: "__clear__",
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
    const steps = await getSteps(sb, node.id, provider);
    return leafAfterMessages(node, steps.length ? steps : ["Pode me contar com detalhes o que está acontecendo? 😊"], { forceState: "geral" });
  }

  const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient, provider);
  const steps = (await getSteps(sb, node.id, provider)).map((s) => renderTemplate(s, vars));
  // ✅ Achado em auditoria: nó sem steps próprios mas com redirect_to_node_id
  // (ex: "Android" → redireciona pro submenu de instalação) mandava o texto
  // de debug "(nenhuma resposta cadastrada...)" pro cliente ANTES do
  // redirect, porque leafAfterMessages só decide o redirect depois de
  // receber `messages` já pronto. Se vai redirecionar mesmo, não preenche
  // com o fallback — deixa passar direto pro nó de destino, silencioso.
  const fallback = node.redirect_to_node_id ? [] : ["(nenhuma resposta cadastrada — avise o Márcio)"];
  return leafAfterMessages(node, steps.length ? steps : fallback);
}

export async function runBotEngine(p: BotEngineParams): Promise<BotEngineResult> {
  const { sb, tenantId, geminiKey, flow, clients, clientMatchesRaw, clientProvider, trimmed, botState, send } = p;
  const awaitingPaymentType = p.awaitingPaymentType === true;
  const logPrefix = p.logPrefix || "[BOT]";
  const firstName = clients[0].display_name.split(" ")[0];

  // ✅ As mensagens globais (saudação, sucesso, escalar, retry de menu) podem
  // usar variáveis do cliente (ex: {primeiro_nome}, {saudacao_tempo}) — antes
  // eram mandadas cruas, então {primeiro_nome} chegava literal pro cliente.
  const flowVars = buildClientTemplateVars({ clientRow: clientMatchesRaw[0], isSecondary: clients[0]?.is_secondary }) as Record<string, any>;
  flowVars.usuario_app = clients[0]?.server_username || "";
  flowVars.plano_nome = clients[0]?.plan_label || "";
  flowVars.servidor_nome = clients[0]?.server_name || "";
  flowVars.dns_servidor = pickRandomDns(clients[0]?.server_dns);
  const sendFlow = (text: string) => send(renderTemplate(text, flowVars));

  // ✅ {NomeDoApp+logo} — só busca a lista de apps (1x por turno, cacheada)
  // quando o texto realmente tem o token; a maioria das mensagens não tem,
  // então isso não vira uma query a mais em toda resposta do bot.
  let appsForLogosCache: { name: string; icon_url: string | null }[] | null = null;
  async function sendWithLogos(text: string) {
    if (!/\{[A-Za-z0-9_]+\+logo\}/.test(text)) {
      await send(text);
      return;
    }
    if (!appsForLogosCache) {
      const { data } = await sb.from("apps").select("name, icon_url").eq("tenant_id", tenantId);
      appsForLogosCache = data || [];
    }
    const { cleanText, images } = extractAppLogoTokens(text, appsForLogosCache);
    await send(cleanText);
    if (p.sendImage) {
      for (const img of images) await p.sendImage(img.url, img.name);
    }
  }

  // ── Entrada forçada num nó específico — prioridade máxima, ignora todo
  // texto/estado. Usado quando o turno não veio de uma mensagem de texto
  // (ex: foto classificada como "tela de app expirado" pelo Gemini).
  if (p.forceNodeId) {
    const forced = await getNodeById(sb, p.forceNodeId);
    if (forced) return enterNode(forced, null, 1);
  }

  // ── Item 1: escalonamento explícito — prioridade máxima ─────────────────
  if (isEscalationTrigger(trimmed)) {
    await sendFlow(flow.human_requested_message);
    return { action: "escalated", escalate: true, markRead: false, nextState: "__clear__" };
  }

  // ── Voltar ao menu principal — atalho reservado, mesma prioridade máxima
  // do escalonamento. Funciona em qualquer estado.
  if (isBackToMenuTrigger(trimmed)) {
    await send(`Voltando ao menu principal! 😊\n\n${await getAllRootsAsMenuText(sb, tenantId, clientProvider)}`);
    return { action: "back_to_menu", markRead: true, nextState: "aguardando_resposta" };
  }

  // ── Checagem global: servidor offline ou acesso vencido ─────────────────
  const FRESH_STATES = new Set([null, undefined, "", "geral", "geral_retry", "aguardando_resposta", "aguardando_resposta_2"]);
  if (FRESH_STATES.has(botState) && !awaitingPaymentType && !isGreetingOnly(trimmed)) {
    // ✅ Com mais de uma conta, não dá pra assumir que o problema é da conta
    // principal (clients[0]) — resolve pelo texto (número/"conta X"/nome do
    // servidor, mesma lógica usada em qualquer outro lugar que precisa de
    // conta). Se não der pra saber qual conta é (mensagem ambígua, ex: "bom
    // dia"), pula esse aviso proativo em vez de arriscar avisar sobre a
    // conta errada — o fluxo normal ainda pergunta "qual conta?" antes de
    // qualquer ação que realmente precise saber (ver nodeNeedsAccount).
    const gateAccount = resolveAccount(trimmed);
    if (gateAccount) {
      const { client: gateClient, rawClient: gateRawClient } = gateAccount;
      if (gateClient?.server_is_offline) {
        const reason = gateClient?.server_offline_reason?.trim();
        const msg = reason
          ? `Identificamos uma instabilidade: ${reason}. Já está sendo verificada pela nossa equipe — assim que normalizar, volta a funcionar sozinho, sem precisar fazer nada. 🙏`
          : "Identificamos uma instabilidade interna no servidor que já está sendo verificada pela nossa equipe. Em breve tudo estará normalizado! Por enquanto, tente acessar de tempos em tempos — quando voltar, funciona normalmente, sem precisar fazer nada. 🙏";
        await send(msg);
        return { action: "gate_offline_global", markRead: true, nextState: "geral" };
      }
      const vencido = gateClient?.vencimento ? new Date(gateClient.vencimento).getTime() < Date.now() : false;
      if (vencido) {
        const link = await toolGerarLinkPortal(sb, tenantId, gateRawClient, gateClient.is_secondary);
        const msg = `Vi aqui que seu acesso está vencido — por isso o sinal parou. 😊\n\nPara renovar:\n👉 ${link}\nSenha: últimos 4 dígitos do seu WhatsApp`;
        await send(msg);
        return { action: "gate_vencido_global", markRead: true, nextState: "geral" };
      }
    }
  }

  // ── Item 5: reação a mensagem automática recente ─────────────────────────
  // ✅ Só roda com o cliente em estado "fresco" (mesmo critério do gate de
  // vencido/offline acima) — sem essa guarda, uma resposta curta e ambígua
  // no MEIO de um fluxo real (escolhendo conta, respondendo "resolveu?",
  // dentro de um submenu) podia ser classificada pelo Gemini como só
  // cordialidade em relação a uma cobrança/vencimento das últimas 24h,
  // desviando o cliente do que ele realmente estava respondendo.
  if (FRESH_STATES.has(botState) && !awaitingPaymentType) {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentJob } = await sb
        .from("client_message_jobs")
        .select(`sent_at, automation_id, message_template_id, billing_automations ( name, type )`)
        .eq("tenant_id", tenantId).in("client_id", clients.map((c: any) => c.id).filter(Boolean))
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
          await send(ACK_MESSAGES[jobKind]);
          return { action: ACK_ACTIONS[jobKind], markRead: true, nextState: "geral" };
        }
      }
    } catch (e: any) {
      safeLog(`${logPrefix} Erro Item5:`, e?.message);
    }
  }

  // ── Confirmação simples / link puro ─────────────────────────────────────
  if (isSimpleConfirmation(trimmed)) return { action: "silence_confirmation", markRead: true };
  if (isLinkOnly(trimmed)) return { action: "silence", markRead: true };

  // ── Helpers de conta ──────────────────────────────────────────────────────
  function resolveAccount(text: string): { client: any; rawClient: any } | null {
    if (clients.length <= 1) return { client: clients[0], rawClient: clientMatchesRaw[0] };
    const idx = matchAccountFromText(clients, text);
    if (idx === null) return null;
    return { client: clients[idx], rawClient: clientMatchesRaw[idx] };
  }
  // ✅ Mesmo estilo visual do menu principal (número + emoji) — o cliente
  // digita só o dígito pra escolher a conta, igual escolhe qualquer opção
  // de menu (matchAccountFromText já aceita o número sozinho).
  const ACCOUNT_NUMBER_EMOJI = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  function askAccountMessage(): string {
    const lista = clients
      .map((c: any, i: number) => `${ACCOUNT_NUMBER_EMOJI[i + 1] || `${i + 1}.`} ${c.display_name} (${c.server_username || "n/i"}) — ${c.server_name}`)
      .join("\n");
    return `Você tem mais de uma conta — escolha uma delas digitando o número correspondente:\n\n${lista}`;
  }

  // ── Executa um nó (root ou folha), incluindo gate checks e resolução de conta ──
  async function enterNode(
    node: MenuNode,
    resolved: { client: any; rawClient: any } | null,
    attempt: 1 | 2,
    redirectDepth: number = 0
  ): Promise<BotEngineResult> {
    if (redirectDepth > MAX_REDIRECT_DEPTH) {
      await sendFlow(flow.escalate_message);
      return { action: "redirect_loop", escalate: true, markRead: false, nextState: "__clear__" };
    }

    if ((await nodeNeedsAccount(sb, node, clientProvider)) && !resolved) {
      resolved = resolveAccount(trimmed);
      if (!resolved) {
        if (attempt === 2) {
          await sendFlow(flow.escalate_message);
          return { action: "conta_desistiu", escalate: true, markRead: false, nextState: "__clear__", transferReason: node.transfer_situation_label || null };
        }
        await send(askAccountMessage());
        return { action: "pede_conta", markRead: true, nextState: `conta:${node.id}` };
      }
    }
    const client = resolved?.client || clients[0];
    const rawClient = resolved?.rawClient || clientMatchesRaw[0];

    const children = await getChildren(sb, node.id, clientProvider);

    if (children.length > 0) {
      const gate = await runGateChecks(node, client, sb, tenantId);
      if (gate) {
        for (const m of gate.messages) await sendWithLogos(m);
        return { action: "gate_resolved", markRead: gate.markRead ?? true, nextState: "geral" };
      }
      const directChild = findChildByKeyword(children, trimmed);
      if (directChild) return enterNode(directChild, null, 1, redirectDepth);

      const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient, clientProvider);
      for (const m of (await getSteps(sb, node.id, clientProvider)).map((s) => renderTemplate(s, vars))) await sendWithLogos(m);
      await send(renderChildrenMenu(children, undefined, true));
      return { action: "menu_shown", markRead: true, nextState: `menunode:${node.id}` };
    }

    const result = await executeLeaf(node, client, rawClient, sb, tenantId, flow, clientProvider);

    const redirectMatch = /^__redirect_node__:([0-9a-f-]{36})$/i.exec(result.nextState || "");
    if (redirectMatch || result.nextState === "__redirect_instalacao__") {
      for (const m of result.messages) await sendWithLogos(m);
      let target: MenuNode | null = null;
      if (redirectMatch) {
        target = await getNodeById(sb, redirectMatch[1]);
      } else {
        const { data: instalacaoRoot } = await sb.from("bot_menu_nodes").select("*").eq("tenant_id", tenantId).eq("slug", "instalacao").maybeSingle();
        target = (instalacaoRoot as MenuNode) || null;
      }
      if (target) return enterNode(target, null, 1, redirectDepth + 1);
      await sendFlow(flow.escalate_message);
      return { action: "redirect_destino_ausente", escalate: true, markRead: false, nextState: "__clear__" };
    }

    let allMsgs = result.messages;
    if ((result.nextState || "").startsWith("awaiting_resolution:")) {
      allMsgs = withResolutionQuestionIfNeeded(result.messages);
    }
    for (const m of allMsgs) await sendWithLogos(m);
    return {
      action: "leaf_executed", escalate: result.escalate, markRead: result.markRead ?? true,
      nextState: result.nextState, transferReason: result.transferReason || null,
    };
  }

  /** Aplica saída de fluxo (sucesso / escalar / fim / outro nó). */
  async function applyFlowTarget(
    rawTarget: string | null | undefined,
    fallback: "success" | "escalate",
    node: MenuNode | null,
    resolvedMsg?: string
  ): Promise<BotEngineResult> {
    const target = parseFlowTarget(rawTarget);
    const kind = target.kind === "default" ? fallback : target.kind;

    if (kind === "node" && target.kind === "node") {
      const dest = await getNodeById(sb, target.nodeId);
      if (dest) return enterNode(dest, null, 1, 0);
      await sendFlow(flow.escalate_message);
      return { action: "target_node_missing", escalate: true, markRead: false, nextState: "__clear__", transferReason: node?.transfer_situation_label || null };
    }
    if (kind === "success") {
      await sendFlow(target.kind === "default" && resolvedMsg?.trim() ? resolvedMsg.trim() : flow.success_message);
      return { action: "resolvido", markRead: true, nextState: "geral" };
    }
    if (kind === "end") {
      return { action: "flow_end", markRead: true, nextState: "geral" };
    }
    await sendFlow(flow.escalate_message);
    return { action: "nao_resolvido_escalado", escalate: true, markRead: false, nextState: "__clear__", transferReason: node?.transfer_situation_label || null };
  }

  // ✅ Pergunta antes de trocar de assunto no meio de um submenu, em vez de já
  // trocar direto. Só troca se o cliente confirmar de propósito.
  async function askConfirmSwitch(targetNode: MenuNode, originNode: MenuNode): Promise<BotEngineResult> {
    await send(`Antes de mudar de assunto: você quer saber sobre *${targetNode.label}* agora? Responda **sim** pra mudar, ou continue me contando sobre o que estávamos vendo. 😊`);
    return { action: "confirm_switch_asked", markRead: true, nextState: `confirm_switch:${targetNode.id}:${originNode.id}` };
  }

  // ── Estado: confirmação antes de trocar de assunto ───────────────────────
  const confirmSwitchMatch = /^confirm_switch:([a-f0-9-]+):([a-f0-9-]+)$/.exec(botState || "");
  if (confirmSwitchMatch) {
    const [, targetId, originId] = confirmSwitchMatch;
    if (isConfirmSwitchYes(trimmed)) {
      const target = await getNodeById(sb, targetId);
      if (target) return enterNode(target, null, 1);
    }
    const origin = await getNodeById(sb, originId);
    if (!origin) return { action: "erro_no_estado", markRead: true, nextState: "__clear__" };
    const originChildren = await getChildren(sb, origin.id, clientProvider);
    await send(renderChildrenMenu(originChildren, "Combinado, seguimos por aqui! Escolha uma das opções:", true));
    return { action: "confirm_switch_declined", markRead: true, nextState: `menunode:${origin.id}` };
  }

  // ── Estado: aguardando resolução de conta ────────────────────────────────
  const contaMatch = /^conta:([a-f0-9-]+)$/.exec(botState || "");
  if (contaMatch) {
    const node = await getNodeById(sb, contaMatch[1]);
    if (!node) return { action: "erro_no_estado", markRead: true, nextState: "__clear__" };
    return enterNode(node, null, 2);
  }

  // ── Estado: aguardando "resolveu ou não" ─────────────────────────────────
  const resolutionMatch = /^awaiting_resolution:([a-f0-9-]+)$/.exec(botState || "");
  const resolutionRetryMatch = /^awaiting_resolution_retry:([a-f0-9-]+)$/.exec(botState || "");
  if (resolutionMatch || resolutionRetryMatch) {
    const nodeId = (resolutionMatch || resolutionRetryMatch)![1];
    const alreadyObjected = !!resolutionRetryMatch;
    const node = await getNodeById(sb, nodeId);
    if (isResolutionResolved(trimmed)) {
      return applyFlowTarget(node?.on_resolved_target, "success", node, node?.closing_message || undefined);
    }
    if (isResolutionNotResolved(trimmed)) {
      safeLog(`${logPrefix} Transferência:`, node?.transfer_situation_label);
      return applyFlowTarget(node?.on_not_resolved_target, "escalate", node);
    }
    if (isConnectivityObjection(trimmed)) {
      const msg = alreadyObjected ? CONNECTIVITY_OBJECTION_INSISTENT_MSG : `${CONNECTIVITY_OBJECTION_MSG}\n\n${RESOLUTION_QUESTION}`;
      await send(msg);
      return { action: "resolution_objection", markRead: true, nextState: `awaiting_resolution_retry:${nodeId}` };
    }
    await send(RESOLUTION_QUESTION);
    return { action: "resolution_retry", markRead: true, nextState: botState };
  }

  // ── Estado: dentro de um nó com filhos (escolhendo opção) ────────────────
  const menuNodeMatch = /^menunode:([a-f0-9-]+)$/.exec(botState || "");
  const menuNodeRetryMatch = /^menunode_retry:([a-f0-9-]+)$/.exec(botState || "");
  if (menuNodeMatch || menuNodeRetryMatch) {
    const nodeId = (menuNodeMatch || menuNodeRetryMatch)![1];
    const isSecondMiss = !!menuNodeRetryMatch;
    const currentNode = await getNodeById(sb, nodeId);
    if (!currentNode) return { action: "erro_no_estado", markRead: true, nextState: "__clear__" };

    const children = await getChildren(sb, currentNode.id, clientProvider);
    const numeric = extractSingleDigitSelection(trimmed);
    const chosen = (numeric ? findChildByNumber(children, numeric) : null) || findChildByKeyword(children, trimmed);

    if (chosen) return enterNode(chosen, null, 1);

    if (!isSecondMiss) {
      const intro = renderTemplate(pickInvalidIntro(currentNode, 1, flow.menu_invalid_intro_1, flow.menu_invalid_intro_2), flowVars);
      await send(buildInvalidMenuRetry(children, intro, true));
      return { action: "menu_retry", markRead: true, nextState: `menunode_retry:${currentNode.id}` };
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
        safeLog(`${logPrefix} Erro na detecção semântica (troca de contexto):`, e?.message);
      }
    }

    const intro2 = renderTemplate(pickInvalidIntro(currentNode, 2, flow.menu_invalid_intro_1, flow.menu_invalid_intro_2), flowVars);
    await send(buildInvalidMenuRetry(children, intro2, true));
    await sendFlow(flow.escalate_message);
    return { action: "menu_retry_escalado", escalate: true, markRead: false, nextState: "__clear__", transferReason: currentNode.transfer_situation_label || null };
  }

  // ── Estado "geral" / "geral_retry" — resposta direta do RAG ──────────────
  if (botState === "geral" || botState === "geral_retry") {
    const isRetry = botState === "geral_retry";
    try {
      const embedding = await generateEmbedding(geminiKey, trimmed);
      const candidates = embedding ? await searchBotKnowledgeCandidates(sb, tenantId, embedding) : [];
      const top = await pickCompatibleKnowledgeMatch(sb, candidates, clientProvider);
      if (top) {
        const vars = buildClientTemplateVars({ clientRow: clientMatchesRaw[0], isSecondary: clients[0]?.is_secondary }) as any;
        vars.usuario_app = clients[0]?.server_username || "";
        vars.plano_nome = clients[0]?.plan_label || "";
        vars.servidor_nome = clients[0]?.server_name || "";
        vars.dns_servidor = pickRandomDns(clients[0]?.server_dns);
        Object.assign(vars, await resolveCouponPendencyVars(sb, tenantId, clients[0], top.content));
        await sendWithLogos(renderTemplate(top.content, vars));
        return { action: "rag_direct", markRead: true, nextState: "geral" };
      }
    } catch (e: any) {
      safeLog(`${logPrefix} Erro RAG:`, e?.message);
    }

    if (!isRetry) {
      await send("Não encontrei uma resposta certeira pra isso 🤔 Pode tentar explicar de outro jeito ou com mais detalhes?");
      return { action: "rag_sem_match_retry", markRead: true, nextState: "geral_retry" };
    }

    await sendFlow(flow.escalate_message);
    return { action: "rag_sem_match", escalate: true, markRead: false, nextState: "__clear__" };
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
    if (node) return enterNode(node, null, 1);
  } catch (e: any) {
    safeLog(`${logPrefix} Erro na detecção semântica de categoria:`, e?.message);
  }

  if (botState === "aguardando_resposta_2") {
    const roots = await getRootNodes(sb, tenantId, clientProvider);
    await send(buildInvalidMenuRetry(roots, renderTemplate(flow.invalid_retry_message_2, flowVars), false));
    await sendFlow(flow.escalate_message);
    return { action: "escalated_menu", escalate: true, markRead: false, nextState: "__clear__" };
  }

  if (!botState || botState === "aguardando_resposta") {
    if (!botState) {
      await sendFlow(flow.greeting_message);
      await send(await getAllRootsAsMenuText(sb, tenantId, clientProvider));
      return { action: "menu_intro", markRead: true, nextState: "aguardando_resposta" };
    }
    const roots = await getRootNodes(sb, tenantId, clientProvider);
    await send(buildInvalidMenuRetry(roots, renderTemplate(flow.invalid_retry_message_1, flowVars), false));
    return { action: "menu_retry", markRead: true, nextState: "aguardando_resposta_2" };
  }

  // fallback de segurança — nunca deveria chegar aqui
  await sendFlow(flow.escalate_message);
  return { action: "estado_desconhecido", escalate: true, markRead: false, nextState: "__clear__" };
}
