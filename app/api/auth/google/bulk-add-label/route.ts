// app/api/auth/google/bulk-add-label/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const { contact_ids, label } = await req.json();
    if (!label?.trim() || !contact_ids?.length) return NextResponse.json({ error: "label e contact_ids são obrigatórios." }, { status: 400 });

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
    if (!tokenRes.ok) throw new Error("Falha ao renovar credenciais Google.");
    const accessToken = tokenData.access_token;

    // Cria ou encontra o grupo no Google
    const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups?pageSize=200", { headers: { Authorization: `Bearer ${accessToken}` } });
    const groupsData = await groupsRes.json();
    const existingGroups: any[] = groupsData.contactGroups || [];

    let groupResourceName: string | null = null;
    const found = existingGroups.find((g: any) => g.name === label.trim() || g.formattedName === label.trim());
    if (found) {
      groupResourceName = found.resourceName;
    } else {
      const createRes = await fetch("https://people.googleapis.com/v1/contactGroups", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contactGroup: { name: label.trim() } }),
      });
      if (createRes.ok) { const created = await createRes.json(); groupResourceName = created.resourceName; }
    }
    if (!groupResourceName) throw new Error("Não foi possível criar o grupo no Google.");

    // Carrega os contatos selecionados
    const { data: contacts } = await supabase
      .from("google_contacts")
      .select("id, google_resource_name, labels")
      .eq("tenant_id", tenantId)
      .in("id", contact_ids);

    let updatedCount = 0;
    const errors: string[] = [];

    for (const contact of contacts || []) {
      // Pula se já tem o label
      const currentLabels: string[] = Array.isArray(contact.labels) ? contact.labels.filter((l: string) => l && l.trim()) : [];
      if (currentLabels.includes(label.trim())) { updatedCount++; continue; }

      try {
        // GET etag + memberships atuais
        const personRes = await fetch(
          `https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=metadata,memberships`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!personRes.ok) { errors.push(contact.google_resource_name); continue; }
        const personData = await personRes.json();

        const memberships: any[] = (personData.memberships || [])
          .map((m: any) => ({ contactGroupMembership: { contactGroupResourceName: m.contactGroupMembership?.contactGroupResourceName } }))
          .filter((m: any) => m.contactGroupMembership?.contactGroupResourceName);

        const alreadyIn = memberships.some(m => m.contactGroupMembership?.contactGroupResourceName === groupResourceName);
        if (!alreadyIn) memberships.push({ contactGroupMembership: { contactGroupResourceName: groupResourceName } });

        const patchRes = await fetch(
          `https://people.googleapis.com/v1/${contact.google_resource_name}:updateContact?updatePersonFields=memberships`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ etag: personData.etag, memberships }),
          }
        );

        if (!patchRes.ok) { errors.push(contact.google_resource_name); continue; }

        await supabase.from("google_contacts")
          .update({ labels: [...currentLabels, label.trim()], synced_at: new Date().toISOString() })
          .eq("id", contact.id).eq("tenant_id", tenantId);

        updatedCount++;
      } catch {
        errors.push(contact.google_resource_name);
      }
    }

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      errors: errors.length ? errors : undefined,
      message: `${updatedCount} contato(s) atribuídos ao grupo "${label}".`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}