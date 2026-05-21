// app/admin/layout.tsx (SERVER)
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import AdminShell from "./AdminShell";
import { ConfirmProvider } from "@/app/admin/HookuseConfirm";
import { ModulesProvider } from "@/lib/modules/ModulesContext";
import TenantHead from "@/components/TenantHead";

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
  const supabase = await createClient();

  // 1) Sessão obrigatória
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) redirect("/login");

  // 2) Tenant do usuário (single-user — apenas pra obter tenant_id)
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<{ tenant_id: string }>();

  if (!member?.tenant_id) redirect("/login");

  // 3) Dados básicos do tenant (sem SaaS, sem cor, sem licença)
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name, financial_control_enabled, active_modules, logo_url")
    .eq("id", member.tenant_id)
    .maybeSingle<{
      name: string | null;
      financial_control_enabled: boolean | null;
      active_modules: string[] | null;
      logo_url: string | null;
    }>();

  const tenantName = tenantRow?.name ?? "Painel";
  const tenantLogo = tenantRow?.logo_url ?? null;
  const isFinancialEnabled = tenantRow?.financial_control_enabled !== false;
  const activeModules = tenantRow?.active_modules ?? ["iptv", "financeiro"];

  // Single-user: sempre admin máximo
  const userLabel = user.email ?? "Usuário";
  const userRole = "SUPERADMIN" as const;

  return (
    <ThemeProvider defaultTheme="light">
      <ConfirmProvider>
        <ModulesProvider
          activeModules={activeModules}
          slug={null}
          logoUrl={tenantLogo}
          tenantName={tenantName}
        >
          <TenantHead />
          <AdminShell
            userLabel={userLabel}
            tenantName={tenantName}
            role={userRole}
            financialControlEnabled={isFinancialEnabled}
            tenantId={member.tenant_id}
            expiresAt={null}
            creditBalance={0}
            saasPlanTableId={null}
            whatsappSessions={1}
            logoUrl={tenantLogo}
          >
            {children}
          </AdminShell>
        </ModulesProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
