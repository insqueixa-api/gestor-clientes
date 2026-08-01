import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isInternalRequest, isCronRequest, hasBadInternalHeader } from "./internal-auth";

function reqWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/test", { headers });
}

describe("isInternalRequest", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;
  const originalBotSecret = process.env.UNIGESTOR_BOT_INTERNAL_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
  });

  afterEach(() => {
    process.env.INTERNAL_API_SECRET = originalSecret;
    process.env.UNIGESTOR_BOT_INTERNAL_SECRET = originalBotSecret;
  });

  it("aceita quando o header bate com o secret esperado", () => {
    const req = reqWithHeaders({ "x-internal-secret": "internal-secret-123" });
    expect(isInternalRequest(req)).toBe(true);
  });

  it("rejeita quando o header não bate", () => {
    const req = reqWithHeaders({ "x-internal-secret": "errado" });
    expect(isInternalRequest(req)).toBe(false);
  });

  it("rejeita quando o header não foi enviado (fluxo normal de usuário)", () => {
    const req = reqWithHeaders({});
    expect(isInternalRequest(req)).toBe(false);
  });

  it("usa a variável de ambiente informada em vez da padrão", () => {
    process.env.UNIGESTOR_BOT_INTERNAL_SECRET = "bot-secret-xyz";
    const req = reqWithHeaders({ "x-internal-secret": "bot-secret-xyz" });
    expect(isInternalRequest(req, "UNIGESTOR_BOT_INTERNAL_SECRET")).toBe(true);
    // não deve aceitar o secret do bot como se fosse o INTERNAL_API_SECRET padrão
    expect(isInternalRequest(req, "INTERNAL_API_SECRET")).toBe(false);
  });
});

describe("hasBadInternalHeader", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
  });

  afterEach(() => {
    process.env.INTERNAL_API_SECRET = originalSecret;
  });

  it("é false quando nenhum header foi enviado (não é caso suspeito, é usuário comum)", () => {
    expect(hasBadInternalHeader(reqWithHeaders({}))).toBe(false);
  });

  it("é true quando o header foi enviado mas está errado (caso suspeito)", () => {
    expect(hasBadInternalHeader(reqWithHeaders({ "x-internal-secret": "errado" }))).toBe(true);
  });

  it("é false quando o header foi enviado e está correto", () => {
    expect(hasBadInternalHeader(reqWithHeaders({ "x-internal-secret": "internal-secret-123" }))).toBe(false);
  });
});

describe("isCronRequest", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
  });

  it("aceita Bearer token que bate com o secret", () => {
    process.env.CRON_SECRET = "cron-secret-xyz";
    const req = reqWithHeaders({ authorization: "Bearer cron-secret-xyz" });
    expect(isCronRequest(req, "CRON_SECRET")).toBe(true);
  });

  it("rejeita Bearer token errado", () => {
    process.env.CRON_SECRET = "cron-secret-xyz";
    const req = reqWithHeaders({ authorization: "Bearer errado" });
    expect(isCronRequest(req, "CRON_SECRET")).toBe(false);
  });

  it("rejeita quando não há header de autorização", () => {
    process.env.CRON_SECRET = "cron-secret-xyz";
    const req = reqWithHeaders({});
    expect(isCronRequest(req, "CRON_SECRET")).toBe(false);
  });
});
