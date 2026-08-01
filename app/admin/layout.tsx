// app/admin/layout.tsx
// app/admin/layout.tsx (SERVER)
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
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
  // (mesma checagem usada nas rotas de API via requireAdminTenant).
  const ctx = await getAdminTenantContext();
  if (!ctx.ok) redirect("/login");

  const supabase = await createClient();

  // 2) Nome do tenant (fallback do userLabel)
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", ctx.tenantId)
    .maybeSingle<{ name: string | null }>();

  // 3) Nome do perfil (display_name)
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", ctx.userId)
    .maybeSingle<{ display_name: string | null }>();

  const tenantName = tenantRow?.name ?? "Painel";
  const userLabel = profile?.display_name || tenantName || "Usuário";

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
