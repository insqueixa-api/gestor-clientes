import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { url } from "inspector/promises";

export const dynamic = "force-dynamic";

// Helper para normalizar o telefone
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
    
    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // 1. Pega o Tenant
    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!tenantData?.tenant_id) {
      throw new Error("Tenant não encontrado");
    }
    const tenantId = tenantData.tenant_id;

    // 2. Busca o Refresh Token salvo no banco
    const { data: tenantConfig } = await supabase
      .from("tenants")
      .select("google_refresh_token")
      .eq("id", tenantId)
      .single();

    if (!tenantConfig?.google_refresh_token) {
      return NextResponse.json(
        { error: "Conta do Google não vinculada. Faça o login primeiro." }, 
        { status: 400 }
      );
    }

    // 3. Troca o Refresh Token por um NOVO Access Token (Silenciosamente)
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
    if (!tokenRes.ok) {
      throw new Error("Falha ao renovar token. Talvez o usuário tenha revogado o acesso.");
    }
    
    const accessToken = tokenData.access_token;

    // 4. Puxa os Rótulos e Contatos
    const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups", { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const groupsData = await groupsRes.json();
    const groupMap = new Map<string, string>();
    
    if (groupsData.contactGroups) {
      groupsData.contactGroups.forEach((g: any) => {
        groupMap.set(g.resourceName, g.name || g.formattedName);
      });
    }

    const contactsRes = await fetch(
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,photos,birthdays,memberships&pageSize=1000",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const contactsData = await contactsRes.json();
    const connections = contactsData.connections || [];

    // 5. Formata e salva no Supabase
    const recordsToInsert = connections.map((person: any) => {
      // CORREÇÃO: Os índices de array foram restaurados abaixo
      const rawPhone = person.phoneNumbers?.[0]?.value || null;
      
      const labels: string[] = [];
      if (person.memberships) {
        person.memberships.forEach((m: any) => {
          const groupId = m.contactGroupMembership?.contactGroupResourceName;
          if (groupId && groupMap.has(groupId)) {
            labels.push(groupMap.get(groupId)!);
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
        email: person.emailAddresses?.[0]?.value || null,
        phone_raw: rawPhone,
        phone_e164: normalizePhone(rawPhone),
        avatar_url: person.photos?.[0]?.url || null,
        birthday: birthdayText,
        labels: labels,
        synced_at: new Date().toISOString()
      };
    });

    if (recordsToInsert.length > 0) {
      const { error: dbErr } = await supabase
        .from("google_contacts")
        .upsert(recordsToInsert, { onConflict: "tenant_id, google_resource_name" });
        
      if (dbErr) throw new Error(dbErr.message);
    }

    return NextResponse.json({ success: true, count: recordsToInsert.length });

  } catch (error: any) {
    console.error("Erro no sync-silent:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}