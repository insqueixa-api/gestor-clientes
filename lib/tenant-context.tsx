"use client";
// lib/tenant-context.tsx
//
// O tenant_id já é resolvido no servidor, uma única vez por request, em
// app/admin/layout.tsx (via getAdminTenantContext()) antes de qualquer
// página client-side montar. Antes desse contexto, cada página/modal do
// admin chamava getCurrentTenantId() (lib/tenant.ts) por conta própria —
// repetindo sessão + lookup em tenant_members toda vez que montava, mesmo
// o layout já sabendo a resposta. Este Provider só repassa o valor que o
// layout já calculou, sem nenhuma consulta extra.

import { createContext, useContext } from "react";

const TenantContext = createContext<string | null>(null);

export function TenantProvider({
  tenantId,
  children,
}: {
  tenantId: string | null | undefined;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={tenantId ?? null}>
      {children}
    </TenantContext.Provider>
  );
}

// Mesmo formato de retorno de getCurrentTenantId() (string, quando disponível)
// pra manter os call sites existentes (que checam `if (!tid) ...`) intactos.
export function useTenantId(): string | null {
  return useContext(TenantContext);
}
