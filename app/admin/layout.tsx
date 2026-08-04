// app/admin/layout.tsx
// app/admin/layout.tsx (SERVER)
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAdminTenantContext } from "@/lib/api/auth-server";
import AdminShell from "./AdminShell";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { PromptProvider } from "@/hooks/usePrompt";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    description: "Painel Administrativo",
    icons: { icon: "/favicon.ico" },
  };
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1) Sessão + vínculo com tenant + role de admin — fonte única de verdade
  // (mesma checagem usada nas rotas de API via requireAdminTenant). Nome do
  // tenant e do perfil já vêm resolvidos aqui dentro (cacheados em cookie
  // desde o login — ver lib/api/auth-server.ts), sem consulta própria.
  const ctx = await getAdminTenantContext();
  if (!ctx.ok) redirect("/login");

  const tenantName = ctx.tenantName ?? "Painel";
  const userLabel = ctx.displayName || tenantName || "Usuário";

  return (
    <ConfirmProvider>
      <PromptProvider>
        <AdminShell userLabel={userLabel} tenantId={ctx.tenantId}>
          {children}
        </AdminShell>
      </PromptProvider>
    </ConfirmProvider>
  );
}
