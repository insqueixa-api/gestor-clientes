import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAdminRole } from "@/lib/api/auth";
import { flagSuspiciousAccess } from "@/lib/observability";
import {
  ADMIN_CTX_COOKIE,
  ADMIN_CTX_HEADER,
  ADMIN_CTX_MAX_AGE,
  ADMIN_CTX_REVALIDATE_MS,
  parseAdminCtxCookie,
  type AdminCtxCookiePayload,
} from "@/lib/api/admin-ctx";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ✅ 05/08/2026: `user` só influencia decisão em duas rotas (/admin exige
  // login, /login redireciona quem já está logado) — em qualquer outra rota
  // (/renew do portal do cliente, /api/*, etc.) essa checagem rodava à toa
  // em TODA requisição, batendo no servidor de Auth do Supabase sem que o
  // resultado mudasse nada. Fora de /admin e /login, nem cria o client.
  if (!pathname.startsWith('/admin') && pathname !== '/login') {
    return NextResponse.next();
  }

  // ✅ 27/08/2026: apaga qualquer x-admin-ctx que já venha no request antes
  // de decidir se seta um de verdade — sem isso, um client malicioso
  // poderia forjar esse header e o layout (que passa a confiar nele, ver
  // lib/api/admin-ctx.ts) leria tenant/role errados sem bater no Supabase.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(ADMIN_CTX_HEADER);

  let cookiesToForward: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          cookiesToForward = cookiesToSet;
        },
      },
    }
  );

  // ✅ Mesmo esquema de lib/api/auth-server.ts: tentativa barata primeiro
  // (getSession, leitura local do cookie, sem round-trip) — só escala pra
  // getUser() (que bate no servidor de Auth) quando o cache admin_ctx não
  // existe ou passou de 24h. Único usuário do sistema, não precisa
  // reconfirmar a sessão em toda navegação pro /admin.
  const { data: sessionData } = await supabase.auth.getSession();
  let user = sessionData?.session?.user ?? null;
  let cached = user ? parseAdminCtxCookie(request.cookies.get(ADMIN_CTX_COOKIE)?.value, user.id) : null;
  const trustedFresh = !!cached && Date.now() - cached.verifiedAt < ADMIN_CTX_REVALIDATE_MS;

  if (!trustedFresh) {
    const { data } = await supabase.auth.getUser();
    user = data.user;
    cached = user ? parseAdminCtxCookie(request.cookies.get(ADMIN_CTX_COOKIE)?.value, user.id) : null;
  }

  // 1. REGRA: Se tentar acessar /admin, deve estar logado.
  // Se não estiver logado, redireciona para /login.
  if (pathname.startsWith('/admin') && !user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 2. REGRA: Se já estiver logado e tentar acessar o /login, manda para /admin.
  // IMPORTANTE: Isso ignora quem está tentando acessar o /renew (que não é /login).
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // 3. REGRA DE SEGURANÇA NO ADMIN:
  // Se o usuário logou, mas não tem tenant OU não tem role de admin, ele não
  // pode ficar no /admin. Mesma regra de lib/api/auth.ts (isAdminRole) — é a
  // fonte única de verdade pra "o que conta como admin", só o jeito de pegar
  // o client Supabase que continua separado (proxy usa cookie de request,
  // Server Component usa next/headers).
  //
  // ✅ 27/08/2026: além de validar, agora resolve o contexto completo aqui
  // (Edge, sem cold-start de container) e repassa via ADMIN_CTX_HEADER pro
  // app/admin/layout.tsx — que antes refazia essa mesma consulta inteira em
  // Node a cada navegação. Mesmo caminho frio de lib/api/auth-server.ts
  // (getAdminTenantContext): tenant_members → tenants+profiles em paralelo
  // → grava cookie de cache. Duplicado de propósito (igual o resto deste
  // arquivo já fazia) em vez de importar de auth-server.ts, que puxa
  // next/headers e não roda em Edge.
  let resolvedCtx: AdminCtxCookiePayload | null = null;

  if (user && pathname.startsWith('/admin')) {
    if (trustedFresh && cached) {
      resolvedCtx = cached;
    } else {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .maybeSingle<{ tenant_id: string; role: string | null }>();

      if (!member) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL('/login', request.url));
      }

      if (!isAdminRole(member.role)) {
        flagSuspiciousAccess("role_nao_admin", { user_id: user.id, tenant_id: member.tenant_id, role: member.role, where: "proxy" });
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL('/login', request.url));
      }

      const [{ data: tenantRow }, { data: profile }] = await Promise.all([
        supabase.from("tenants").select("name").eq("id", member.tenant_id).maybeSingle<{ name: string | null }>(),
        supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle<{ display_name: string | null }>(),
      ]);

      resolvedCtx = {
        userId: user.id,
        tenantId: member.tenant_id,
        role: member.role as string,
        tenantName: tenantRow?.name ?? null,
        displayName: profile?.display_name ?? null,
        verifiedAt: Date.now(),
      };

      cookiesToForward.push({
        name: ADMIN_CTX_COOKIE,
        value: JSON.stringify(resolvedCtx),
        options: {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: ADMIN_CTX_MAX_AGE,
        },
      });
    }
  }

  if (resolvedCtx) {
    requestHeaders.set(ADMIN_CTX_HEADER, JSON.stringify(resolvedCtx));
  }

  // Se não caiu em nenhuma regra de redirecionamento, continua normalmente.
  // Isso permite que um usuário logado acesse /renew ou qualquer outra rota sem bloqueios.
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  cookiesToForward.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any));
  return response;
}

export const config = {
  // ✅ 05/08/2026: a função só faz algo em /admin/* (exige login) e /login
  // (redireciona quem já logou) — o matcher antigo cobria praticamente toda
  // rota do site (inclusive /renew e todo /api/client-portal/* usado pelos
  // clientes no link mágico), rodando essa checagem à toa em cada request.
  matcher: ["/admin/:path*", "/login"],
};