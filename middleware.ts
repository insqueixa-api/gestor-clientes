import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  // 1. Cria uma resposta inicial que permite passar headers
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // A. Atualiza os cookies no request (para o Next.js saber agora)
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
          });

          // B. Recria a resposta para incluir os cookies atualizados
          response = NextResponse.next({
            request,
          });

          // C. Atualiza os cookies na resposta (para o navegador salvar)
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // 2. Verifica o usuário (Isso dispara o setAll se o token precisar de refresh)
  const { data: { user } } = await supabase.auth.getUser();

  // --- REGRAS DE PROTEÇÃO ---

  // A. Se NÃO estiver logado e tentar acessar área /admin -> Manda para Login
  if (!user && request.nextUrl.pathname.startsWith('/admin')) {
    const loginUrl = new URL('/login', request.url);
    // Removemos o parâmetro 'next' para simplificar, já que o redirect padrão do login é /admin
    return NextResponse.redirect(loginUrl);
  }

  // B. Se JÁ estiver logado e tentar acessar /login -> Manda para Admin
  if (user && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  // C. Se estiver logado e na raiz /, manda para /admin (Opcional, boa prática)
  if (user && request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Aplica o middleware em todas as rotas, exceto arquivos estáticos e de imagem
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};