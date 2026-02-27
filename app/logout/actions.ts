"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();

  // Faz o signout no servidor
  await supabase.auth.signOut({ scope: 'local' });

  // Redireciona imediatamente sem deixar rastros no console
  redirect("/login");
}
