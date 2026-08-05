// lib/api/auth-server.ts
// Equivalente de requireAdminTenant (lib/api/auth.ts) para uso em Server
// Components / layouts, onde a sessão vem do cookie (via lib/supabase/server.ts)
// em vez de um Bearer token. Mesma fonte de verdade de role (tenant_members).
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "./auth";
import { flagSuspiciousAccess } from "@/lib/observability";
import { ADMIN_CTX_COOKIE, ADMIN_CTX_MAX_AGE, ADMIN_CTX_REVALIDATE_MS, parseAdminCtxCookie, type AdminCtxCookiePayload } from "./admin-ctx";

export type AdminTenantContext = {
  ok: true;
  tenantId: string;
  userId: string;
  role: string;
  tenantName: string | null;
  displayName: string | null;
};

export type AdminTenantDenied = {
  ok: false;
  reason: "unauthenticated" | "no_tenant" | "forbidden";
};

// ✅ Cache do contexto admin (tenant/role/nomes) num cookie httpOnly, setado
// no login e limpo no logoff — pedido do Marcio, 04/08/2026: único usuário
// do sistema, não precisa reconsultar tenant_members/tenants/profiles em
// toda navegação, só quando a sessão trocar de usuário ou for renovada.
// ✅ 05/08/2026: o cookie também guarda `verifiedAt` — enquanto estiver
// dentro de ADMIN_CTX_REVALIDATE_MS (24h), getAdminTenantContext nem chama
// auth.getUser() (que bate no servidor de Auth do Supabase a cada request,
// inclusive em prefetch de <Link>); usa só supabase.auth.getSession(), que
// é leitura local do cookie de sessão, sem round-trip. A autorização de
// dados de verdade continua imposta pelas policies de RLS via auth.uid().
async function readAdminCtxCookie(userId: string): Promise<AdminCtxCookiePayload | null> {
  try {
    const store = await cookies();
    return parseAdminCtxCookie(store.get(ADMIN_CTX_COOKIE)?.value, userId);
  } catch {
    return null;
  }
}

// ✅ Só grava de verdade quando chamado de um contexto que pode escrever
// cookie (Server Action / Route Handler — ex: login). Chamado a partir de
// Server Component (ex: app/admin/layout.tsx) falha silenciosamente
// (mesma limitação do Next.js já documentada em lib/supabase/server.ts) —
// nesse caso a função segue funcionando, só sem popular o cache.
export async function writeAdminCtxCookie(payload: AdminCtxCookiePayload): Promise<void> {
  try {
    const store = await cookies();
    store.set(ADMIN_CTX_COOKIE, JSON.stringify(payload), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ADMIN_CTX_MAX_AGE,
    });
  } catch {
    // silencioso — ver comentário acima
  }
}

export async function clearAdminCtxCookie(): Promise<void> {
  try {
    const store = await cookies();
    store.delete(ADMIN_CTX_COOKIE);
  } catch {
    // idem — se por algum motivo for chamado de onde cookie é readonly
  }
}

// Não redireciona sozinho — quem chama decide (redirect, notFound, etc.),
// igual o app/admin/layout.tsx já fazia manualmente antes desta função existir.
export async function getAdminTenantContext(): Promise<AdminTenantContext | AdminTenantDenied> {
  const supabase = await createClient();

  // 1) Tentativa barata: sessão local (sem bater no servidor de Auth). Se o
  // cookie de contexto já foi verificado de verdade há menos de 24h para
  // esse mesmo usuário, confia nela e nem chama auth.getUser().
  const { data: sessionData } = await supabase.auth.getSession();
  const localUserId = sessionData?.session?.user?.id;
  if (localUserId) {
    const cached = await readAdminCtxCookie(localUserId);
    if (cached && Date.now() - cached.verifiedAt < ADMIN_CTX_REVALIDATE_MS) {
      return {
        ok: true,
        tenantId: cached.tenantId,
        userId: localUserId,
        role: cached.role,
        tenantName: cached.tenantName,
        displayName: cached.displayName,
      };
    }
  }

  // 2) Cache ausente/vencido — verificação de verdade, batendo no servidor
  // de Auth do Supabase.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { ok: false, reason: "unauthenticated" };

  const cached = await readAdminCtxCookie(user.id);
  if (cached && Date.now() - cached.verifiedAt < ADMIN_CTX_REVALIDATE_MS) {
    return {
      ok: true,
      tenantId: cached.tenantId,
      userId: user.id,
      role: cached.role,
      tenantName: cached.tenantName,
      displayName: cached.displayName,
    };
  }

  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .maybeSingle<{ tenant_id: string; role: string | null }>();

  if (!member?.tenant_id) return { ok: false, reason: "no_tenant" };
  if (!isAdminRole(member.role)) {
    flagSuspiciousAccess("role_nao_admin", { user_id: user.id, tenant_id: member.tenant_id, role: member.role });
    return { ok: false, reason: "forbidden" };
  }

  // Nome do tenant + nome do perfil — independentes entre si, em paralelo.
  const [{ data: tenantRow }, { data: profile }] = await Promise.all([
    supabase.from("tenants").select("name").eq("id", member.tenant_id).maybeSingle<{ name: string | null }>(),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle<{ display_name: string | null }>(),
  ]);

  const ctx: AdminTenantContext = {
    ok: true,
    tenantId: member.tenant_id,
    userId: user.id,
    role: member.role as string,
    tenantName: tenantRow?.name ?? null,
    displayName: profile?.display_name ?? null,
  };

  await writeAdminCtxCookie({
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    role: ctx.role,
    tenantName: ctx.tenantName,
    displayName: ctx.displayName,
    verifiedAt: Date.now(),
  });

  return ctx;
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

  if (!data?.tenant_id) return null;
  if (!isAdminRole(data.role)) {
    flagSuspiciousAccess("role_nao_admin", { user_id: userId, tenant_id: data.tenant_id, role: data.role });
    return null;
  }
  return { tenantId: data.tenant_id, role: data.role as string };
}
