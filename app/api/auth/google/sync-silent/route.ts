import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function normalizePhone(raw: string | null | undefined) {
  if (!raw) return null;
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (raw.trim().startsWith("+")) return "+" + digits;
  if (digits.startsWith("55") && digits.length >= 12) return "+" + digits;
  if (digits.startsWith("0")) digits = digits.substring(1);
  return "+55" + digits;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const { data: tenantData } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", user.id).limit(1).single();
    const tenantId = tenantData?.tenant_id;

    const { data: tenantConfig } = await supabase.from("tenants").select("google_refresh_token").eq("id", tenantId).single();
    if (!tenantConfig?.google_refresh_token) return NextResponse.json({ error: "Faça login no Google." }, { status: 400 });

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
    if (!tokenRes.ok) throw new Error("Acesso revogado.");
    const accessToken = tokenData.access_token;

    const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups", { headers: { Authorization: `Bearer ${accessToken}` } });
    const groupsData = await groupsRes.json();
    const groupMap = new Map<string, string>();
    
    if (groupsData.contactGroups) {
      groupsData.contactGroups.forEach((g: any) => groupMap.set(g.resourceName, g.name || g.formattedName));
    }

    const contactsRes = await fetch(
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,photos,birthdays,memberships&pageSize=1000",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const contactsData = await contactsRes.json();
    const connections = contactsData.connections || [];

    const recordsToInsert = connections.map((person: any) => {
      const phonesList = (person.phoneNumbers || []).map((p: any) => ({ label: p.formattedType || "Celular", value: p.value }));
      const emailsList = (person.emailAddresses || []).map((e: any) => ({ label: e.formattedType || "Pessoal", value: e.value }));
      
      const labels: string[] = [];
      if (person.memberships) {
        person.memberships.forEach((m: any) => {
          const groupId = m.contactGroupMembership?.contactGroupResourceName;
          if (groupId && groupMap.has(groupId)) {
            const groupName = groupMap.get(groupId)!;
            // 🔥 MÁGICA 4: Esconde o myContacts do seu painel!
            if (groupName !== "myContacts") labels.push(groupName);
          }
        });
      }

      let birthdayText = person.birthdays?.[0]?.text || null;
      if (!birthdayText && person.birthdays?.[0]?.date) {
        const d = person.birthdays.date;
        birthdayText = `${d.year ? d.year + '-' : '--'}${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      }

      return {
        tenant_id: tenantId,
        google_resource_name: person.resourceName,
        display_name: person.names?.[0]?.displayName || "Sem Nome",
        phones: phonesList,
        emails: emailsList,
        phone_e164: phonesList.length > 0 ? normalizePhone(phonesList.value) : null,
        avatar_url: person.photos?.[0]?.url || null,
        birthday: birthdayText,
        labels: labels,
        synced_at: new Date().toISOString()
      };
    });

    if (recordsToInsert.length > 0) {
      const { error: dbErr } = await supabase.from("google_contacts").upsert(recordsToInsert, { onConflict: "tenant_id, google_resource_name" });
      if (dbErr) throw new Error(dbErr.message);
    }

    return NextResponse.json({ success: true, count: recordsToInsert.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}