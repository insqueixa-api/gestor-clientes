// lib/whatsapp/gemini-client.ts
// ─────────────────────────────────────────────────────────────────────────────
// Camada compartilhada de acesso ao Gemini — chamada de texto, embeddings e
// busca no RAG. Usada pelo agent e pelo chat-admin, sem duplicar a mesma
// lógica de fetch/timeout em dois lugares.
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