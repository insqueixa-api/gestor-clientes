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
