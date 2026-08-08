// lib/whatsapp/bot-menu.ts
// ─────────────────────────────────────────────────────────────────────────────
// Fonte única da lógica de menu/estado/escalonamento — compartilhada entre
// o agent (produção, texto fixo antigo) e o chat-admin (motor de árvore,
// lendo bot_menu_nodes/bot_menu_steps do banco). Edite APENAS aqui.
// ─────────────────────────────────────────────────────────────────────────────

// ── Mensagens de encerramento — UMA fonte para cada caso, nunca divergir ──────

export const HUMAN_REQUESTED_MSG =
  "Combinado! Vou deixar sua conversa marcada aqui e o Márcio te atende assim que possível. 🙏";

export const BOT_GAVE_UP_MSG =
  "Poxa, que pena não ter conseguido ajudar! 😔 Mas fique tranquilo, o Márcio dará sequência a partir daqui.";

export const PORTAL_HANDOFF_MSG =
  "Entendido, {primeiro_nome}! Como você já veio transferido pelo Portal do Cliente, peço que aguarde um momento — o Márcio vai continuar seu atendimento em instantes. 🙏";

// ── Transferência vinda do Portal do Cliente (botão "Fale com o suporte" do
// Bloco 3 — app/renew-beta/RenewBetaClient.tsx) ────────────────────────────────
// Prioridade MAIOR que isEscalationTrigger: a mensagem já avisa que o
// cliente veio do portal sem achar o app ou com dúvida — rodar o fluxo
// normal do bot mandaria ele de volta pro mesmo portal que ele acabou de
// sair, o que não faz sentido nenhum. Marcador ("Vim do Portal do Cliente")
// é fixo no texto padrão do link wa.me, então basta bater a frase.
export function isPortalHandoffTrigger(text: string): boolean {
  return /\bvim do portal( do cliente)?\b/i.test(text);
}

// ── Escalonamento explícito por texto do cliente ──────────────────────────────

// ✅ Linha-a-linha, não a string inteira: quando o debounce agrupa várias
// mensagens do cliente numa só (separadas por "\n" — ver callBotAgentBatch
// no sessionManager.js e o buffer do chat-admin), um "0" digitado sozinho
// seguido de outra frase ("0\nquero falar com alguém") deixava de bater com
// esse gatilho, porque o match antigo exigia a string INTEIRA ser "0". Isso
// silenciava o pedido de humano bem na hora que ele mais importa. A frase
// livre (2º ramo) já funcionava embutida em qualquer lugar do texto — só o
// comando "solto" precisava virar checagem por linha.
export function isEscalationTrigger(text: string): boolean {
  if (/\b(falar com (o )?márcio|falar com (uma )?pessoa|atendente humano|quero (um )?humano|preciso de (uma )?pessoa)\b/i.test(text)) {
    return true;
  }
  return text.split("\n").some((line) => /^(pessoal|márcio|marcio|humano|0)$/i.test(line.trim()));
}

// ── Confirmação simples / link puro ───────────────────────────────────────────

// ── Voltar ao menu principal — atalho reservado, mesmo padrão do "0" ─────────
// Funciona em QUALQUER estado (dentro de submenu, aguardando conta,
// aguardando resolução, ou até na conversa livre) — sempre reseta o cliente
// pro menu raiz. Checado logo depois de isEscalationTrigger, também com
// prioridade máxima.
// ✅ Mesma checagem por linha do isEscalationTrigger, e pelo mesmo motivo —
// "9\nquero ver outra coisa" precisa continuar reconhecendo o "9" mesmo
// combinado com outra mensagem pelo debounce.
export function isBackToMenuTrigger(text: string): boolean {
  return text.split("\n").some((line) => /^(9|menu|menu principal|voltar|voltar ao menu|voltar pro menu)$/i.test(line.trim()));
}

// Vocabulário de confirmação/despedida curta, usado tanto no match exato
// (palavra sozinha) quanto por-parte (ver isSimpleConfirmation abaixo).
const ACK_WORD_RE = /^(ok|okay|oks|blz|beleza|certo|entendi|entendido|perfeito|t[áa]|t[áa]\s*bom|est[áa]\s*bem|tudo\s*bem|tudo\s*certo|obrigad[oa]|muito\s*obrigad[oa]|vlw|valeu|at[ée]|[óo]timo|show|legal|massa|foi|feito|deu\s*certo|combinado|fechado|qualquer\s*coisa)$/i;
const EMOJI_ONLY_RE = /^[👍👌✅😊🙏👏🤝😀😄🙂❤️🥰]+$/u;

export function isSimpleConfirmation(text: string): boolean {
  const t = text.trim();
  if (EMOJI_ONLY_RE.test(t) || ACK_WORD_RE.test(t)) return true;

  // ✅ Agradecimento/despedida de verdade, mas com "recheio" em volta (nome,
  // "meu amigo", emoji) em vez de só a palavra sozinha — casos reais vistos:
  // "Vlw meu amigo, super obrigado", "Muito obrigado pela atenção, meu
  // amigo 🤝🤝", "Qualquer coisa estou por aqui". Sem isso o bot tratava
  // como pergunta nova e reabria o menu pra um simples "obrigado".
  // Blindagem: nem todo mundo digita "?" numa pergunta real ("Obrigado por
  // avisar, mas quero saber quando volta") — por isso, além do limite de
  // tamanho e da ausência de "?", a frase não pode ter nenhuma palavra de
  // continuação/pedido (mas, ainda, quero, quando, pode...), senão é
  // tratada como pergunta de verdade, não como despedida.
  const hasContinuationWord = /\b(mas|por[ée]m|só que|ainda|quero|queria|preciso|precisava|gostaria|pode|poderia|consegue|quando|como|cad[eê]|por\s*que|pra\s*que|onde)\b/i.test(t);
  if (t.includes("?") || hasContinuationWord) return false;

  if (t.length <= 60) {
    if (/^(vlw|valeu|obrigad[oa]|muito\s+obrigad[oa])\b/i.test(t)) return true;
    if (/^qualquer\s+coisa\b/i.test(t)) return true;
  }

  // ✅ Saudação/nome + despedida curta combinados — nenhuma parte sozinha bate
  // nos padrões acima, mas juntas são só cordialidade. Casos reais: "Está bem
  // Marcio", "Boa tarde Marcio! Feito 🙏", "oi márcio, boa noite! obrigada
  // por avisar 😊" (resposta a mensagens automáticas de cobrança/pós-venda).
  if (t.length <= 80) {
    const withoutName = t.replace(/\bm[aá]rcio\b/gi, " ");
    const parts = withoutName
      .split(/[,;.!?]+/)
      .map((p) => p.replace(/[\p{Extended_Pictographic}]/gu, "").trim())
      .filter(Boolean);
    if (
      parts.length &&
      parts.every(
        (p) => GREETING_WORD_RE.test(p) || ACK_WORD_RE.test(p) || /^(vlw|valeu|obrigad[oa]|muito\s+obrigad[oa])\b/i.test(p)
      )
    ) {
      return true;
    }
  }

  return false;
}

export function isLinkOnly(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim());
}

// ── Item 5: classificação de mensagens automáticas recentes ──────────────────

export type RecentJobKind =
  | "payment_confirmation"
  | "vencimento"
  | "pos_venda_satisfacao"
  | "pos_venda_fidelidade"
  | "pos_venda_generico"
  | "none";

export function classifyRecentJob(
  job: any,
  templateInfo: { name?: string; category?: string } | null
): RecentJobKind {
  if (!job) return "none";
  const templateName = String(templateInfo?.name || "");
  const automationType = job.billing_automations?.type || null;
  const automationName = String(job.billing_automations?.name || "");

  if (!job.automation_id && templateName === "Pagamento Realizado") return "payment_confirmation";
  if (automationType === "Vencimento") return "vencimento";
  if (automationType === "Pós-Venda") {
    if (/pesquisa de satisfa/i.test(automationName)) return "pos_venda_satisfacao";
    if (/fidelidade/i.test(automationName)) return "pos_venda_fidelidade";
    return "pos_venda_generico";
  }
  return "none";
}

// ── Checagem de pagamento recente — reaproveitável em qualquer fluxo de texto ─

export type PortalPaymentStatus =
  | "auto_confirmed"
  | "manual_pending"
  | "fulfillment_error"
  | "confirmed_not_notified"
  | "awaiting_transfer"
  | "none";

export async function checkRecentPortalPayment(
  sb: any,
  tenantId: string,
  clientIds: (string | null)[]
): Promise<PortalPaymentStatus> {
  const ids = clientIds.filter(Boolean);
  if (!ids.length) return "none";

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("client_portal_payments")
    .select("id, fulfillment_status, whatsapp_status")
    .eq("tenant_id", tenantId)
    .in("client_id", ids)
    .gte("created_at", sixHoursAgo)
    .order("created_at", { ascending: false })
    .limit(1);

  const payment = data?.[0];
  if (!payment) return "none";
  if (payment.whatsapp_status === "sent") return "auto_confirmed";
  if (payment.fulfillment_status === "manual_pending") return "manual_pending";
  if (payment.fulfillment_status === "error") return "fulfillment_error";
  // ✅ Achado 08/08/2026: fulfillment_status="done" mas whatsapp_status !=
  // "sent" (null, "error", ou o retry de +2min do "Plano B" que nunca
  // atualiza esse campo de volta pra "sent") — a renovação JÁ FOI aplicada
  // com sucesso, só a notificação automática que falhou/não confirmou.
  // Sem esse branch, caía em "none" e o bot pedia comprovante de algo que
  // já estava 100% concluído.
  // ✅ Achado na auditoria com dados reais (08/08/2026): "manual_done" é o
  // mesmo desfecho de "done" (renovação 100% concluída), só que passou pela
  // ativação manual de servidor Elite em vez do automático — sem incluir
  // aqui, um pagamento Elite com WhatsApp não confirmado caía errado em
  // "none" (pedia comprovante de algo já pago e liberado).
  if (payment.fulfillment_status === "done" || payment.fulfillment_status === "manual_done") return "confirmed_not_notified";
  // ✅ Achado 08/08/2026: cliente escolheu pagamento manual (PIX/transferência
  // manual) no Portal e ainda não mandou comprovante — intenção registrada,
  // mas MUITO diferente de "none" (nenhum registro de nada). Antes caía no
  // mesmo balaio de "não achei nada".
  if (payment.fulfillment_status === "awaiting_transfer") return "awaiting_transfer";
  return "none";
}

// ✅ Promovidos a template editável em bot_flow_settings (payment_*_message)
// — estes aqui viraram só os DEFAULTS (mesmo padrão de BOT_GAVE_UP_MSG etc
// acima). {primeiro_nome} e {data_vencimento} são substituídos na mão em
// toolCheckRenovacaoRecente (bot-engine.ts), não passam pelo renderTemplate
// genérico da árvore. {data_vencimento} vira " Seu acesso está confirmado
// até {data}." quando há data, ou "" quando não há — nunca digite o texto
// fixo dessa frase direto, use sempre a tag.
export const DEFAULT_PAYMENT_AUTO_CONFIRMED_MSG =
  "Tudo certo, {primeiro_nome}! 😊 Sua renovação já foi processada automaticamente pelo portal e a confirmação já foi enviada.{data_vencimento} Não precisa mandar comprovante — já está tudo certo! ✅";

// ✅ Achado 08/08/2026: manual_pending (servidor sem integração automática)
// e fulfillment_error (renovação automática que quebrou) são tecnicamente
// diferentes, mas pro CLIENTE contam a mesma história — "pagamento
// confirmado, algo do nosso lado precisa ser concluído na mão, já sei
// disso" — por isso os 2 defaults têm o mesmo texto (decisão do Márcio:
// as notificações de sino/e-mail pra ele já existem nos dois casos hoje).
const PAYMENT_NEEDS_MANUAL_COMPLETION_MSG =
  "Encontrei seu pagamento aqui, {primeiro_nome} — está confirmado! ✅ Isso já caiu automaticamente pra mim (recebo aviso por e-mail e no sino do painel) e vou concluir sua renovação o quanto antes.";

export const DEFAULT_PAYMENT_MANUAL_PENDING_MSG = PAYMENT_NEEDS_MANUAL_COMPLETION_MSG;

export const DEFAULT_PAYMENT_FULFILLMENT_ERROR_MSG = PAYMENT_NEEDS_MANUAL_COMPLETION_MSG;

// ✅ awaiting_transfer — cliente JÁ escolheu pagamento manual (PIX/transferência)
// no Portal e ainda não mandou comprovante. Achado 08/08/2026 (correção do
// Márcio): PIX automático no Brasil não tem esse problema — quem cai aqui em
// BRL foi por escolha mesmo, sem motivo pra "dica". Já em USD/EUR, a causa
// mais comum é cartão Revolut sendo recusado pelo Stripe — nesse caso vale
// sugerir Google Pay/Apple Pay ou outro cartão. Por isso {metodo_automatico}
// agora é a CLÁUSULA INTEIRA (com pontuação), condicional por moeda: "" pra
// BRL, dica de cartão/wallet pra USD/EUR. Sem {link_pagamento} — o cliente já
// tem o link, acabou de usá-lo pra escolher esse método.
export const DEFAULT_PAYMENT_AWAITING_TRANSFER_MSG =
  "Encontrei seu pedido de pagamento manual aqui, {primeiro_nome}! 📋 Pode me mandar o comprovante da transferência por aqui — assim o Márcio já valida e conclui sua renovação.{metodo_automatico}";

// ── Servidor do cliente (NaTV / Fast / Elite) — usado pra filtrar conteúdo
// específico de servidor, tanto na árvore quanto na base de conhecimento. ──

export type ServerProvider = "NATV" | "FAST" | "ELITE";
const VALID_PROVIDERS: ServerProvider[] = ["NATV", "FAST", "ELITE"];

// Resolve o provider real do servidor de uma conta (mesmo caminho já usado
// em toolConsultarPrecosTexto: servers.panel_integration -> server_integrations.provider).
// Centralizado aqui pra não duplicar em agent/route.ts e chat-admin/route.ts.
export async function resolveClientProvider(sb: any, serverId: string | null | undefined): Promise<ServerProvider | null> {
  if (!serverId) return null;
  try {
    const { data: srv } = await sb.from("servers").select("panel_integration").eq("id", serverId).maybeSingle();
    if (!srv?.panel_integration) return null;
    const { data: integ } = await sb.from("server_integrations").select("provider").eq("id", srv.panel_integration).maybeSingle();
    const p = String(integ?.provider || "").toUpperCase();
    return (VALID_PROVIDERS as string[]).includes(p) ? (p as ServerProvider) : null;
  } catch {
    return null;
  }
}

// ✅ Regra pensada pra bater com o que se espera olhando os checkboxes na
// tela: "marcado = funciona pra esse servidor". Pra funcionar em todos, TODOS
// os servidores precisam estar marcados (nesse caso salvamos NULL, que
// representa "nunca restringido" = universal). Uma lista VAZIA não é a mesma
// coisa que null — é o cliente ter desmarcado todos de propósito, o que
// significa "não funciona pra nenhum servidor" (não aparece pra ninguém).
// Se o item É restrito mas não sabemos o provider do cliente, escondemos por
// segurança — melhor mostrar menos do que arriscar mostrar instrução errada.
export function appliesToProvider(applies_to_servers: string[] | null | undefined, provider: ServerProvider | null): boolean {
  if (applies_to_servers === null || applies_to_servers === undefined) return true; // nunca restringido = universal
  if (!provider) return false;
  return applies_to_servers.includes(provider);
}

// ✅ Normaliza o que vem do formulário (checkboxes marcados) pro formato de
// armazenamento: todos os 3 servidores marcados = null (universal, forma
// mais limpa de guardar "sem restrição"). Qualquer outra combinação —
// incluindo lista vazia (nada marcado) — é guardada exatamente como veio.
export function normalizeAppliesToServers(checked: unknown): string[] | null {
  if (!Array.isArray(checked)) return null;
  const valid = checked.filter((v): v is ServerProvider => (VALID_PROVIDERS as string[]).includes(v));
  return valid.length >= VALID_PROVIDERS.length ? null : valid;
}

// ── Motor genérico da árvore de menu (dados no banco, editável pelo painel) ──

export type MenuNode = {
  id: string;
  parent_id: string | null;
  slug: string | null;
  option_number: number;
  label: string;
  keywords: string[];
  special_actions: string[];
  closing_message: string | null;
  transfer_situation_label: string | null;
  applies_to_servers?: string[] | null;
  is_active?: boolean;
  /**
   * Nós criados só como destino de "continuar/resolveu/não" — ficam na árvore
   * pro layout/canvas, mas NÃO aparecem como opção de menu pro cliente.
   */
  // (flag em special_actions: "link_target_only")
  /** Após executar a folha, entra neste nó (várias folhas podem apontar pro mesmo). */
  redirect_to_node_id?: string | null;
  /** __success__ | __escalate__ | __end__ | uuid | null */
  on_resolved_target?: string | null;
  on_not_resolved_target?: string | null;
  /** true/false força; null = auto se closing/targets. */
  ask_resolution?: boolean | null;
  /** Override local da 1ª resposta inválida neste menu (pai com filhos). */
  invalid_retry_message_1?: string | null;
  invalid_retry_message_2?: string | null;
};

export async function getNodeById(sb: any, tenantId: string, nodeId: string): Promise<MenuNode | null> {
  const { data } = await sb.from("bot_menu_nodes").select("*").eq("id", nodeId).eq("tenant_id", tenantId).maybeSingle();
  return data || null;
}

// ✅ "provider": quando informado (mesmo que null), filtra fora os nós
// restritos a outro servidor — permite ter DUAS variantes com o MESMO
// option_number (uma por servidor), já que só uma sobrevive ao filtro pra
// cada cliente. Quando omitido (undefined — usado pelo editor visual, que
// não tem "cliente" nenhum), retorna tudo, sem filtrar.
/** Destinos de fluxo (continuar/ok/fail) — não listar como opção no WhatsApp */
export function isLinkTargetOnly(node: { special_actions?: string[] | null }): boolean {
  return (node.special_actions || []).includes("link_target_only");
}

export async function getChildren(sb: any, parentId: string, provider?: ServerProvider | null): Promise<MenuNode[]> {
  const { data } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("parent_id", parentId).eq("is_active", true)
    .order("option_number", { ascending: true });
  const all: MenuNode[] = (data || []).filter((n: MenuNode) => !isLinkTargetOnly(n));
  if (provider === undefined) return all;
  return all.filter((n) => appliesToProvider(n.applies_to_servers, provider));
}

// ✅ "provider": nó pode ter uma única mensagem universal (server = null em
// todas as linhas) OU variantes por servidor. Com variantes, prioriza a do
// provider do cliente (se ativa); sem provider conhecido, ou sem variante
// ativa pra ele, cai pras linhas universais (server IS NULL) — mesma
// filosofia de "esconde/some quando não sabe o servidor" de appliesToProvider.
export async function getSteps(sb: any, nodeId: string, provider?: ServerProvider | null): Promise<string[]> {
  const { data } = await sb
    .from("bot_menu_steps")
    .select("message_text, server, is_active")
    .eq("node_id", nodeId)
    .order("step_order", { ascending: true });
  const rows: any[] = data || [];
  if (!rows.length) return [];

  const hasVariants = rows.some((r) => r.server);
  if (!hasVariants) return rows.map((r) => r.message_text);

  if (provider) {
    const forProvider = rows.filter((r) => r.server === provider && r.is_active !== false);
    if (forProvider.length) return forProvider.map((r) => r.message_text);
  }
  return rows.filter((r) => r.server === null).map((r) => r.message_text);
}

// ✅ "intro" é configurável: "Entendido! Me conta mais:" só faz sentido quando
// o cliente JÁ disse algo que bateu com uma categoria (ex: "problema técnico")
// e o bot está confirmando entendimento antes de aprofundar. No primeiro
// contato (getAllRootsAsMenuText) nada foi dito ainda — usar essa mesma frase
// lá soava como o bot "entendendo" uma saudação qualquer, sem sentido nenhum.
// ✅ "showBackHint" acrescenta a linha "9️⃣ Voltar ao menu principal" — só
// faz sentido dentro de um SUBMENU de verdade (não na listagem raiz, onde
// seria redundante já estar ali). "9" já funciona como atalho global
// (isBackToMenuTrigger) mesmo sem essa linha; ela é só a dica visual.
export function renderChildrenMenu(children: MenuNode[], intro: string = "Entendido! Me conta mais:", showBackHint: boolean = false): string {
  const NUMBER_EMOJI = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  // ✅ "0" é o atalho reservado (ex: Assuntos Pessoais / falar com humano) —
  // sempre exibido por último na lista, mesmo sendo o menor número.
  const ordered = [...children].sort((a, b) => {
    if (a.option_number === 0) return 1;
    if (b.option_number === 0) return -1;
    return a.option_number - b.option_number;
  });
  const lines = ordered.map((c) => `${NUMBER_EMOJI[c.option_number] || c.option_number} ${c.label}`);
  if (showBackHint) lines.push("9️⃣ Voltar ao menu principal");
  return `${intro}\n` + lines.join("\n");
}

export function findChildByNumber(children: MenuNode[], num: number): MenuNode | null {
  return children.find((c) => c.option_number === num) || null;
}

// ✅ Extrai uma seleção numérica (1-9) de dentro do texto — olhando linha
// por linha, não a string inteira. Sem isso, um lote combinado pelo
// debounce (ex: "6\nminha tv não liga", duas mensagens do cliente viradas
// uma só) nunca reconhecia o "6", porque o match antigo exigia que o texto
// INTEIRO fosse só o dígito. Pega a primeira linha "solta" que seja
// exatamente um número — a mesma lógica vale tanto pro menu raiz
// (findRootByNumber) quanto pra seleção dentro de um submenu.
export function extractSingleDigitSelection(text: string): number | null {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^[1-9]$/.test(t)) return Number(t);
  }
  return null;
}

export function findChildByKeyword(children: MenuNode[], text: string): MenuNode | null {
  const t = text.toLowerCase();
  return children.find((c) => (c.keywords || []).some((k) => t.includes(k.toLowerCase()))) || null;
}

// ✅ Uma saudação pura (ex: "Oi Marcio, tudo bem?\nbom dia!") não é sinal de
// NENHUMA categoria — mas o matching de keyword é um `.includes()` cru, sem
// threshold nem contexto algum. Se algum nó tiver "márcio"/"marcio" (ou
// qualquer outra palavra comum) cadastrado como keyword — o que é natural
// de acontecer, já que o bot se apresenta como "assistente do Márcio" e as
// pessoas naturalmente o cumprimentam pelo nome — uma saudação inofensiva
// dispara esse nó na hora, sem nem mostrar o menu principal primeiro. Essa
// checagem tira "márcio"/"marcio" da equação antes de comparar com o
// vocabulário de saudação, então cumprimentar pelo nome continua sendo só
// educação — quem realmente quer falar com ele usa uma frase de pedido
// ("falar com o márcio"), já coberta com prioridade máxima por
// isEscalationTrigger, chamada bem antes de qualquer coisa da árvore.
const GREETING_WORD_RE = /^(oi+|ol[aá]|opa|eae|e\s*a[ií]|salve|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|tudo\s*certo|td\s*bem|como\s*vai|como\s*(voc[eê]|c[eê])\s*(est[aá]|t[aá])|blz|beleza|obrigad[oa]|vlw|valeu)$/i;

export function isGreetingOnly(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  return lines.every((line) => {
    const withoutName = line.replace(/\bm[aá]rcio\b/gi, " ");
    const parts = withoutName.split(/[,;.!?]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return true; // linha era só o nome e/ou pontuação
    return parts.every((p) => GREETING_WORD_RE.test(p));
  });
}

// ✅ Piso comum antes de gastar Gemini com busca semântica: mensagens curtas
// (menos de 4 palavras) ou saudações puras não carregam sinal suficiente
// pra comparar com nada — evita tanto custo à toa quanto falso positivo.
// Centralizado aqui porque é usado em 4 lugares (detecção de categoria raiz
// e troca de contexto dentro de submenu, nos dois arquivos de rota).
export function hasSemanticSignal(text: string): boolean {
  if (isGreetingOnly(text)) return false;
  return text.split(/\s+/).filter(Boolean).length >= 4;
}

export const RESOLUTION_QUESTION =
  "Vou deixar as opções aqui: responda **1** se resolveu, ou **2** se ainda está com o problema.";

/** Evita mandar a pergunta 1/2 se os passos do nó já pediram a mesma coisa. */
export function stepsAlreadyAskResolution(messages: string[]): boolean {
  const joined = (messages || []).join("\n");
  if (!joined.trim()) return false;
  // Heurística conservadora: só suprime se o texto já menciona 1 e 2 no
  // contexto de "resolveu" / "responda" / opção numérica de resolução.
  if (/\b(responda|digite|escolha)\b[\s\S]{0,40}\b1\b[\s\S]{0,40}\b2\b/i.test(joined)) return true;
  if (/\b1\b[\s\S]{0,30}\b(resolveu|resolvido)\b[\s\S]{0,40}\b2\b/i.test(joined)) return true;
  if (/\b(resolveu|resolvido)\b[\s\S]{0,40}\b1\b[\s\S]{0,40}\b2\b/i.test(joined)) return true;
  return false;
}

/** Anexa RESOLUTION_QUESTION só se ainda não estiver nos passos. */
export function withResolutionQuestionIfNeeded(messages: string[]): string[] {
  if (stepsAlreadyAskResolution(messages)) return messages;
  return [...messages, RESOLUTION_QUESTION];
}

// ── Confirmação sim/não — usada antes de trocar de assunto no meio de um
// submenu (troca de contexto por palavra-chave ou por significado). Só troca
// se o cliente confirmar de propósito — qualquer coisa diferente de "sim"
// (inclusive "não" ou uma resposta pouco clara) mantém ele onde estava, por
// segurança: é melhor perguntar de novo do que arrancar o cliente do
// assunto certo por causa de uma interpretação errada.
// ✅ As três a seguir eram RegExp exportadas testadas direto contra o texto
// inteiro (`REGEX.test(trimmed)`) — quebravam do mesmo jeito que os
// triggers acima quando o cliente respondia "sim" (ou "1"/"2") e emendava
// outra mensagem logo em seguida, agrupada pelo debounce. Viraram funções
// que checam linha por linha, mesma lógica de isEscalationTrigger.
const CONFIRM_SWITCH_YES_RE = /^(1|sim|s|isso|isso mesmo|exato|correto|quero|pode ser|é isso|é sim)$/i;
export function isConfirmSwitchYes(text: string): boolean {
  return text.split("\n").some((line) => CONFIRM_SWITCH_YES_RE.test(line.trim()));
}

// ✅ Achado testando o fluxo: "resolveu, obrigado!" não batia (só o exato
// "resolveu" batia), então o bot ignorava a confirmação e repetia a
// pergunta 1/2 — sensação de "não escutou", justamente o que o Márcio não
// quer. Aceita agora um agradecimento/emoji SOLTO grudado no final (sem
// "mas"/continuação, que continua sinalizando problema real e cai fora
// deste match) — mesmo espírito de isSimpleConfirmation, escopo restrito
// de propósito pra não confundir com objeção.
const TRAILING_PLEASANTRY = "[\\s,!.]*([ ]*obrigad[oa]|[ ]*valeu|[ ]*vlw|[ ]*😊|[ ]*🙏|[ ]*👍)?[\\s,!.]*$";
const RESOLUTION_RESOLVED_RE = new RegExp(`^(1|sim|resolveu|resolvido|deu certo|funcionou)${TRAILING_PLEASANTRY}`, "i");
export function isResolutionResolved(text: string): boolean {
  return text.split("\n").some((line) => RESOLUTION_RESOLVED_RE.test(line.trim()));
}

const RESOLUTION_NOT_RESOLVED_RE = new RegExp(`^(2|não|nao|não resolveu|nao resolveu|continua|ainda não|ainda nao)${TRAILING_PLEASANTRY}`, "i");
export function isResolutionNotResolved(text: string): boolean {
  return text.split("\n").some((line) => RESOLUTION_NOT_RESOLVED_RE.test(line.trim()));
}

// ✅ Objeção mais comum (na prática, ~99% dos casos) quando o cliente é
// perguntado "resolveu ou não" depois de um reset: "mas minha internet está
// boa" ou "mas o Netflix/YouTube funciona normal". Sem tratamento
// específico, isso caía no "não entendi, responda 1 ou 2" — repetindo a
// pergunta sem nunca explicar POR QUE o reset ainda é o caminho certo
// mesmo com a internet "boa" (cache preso no modem/TV) e por que comparar
// com Netflix/YouTube não vale (eles se adaptam à conexão automaticamente;
// IPTV precisa de conexão 100% estável o tempo todo — não é a mesma coisa).
const CONNECTIVITY_OBJECTION_RE =
  /\b(minha\s+)?(internet|wi-?fi|wifi|conex[aã]o|net)\b[^.!?\n]{0,25}\b(boa|est[aá]vel|ok|normal|forte|r[aá]pida|funcionando)\b|\b(netflix|youtube|prime\s*video|disney\+?|globoplay)\b[^.!?\n]{0,25}\b(funciona|funcionando|abre|abrindo|normal)\b/i;

export function isConnectivityObjection(text: string): boolean {
  return CONNECTIVITY_OBJECTION_RE.test(text);
}

export const CONNECTIVITY_OBJECTION_MSG =
  "Entendo! 😊 Mas mesmo com a internet boa, às vezes fica um cache preso no modem ou na TV que só o reset resolve — cerca de 99% dos casos voltam a funcionar só com esse processo. E sobre Netflix/YouTube funcionando normal: eles se adaptam à conexão automaticamente, por isso não travam fácil — já o IPTV precisa de conexão 100% estável o tempo todo, são sistemas bem diferentes. Vale muito a pena fazer o reset completo (desligar modem e TV da tomada por 5 minutos) antes de mais alguma coisa. Consegue tentar? 🙏";

// ✅ Se a mesma objeção ("internet tá boa"/"Netflix funciona") aparecer de
// novo depois da explicação acima, repetir a mesma mensagem soa como o bot
// "não escutando" o cliente. Essa segunda versão reformula, é mais direta
// (menos explicação, mais pedido) e já deixa claro o que fazer se o reset
// não resolver — evita ficar girando em círculo com a mesma resposta.
export const CONNECTIVITY_OBJECTION_INSISTENT_MSG =
  "Compreendo! 🙏 Mas esse procedimento é bem importante mesmo assim — ele é sempre o primeiro passo pra resolver qualquer problema desse tipo. Por favor, desconecte o modem e a TV da tomada por uns 5 minutinhos e teste de novo. Se mesmo assim não funcionar, volta aqui e me conta que aí o Márcio já entra pra te ajudar direto! 😊";

// ── Detecção de categoria a partir da árvore (Fase 1 do motor) ───────────────

export async function getRootNodes(sb: any, tenantId: string, provider?: ServerProvider | null): Promise<MenuNode[]> {
  const { data: roots } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("tenant_id", tenantId).is("parent_id", null).eq("is_active", true)
    .order("option_number", { ascending: true });
  const all: MenuNode[] = (roots || []).filter((n: MenuNode) => !isLinkTargetOnly(n));
  if (provider === undefined) return all;
  return all.filter((n) => appliesToProvider(n.applies_to_servers, provider));
}

// ✅ Seleção por número no menu raiz — antes só existia dentro de submenus
// (findChildByNumber). O menu principal sempre mostrou números (1️⃣, 2️⃣...)
// mas digitar "1" nunca selecionava nada na prática, porque nada chamava
// findChildByNumber pra ele. Checado ANTES de palavra-chave/semântica de
// propósito: é a via mais barata e sem ambiguidade — não precisa gastar
// Gemini pra saber que "1" significa a primeira opção.
export function findRootByNumber(roots: MenuNode[], text: string): MenuNode | null {
  const numeric = extractSingleDigitSelection(text);
  if (numeric === null) return null;
  return findChildByNumber(roots, numeric);
}

export async function detectMenuContextFromTree(sb: any, tenantId: string, text: string, provider?: ServerProvider | null): Promise<MenuNode | null> {
  // ✅ Saudação pura nunca deve casar com keyword nenhuma — ver isGreetingOnly.
  if (isGreetingOnly(text)) return null;
  const roots = await getRootNodes(sb, tenantId, provider);
  if (!roots.length) return null;
  const t = text.toLowerCase();
  return roots.find((r: any) => (r.keywords || []).some((k: string) => t.includes(k.toLowerCase()))) || null;
}

export async function getAllRootsAsMenuText(sb: any, tenantId: string, provider?: ServerProvider | null): Promise<string> {
  const roots = await getRootNodes(sb, tenantId, provider);
  return renderChildrenMenu(roots, "Escolha uma das opções abaixo, digitando o número correspondente:");
}

// ✅ Pega vários candidatos da busca semântica (ordenados por similaridade) e
// devolve o PRIMEIRO que seja compatível com o servidor do cliente — nunca
// devolve um nó restrito a outro servidor, mesmo que ele tenha vindo com
// mais similaridade que um candidato mais abaixo na lista.
export async function pickCompatibleSemanticMatch(
  sb: any,
  tenantId: string,
  candidates: { id: string; label: string; similarity: number }[],
  provider: ServerProvider | null
): Promise<MenuNode | null> {
  for (const c of candidates) {
    const node = await getNodeById(sb, tenantId, c.id);
    if (node && appliesToProvider(node.applies_to_servers, provider)) return node;
  }
  return null;
}

// ── Resolução de conta (múltiplas contas) ────────────────────────────────────

export function matchAccountFromText(clients: any[], text: string): number | null {
  const lower = text.toLowerCase();

  // ✅ Seleção direta por número — mesma prioridade barata do menu principal
  // (extractSingleDigitSelection). "2" sozinho escolhe a Conta 2 direto, sem
  // precisar digitar "conta 2": a lista de contas É um menu igual aos outros.
  const numeric = extractSingleDigitSelection(text);
  if (numeric !== null && clients[numeric - 1]) return numeric - 1;

  const contaMatch = /conta\s*([1-9])/i.exec(text);
  if (contaMatch) {
    const idx = Number(contaMatch[1]) - 1;
    if (clients[idx]) return idx;
  }
  const serverMatches = clients
    .map((c, i) => ({ i, name: String(c.server_name || "").toLowerCase() }))
    .filter((m) => m.name && lower.includes(m.name));
  if (serverMatches.length === 1) return serverMatches[0].i;
  return null;
}

// Ações que precisam saber qual conta usar quando há múltiplas — mantido
// pra nós legados que ainda têm esses valores salvos em special_actions
// (de antes de virarem automáticos).
export const ACCOUNT_DEPENDENT_ACTIONS = [
  "check_servidor_vencimento",
  "check_renovacao_recente",
  "consultar_precos",
  "recomendar_app",
];

// ✅ {link_pagamento}/{tabela_precos}/{cupom_frase}/{pendencia_detalhe}
// viraram automáticos (detectados no texto do nó, ver buildVarsForNode em
// bot-engine.ts) — não têm checkbox próprio, então não aparecem em
// special_actions pra nós NOVOS. Sem essa checagem por texto, um nó novo
// com uma dessas tags nunca perguntaria "qual conta?" antes de resolver —
// resolveria sempre pra primeira conta, errado pra quem tem mais de uma
// (cupom/pendência são por conta, não pela pessoa — ver coupons.ts).
// ✅ {usuario_app}/{senha_app}/{dns_servidor}/{servidor_nome} adicionados
// (auditoria 2026-07-24): são credenciais/identidade da CONTA, não da
// pessoa — igual cupom/pendência, nunca devem resolver pra clients[0] sem
// perguntar quando há mais de uma conta.
export const ACCOUNT_DEPENDENT_VARS = [
  "{link_pagamento}", "{tabela_precos}", "{cupom_frase}", "{cupom_retencao}", "{confirmar_renovacao}", "{pendencia_detalhe}",
  "{usuario_app}", "{senha_app}", "{dns_servidor}", "{servidor_nome}",
];

// ✅ Achado em auditoria (2026-07-24): nós com variante de texto POR SERVIDOR
// (ex: "Samsung ou LG", "Roku" — código/app muda entre NaTV/Fast/Elite) NÃO
// disparavam esta checagem quando o provider já resolvido (de clients[0]) era
// null/diferente do servidor certo — porque a versão antiga buscava os steps
// JÁ FILTRADOS por esse provider (getSteps(..., provider)), e um nó só-com-
// variantes sem fallback universal devolve ZERO linhas pra provider errado/
// desconhecido, então a busca por {tag} nunca achava nada e nunca pedia conta.
// Corrigido buscando os steps CRUS (sem filtro de provider): se o nó tem
// QUALQUER linha com `server` preenchido, o conteúdo em si já depende de qual
// conta/servidor é — precisa perguntar, mesmo sem nenhuma tag explícita.
export async function nodeNeedsAccount(sb: any, node: MenuNode): Promise<boolean> {
  const actions = node.special_actions || [];
  if (actions.some((a) => ACCOUNT_DEPENDENT_ACTIONS.includes(a))) return true;

  const { data } = await sb.from("bot_menu_steps").select("message_text, server").eq("node_id", node.id);
  const rows: any[] = data || [];
  if (!rows.length) return false;

  if (rows.some((r) => r.server)) return true;

  const stepsText = rows.map((r) => r.message_text).join(" ");
  return ACCOUNT_DEPENDENT_VARS.some((v) => stepsText.includes(v));
}

/** Monta texto de retry inválido: intro (configurável) + lista de opções. */
export function buildInvalidMenuRetry(
  children: MenuNode[],
  intro: string,
  showBackHint: boolean = true
): string {
  const cleanIntro = (intro || "").trim() || "Não entendi — escolha uma das opções:";
  // Se o intro já contém as opções (raro), não duplica — senão sempre anexa o menu.
  return renderChildrenMenu(children, cleanIntro, showBackHint);
}

/** Intro de retry: prioriza override do nó, senão settings globais. */
export function pickInvalidIntro(
  node: MenuNode | null | undefined,
  attempt: 1 | 2,
  global1: string,
  global2: string
): string {
  if (attempt === 1) {
    const local = node?.invalid_retry_message_1?.trim();
    return local || global1;
  }
  const local = node?.invalid_retry_message_2?.trim();
  return local || global2;
}