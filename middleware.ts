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

// 2. Verifica o usuário
  const { data: { user } } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();

  // --- REGRAS DE PROTEÇÃO ATUALIZADAS ---

  // A. Proteção da nova pasta admin (antigo /admin)
  if (!user && url.pathname.startsWith('/admin')) {
    // Se não está logado e tenta entrar no admin, manda para a tela de login
    
    if (url.pathname !== '/admin') {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
  }

  // B. Se já estiver logado e tentar acessar a raiz / ou o /admin (estando na tela de login)
  // Redireciona para o Dashboard interno
  if (user && url.pathname === '/admin') {
     // Aqui você redireciona para a página interna do seu dashboard
     
     
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