// app/admin/layout.tsx (SERVER)
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import AdminShell from "./AdminShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard | UniGestor", // <--- O NOME QUE VAI NA ABA
  description: "Painel Administrativo",
};

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
    .select("name, financial_control_enabled, active_modules") // ✅ ADICIONADO active_modules
    .eq("id", member.tenant_id)
    .maybeSingle<any>();

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

  return (
    <ThemeProvider defaultTheme="light">
      <AdminShell 
        userLabel={userLabel} 
        tenantName={tenantName} 
        role={userRole}
        financialControlEnabled={isFinancialEnabled} // ✅ Usando a variável corrigida
        tenantId={member.tenant_id} 
        expiresAt={licenseData?.expires_at ?? null} 
        creditBalance={licenseData?.credit_balance ?? 0} 
        saasPlanTableId={licenseData?.saas_plan_table_id ?? null} 
        whatsappSessions={licenseData?.whatsapp_sessions ?? 1} 
        isOnlyFinanceiro={isOnlyFinanceiro} // ✅ PASSANDO A PROP AQUI PARA O FRONT-END
      >
        {children}
      </AdminShell>
    </ThemeProvider>
  );
}
