import { describe, expect, it } from "vitest";
import {
  MAX_DELAY_SECS,
  MIN_DELAY_SECS,
  normalizeBillingDelayWindow,
} from "./billing-campaign-window";

describe("normalizeBillingDelayWindow", () => {
  it("mantém o intervalo dentro do padrão de 2 a 30 minutos", () => {
    expect(normalizeBillingDelayWindow(120, 300)).toEqual({
      minSecs: 120,
      maxSecs: 300,
    });
  });

  it("clampa valores fora da faixa para 2 ou 30 minutos", () => {
    expect(normalizeBillingDelayWindow(30, 3000)).toEqual({
      minSecs: MIN_DELAY_SECS,
      maxSecs: MAX_DELAY_SECS,
    });
  });

  it("corrige o caso em que o máximo fica menor que o mínimo", () => {
    expect(normalizeBillingDelayWindow(240, 60)).toEqual({
      minSecs: 240,
      maxSecs: 240,
    });
  });
});
