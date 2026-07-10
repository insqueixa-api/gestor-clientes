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