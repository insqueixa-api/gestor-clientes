// app/logout/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { clearAdminCtxCookie } from "@/lib/api/auth-server";
import { redirect } from "next/navigation";

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();

  // Faz o signout no servidor
  await supabase.auth.signOut({ scope: 'local' });

 // Limpa o cache de tenant/role/nomes (setado no login) - sem isso, um
 // proximo login (mesmo de outra conta) podia reaproveitar dados velhos
 // ate o cookie expirar.
 await clearAdminCtxCookie();

  // Redireciona imediatamente sem deixar rastros no console
  redirect("/login");
}