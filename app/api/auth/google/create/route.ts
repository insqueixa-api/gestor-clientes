// app/api/auth/google/create/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatPhone(raw: string | null | undefined) {
  if (!raw) return null;
  let clean = raw.replace(/\D+/g, "");
  if (!clean) return raw;

  const hasPlus = raw.trim().startsWith("+");
  if (hasPlus) {
    if (clean.startsWith("55") && clean.length >= 12) {
      clean = clean.substring(2);
    } else {
      return "+" + clean; 
    }
  }

  if (clean.startsWith("0")) clean = clean.substring(1);

  if (clean.length === 11) {
    return `0${clean.substring(0, 2)} ${clean.substring(2, 7)}-${clean.substring(7)}`;
  } else if (clean.length === 10) {
    return `0${clean.substring(0, 2)} ${clean.substring(2, 6)}-${clean.substring(6)}`;
  }
  return raw;
}

function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  return { type: label };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json();
    const { display_name, phones, emails, labels, photo_base64 } = body;

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

    let finalMemberships: any[] = [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } }];
    if (labels && labels.length > 0) {
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
          if (createGrpRes.ok) found = await createGrpRes.json();
        }
        if (found) finalMemberships.push({ contactGroupMembership: { contactGroupResourceName: found.resourceName } });
      }
    }

    const formattedPhones = (phones || []).map((p: any) => ({ label: p.label, value: formatPhone(p.value) }));

    const googlePayload: any = {
      names: [{ givenName: display_name || "Sem Nome" }],
      emailAddresses: (emails || []).map((e: any) => ({ value: e.value, ...getGoogleLabel(e.label, "other") })),
      phoneNumbers: formattedPhones.map((p: any) => ({ value: p.value, ...getGoogleLabel(p.label, "mobile") })),
      memberships: finalMemberships
    };

    const createRes = await fetch(`https://people.googleapis.com/v1/people:createContact`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(googlePayload),
    });
    if (!createRes.ok) throw new Error(`Erro ao criar contato no Google`);

    const newContact = await createRes.json();
    const google_resource_name = newContact.resourceName;

    let finalAvatarUrl = null;
    if (photo_base64 && photo_base64.includes("base64,")) {
      const base64Data = photo_base64.split(",")[ 1 ];
      const photoRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}:updateContactPhoto`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ photoBytes: base64Data })
      });
      if (photoRes.ok) {
         const getPhotoRes = await fetch(`https://people.googleapis.com/v1/${google_resource_name}?personFields=photos`, { headers: { Authorization: `Bearer ${accessToken}` } });
         if (getPhotoRes.ok) {
            const freshData = await getPhotoRes.json();
            if (freshData.photos?.[0]?.url) finalAvatarUrl = freshData.photos[ 0 ].url;
         }
      }
    }

    await supabase.from("google_contacts").insert({
      tenant_id: tenantId,
      google_resource_name: google_resource_name,
      display_name, 
      phones: formattedPhones, 
      emails, 
      labels,
      phone_e164: formattedPhones.length > 0 ? formattedPhones[ 0 ].value.replace(/\D/g, "") : null,
      avatar_url: finalAvatarUrl,
      synced_at: new Date().toISOString()
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}