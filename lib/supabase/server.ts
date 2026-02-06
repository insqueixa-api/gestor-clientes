import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
// import { Database } from "@/types/database"; // Descomente se tiver as tipagens geradas

export const createClient = async () => {
  // Await no cookies() é obrigatório no Next.js 15+
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set({ name, value, ...options })
            );
          } catch {
            // O try/catch é necessário porque esse método pode ser chamado 
            // de um Server Component (onde cookies são readonly), 
            // mas no caso do LOGOUT (Server Action), o catch não é ativado e a escrita funciona.
          }
        },
      },
    }
  );
};