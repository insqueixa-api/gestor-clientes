// lib/whatsapp/bot-prompt.ts
// ─────────────────────────────────────────────────────────────────────────────
// Este arquivo era a fonte dos prompts do Gemini (buildBotSystemPrompt,
// buildScopedBotSystemPrompt, ESCALATION_TAG, etc.) usados na arquitetura
// antiga do bot, onde o Gemini "pensava" e gerava texto livre em cima de um
// prompt gigante.
//
// Essa arquitetura foi substituída pelo motor de árvore (bot_menu_nodes/
// bot_menu_steps, editável pelo painel) + RAG de resposta direta (busca por
// similaridade, sem geração de texto). O Gemini hoje só é usado para: (1)
// gerar embeddings de busca, e (2) classificar imagens de comprovante
// (visão computacional pontual, não geração de texto).
//
// Por isso, só sobrevivem aqui os helpers de data/hora — genuinamente
// reutilizados em várias partes do sistema, sem relação com prompt de IA.
// ─────────────────────────────────────────────────────────────────────────────

export function toBRDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function toBRDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function diffDaysFromNow(iso: string): number {
  const sp = (d: Date) =>
    new Date(d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
  return Math.floor(
    (sp(new Date(iso)).getTime() - sp(new Date()).getTime()) / 86_400_000
  );
}