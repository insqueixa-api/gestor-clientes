import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    // 1. Coleta os dados de exclusão
    const body = await req.json();
    const { id, resourceName, deleteFromGoogle } = body;

    // 2. Busca o Tenant ID
    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!tenantData?.tenant_id) throw new Error("Tenant não encontrado");
    const tenantId = tenantData.tenant_id;

    // 3. Se o usuário marcou para deletar do celular também
    if (deleteFromGoogle && resourceName) {
      const { data: tenantConfig } = await supabase
        .from("tenants")
        .select("google_refresh_token")
        .eq("id", tenantId)
        .single();

      if (tenantConfig?.google_refresh_token) {
        // Renova o token
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: tenantConfig.google_refresh_token,
            grant_type: "refresh_token",
          }),
        });

        const tokenData = await tokenRes.json();
        if (tokenRes.ok) {
          const accessToken = tokenData.access_token;
          
          // Manda o comando de exclusão para a API do Google.
          await fetch(`https://people.googleapis.com/v1/${resourceName}:deleteContact`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` }
          });
        }
      }
    }

    // 4. Exclui o contato definitivamente do Supabase
    const { error: dbErr } = await supabase
      .from("google_contacts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (dbErr) throw new Error("Erro ao deletar do banco local: " + dbErr.message);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}