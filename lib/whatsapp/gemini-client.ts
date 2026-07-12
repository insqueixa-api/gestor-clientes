// lib/whatsapp/gemini-client.ts
// ─────────────────────────────────────────────────────────────────────────────
// Camada compartilhada de acesso ao Gemini. Tanto o agent/route.ts (produção)
// quanto o chat-admin (simulador) já rodam no motor de árvore — nenhum dos
// dois gera texto livre. O Gemini hoje só é usado para: (1) gerar embeddings
// de busca (RAG), (2) classificar comprovante de pagamento (agent), e
// (3) classificar se uma resposta é só cordialidade (Item 5).
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function callGemini(apiKey: string, payload: any, timeoutMs = 55_000): Promise<any> {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

// ✅ Modo "consulta" — usado pra embutir o TEXTO DE BUSCA (o que o cliente
// escreveu). Gemini otimiza o vetor de forma diferente pra consulta vs pra
// documento indexado — usar o modo errado num dos dois lados degrada a
// qualidade da similaridade (é exatamente o bug que corrigimos: categorias
// da árvore indexadas em modo consulta faziam saudações genéricas tipo
// "Olá, tudo bem?" parecerem parecidas o suficiente com "Nova instalação").
export async function generateEmbedding(apiKey: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding?.values ?? null;
  } catch {
    return null;
  }
}

// ✅ Modo "documento" — usado pra embutir CONTEÚDO QUE SERÁ ENCONTRADO depois
// (artigos da base de conhecimento, e agora também a intenção de cada
// categoria da árvore). Mesmo padrão que knowledge/route.ts já usa há tempo
// pra indexar os artigos do RAG — mantido separado de propósito.
export async function generateDocumentEmbedding(apiKey: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding?.values ?? null;
  } catch {
    return null;
  }
}

// ── ⚠️ Não usada em nenhuma rota hoje (nem agent nem chat-admin) — os dois
// já usam searchBotKnowledgeTop, que devolve o conteúdo direto sem o Gemini
// gerar texto em cima. Mantida por enquanto caso algum fluxo futuro volte a
// precisar de um prompt com múltiplos resultados de contexto.
export async function searchBotKnowledge(
  sb: any,
  tenantId: string,
  embedding: number[],
  limit = 5
): Promise<string> {
  try {
    const { data, error } = await sb.rpc("search_bot_knowledge", {
      p_tenant_id: tenantId,
      p_embedding: `[${embedding.join(",")}]`,
      p_limit: limit,
      p_threshold: 0.5,
    });
    if (error || !data?.length) return "(nenhum conhecimento relevante encontrado)";
    return data
      .map((row: any) => `### [${row.category}] ${row.title}\n${row.content}`)
      .join("\n\n---\n\n");
  } catch {
    return "(erro ao buscar base de conhecimento)";
  }
}

// ── Usado pelo chat-admin (motor de árvore) — retorna o item mais similar
// SEM passar por geração de texto do Gemini. A resposta é o próprio
// conteúdo cadastrado (com variáveis substituídas depois pelo renderTemplate).
export async function searchBotKnowledgeTop(
  sb: any,
  tenantId: string,
  embedding: number[],
  threshold = 0.55
): Promise<{ id: string; title: string; category: string; content: string; similarity: number } | null> {
  try {
    const { data, error } = await sb.rpc("search_bot_knowledge", {
      p_tenant_id: tenantId,
      p_embedding: `[${embedding.join(",")}]`,
      p_limit: 1,
      p_threshold: threshold,
    });
    if (error || !data?.length) return null;
    return data[0];
  } catch {
    return null;
  }
}

// ── Detecção semântica de categoria raiz — fallback quando NENHUMA palavra-
// chave bate na 1ª mensagem do cliente (ex: "estou com problemas na minha
// tv, pode me ajudar?" não contém nenhuma das palavras exatas cadastradas em
// "Problema técnico", mas o SIGNIFICADO bate). Mesmo mecanismo de embedding +
// similaridade já usado no RAG da base de conhecimento, aplicado aos nós
// raiz da árvore em vez de artigos — cada nó tem seu próprio embedding
// (gerado a partir de label + palavras-chave), atualizado sempre que o
// admin salva o nó em menu-tree/route.ts.
// ⚠️ Limiar bem mais rigoroso que o do RAG de conhecimento (0.55). As
// "documentos" aqui são descrições curtas de categoria (rótulo + palavras-
// chave), não artigos longos — com pouco texto pra ancorar o significado,
// até saudações genéricas passavam no 0.55 (ex: "Olá, tudo bem?" batendo
// com "Nova instalação"). 0.78 é conservador de propósito: prefere não
// achar nada (cai no menu normal, sem risco) a arriscar rotear errado.
export async function searchMenuIntentTop(
  sb: any,
  tenantId: string,
  embedding: number[],
  threshold = 0.78
): Promise<{ id: string; label: string; similarity: number } | null> {
  try {
    const { data, error } = await sb.rpc("search_menu_intent", {
      p_tenant_id: tenantId,
      p_embedding: `[${embedding.join(",")}]`,
      p_limit: 1,
      p_threshold: threshold,
    });
    if (error || !data?.length) return null;
    return data[0];
  } catch {
    return null;
  }
}

// ── Classificação barata: "isso é só cordialidade, ou é um pedido real?" ────
// Usada no Item 5, quando o cliente responde a uma mensagem automática
// recente. Não gera texto — só decide true/false, com contexto mínimo.
// Falha (timeout/erro de parse) volta `false` de propósito: em dúvida,
// trata como pedido real — nunca deixa uma pergunta de verdade em silêncio.
export async function classifyIsAcknowledgment(
  apiKey: string,
  context: string,
  clientReply: string
): Promise<boolean> {
  try {
    const payload = {
      contents: [{
        role: "user",
        parts: [{
          text: `O cliente recebeu esta mensagem automática do sistema:\n"${context}"\n\nEle respondeu:\n"${clientReply}"\n\nIsso é APENAS uma cordialidade/agradecimento/confirmação simples em relação à mensagem acima, sem nenhum pedido, dúvida ou problema real que precise de atendimento?\n\nResponda SOMENTE com JSON, sem markdown, sem explicação:\n{"is_acknowledgment": true}\nou\n{"is_acknowledgment": false}`,
        }],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 32 },
    };
    const result = await callGemini(apiKey, payload, 8_000);
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    return parsed?.is_acknowledgment === true;
  } catch {
    return false;
  }
}