// lib/webhook-signatures.ts
// Verificação de assinatura dos webhooks (Mercado Pago, Stripe) — extraído
// das rotas pra ser testável isoladamente (funções puras, sem rede/banco).
// Mesma lógica que já rodava embutida em cada rota, sem mudança de
// comportamento.
import crypto from "crypto";

const REPLAY_WINDOW_SECONDS = 300;

function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function parseMpSignatureHeader(sig: string): { ts: string; v1: string } {
  const parts = sig.split(",").map((s) => s.trim());
  const out: Record<string, string> = {};
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k && v) out[k.trim()] = v.trim();
  }
  return { ts: out.ts || "", v1: out.v1 || "" };
}

export function verifyMercadoPagoSignature(params: {
  signatureHeader: string;
  requestIdHeader: string;
  paymentId: string;
  secret: string;
  nowUnixSeconds?: number;
}): boolean {
  const { signatureHeader, requestIdHeader, paymentId, secret } = params;
  if (!signatureHeader || !requestIdHeader) return false;

  const { ts, v1 } = parseMpSignatureHeader(signatureHeader);
  if (!ts || !v1) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;

  const now = params.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > REPLAY_WINDOW_SECONDS) return false;

  const manifest = `id:${paymentId};request-id:${requestIdHeader};ts:${ts};`;
  const hmac = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return safeEqualHex(hmac, v1);
}

function parseStripeSignatureHeader(sig: string): { t: string; v1: string } {
  const out: Record<string, string> = {};
  for (const part of sig.split(",")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return { t: out.t || "", v1: out.v1 || "" };
}

export function verifyStripeWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  nowUnixSeconds?: number;
}): boolean {
  const { rawBody, signatureHeader, secret } = params;
  const { t, v1 } = parseStripeSignatureHeader(signatureHeader);
  if (!t || !v1) return false;

  const tsNum = Number(t);
  if (!Number.isFinite(tsNum)) return false;

  const now = params.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > REPLAY_WINDOW_SECONDS) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return safeEqualHex(expected, v1);
}
