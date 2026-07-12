// app/api/whatsapp/bot/chat-admin/route.ts
// Motor genérico orientado pela árvore (bot_menu_nodes/bot_menu_steps).
// Gemini só é usado para gerar o embedding da busca no RAG — nenhuma
// geração de texto livre acontece neste arquivo.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
  isConnectivityObjection,
  CONNECTIVITY_OBJECTION_MSG,
  CONNECTIVITY_OBJECTION_INSISTENT_MSG,
  isConfirmSwitchYes,
  resolveClientProvider,
  pickCompatibleSemanticMatch,
  type ServerProvider,
} from "@/lib/whatsapp/bot-menu";
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
  // ✅ Alinhado com agent/route.ts — faltava a lista de apps pagos aqui, o
  // simulador nunca mostrava essa parte da recomendação (divergia da produção).
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
async function executeLeaf(node: MenuNode, client: any, rawClient: any, sb: any, tenantId: string): Promise<{ messages: string[]; escalate?: boolean; markRead?: boolean; nextState: string; transferReason?: string | null }> {
  const actions = node.special_actions || [];

  // Escalonamento direto — manda os passos cadastrados e transfere.
  if (actions.includes("escalar_imediatamente") || actions.includes("coletar_relato_e_escalar")) {
    const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
    const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
    // ✅ Repassa transfer_situation_label — mesma correção do agent/route.ts.
    return { messages: steps.length ? steps : [HUMAN_REQUESTED_MSG], escalate: true, markRead: false, nextState: "__clear__", transferReason: node.transfer_situation_label || null };
  }

  // Redireciona pro fluxo de instalação
  if (actions.includes("redirecionar_instalacao")) {
    const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
    const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
    return { messages: steps, escalate: false, nextState: "__redirect_instalacao__" };
  }

  // App não abre — decide dinamicamente com Cloudflare real
  if (actions.includes("verificar_cloudflare")) {
    const cf = await toolVerificarCloudflare();
    const msg = cf.operacional
      ? "Verifiquei aqui e não identificamos instabilidade externa no momento. Vamos tentar: desligue o modem da tomada por 5 minutos e reabra o aplicativo. Se persistir, me avisa!"
      : "Identificamos que a instabilidade vem de um serviço externo chamado Cloudflare, que faz a ponte entre você e nosso servidor. O time deles já está atuando para corrigir. A normalização deve ocorrer em breve. Obrigado pela paciência! 💙";
    return { messages: [msg], nextState: node.closing_message ? `awaiting_resolution:${node.id}` : "geral" };
  }

  // Sem sinal/vencimento — decide dinamicamente se está vencido
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

  // Texto livre → RAG (a próxima mensagem cai no fallback de "geral")
  if (actions.includes("free_text_rag")) {
    const steps = await getSteps(sb, node.id);
    return { messages: steps.length ? steps : ["Pode me contar com detalhes o que está acontecendo? 😊"], nextState: "geral" };
  }

  // Caso padrão — só renderiza os passos com variáveis
  const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
  const steps = (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars));
  return {
    messages: steps.length ? steps : ["(nenhuma resposta cadastrada — avise o Márcio)"],
    nextState: node.closing_message ? `awaiting_resolution:${node.id}` : "geral",
  };
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
      .select(`id, display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username, server_username, server_password, vencimento, screens, plan_label, plan_table_id, price_amount, price_currency, technology, server_id, servers (name, dns, is_offline)`)
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
          is_secondary: isSec,
        };
      });
    }
  }
  if (!clients.length) {
    clients = [{ id: null, display_name: "Cliente Teste", server_name: "Servidor Teste", plan_label: "Mensal", screens: 1, vencimento: null, price_currency: "BRL", price_amount: 0, plan_table_id: null, server_id: null, whatsapp_username: null, server_is_offline: false }];
    clientMatchesRaw = [clients[0]];
  }
  const firstName = clients[0].display_name.split(" ")[0];

  // ✅ Provider do servidor do cliente — mesma correção do agent/route.ts,
  // usado pra filtrar conteúdo restrito a um servidor específico.
  const clientProvider: ServerProvider | null = await resolveClientProvider(sb, clients[0]?.server_id || null);

  const history: any[] = []; // reservado (não usamos mais Gemini conversacional aqui)
  const sentMessages: string[] = [];
  function send(text: string) { sentMessages.push(text); }

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
    send(HUMAN_REQUESTED_MSG);
    return finish({ action: "escalated", escalate: true, mark_read: false, next_state: "__clear__" });
  }

  // ── Voltar ao menu principal — atalho reservado, mesma prioridade máxima
  // do escalonamento. Funciona em qualquer estado.
  if (isBackToMenuTrigger(trimmed)) {
    send(`Voltando ao menu principal! 😊\n\n${await getAllRootsAsMenuText(sb, tenantId, clientProvider)}`);
    return finish({ action: "back_to_menu", mark_read: true, next_state: "aguardando_resposta" });
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
  async function enterNode(node: MenuNode, resolved: { client: any; rawClient: any } | null, attempt: 1 | 2): Promise<any> {
    if (nodeNeedsAccount(node) && !resolved) {
      resolved = resolveAccount(trimmed);
      if (!resolved) {
        if (attempt === 2) {
          send(BOT_GAVE_UP_MSG);
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
      // ✅ Mesma correção do agent/route.ts: se a mensagem já é específica o
      // suficiente pra bater com um filho direto, pula o submenu e entra
      // direto nele — os gate checks da raiz já rodaram normalmente acima.
      const directChild = findChildByKeyword(children, trimmed);
      if (directChild) return enterNode(directChild, null, 1);

      const vars = await buildVarsForNode(sb, tenantId, node, client, rawClient);
      (await getSteps(sb, node.id)).map((s) => renderTemplate(s, vars)).forEach(send);
      send(renderChildrenMenu(children, undefined, true));
      return finish({ action: "menu_shown", mark_read: true, next_state: `menunode:${node.id}` });
    }

    const result = await executeLeaf(node, client, rawClient, sb, tenantId);

    if (result.nextState === "__redirect_instalacao__") {
      const { data: instalacaoRoot } = await sb.from("bot_menu_nodes").select("*").eq("tenant_id", tenantId).eq("slug", "instalacao").maybeSingle();
      result.messages.forEach(send);
      if (instalacaoRoot) return enterNode(instalacaoRoot as MenuNode, null, 1);
      send(BOT_GAVE_UP_MSG);
      return finish({ action: "instalacao_nao_encontrada", escalate: true, mark_read: false, next_state: "__clear__" });
    }

    result.messages.forEach(send);
    return finish({ action: "leaf_executed", escalate: result.escalate, mark_read: result.markRead ?? true, next_state: result.nextState, transfer_reason: result.transferReason || null });
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
      send(node?.closing_message || "Que bom! Fico feliz que resolveu 😊");
      return finish({ action: "resolvido", mark_read: true, next_state: "geral" });
    }
    if (isResolutionNotResolved(trimmed)) {
      safeLog("[BOT][chat-admin] Transferência:", node?.transfer_situation_label);
      send(BOT_GAVE_UP_MSG);
      return finish({ action: "nao_resolvido_escalado", escalate: true, mark_read: false, next_state: "__clear__", transfer_reason: node?.transfer_situation_label || null });
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
      send(renderChildrenMenu(children, "Não entendi — pode escolher uma das opções abaixo, por favor? 😊", true));
      return finish({ action: "menu_retry", mark_read: true, next_state: `menunode_retry:${currentNode.id}` });
    }

    // ✅ 2ª tentativa seguida sem bater número/keyword — agora sim tenta
    // detectar troca de assunto de verdade, antes de desistir e escalonar.
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

    send(BOT_GAVE_UP_MSG);
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

    send(BOT_GAVE_UP_MSG);
    return finish({ action: "rag_sem_match", escalate: true, mark_read: false, next_state: "__clear__" });
  }

  // ── Primeira mensagem / paciência de 2 tentativas ────────────────────────
  // ✅ Seleção por número no menu raiz — mesma correção do agent/route.ts.
  if (extractSingleDigitSelection(trimmed) !== null) {
    const roots = await getRootNodes(sb, tenantId, clientProvider);
    const chosenRoot = findRootByNumber(roots, trimmed);
    if (chosenRoot) return enterNode(chosenRoot, null, 1);
  }

  const detected = await detectMenuContextFromTree(sb, tenantId, trimmed, clientProvider);
  if (detected) return enterNode(detected, null, 1);

  // ✅ Fallback semântico — mesma correção do agent/route.ts. Nenhuma
  // palavra-chave bateu, tenta por significado (embedding) antes de
  // desistir/mostrar o menu genérico.
  // ⚠️ Piso de tamanho: saudações/small talk não carregam sinal suficiente
  // pra comparar — nem tenta, evita gastar Gemini à toa e falso positivo.
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
    send(BOT_GAVE_UP_MSG);
    return finish({ action: "escalated_menu", escalate: true, mark_read: false, next_state: "__clear__" });
  }

  if (!bot_state || bot_state === "aguardando_resposta") {
    if (!bot_state) {
      send("Olá! 😊 Sou o assistente do Márcio. Me diga, como posso te ajudar?");
      send(await getAllRootsAsMenuText(sb, tenantId, clientProvider));
      return finish({ action: "menu_intro", mark_read: true, next_state: "aguardando_resposta" });
    }
    // ✅ Reforça a seleção por número (em vez de convidar texto livre, que
    // dispararia o fallback semântico à toa) e mostra o menu de novo, caso
    // o cliente tenha perdido a lista original.
    send(`Sem pressa! 😊 ${await getAllRootsAsMenuText(sb, tenantId, clientProvider)}`);
    return finish({ action: "menu_retry", mark_read: true, next_state: "aguardando_resposta_2" });
  }

  // fallback de segurança — nunca deveria chegar aqui
  send(BOT_GAVE_UP_MSG);
  return finish({ action: "estado_desconhecido", escalate: true, mark_read: false, next_state: "__clear__" });
}