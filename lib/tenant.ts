import { supabaseBrowser } from "./supabase/browser";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getCurrentTenantId(): Promise<string> {
  // 1. OTIMIZAÇÃO: Tenta pegar a sessão local (Cookie) primeiro. É instantâneo.
  const { data: { session } } = await supabaseBrowser.auth.getSession();
  let user = session?.user;

  // Se não achar sessão local, aí sim força uma ida ao servidor (getUser)
  if (!user) {
    const { data: userResult, error } = await supabaseBrowser.auth.getUser();
    
    if (error || !userResult.user) {
       // Só estoura erro se ambos falharem
       throw new Error("Usuário não autenticado");
    }
    user = userResult.user;
  }

  // 2. Tenta Metadata (Mais rápido)
  const metaTenant = user.app_metadata?.tenant_id || user.user_metadata?.tenant_id;
  if (metaTenant) return metaTenant;

  // 3. Busca no Banco com RETRY (Mantido igual ao seu original)
  let attempts = 0;
  const maxAttempts = 3; 
  
  while (attempts < maxAttempts) {
    const { data, error } = await supabaseBrowser
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && data?.tenant_id) {
      return data.tenant_id;
    }

    // Se não achou, espera um pouco e tenta de novo
    console.log(`Tentativa ${attempts + 1} de buscar tenant... aguardando criação automática.`);
    await delay(1000); 
    attempts++;
  }

  // Se chegou aqui, realmente falhou
  console.error("Falha: Usuário logado, mas sem vínculo em tenant_members após tentativas.", user.id);
  throw new Error("Usuário não vinculado a nenhum Tenant.");
}