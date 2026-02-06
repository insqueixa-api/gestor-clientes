"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  // Mesmo se der erro, a gente força ir pro /login (sessão local vai cair)
  if (error) {
    console.warn("[logout] signOut error:", error.message);
  }

  redirect("/login");
}
