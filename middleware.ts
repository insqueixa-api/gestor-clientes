import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
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

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

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
  // Se o usuário logou, mas não tem tenant, ele não pode ficar no /admin.
  if (user && pathname.startsWith('/admin')) {
    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // Se não caiu em nenhuma regra de redirecionamento, continua normalmente.
  // Isso permite que um usuário logado acesse /renew ou qualquer outra rota sem bloqueios.
  return response;
}

export const config = {
  matcher: [
    "/((?!monitoring|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};