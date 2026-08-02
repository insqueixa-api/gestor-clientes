import { describe, expect, it } from "vitest";
import { resolveCronTenantSelection } from "./wa-context";

describe("resolveCronTenantSelection", () => {
  it("retorna null quando há mais de um tenant diferente na tabela", () => {
    const rows = [
      { tenant_id: "tenant-a", user_id: "u1", role: "owner" },
      { tenant_id: "tenant-b", user_id: "u2", role: "admin" },
    ];

    expect(resolveCronTenantSelection(rows, undefined)).toBeNull();
  });

  it("retorna o tenant único quando existe apenas uma entrada válida", () => {
    const rows = [
      { tenant_id: "tenant-a", user_id: "u1", role: "owner" },
    ];

    expect(resolveCronTenantSelection(rows, undefined)).toEqual({
      tenantId: "tenant-a",
      userId: "u1",
    });
  });

  it("prioriza a configuração explícita de tenant quando ela existe", () => {
    const rows = [
      { tenant_id: "tenant-a", user_id: "u1", role: "owner" },
      { tenant_id: "tenant-b", user_id: "u2", role: "owner" },
    ];

    expect(resolveCronTenantSelection(rows, "tenant-b")).toEqual({
      tenantId: "tenant-b",
      userId: "u2",
    });
  });
});
