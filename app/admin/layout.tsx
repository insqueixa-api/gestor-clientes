// app/admin/layout.tsx (SERVER)
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import AdminShell from "./AdminShell";
import { ConfirmProvider } from "@/app/admin/HookuseConfirm";
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
      icons: tenant?.logo_url ? { icon: tenant.logo_url } : { icon: "/favicon.ico" },
    };
  } catch {
    return { description: "Painel Administrativo" };
  }
}

function pickUserLabel(user: any): string {
  const md = user.user_metadata ?? {};
  return (md.full_name || md.name || user.email || "Administrador").toString();
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!member?.tenant_id) redirect("/login");

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name, primary_color, logo_url")
    .eq("id", member.tenant_id)
    .maybeSingle();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const tenantName = tenantRow?.name ?? "Meu Sistema";
  const userLabel = profile?.display_name || tenantName || pickUserLabel(user);
  const brandColor = tenantRow?.primary_color || "#10b981";
  const tenantLogo = tenantRow?.logo_url || null;

  return (
    <ThemeProvider defaultTheme="light">
      <ConfirmProvider>
        <TenantHead />
        <div style={{ "--theme-color": brandColor } as React.CSSProperties} className="contents">
          <AdminShell 
            userLabel={userLabel} 
            tenantName={tenantName} 
            tenantId={member.tenant_id} 
            logoUrl={tenantLogo}
          >
            {children}
          </AdminShell>
        </div>
      </ConfirmProvider>
    </ThemeProvider>
  );
}