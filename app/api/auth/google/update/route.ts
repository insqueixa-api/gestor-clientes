import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function normalizePhone(raw: string | null | undefined) {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.startsWith("55")) return "+" + digits;
  return "+55" + digits;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    // 1. Coleta os dados enviados pelo modal (agora com arrays JSON)
    const body = await req.json();
    const { id, google_resource_name, display_name, phones, emails, labels, photo_base64 } = body;

    // 2. Busca o Tenant ID
    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!tenantData?.tenant_id) throw new Error("Tenant não encontrado");
    const tenantId = tenantData.tenant_id;

    // 3. Busca o Refresh Token
    const { data: tenantConfig } = await supabase
      .from("tenants")
      .select("google_refresh_token")
      .eq("id", tenantId)
      .single();

    if (!tenantConfig?.google_refresh_token) {
      throw new Error("Conta do Google não vinculada neste tenant.");
    }

    // 4. Renova o Access Token com o Google
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
    if (!tokenRes.ok) throw new Error("Falha ao renovar credenciais com o Google.");
    const accessToken = tokenData.access_token;

    // 5. O Google exige uma chave de validação (ETag) antes de atualizar. Puxamos ela agora:
    const getPersonRes = await fetch(
      `https://people.googleapis.com/v1/${google_resource_name}?personFields=metadata`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const personCurrentData = await getPersonRes.json();
    if (!getPersonRes.ok) throw new Error("Contato não localizado na agenda do Google.");
    const etag = personCurrentData.etag;

    // 6. Monta o pacote de dados seguindo o padrão rígido do Google People API (agora dinâmico)
    const googlePayload: any = {
      etag: etag,
      names: [{ givenName: display_name || "Sem Nome" }],
      emailAddresses: (emails || []).map((e: any) => ({ value: e.value, type: e.label || "home" })),
      phoneNumbers: (phones || []).map((p: any) => ({ value: normalizePhone(p.value), type: p.label || "mobile" }))
    };

    // 7. Envia a atualização para os servidores do Google
    const updateRes = await fetch(
      `https://people.googleapis.com/v1/${google_resource_name}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(googlePayload),
      }
    );

    if (!updateRes.ok) {
      const errorData = await updateRes.json();
      throw new Error("Erro na API do Google: " + (errorData.error?.message || "Falha desconhecida"));
    }

    // 8. Se deu certo no Google, salva o reflexo atualizado no Supabase
    const { error: dbErr } = await supabase
      .from("google_contacts")
      .update({
        display_name,
        phones, // Array JSON novo
        emails, // Array JSON novo
        labels,
        // Atualiza o principal caso o sistema use para envios de WPP antigos
        phone_e164: phones && phones.length > 0 ? normalizePhone(phones.value) : null,
        synced_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (dbErr) throw new Error("Erro ao atualizar banco local: " + dbErr.message);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Erro na rota de update do Google:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}