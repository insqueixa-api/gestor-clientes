import { describe, expect, it } from "vitest";
import {
  DATE_TEMPLATE as D,
  DATETIME_TEMPLATE as DT,
  TIME_TEMPLATE as T,
  backspace,
  fromLooseText,
  isoToText,
  stepSegment,
  textToIso,
  typeDigit,
} from "./overwriteMask";

const typeAll = (tpl: string, keys: string, start = "") => {
  let s = { text: start, caret: start.length };
  for (const k of keys) s = typeDigit(tpl, s.text, s.caret, s.caret, k);
  return s;
};

describe("overwriteMask", () => {
  it("digitação do zero monta DD/MM/AAAA", () => {
    expect(typeAll(D, "02102026").text).toBe("02/10/2026");
    expect(textToIso(D, "02/10/2026")).toBe("2026-10-02");
  });

  it("selecionar o dia e digitar troca SÓ o dia (bug 10/20/2608)", () => {
    let s = typeDigit(D, "02/10/2026", 0, 2, "0");
    s = typeDigit(D, s.text, s.caret, s.caret, "5");
    expect(s.text).toBe("05/10/2026");
    expect(s.caret).toBe(3); // cursor já no mês
  });

  it("selecionar o mês e digitar troca SÓ o mês", () => {
    let s = typeDigit(D, "02/10/2026", 3, 5, "0");
    s = typeDigit(D, s.text, s.caret, s.caret, "8");
    expect(s.text).toBe("02/08/2026");
  });

  it("dígito alto no início do segmento completa com 0 (dia 5 → 05)", () => {
    const s = typeDigit(D, "02/10/2026", 0, 2, "5");
    expect(s.text).toBe("05/10/2026");
    expect(s.caret).toBe(3);
    expect(typeDigit(D, "02/10/2026", 3, 5, "9").text).toBe("02/09/2026");
  });

  it("selecionar o ano e digitar troca só o ano", () => {
    const s = typeAll(D, "2027", "");
    expect(s.text).toBe("20/02/7");
    let x = typeDigit(D, "02/10/2026", 6, 10, "2");
    for (const k of "027") x = typeDigit(D, x.text, x.caret, x.caret, k);
    expect(x.text).toBe("02/10/2027");
  });

  it("Ctrl+A e digitar recomeça", () => {
    expect(typeDigit(D, "02/10/2026", 0, 10, "1").text).toBe("1");
  });

  it("backspace no fim apaga; no meio só seleciona", () => {
    expect(backspace(D, "02/10/2026", 10, 10).text).toBe("02/10/202");
    expect(backspace(D, "02/1", 4, 4).text).toBe("02");
    const mid = backspace(D, "02/10/2026", 4, 4);
    expect(mid.text).toBe("02/10/2026");
    expect([mid.caret, mid.selEnd]).toEqual([3, 4]);
  });

  it("data inválida não vira ISO (31/02)", () => {
    expect(textToIso(D, "31/02/2026")).toBeNull();
    expect(textToIso(D, "29/02/2028")).toBe("2028-02-29");
  });

  it("data-hora", () => {
    expect(typeAll(DT, "021020261430").text).toBe("02/10/2026 14:30");
    expect(textToIso(DT, "02/10/2026 14:30")).toBe("2026-10-02T14:30");
    expect(isoToText(DT, "2026-10-02T14:30")).toBe("02/10/2026 14:30");
    let s = typeDigit(DT, "02/10/2026 14:30", 14, 16, "4");
    s = typeDigit(DT, s.text, s.caret, s.caret, "5");
    expect(s.text).toBe("02/10/2026 14:45");
  });

  it("hora HH:MM", () => {
    expect(typeAll(T, "0930").text).toBe("09:30");
    expect(typeDigit(T, "09:30", 0, 2, "7").text).toBe("07:30");
    expect(typeDigit(T, "09:30", 3, 5, "7").text).toBe("09:07");
  });

  it("colar em vários formatos", () => {
    expect(fromLooseText(D, "2026-10-02")).toBe("02/10/2026");
    expect(fromLooseText(D, "02/10/2026")).toBe("02/10/2026");
    expect(fromLooseText(DT, "2026-10-02T09:05:00")).toBe("02/10/2026 09:05");
  });

  it("setas mudam o segmento do cursor", () => {
    expect(stepSegment(D, "31/01/2026", 1, 1)).toBe("01/02/2026");
    expect(stepSegment(D, "31/01/2026", 4, 1)).toBe("28/02/2026");
    expect(stepSegment(D, "02/10/2026", 8, -1)).toBe("02/10/2025");
    expect(stepSegment(DT, "02/10/2026 23:59", 15, 1)).toBe("03/10/2026 00:00");
  });
});
