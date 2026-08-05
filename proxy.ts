import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAdminRole } from "@/lib/api/auth";
import { flagSuspiciousAccess } from "@/lib/observability";
import { ADMIN_CTX_COOKIE, ADMIN_CTX_REVALIDATE_MS, parseAdminCtxCookie } from "@/lib/api/admin-ctx";

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

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
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
  if (user && pathname.startsWith('/admin')) {
    // ✅ Mesmo cache de lib/api/auth-server.ts (cookie setado no login, até
    // o logoff) — se já validamos essa sessão antes (cache ainda dentro da
    // janela de 24h), pula a consulta a tenant_members aqui também.
    if (!trustedFresh) {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!member) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL('/login', request.url));
      }

      if (!isAdminRole(member.role)) {
        flagSuspiciousAccess("role_nao_admin", { user_id: user.id, tenant_id: member.tenant_id, role: member.role, where: "proxy" });
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL('/login', request.url));
      }
    }
  }

  // Se não caiu em nenhuma regra de redirecionamento, continua normalmente.
  // Isso permite que um usuário logado acesse /renew ou qualquer outra rota sem bloqueios.
  return response;
}

export const config = {
  // ✅ 05/08/2026: a função só faz algo em /admin/* (exige login) e /login
  // (redireciona quem já logou) — o matcher antigo cobria praticamente toda
  // rota do site (inclusive /renew e todo /api/client-portal/* usado pelos
  // clientes no link mágico), rodando essa checagem à toa em cada request.
  matcher: ["/admin/:path*", "/login"],
};