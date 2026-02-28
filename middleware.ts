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
// --- REGRAS DE PROTEÇÃO ATUALIZADAS ---

  // A. Se NÃO estiver logado e tentar acessar o painel -> Vai pro login
  if (!user && url.pathname.startsWith('/admin')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

// B. Se JÁ ESTIVER logado e tentar acessar a tela de login -> Vai pro dashboard
  if (user && url.pathname === '/login') {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url));
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