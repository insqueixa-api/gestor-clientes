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

async function requestGemini(apiKey: string, payload: any, timeoutMs: number, model = GEMINI_MODEL): Promise<any> {
  const url = `${GEMINI_BASE}/${model}:generateContent`;
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

// ✅ 08/10/2026, achado ao vivo (Márcio: configurar IBO Player do
// AlessandroNaTV deu "Gemini 503 (fallback pago também falhou)"): o 503
// "high demand" é do MODELO, não da chave — as duas chaves chamavam o mesmo
// gemini-flash-latest, então caíam juntas. Testado na hora com captchas
// reais do IBO: flash-latest 503/30s travado nas duas chaves, enquanto
// gemini-3.5-flash e gemini-3.1-flash-lite responderam em ~1s e leram o
// MESMO texto nos 3 captchas. Agora cada chamada percorre uma lista de
// modelos (chave grátis → paga em cada um) antes de desistir.
const DEFAULT_MODELS = [GEMINI_MODEL, "gemini-3.5-flash"];
// Captcha: texto curto, sem raciocínio — modelos rápidos primeiro, sem
// "pensar" (o flash-latest pensando levava 15-25s por captcha).
export const CAPTCHA_GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash", GEMINI_MODEL];

export async function callGemini(
  apiKey: string,
  payload: any,
  timeoutMs = 55_000,
  opts: { models?: string[]; noThinking?: boolean; preferPaid?: boolean } = {},
): Promise<any> {
  // ✅ GEMINI_API_KEY é o nível gratuito (sem faturamento, ver comentário
  // em .env.local) — tem cota baixa e volta e meia devolve 429/503 sob
  // demanda alta. GEMINI_API_KEY_PAID (projeto com faturamento) entra
  // automaticamente quando o erro é desse tipo — pedido do Márcio
  // (23/08/2026) depois de bater um 503 gerando treino.
  const paidKey = String(process.env.GEMINI_API_KEY_PAID || "").trim();
  const keys = [apiKey, ...(paidKey && paidKey !== apiKey ? [paidKey] : [])].filter(Boolean);
  // Captcha: a grátis variou de 0,9s a 14s no teste de 08/10/2026; a paga
  // ficou estável em ~1s e cada captcha custa fração de centavo — paga
  // primeiro, grátis de reserva.
  if (opts.preferPaid && keys.length > 1) keys.reverse();
  const models = opts.models?.length ? opts.models : DEFAULT_MODELS;
  const body = opts.noThinking
    ? { ...payload, generationConfig: { ...(payload?.generationConfig || {}), thinkingConfig: { thinkingBudget: 0 } } }
    : payload;

  const failures: string[] = [];
  for (const model of models) {
    for (let k = 0; k < keys.length; k++) {
      try {
        return await requestGemini(keys[k], body, timeoutMs, model);
      } catch (err: any) {
        const status = err instanceof GeminiHttpError ? err.status : err?.name === "AbortError" ? "timeout" : "?";
        failures.push(`${model}/${keys[k] === paidKey ? "paga" : "grátis"}: ${status}`);
        // Erro de capacidade (429/503/timeout) → vale a outra chave no mesmo
        // modelo. Qualquer outro (modelo aposentado, argumento não aceito
        // por esse modelo) → pula direto pro próximo modelo.
        if (!isRetryableGeminiError(err)) break;
      }
    }
  }
  throw new Error(`Gemini indisponível (${failures.join(", ")})`);
}
