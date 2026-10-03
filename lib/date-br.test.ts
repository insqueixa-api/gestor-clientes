import { describe, expect, it } from "vitest";
import { addYearsToIsoDate, formatDateBR, isoDateInSaoPaulo, toBRDateStr } from "./date-br";

describe("date-br (São Paulo)", () => {
  it("vencimento às 22h do último dia do mês fica no mesmo mês (previsão)", () => {
    // 31/10 22:00 em SP = 01/11 01:00 UTC
    expect(toBRDateStr("2026-11-01T01:00:00Z")).toBe("2026-10-31");
    expect("2026-11-01T01:00:00Z".split("T")[0]).toBe("2026-11-01"); // jeito antigo errava
  });

  it("hoje em SP depois das 21h não vira amanhã", () => {
    expect(isoDateInSaoPaulo(new Date("2026-10-03T02:30:00Z"))).toBe("2026-10-02");
  });

  it("+1 ano em data pura", () => {
    expect(addYearsToIsoDate("2026-10-02", 1)).toBe("2027-10-02");
    expect(addYearsToIsoDate("2028-02-29", 1)).toBe("2029-03-01");
    expect(addYearsToIsoDate("2026-12-31T00:00:00", 1)).toBe("2027-12-31");
  });

  it("formatDateBR: data pura não volta 1 dia", () => {
    expect(formatDateBR("2026-10-02")).toBe("02/10/2026");
    expect(formatDateBR("2026-11-01T01:00:00Z")).toBe("31/10/2026");
  });
});
