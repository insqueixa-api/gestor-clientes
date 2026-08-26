// lib/whatsapp/gemini-client.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cliente HTTP genérico do Gemini — compartilhado por app/api/whatsapp/
// generate-variant (variação de texto de template de cobrança) e pelas
// integrações de app que resolvem captcha via Gemini (lib/integrations/
// iboplayer.ts, bobplayer.ts, messitv.ts). Nada aqui é exclusivo de bot de
// atendimento — as funções de embedding/RAG/classificação que existiam neste
// arquivo foram removidas junto com o bot (lib/whatsapp/bot-engine.ts).
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

class GeminiHttpError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string) {
    super(`Gemini ${status}: ${bodyText.slice(0, 300)}`);
    this.status = status;
    this.bodyText = bodyText;
  }
}

async function requestGemini(apiKey: string, payload: any, timeoutMs: number): Promise<any> {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new GeminiHttpError(res.status, bodyText);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// 429 = cota do nível gratuito estourada, 503 = "high demand" (sobrecarga
// momentânea do lado do Google) — os dois são transitórios/de capacidade,
// não erro de prompt/payload, então valem fallback pra chave paga. Outros
// status (400 payload inválido, 403 chave errada) não valem — trocar de
// chave não resolve.
//
// ⚠️ Achado 26/08/2026 (Márcio: "configurar M3U do IBO Player deu timeout,
// acho que foi o Gemini grátis que não respondeu"): um timeout (o
// AbortController de requestGemini estourando o `timeoutMs`) NUNCA caía
// aqui — a chamada nem chega a devolver um HTTP status pra virar
// GeminiHttpError, só um AbortError/DOMException genérico, que a checagem
// original (`err instanceof GeminiHttpError`) descartava de cara. Resultado:
// a chave grátis simplesmente não responder dentro do prazo NUNCA acionava
// o fallback pra paga — exatamente o caso mais comum de "grátis
// sobrecarregada", só que sem devolver um 429/503 explícito. Timeout entra
// no mesmo balde de "transitório, vale tentar a paga".
function isRetryableGeminiError(err: unknown): boolean {
  if (err instanceof GeminiHttpError) {
    if (err.status === 429 || err.status === 503) return true;
    return /RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(err.bodyText);
  }
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

export async function callGemini(apiKey: string, payload: any, timeoutMs = 55_000): Promise<any> {
  try {
    return await requestGemini(apiKey, payload, timeoutMs);
  } catch (err) {
    // ✅ GEMINI_API_KEY é o nível gratuito (sem faturamento, ver comentário
    // em .env.local) — tem cota baixa e volta e meia devolve 429/503 sob
    // demanda alta. GEMINI_API_KEY_PAID (mesmo modelo, projeto com
    // faturamento habilitado) é usada automaticamente como fallback só
    // quando o erro é desse tipo, em QUALQUER chamada ao Gemini no projeto
    // — pedido do Márcio (23/08/2026) depois de bater um 503 gerando treino.
    const paidKey = String(process.env.GEMINI_API_KEY_PAID || "").trim();
    if (!paidKey || paidKey === apiKey || !isRetryableGeminiError(err)) {
      throw err;
    }
    try {
      return await requestGemini(paidKey, payload, timeoutMs);
    } catch (err2: any) {
      const status = err2 instanceof GeminiHttpError ? err2.status : "?";
      const bodyText = err2 instanceof GeminiHttpError ? err2.bodyText : String(err2?.message || err2);
      throw new Error(`Gemini ${status} (fallback pago também falhou): ${String(bodyText).slice(0, 300)}`);
    }
  }
}
