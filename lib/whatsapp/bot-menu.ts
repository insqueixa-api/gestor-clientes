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
  "Desculpa por não conseguir te ajudar direito por aqui! 🙏 Já deixei tudo registrado e o Márcio vai continuar seu atendimento assim que possível.";

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

export function isSimpleConfirmation(text: string): boolean {
  return /^(ok|okay|oks|👍|👌|✅|😊|🙏|blz|beleza|certo|entendi|entendido|perfeito|tá|ta|tá bom|ta bom|tudo bem|obrigad[oa]|vlw|valeu|até|ótimo|otimo|show|legal|massa|👏|🤝|😀|😄|🙂)$/i.test(text.trim());
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

export type PortalPaymentStatus = "auto_confirmed" | "manual_pending" | "fulfillment_error" | "none";

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
  return "none";
}

export function paymentAutoConfirmedMsg(firstName: string): string {
  return `Tudo certo, ${firstName}! 😊 Sua renovação já foi processada automaticamente pelo portal e a confirmação já foi enviada. Não precisa mandar comprovante — já está tudo certo! ✅`;
}

export const PAYMENT_MANUAL_PENDING_MSG =
  "Encontrei seu pagamento aqui! ✅ Está em análise e será concluído em breve.";

export const PAYMENT_FULFILLMENT_ERROR_MSG =
  "Encontrei seu pagamento aqui — está confirmado! ✅ Só tivemos uma instabilidade técnica na finalização automática, mas o Márcio já foi notificado e vai concluir sua renovação em instantes.";

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
  requires_account_check: boolean;
  special_actions: string[];
  closing_message: string | null;
  transfer_situation_label: string | null;
  applies_to_servers?: string[] | null;
  is_active?: boolean;
};

export async function getRootNodeBySlug(sb: any, tenantId: string, slug: string): Promise<MenuNode | null> {
  const { data } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("tenant_id", tenantId).eq("slug", slug).eq("is_active", true)
    .maybeSingle();
  return data || null;
}

export async function getNodeById(sb: any, nodeId: string): Promise<MenuNode | null> {
  const { data } = await sb.from("bot_menu_nodes").select("*").eq("id", nodeId).maybeSingle();
  return data || null;
}

// ✅ "provider": quando informado (mesmo que null), filtra fora os nós
// restritos a outro servidor — permite ter DUAS variantes com o MESMO
// option_number (uma por servidor), já que só uma sobrevive ao filtro pra
// cada cliente. Quando omitido (undefined — usado pelo editor visual, que
// não tem "cliente" nenhum), retorna tudo, sem filtrar.
export async function getChildren(sb: any, parentId: string, provider?: ServerProvider | null): Promise<MenuNode[]> {
  const { data } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("parent_id", parentId).eq("is_active", true)
    .order("option_number", { ascending: true });
  const all: MenuNode[] = data || [];
  if (provider === undefined) return all;
  return all.filter((n) => appliesToProvider(n.applies_to_servers, provider));
}

export async function getSteps(sb: any, nodeId: string): Promise<string[]> {
  const { data } = await sb
    .from("bot_menu_steps")
    .select("message_text")
    .eq("node_id", nodeId)
    .order("step_order", { ascending: true });
  return (data || []).map((s: any) => s.message_text);
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

const RESOLUTION_RESOLVED_RE = /^(1|sim|resolveu|resolvido|deu certo|funcionou)$/i;
export function isResolutionResolved(text: string): boolean {
  return text.split("\n").some((line) => RESOLUTION_RESOLVED_RE.test(line.trim()));
}

const RESOLUTION_NOT_RESOLVED_RE = /^(2|não|nao|não resolveu|nao resolveu|continua|ainda não|ainda nao)$/i;
export function isResolutionNotResolved(text: string): boolean {
  return text.split("\n").some((line) => RESOLUTION_NOT_RESOLVED_RE.test(line.trim()));
}

// ── Detecção de categoria a partir da árvore (Fase 1 do motor) ───────────────

export async function getRootNodes(sb: any, tenantId: string, provider?: ServerProvider | null): Promise<MenuNode[]> {
  const { data: roots } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("tenant_id", tenantId).is("parent_id", null).eq("is_active", true)
    .order("option_number", { ascending: true });
  const all: MenuNode[] = roots || [];
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
  candidates: { id: string; label: string; similarity: number }[],
  provider: ServerProvider | null
): Promise<MenuNode | null> {
  for (const c of candidates) {
    const node = await getNodeById(sb, c.id);
    if (node && appliesToProvider(node.applies_to_servers, provider)) return node;
  }
  return null;
}

// ── Resolução de conta (múltiplas contas) ────────────────────────────────────

export function matchAccountFromText(clients: any[], text: string): number | null {
  const lower = text.toLowerCase();
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

// Ações que precisam saber qual conta usar quando há múltiplas
export const ACCOUNT_DEPENDENT_ACTIONS = [
  "check_servidor_vencimento",
  "check_renovacao_recente",
  "gerar_link_portal",
  "consultar_precos",
  "recomendar_app",
];

export function nodeNeedsAccount(node: MenuNode): boolean {
  return (node.special_actions || []).some((a) => ACCOUNT_DEPENDENT_ACTIONS.includes(a));
}