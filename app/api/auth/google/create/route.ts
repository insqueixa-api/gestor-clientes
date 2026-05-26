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

function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  return { type: "custom", formattedType: label };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json();
    const { display_name, phones, emails, labels, photo_base64 } = body;

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

    // Lógica de Grupos
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
          if (createGrpRes.ok) {
             const newGroup = await createGrpRes.json();
             found = newGroup;
          }
        }
        if (found) finalMemberships.push({ contactGroupMembership: { contactGroupResourceName: found.resourceName } });
      }
    }

    const googlePayload: any = {
      names: [{ givenName: display_name || "Sem Nome" }],
      emailAddresses: (emails || []).map((e: any) => ({ value: e.value, ...getGoogleLabel(e.label, "other") })),
      phoneNumbers: (phones || []).map((p: any) => ({ value: normalizePhone(p.value), ...getGoogleLabel(p.label, "mobile") })),
      memberships: finalMemberships
    };

    const createRes = await fetch(`https://people.googleapis.com/v1/people:createContact`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(googlePayload),
    });
    
    if (!createRes.ok) {
      const errData = await createRes.json();
      throw new Error(`Google API: ${errData.error?.message || "Erro ao criar contato"}`);
    }

    const newContact = await createRes.json();
    const google_resource_name = newContact.resourceName;

    // Foto
    if (photo_base64 && photo_base64.includes("base64,")) {
      const base64Data = photo_base64.split(",");
      await fetch(`https://people.googleapis.com/v1/${google_resource_name}:updateContactPhoto`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ photoBytes: base64Data })
      });
    }

    await supabase.from("google_contacts").insert({
      tenant_id: tenantId,
      google_resource_name: google_resource_name,
      display_name, phones, emails, labels,
      phone_e164: phones && phones.length > 0 ? normalizePhone(phones.value) : null,
      synced_at: new Date().toISOString()
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}