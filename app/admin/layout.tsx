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
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { description: "Painel Administrativo" };

    const { data: member } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!member?.tenant_id) return { description: "Painel Administrativo" };

    const { data: tenant } = await supabase
      .from("tenants")
      .select("logo_url")
      .eq("id", member.tenant_id)
      .maybeSingle();

    return {
      description: "Painel Administrativo",
      icons: tenant?.logo_url
        ? { icon: `/api/upload/admin-favicon?t=${Date.now()}` }
        : undefined,
    };
  } catch {
    return { description: "Painel Administrativo" };
  }
}

type TenantMemberRow = {
  tenant_id: string;
  role: string | null;
  created_at: string | null;
};



type TenantRow = {
  name: string | null;
  financial_control_enabled: boolean | null; // ✅ NOVO
};

function pickUserLabel(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const md = user.user_metadata ?? {};
  const fullName = typeof md.full_name === "string" ? md.full_name : null;
  const name = typeof md.name === "string" ? md.name : null;

  return (fullName || name || user.email || "Usuário").toString();
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

  // 2) Tenant obrigatório (pega o mais recente)
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id, role, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<TenantMemberRow>();

  if (!member?.tenant_id) {
    // Se quiser diferenciar: redirect("/no-tenant")
    redirect("/login");
  }

  // 3) Nome e configs do tenant (topo)
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name, financial_control_enabled, active_modules, primary_color, logo_url, slug")
    .eq("id", member.tenant_id)
    .maybeSingle<any>();

  console.log("TENANT ROW:", {
    slug: tenantRow?.slug,
    logo_url: tenantRow?.logo_url,
    tenantLogo: tenantRow?.logo_url || null,
  });
  // 4) Busca os dados da Licença SEPARADAMENTE (Garante que não quebra o Menu)
  const { data: licenseData } = await supabase
    .from("vw_saas_tenants") // ✅ AGORA SIM, BUSCA NA VIEW LIBERADA
    .select("expires_at, credit_balance, saas_plan_table_id, whatsapp_sessions")
    .eq("id", member.tenant_id) // ✅ NA VIEW A COLUNA SE CHAMA "id"
    .maybeSingle<any>();

  // ✅ SE NÃO FOR FALSO EXPLÍCITO, ESTÁ LIBERADO
  const isFinancialEnabled = tenantRow?.financial_control_enabled !== false;

  // ✅ NOVO: Busca o nome salvo no Perfil (tabela profiles)
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
.eq("id", user.id)
.maybeSingle<{ display_name: string | null; role: string | null }>();

  // ✅ LÓGICA DE PRIORIDADE CORRIGIDA:
  // 1. Nome salvo no perfil
  // 2. Nome da Empresa (Tenant) <-- Vai cair aqui no seu caso
  // 3. Fallback do Auth/E-mail
  const authLabel = pickUserLabel(user);
  const tenantName = tenantRow?.name ?? "Tenant";
  
  const userLabel = profile?.display_name || tenantName || authLabel;

  // ✅ NOVO: Pega a role que o banco já buscou lá em cima, padroniza e envia pro AdminShell
const userRole =
    profile?.role === "superadmin" && member.role === "owner"
      ? "SUPERADMIN"
      : member.role === "owner"
      ? "MASTER"
      : "USER";

  // ✅ NOVO: Verifica se o cliente possui APENAS o módulo financeiro habilitado
  const activeModules = tenantRow?.active_modules || [];
  const isOnlyFinanceiro = activeModules.length === 1 && activeModules.includes("financeiro");

  // ✅ EXTRAI AS CORES E LOGO DO CLIENTE
  const brandColor = tenantRow?.primary_color || "#10b981"; // Fallback para Emerald
  const tenantLogo = tenantRow?.logo_url || null;

  return (
    <ThemeProvider defaultTheme="light">
      <ConfirmProvider>
<ModulesProvider
          activeModules={activeModules}
          slug={userRole === "SUPERADMIN" ? null : (tenantRow?.slug ?? null)}
          logoUrl={tenantLogo}
          tenantName={tenantName}
        >
          <TenantHead />
          <div style={{ "--theme-color": brandColor } as React.CSSProperties} className="contents">
            <AdminShell 
              userLabel={userLabel} 
              tenantName={tenantName} 
              role={userRole}
              financialControlEnabled={isFinancialEnabled}
              tenantId={member.tenant_id} 
              expiresAt={licenseData?.expires_at ?? null} 
              creditBalance={licenseData?.credit_balance ?? 0} 
              saasPlanTableId={licenseData?.saas_plan_table_id ?? null} 
              whatsappSessions={licenseData?.whatsapp_sessions ?? 1} 
              logoUrl={tenantLogo}
            >
              {children}
            </AdminShell>
          </div>
        </ModulesProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
