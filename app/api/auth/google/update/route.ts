// app/api/auth/google/update/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 🚀 O NOVO FORMATADOR INTELIGENTE (0XX XXXXX-XXXX)
function formatPhone(raw: string | null | undefined) {
  if (!raw) return null;
  let clean = raw.replace(/\D+/g, "");
  if (!clean) return raw;

  const hasPlus = raw.trim().startsWith("+");
  if (hasPlus) {
    if (clean.startsWith("55") && clean.length >= 12) {
      clean = clean.substring(2); // Arranca o 55 para formatar padrão Brasil
    } else {
      return "+" + clean; // Se for outro país (+1, +351), mantém intocável
    }
  }

  // Tira o zero da frente se a pessoa digitou 021
  if (clean.startsWith("0")) clean = clean.substring(1);

  // Formata Celular (11 dígitos) ou Fixo (10 dígitos)
  if (clean.length === 11) {
    return `0${clean.substring(0, 2)} ${clean.substring(2, 7)}-${clean.substring(7)}`;
  } else if (clean.length === 10) {
    return `0${clean.substring(0, 2)} ${clean.substring(2, 6)}-${clean.substring(6)}`;
  }
  
  return raw; // Fallback: Salva como digitou se for estranho
}

function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  // 🚀 O SEGREDO DO GOOGLE: Aceita a operadora direto no type
  return { type: label };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json();
    const { id, google_resource_name, display_name, phones, emails, labels, photo_base64 } = body;

    const { data: tenantData } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", user.id).limit(1).single();
    const tenantId = tenantData?.tenant_id;

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

    const getPersonRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}?personFields=metadata,memberships`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const personCurrentData = await getPersonRes.json();
    const etag = personCurrentData.etag;

    let finalMemberships: any[] = [];
    if (labels !== undefined) {
      const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups", { headers: { Authorization: `Bearer ${accessToken}` } });
      const groupsData = await groupsRes.json();
      let existingGroups = groupsData.contactGroups || [];

      for (const lbl of labels) {
        const cleanLbl = lbl.trim();
        if (cleanLbl.toLowerCase() === "mycontacts") continue;

        let found = existingGroups.find((g: any) => g.name === cleanLbl || g.formattedName === cleanLbl);
        if (!found) {
          const createGrpRes = await fetch("https://people.googleapis.com/v1/contactGroups", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ contactGroup: { name: cleanLbl } })
          });
          if (createGrpRes.ok) {
            found = await createGrpRes.json();
            existingGroups.push(found);
          }
        }
        if (found) finalMemberships.push({ contactGroupMembership: { contactGroupResourceName: found.resourceName } });
      }
    }

    if (personCurrentData.memberships) {
      const hasMyContacts = personCurrentData.memberships.some((m: any) => m.contactGroupMembership?.contactGroupResourceName === "contactGroups/myContacts");
      if (hasMyContacts) {
        const alreadyIn = finalMemberships.some(m => m.contactGroupMembership?.contactGroupResourceName === "contactGroups/myContacts");
        if (!alreadyIn) finalMemberships.push({ contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } });
      }
    }

    // Formata TODOS os telefones antes de enviar pro Google
    const formattedPhones = (phones || []).map((p: any) => ({ label: p.label, value: formatPhone(p.value) }));

    const googlePayload: any = {
      etag: etag,
      names: [{ givenName: display_name || "Sem Nome" }],
      emailAddresses: (emails || []).map((e: any) => ({ value: e.value, ...getGoogleLabel(e.label, "other") })),
      phoneNumbers: formattedPhones.map((p: any) => ({ value: p.value, ...getGoogleLabel(p.label, "mobile") })),
      memberships: finalMemberships
    };

    const updateRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers,memberships`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(googlePayload),
    });
    
    if (!updateRes.ok) {
      const errData = await updateRes.json();
      throw new Error(`Google API: ${errData.error?.message}`);
    }

    // 🚀 BUSCA FORÇADA DA FOTO NOVA
    let finalAvatarUrl = null;
    if (photo_base64 && photo_base64.includes("base64,")) {
      const base64Data = photo_base64.split(",")[1];
      const photoRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}:updateContactPhoto`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ photoBytes: base64Data })

      });
      
      if (photoRes.ok) {
         const getPhotoRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}?personFields=photos`, {
           headers: { Authorization: `Bearer ${accessToken}` }
         });
         if (getPhotoRes.ok) {
            const freshData = await getPhotoRes.json();
            if (freshData.photos?.[ 0 ]?.url) finalAvatarUrl = freshData.photos[ 0 ].url;
            }
         }
      }
    

    // Salva no banco local
    const updateData: any = {
      display_name, 
      phones: formattedPhones, 
      emails, 
      labels,
      phone_e164: formattedPhones.length > 0 ? formattedPhones[0].value.replace(/\D/g, "") : null,

      synced_at: new Date().toISOString()
    };
    if (finalAvatarUrl) updateData.avatar_url = finalAvatarUrl;

    await supabase.from("google_contacts").update(updateData).eq("id", id).eq("tenant_id", tenantId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}