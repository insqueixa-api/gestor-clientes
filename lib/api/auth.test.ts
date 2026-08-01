import { describe, it, expect } from "vitest";
import { isAdminRole, ADMIN_ROLES } from "./auth";

describe("isAdminRole", () => {
  it("aceita todos os roles reconhecidos como admin", () => {
    for (const role of ADMIN_ROLES) {
      expect(isAdminRole(role)).toBe(true);
    }
  });

  it("rejeita roles que não são de admin", () => {
    expect(isAdminRole("member")).toBe(false);
    expect(isAdminRole("viewer")).toBe(false);
    expect(isAdminRole("Owner")).toBe(false); // case-sensitive de propósito
  });

  it("rejeita valores ausentes ou de tipo errado", () => {
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole(123)).toBe(false);
    expect(isAdminRole("")).toBe(false);
  });
});
