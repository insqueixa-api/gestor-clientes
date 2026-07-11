// lib/whatsapp/bot-menu.ts
// ─────────────────────────────────────────────────────────────────────────────
// Fonte única da lógica de menu/estado/escalonamento — compartilhada entre
// o agent (produção) e o chat-admin (simulador). Edite APENAS aqui.
// ─────────────────────────────────────────────────────────────────────────────

// ── Menu: contexto e textos ───────────────────────────────────────────────────

export type MenuContext = "tecnico" | "pagamento" | "instalacao" | "conteudo" | null;

export function detectMenuContext(text: string): MenuContext {
  const t = text.toLowerCase();
  if (/\b(travando|travou|trava|congela|buffer|tela preta|sem sinal|não abre|nao abre|não funciona|nao funciona|erro|não conecta|nao conecta|canal)\b/i.test(t)) {
    return "tecnico";
  }
  if (/\b(pagar|pagamento|renovar|renova[çc][ãa]o|pix|vencimento|venceu|cobran[çc]a|boleto|cancelar|plano)\b/i.test(t)) {
    return "pagamento";
  }
  if (/\b(instalar|instala[çc][ãa]o|tv nova|configurar|app|aplicativo|celular|tablet|computador|nova tv)\b/i.test(t)) {
    return "instalacao";
  }
  if (/\b(jogo|jogos|filme|filmes|s[ée]rie|s[ée]ries|programa[çc][ãa]o|onde passa|em qual canal|sugerir|sugest[ãa]o|novidades|catálogo|catalogo)\b/i.test(t)) {
    return "conteudo";
  }
  return null;
}

export const MAIN_MENU_TEXT =
  "Me conta o que você precisa:\n" +
  "1️⃣ Problema técnico\n" +
  "2️⃣ Renovação / pagamento\n" +
  "3️⃣ Nova instalação\n" +
  "4️⃣ Canais, filmes ou séries\n" +
  "5️⃣ Dúvidas gerais\n" +
  "6️⃣ Falar com o Márcio";

export const TECNICO_SUBMENU_TEXT =
  "Entendido! Me conta mais:\n" +
  "1️⃣ Canal travando / buffering\n" +
  "2️⃣ Aplicativo não abre\n" +
  "3️⃣ Tela preta com som\n" +
  "4️⃣ Sem sinal / vencimento\n" +
  "5️⃣ Descrever o problema";

export const PAGAMENTO_SUBMENU_TEXT =
  "Entendido! Me conta mais:\n" +
  "1️⃣ Já paguei, aguardando confirmação\n" +
  "2️⃣ Quero renovar agora\n" +
  "3️⃣ Dúvida sobre valores / trocar plano\n" +
  "4️⃣ Cancelar\n" +
  "5️⃣ Outro assunto sobre pagamento";

export const INSTALACAO_SUBMENU_TEXT =
  "Entendido! Me conta mais:\n" +
  "1️⃣ TV nova\n" +
  "2️⃣ Celular / tablet\n" +
  "3️⃣ Computador\n" +
  "4️⃣ Já tenho o app, preciso reconfigurar\n" +
  "5️⃣ Outro assunto sobre instalação";

export const CONTEUDO_INFO_TEXT =
  "📺 Pra isso você tem uma área dedicada dentro do seu portal! Lá você encontra:\n\n" +
  "- Jogos do dia e a programação ao vivo da TV brasileira (qual canal passa o quê)\n" +
  "- Busca de filmes e séries — ao clicar na capa, já mostra exatamente em qual pasta o conteúdo está disponível na sua TV\n" +
  "- Também dá pra sugerir um filme ou série que ainda não tem (é uma sugestão, não uma garantia — a equipe avalia)\n\n" +
  "A atualização acontece todos os dias. É só entrar no seu portal e ir em 'Novidades'.\n\n" +
  "Se não encontrar o que procura por lá, me avisa que eu vejo com o Márcio! 😊";

export const CONTEUDO_NOT_FOUND =
  /\b(n[ãa]o (achei|encontrei|tem|achou|apareceu)|sem canal|n[ãa]o passa|nada aparece)\b/i;

export function submenuTextFor(context: MenuContext): string {
  if (context === "tecnico") return TECNICO_SUBMENU_TEXT;
  if (context === "pagamento") return PAGAMENTO_SUBMENU_TEXT;
  if (context === "instalacao") return INSTALACAO_SUBMENU_TEXT;
  if (context === "conteudo") return CONTEUDO_INFO_TEXT;
  return MAIN_MENU_TEXT;
}

// ── Mensagens de encerramento — UMA fonte para cada caso, nunca divergir ──────

export const HUMAN_REQUESTED_MSG =
  "Combinado! Vou deixar sua conversa marcada aqui e o Márcio te atende assim que possível. 🙏";

export const BOT_GAVE_UP_MSG =
  "Desculpa por não conseguir te ajudar direito por aqui! 🙏 Já deixei tudo registrado e o Márcio vai continuar seu atendimento assim que possível.";

// ── Escalonamento explícito por texto do cliente ──────────────────────────────

export function isEscalationTrigger(text: string): boolean {
  const t = text.trim();
  return (
    /^(pessoal|márcio|marcio|humano|0)$/i.test(t) ||
    /\b(falar com (o )?márcio|falar com (uma )?pessoa|atendente humano|quero (um )?humano|preciso de (uma )?pessoa)\b/i.test(t)
  );
}

// ── Confirmação simples / link puro ───────────────────────────────────────────

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

const GRATITUDE_PHRASES = [
  "bom dia", "boa tarde", "boa noite", "oi", "olá", "ola",
  "obrigada", "obrigado", "obrigada pela paciência", "obrigado pela paciência",
  "obrigada por tudo", "obrigado por tudo", "muito obrigada", "muito obrigado",
  "valeu", "vlw", "tudo certo", "tudo ótimo", "tudo otimo", "perfeito",
  "ótimo", "otimo", "obrigada viu", "obrigado viu",
];

export function isGratitudeOrGreetingOnly(text: string): boolean {
  let remaining = text.toLowerCase().replace(/[!.,😊🙏❤️😄👍✅🎉]/g, "").trim();
  for (const phrase of [...GRATITUDE_PHRASES].sort((a, b) => b.length - a.length)) {
    remaining = remaining.split(phrase).join(" ");
  }
  remaining = remaining.replace(/\s+/g, " ").trim();
  return remaining.length === 0 && text.trim().length > 0;
}

export const POSTPONEMENT_INTENT =
  /\b(vou pagar|pago (amanh[ãa]|hoje|depois|mais tarde|essa semana)|j[áa] vou (pagar|renovar)|assim que (puder|poss[íi]vel)|quando (chegar|puder)|semana que vem)\b/i;

export const PROBLEM_KEYWORDS =
  /\b(travando|travou|ruim|p[ée]ssimo|n[ãa]o (funciona|gostei|est[áa] bom)|problema|reclama|demora|lento|sem sinal|n[ãa]o consigo)\b/i;

  // ── Checagem de pagamento recente — reaproveitável em qualquer fluxo de texto ─
// Mesma lógica dos Casos A/B/D do fluxo de mídia, só que disparável a partir
// de texto (ex: opção "1" do submenu pagamento), sem esperar um comprovante.

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

  // ── Motor genérico da árvore de menu (dados no banco, editável pelo painel) ──

export type MenuNode = {
  id: string;
  parent_id: string | null;
  slug: string | null;
  option_number: number;
  label: string;
  keywords: string[];
  requires_account_check: boolean;
  special_action: string | null;
  closing_message: string | null;
  transfer_situation_label: string | null;
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

export async function getChildren(sb: any, parentId: string): Promise<MenuNode[]> {
  const { data } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("parent_id", parentId).eq("is_active", true)
    .order("option_number", { ascending: true });
  return data || [];
}

export async function getSteps(sb: any, nodeId: string): Promise<string[]> {
  const { data } = await sb
    .from("bot_menu_steps")
    .select("message_text")
    .eq("node_id", nodeId)
    .order("step_order", { ascending: true });
  return (data || []).map((s: any) => s.message_text);
}

export function renderChildrenMenu(children: MenuNode[]): string {
  const NUMBER_EMOJI = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  return "Entendido! Me conta mais:\n" + children
    .map((c) => `${NUMBER_EMOJI[c.option_number] || c.option_number} ${c.label}`)
    .join("\n");
}

export function findChildByNumber(children: MenuNode[], num: number): MenuNode | null {
  return children.find((c) => c.option_number === num) || null;
}

export function findChildByKeyword(children: MenuNode[], text: string): MenuNode | null {
  const t = text.toLowerCase();
  return children.find((c) => (c.keywords || []).some((k) => t.includes(k.toLowerCase()))) || null;
}

export const RESOLUTION_QUESTION =
  "Vou deixar as opções aqui: responda **1** se resolveu, ou **2** se ainda está com o problema.";