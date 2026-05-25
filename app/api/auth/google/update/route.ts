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

// 🪄 TRADUTOR DE LABELS PARA O GOOGLE
function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  // Se for "Vivo", "Claro", ou qualquer nome livre, forçamos como Customizado:
  return { type: "custom", customType: label };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json();
    const { id, google_resource_name, display_name, phones, emails, labels, photo_base64 } = body;

    const { data: tenantData } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", user.id).limit(1).single();
    if (!tenantData?.tenant_id) throw new Error("Tenant não encontrado");
    const tenantId = tenantData.tenant_id;

    const { data: tenantConfig } = await supabase.from("tenants").select("google_refresh_token").eq("id", tenantId).single();
    if (!tenantConfig?.google_refresh_token) throw new Error("Conta do Google não vinculada.");

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
    if (!tokenRes.ok) throw new Error("Falha ao renovar credenciais.");
    const accessToken = tokenData.access_token;

    // 1. Pega o ETag (Obrigatório para atualizar)
    const getPersonRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}?personFields=metadata`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const personCurrentData = await getPersonRes.json();
    if (!getPersonRes.ok) throw new Error("Contato não localizado.");
    const etag = personCurrentData.etag;

    // 2. Busca e mapeia os IDs dos Grupos (Labels)
    let memberships: any[] = [];
    if (labels && labels.length > 0) {
      const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups", { headers: { Authorization: `Bearer ${accessToken}` } });
      const groupsData = await groupsRes.json();
      if (groupsData.contactGroups) {
        labels.forEach((lbl: string) => {
          // Procura o grupo pelo nome exato e pega o ID interno
          const found = groupsData.contactGroups.find((g: any) => g.name === lbl || g.formattedName === lbl);
          if (found) memberships.push({ contactGroupMembership: { contactGroupResourceName: found.resourceName } });
        });
      }
    }

    // 3. Monta o pacote de dados traduzido
    const googlePayload: any = {
      etag: etag,
      names: [{ givenName: display_name || "Sem Nome" }],
      emailAddresses: (emails || []).map((e: any) => ({ value: e.value, ...getGoogleLabel(e.label, "other") })),
      phoneNumbers: (phones || []).map((p: any) => ({ value: normalizePhone(p.value), ...getGoogleLabel(p.label, "mobile") })),
      memberships: memberships
    };

    // 4. Salva os textos no Google
    const updateRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers,memberships`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(googlePayload),
    });
    if (!updateRes.ok) throw new Error("Erro na API do Google");

    // 5. Salva a foto no Google (Endpoint separado)
    if (photo_base64 && photo_base64.includes("base64,")) {
      const base64Data = photo_base64.split(",");
      await fetch(`https://people.googleapis.com/v1/${google_resource_name}:updateContactPhoto`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ photoBytes: base64Data })
      });
    }

    // 6. Salva no banco local
    await supabase.from("google_contacts").update({
      display_name, phones, emails, labels,
      phone_e164: phones && phones.length > 0 ? normalizePhone(phones.value) : null,
      synced_at: new Date().toISOString()
    }).eq("id", id).eq("tenant_id", tenantId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Erro no update:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}