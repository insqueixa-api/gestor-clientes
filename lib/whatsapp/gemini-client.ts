// lib/whatsapp/gemini-client.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cliente HTTP genérico do Gemini — compartilhado por app/api/whatsapp/
// generate-variant (variação de texto de template de cobrança) e pelas
// integrações de app que resolvem captcha via Gemini (lib/integrations/
// iboplayer.ts, bobplayer.ts, messitv.ts). Nada aqui é exclusivo de bot de
// atendimento — as funções de embedding/RAG/classificação que existiam neste
// arquivo foram removidas junto com o bot (lib/whatsapp/bot-engine.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { getGeminiRuntimeConfig } from "@/lib/ai/gemini-config";

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


// ✅ 08/10/2026, achado ao vivo (Márcio: configurar IBO Player do
// AlessandroNaTV deu "Gemini 503 (fallback pago também falhou)"): o 503
// "high demand" é do MODELO, não da chave — as duas chaves chamavam o mesmo
// gemini-flash-latest, então caíam juntas. Testado com captchas reais do
// IBO: flash-latest 503/30s travado nas duas chaves; gemini-3.5-flash e
// gemini-3.1-flash-lite em ~1s, lendo o MESMO texto. Agora cada chamada
// percorre uma lista de modelos (e as duas chaves em cada um).
//
// ✅ 08/10/2026 (2ª parte): chaves e listas de modelos vêm do painel
// (Configurações → API de Integrações → Parceiros → Gemini, tabela
// gemini_config — lib/ai/gemini-config.ts), 2 cards: "Gemini Paga"
// (principal, decisão do Márcio) e "Gemini Gratuita" (reserva), cada uma
// com a sua ordem de modelos. Tenta: paga × modelos dela, depois gratuita ×
// modelos dela. Sem nada salvo, cai nas env vars e na lista padrão.
export async function callGemini(
  apiKey: string,
  payload: any,
  timeoutMs = 55_000,
  opts: { purpose?: "text" | "captcha" } = {},
): Promise<any> {
  const cfg = await getGeminiRuntimeConfig();
  const attempts: { key: string; model: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (key: string, models: string[], label: string) => {
    const k = String(key || "").trim();
    if (!k) return;
    for (const model of models) {
      if (seen.has(k + "|" + model)) continue;
      seen.add(k + "|" + model);
      attempts.push({ key: k, model, label });
    }
  };
  add(cfg.paidKey, cfg.paidModels, "paga");
  add(cfg.freeKey, cfg.freeModels, "grátis");
  add(apiKey, cfg.freeModels, "grátis"); // chave passada pelo chamador, se for outra
  if (!attempts.length) throw new Error("Gemini sem chave configurada");
  const isCaptcha = opts.purpose === "captcha";
  // Captcha: texto curto, sem raciocínio — sem "pensar" (o flash-latest
  // pensando levava 15-25s por captcha).
  const body = isCaptcha
    ? { ...payload, generationConfig: { ...(payload?.generationConfig || {}), thinkingConfig: { thinkingBudget: 0 } } }
    : payload;

  // Qualquer falha (sobrecarga, tempo, modelo aposentado) → próxima
  // combinação da fila.
  const failures: string[] = [];
  for (const a of attempts) {
    try {
      return await requestGemini(a.key, body, timeoutMs, a.model);
    } catch (err: any) {
      const status = err instanceof GeminiHttpError ? err.status : err?.name === "AbortError" ? "timeout" : "?";
      failures.push(`${a.model}/${a.label}: ${status}`);
    }
  }
  throw new Error(`Gemini indisponível (${failures.join(", ")})`);
}

// Usado pelo botão "Testar" do painel: 1 chamada curta, sem fallback,
// devolvendo status e tempo de cada combinação chave × modelo.
export async function testGeminiModel(
  key: string,
  model: string,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; ms: number; status: string; text?: string }> {
  const t0 = Date.now();
  try {
    const res = await requestGemini(
      key,
      {
        contents: [{ parts: [{ text: "Responda apenas: OK" }] }],
        generationConfig: { maxOutputTokens: 10, thinkingConfig: { thinkingBudget: 0 } },
      },
      timeoutMs,
      model,
    );
    const text = String(res?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    return { ok: true, ms: Date.now() - t0, status: "200", text };
  } catch (err: any) {
    const status = err instanceof GeminiHttpError ? String(err.status) : err?.name === "AbortError" ? "timeout" : "erro";
    let msg = "";
    if (err instanceof GeminiHttpError) {
      try { msg = JSON.parse(err.bodyText)?.error?.message || ""; } catch { msg = err.bodyText; }
    }
    return { ok: false, ms: Date.now() - t0, status, text: String(msg || err?.message || "").slice(0, 160) };
  }
}
