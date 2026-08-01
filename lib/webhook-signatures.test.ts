import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyMercadoPagoSignature, verifyStripeWebhookSignature } from "./webhook-signatures";

describe("verifyMercadoPagoSignature", () => {
  const secret = "test-secret";
  const paymentId = "123456789";
  const requestId = "req-abc";
  const now = 1700000000;

  function sign(ts: number, id = paymentId, reqId = requestId, s = secret) {
    const manifest = `id:${id};request-id:${reqId};ts:${ts};`;
    return crypto.createHmac("sha256", s).update(manifest).digest("hex");
  }

  it("aceita uma assinatura válida dentro da janela de tempo", () => {
    const v1 = sign(now);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: `ts=${now},v1=${v1}`,
        requestIdHeader: requestId,
        paymentId,
        secret,
        nowUnixSeconds: now,
      })
    ).toBe(true);
  });

  it("rejeita quando o segredo está errado", () => {
    const v1 = sign(now, paymentId, requestId, "outro-segredo");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: `ts=${now},v1=${v1}`,
        requestIdHeader: requestId,
        paymentId,
        secret,
        nowUnixSeconds: now,
      })
    ).toBe(false);
  });

  it("rejeita quando o payment_id foi trocado (não bate com o manifest assinado)", () => {
    const v1 = sign(now);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: `ts=${now},v1=${v1}`,
        requestIdHeader: requestId,
        paymentId: "outro-id-qualquer",
        secret,
        nowUnixSeconds: now,
      })
    ).toBe(false);
  });

  it("rejeita timestamp fora da janela de replay (>300s)", () => {
    const oldTs = now - 301;
    const v1 = sign(oldTs);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: `ts=${oldTs},v1=${v1}`,
        requestIdHeader: requestId,
        paymentId,
        secret,
        nowUnixSeconds: now,
      })
    ).toBe(false);
  });

  it("rejeita quando falta o header x-request-id", () => {
    const v1 = sign(now);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: `ts=${now},v1=${v1}`,
        requestIdHeader: "",
        paymentId,
        secret,
        nowUnixSeconds: now,
      })
    ).toBe(false);
  });

  it("rejeita header de assinatura mal formado", () => {
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: "isso-nao-e-um-header-valido",
        requestIdHeader: requestId,
        paymentId,
        secret,
        nowUnixSeconds: now,
      })
    ).toBe(false);
  });
});

describe("verifyStripeWebhookSignature", () => {
  const secret = "whsec_test";
  const rawBody = JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "pi_123" } } });
  const now = 1700000000;

  function sign(ts: number, body = rawBody, s = secret) {
    return crypto.createHmac("sha256", s).update(`${ts}.${body}`, "utf8").digest("hex");
  }

  it("aceita uma assinatura válida", () => {
    const v1 = sign(now);
    expect(
      verifyStripeWebhookSignature({ rawBody, signatureHeader: `t=${now},v1=${v1}`, secret, nowUnixSeconds: now })
    ).toBe(true);
  });

  it("rejeita quando o corpo foi alterado depois de assinado (payload adulterado)", () => {
    const v1 = sign(now);
    const tamperedBody = JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "pi_OUTRO" } } });
    expect(
      verifyStripeWebhookSignature({ rawBody: tamperedBody, signatureHeader: `t=${now},v1=${v1}`, secret, nowUnixSeconds: now })
    ).toBe(false);
  });

  it("rejeita segredo errado", () => {
    const v1 = sign(now, rawBody, "outro-segredo");
    expect(
      verifyStripeWebhookSignature({ rawBody, signatureHeader: `t=${now},v1=${v1}`, secret, nowUnixSeconds: now })
    ).toBe(false);
  });

  it("rejeita timestamp fora da janela de replay", () => {
    const oldTs = now - 400;
    const v1 = sign(oldTs);
    expect(
      verifyStripeWebhookSignature({ rawBody, signatureHeader: `t=${oldTs},v1=${v1}`, secret, nowUnixSeconds: now })
    ).toBe(false);
  });

  it("rejeita header de assinatura mal formado", () => {
    expect(
      verifyStripeWebhookSignature({ rawBody, signatureHeader: "garbage", secret, nowUnixSeconds: now })
    ).toBe(false);
  });
});
