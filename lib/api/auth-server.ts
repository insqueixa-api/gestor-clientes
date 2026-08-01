// lib/api/auth-server.ts
// Equivalente de requireAdminTenant (lib/api/auth.ts) para uso em Server
// Components / layouts, onde a sessão vem do cookie (via lib/supabase/server.ts)
// em vez de um Bearer token. Mesma fonte de verdade de role (tenant_members).
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "./auth";

export type AdminTenantContext = {
  ok: true;
  tenantId: string;
  userId: string;
  role: string;
};

export type AdminTenantDenied = {
  ok: false;
  reason: "unauthenticated" | "no_tenant" | "forbidden";
};

// Não redireciona sozinho — quem chama decide (redirect, notFound, etc.),
// igual o app/admin/layout.tsx já fazia manualmente antes desta função existir.
export async function getAdminTenantContext(): Promise<AdminTenantContext | AdminTenantDenied> {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { ok: false, reason: "unauthenticated" };

  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .maybeSingle<{ tenant_id: string; role: string | null }>();

  if (!member?.tenant_id) return { ok: false, reason: "no_tenant" };
  if (!isAdminRole(member.role)) return { ok: false, reason: "forbidden" };

  return { ok: true, tenantId: member.tenant_id, userId: user.id, role: member.role as string };
}

// Mesma checagem, mas reaproveitando um client já em mãos (ex: rotas que
// já fizeram createClient() + auth.getUser() e precisam do mesmo client de
// sessão, com RLS ativo, pras queries seguintes — evita criar um segundo
// client só pra essa checagem).
export async function resolveAdminTenant(
  supabase: any,
  userId: string
): Promise<{ tenantId: string; role: string } | null> {
  const { data } = await supabase
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle() as { data: { tenant_id: string; role: string | null } | null };

  if (!data?.tenant_id || !isAdminRole(data.role)) return null;
  return { tenantId: data.tenant_id, role: data.role as string };
}
