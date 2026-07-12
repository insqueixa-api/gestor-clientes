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
  // ✅ "0" é o atalho reservado (ex: Assuntos Pessoais / falar com humano) —
  // sempre exibido por último na lista, mesmo sendo o menor número.
  const ordered = [...children].sort((a, b) => {
    if (a.option_number === 0) return 1;
    if (b.option_number === 0) return -1;
    return a.option_number - b.option_number;
  });
  return "Entendido! Me conta mais:\n" + ordered
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

export const RESOLUTION_RESOLVED = /^(1|sim|resolveu|resolvido|deu certo|funcionou)$/i;
export const RESOLUTION_NOT_RESOLVED = /^(2|não|nao|não resolveu|nao resolveu|continua|ainda não|ainda nao)$/i;

// ── Detecção de categoria a partir da árvore (Fase 1 do motor) ───────────────

export async function detectMenuContextFromTree(sb: any, tenantId: string, text: string): Promise<MenuNode | null> {
  const { data: roots } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("tenant_id", tenantId).is("parent_id", null).eq("is_active", true)
    .order("option_number", { ascending: true });

  if (!roots?.length) return null;
  const t = text.toLowerCase();
  return roots.find((r: any) => (r.keywords || []).some((k: string) => t.includes(k.toLowerCase()))) || null;
}

export async function getAllRootsAsMenuText(sb: any, tenantId: string): Promise<string> {
  const { data: roots } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("tenant_id", tenantId).is("parent_id", null).eq("is_active", true)
    .order("option_number", { ascending: true });
  return renderChildrenMenu(roots || []);
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