import { describe, expect, it } from "vitest";
import { computeAppCouponDiscount, couponCoversApp, type CouponRow } from "./coupons";

const base = {
  discount_type: "percent",
  discount_value: 50,
  target_app_names: ["DupleCast"],
  target_client_app_ids: null,
} as unknown as CouponRow;

const sala = { client_app_id: "sala", app_name: "DupleCast", price_amount: 30 };
const quarto = { client_app_id: "quarto", app_name: "DupleCast", price_amount: 30 };
const ibo = { client_app_id: "ibo", app_name: "IBO Player", price_amount: 30 };

describe("cupom de app por instalação", () => {
  it("cupom antigo (só nome) cobre TODAS as instalações daquele app", () => {
    expect(couponCoversApp(base, sala)).toBe(true);
    expect(couponCoversApp(base, quarto)).toBe(true);
    expect(couponCoversApp(base, ibo)).toBe(false);
  });

  it("caso Vera: 50% em cada DupleCast = R$ 30 de desconto (não R$ 15)", () => {
    const r = computeAppCouponDiscount(base, [sala, quarto]);
    expect(r.total).toBe(30);
    expect(r.byClientAppId).toEqual({ sala: 15, quarto: 15 });
  });

  it("com instalações escolhidas, só elas ganham desconto", () => {
    const soSala = { ...base, target_client_app_ids: ["sala"] } as CouponRow;
    expect(couponCoversApp(soSala, quarto)).toBe(false);
    expect(computeAppCouponDiscount(soSala, [sala, quarto]).total).toBe(15);
  });

  it("valor fixo vale por instalação e nunca passa do preço", () => {
    const fixo = { ...base, discount_type: "fixed", discount_value: 40 } as unknown as CouponRow;
    const r = computeAppCouponDiscount(fixo, [sala, quarto]);
    expect(r.byClientAppId).toEqual({ sala: 30, quarto: 30 });
    expect(r.total).toBe(60);
  });

  it("app não coberto no carrinho não ganha nada", () => {
    expect(computeAppCouponDiscount(base, [ibo]).total).toBe(0);
  });
});
