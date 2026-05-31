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

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");

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
      const phonesList = (person.phoneNumbers || []).map((p: any) => ({ label: p.formattedType || p.type || "Celular", value: formatPhone(p.value) }));
      const emailsList = (person.emailAddresses || []).map((e: any) => ({ label: e.formattedType || e.type || "Pessoal", value: e.value }));
      
      const labels: string[] = [];
      if (person.memberships) {
        person.memberships.forEach((m: any) => {
          const groupId = m.contactGroupMembership?.contactGroupResourceName;
          if (groupId && groupMap.has(groupId)) {
            const groupName = groupMap.get(groupId)!;
            // 🚀 IGNORA O MYCONTACTS DO FRONTEND PARA LIMPAR O VISUAL
            if (groupName !== "myContacts") labels.push(groupName);
          }
        });
      }

      let birthdayText = person.birthdays?.[0]?.text || null;
      if (!birthdayText && person.birthdays?.[0]?.date) {
        const d = person.birthdays[0].date;
        birthdayText = `${d.year ? d.year + '-' : '--'}${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      }

      return {
        tenant_id: tenantId,
        google_resource_name: person.resourceName,
        display_name: person.names?.[0]?.displayName || "Sem Nome",
        phones: phonesList,
        emails: emailsList,
        phone_e164: phonesList.length > 0 ? phonesList[ 0 ].value.replace(/\D/g, "") : null,
        avatar_url: person.photos?.[0]?.url || null,
        birthday: birthdayText,
        labels: labels,
        synced_at: new Date().toISOString()
      };
    });

    if (mode === "replace") {
      // 1. Limpa o terreno: deleta TODOS os contatos antigos deste tenant
      const { error: delErr } = await supabase.from("google_contacts").delete().eq("tenant_id", tenantId);
      if (delErr) throw new Error(delErr.message);

      // 2. Insere a lista fresquinha que acabou de vir do Google
      if (recordsToInsert.length > 0) {
        const { error: insErr } = await supabase.from("google_contacts").insert(recordsToInsert);
        if (insErr) throw new Error(insErr.message);
      }
    } else {
      // Comportamento padrão de Sync (Upsert) caso você precise no futuro
      if (recordsToInsert.length > 0) {
        const { error: dbErr } = await supabase.from("google_contacts").upsert(recordsToInsert, { onConflict: "tenant_id, google_resource_name" });
        if (dbErr) throw new Error(dbErr.message);
      }
    }

    return NextResponse.json({ success: true, count: recordsToInsert.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}