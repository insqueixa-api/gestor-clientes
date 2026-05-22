// app/admin/layout.tsx (SERVER)
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import AdminShell from "./AdminShell";
import { ConfirmProvider } from "@/app/admin/HookuseConfirm";

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

  // 2) Tenant obrigatório (single-user — só serve pra obter o tenant_id)
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .maybeSingle<{ tenant_id: string }>();

  if (!member?.tenant_id) redirect("/login");

  // 3) Nome e logo do tenant
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name, logo_url")
    .eq("id", member.tenant_id)
    .maybeSingle<{ name: string | null; logo_url: string | null }>();

  // 4) Nome do perfil (display_name)
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();

  const tenantName = tenantRow?.name ?? "Painel";
  const tenantLogo = tenantRow?.logo_url ?? null;
  const userLabel = profile?.display_name || tenantName || user.email || "Usuário";

  return (
    <ThemeProvider defaultTheme="light">
      <ConfirmProvider>
        <AdminShell
          userLabel={userLabel}
          tenantName={tenantName}
          tenantId={member.tenant_id}
          whatsappSessions={1}
          logoUrl={tenantLogo}
        >
          {children}
        </AdminShell>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
