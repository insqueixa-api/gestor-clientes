import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function normalizePhone(raw: string | null | undefined) {
  if (!raw) return null;
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.startsWith("55") && digits.length >= 12) return "+" + digits;
  // 🔥 MÁGICA 1: Arranca o ZERO do DDD se a pessoa digitar (ex: 021 vira 21)
  if (digits.startsWith("0")) digits = digits.substring(1);
  return "+55" + digits;
}

function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  // 🔥 MÁGICA 2: O Google aceita o rótulo direto no 'type'
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
        if (cleanLbl.toLowerCase() === "mycontacts") continue; // Ignora o myContacts limpo

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

    // Mantém o myContacts invisível para o Google não arquivar o contato
    if (personCurrentData.memberships) {
      const hasMyContacts = personCurrentData.memberships.some((m: any) => m.contactGroupMembership?.contactGroupResourceName === "contactGroups/myContacts");
      if (hasMyContacts) {
        const alreadyIn = finalMemberships.some(m => m.contactGroupMembership?.contactGroupResourceName === "contactGroups/myContacts");
        if (!alreadyIn) finalMemberships.push({ contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } });
      }
    }

    const googlePayload: any = {
      etag: etag,
      names: [{ givenName: display_name || "Sem Nome" }],
      emailAddresses: (emails || []).map((e: any) => ({ value: e.value, ...getGoogleLabel(e.label, "other") })),
      phoneNumbers: (phones || []).map((p: any) => ({ value: normalizePhone(p.value), ...getGoogleLabel(p.label, "mobile") })),
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

    // 🔥 MÁGICA 3: Pega o link da foto nova que o Google gerou e salva
    let finalAvatarUrl = null;
    if (photo_base64 && photo_base64.includes("base64,")) {
      const base64Data = photo_base64.split(",");
      const photoRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}:updateContactPhoto`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ photoBytes: base64Data })
      });
      if (photoRes.ok) {
        const photoData = await photoRes.json();
        if (photoData.person?.photos?.[0]?.url) {
          finalAvatarUrl = photoData.person.photos[0].url;
        }
      }
    }

    // Salva no banco local
    const updateData: any = {
      display_name, phones, emails, labels,
      phone_e164: phones && phones.length > 0 ? normalizePhone(phones.value) : null,
      synced_at: new Date().toISOString()
    };
    if (finalAvatarUrl) updateData.avatar_url = finalAvatarUrl; // Aplica a foto nova no Supabase

    await supabase.from("google_contacts").update(updateData).eq("id", id).eq("tenant_id", tenantId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Erro no update:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}