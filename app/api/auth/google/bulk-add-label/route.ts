// app/api/auth/google/bulk-add-label/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  batchGetPeople,
  batchUpdatePeople,
  getOrCreateContactGroups,
  getGoogleAccessToken,
} from "@/lib/google/people-batch";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const { contact_ids, label } = await req.json();
    if (!label?.trim() || !contact_ids?.length)
      return NextResponse.json(
        { error: "label e contact_ids são obrigatórios." },
        { status: 400 },
      );

    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const tenantId = tenantData?.tenant_id;

    const { data: tenantConfig } = await supabase
      .from("tenants")
      .select("google_refresh_token")
      .eq("id", tenantId)
      .single();
    if (!tenantConfig?.google_refresh_token)
      throw new Error("Conta do Google não vinculada.");
    const accessToken = await getGoogleAccessToken(
      tenantConfig.google_refresh_token,
    );

    // Cria ou encontra o grupo no Google (uma vez só, não por contato)
    const cleanLabel = label.trim();
    const groupByLabel = await getOrCreateContactGroups(accessToken, [
      cleanLabel,
    ]);
    const groupResourceName = groupByLabel.get(cleanLabel);
    if (!groupResourceName)
      throw new Error("Não foi possível criar o grupo no Google.");

    // Carrega os contatos selecionados
    const { data: contacts } = await supabase
      .from("google_contacts")
      .select("id, google_resource_name, labels")
      .eq("tenant_id", tenantId)
      .in("id", contact_ids);

    let updatedCount = 0;
    const errors: string[] = [];

    // Quem já tem o label localmente não precisa de nenhuma chamada
    const toProcess = (contacts || []).filter((contact) => {
      const currentLabels: string[] = Array.isArray(contact.labels)
        ? contact.labels.filter((l: string) => l && l.trim())
        : [];
      if (currentLabels.includes(cleanLabel)) {
        updatedCount++;
        return false;
      }
      return Boolean(contact.google_resource_name);
    });

    if (toProcess.length === 0) {
      return NextResponse.json({
        success: true,
        updated: updatedCount,
        message: `${updatedCount} contato(s) atribuídos ao grupo "${label}".`,
      });
    }

    // Busca etag + memberships atuais de todos de uma vez
    const personByResource = await batchGetPeople(
      accessToken,
      toProcess.map((c) => c.google_resource_name as string),
      "metadata,memberships",
    );

    const updates = new Map<string, Record<string, any>>();
    const newLabelsByResource = new Map<string, string[]>();

    for (const contact of toProcess) {
      const resourceName = contact.google_resource_name as string;
      const person = personByResource.get(resourceName);
      if (!person?.etag) {
        errors.push(resourceName);
        continue;
      }

      const currentLabels: string[] = Array.isArray(contact.labels)
        ? contact.labels.filter((l: string) => l && l.trim())
        : [];

      const memberships: any[] = (person.memberships || [])
        .map((m: any) => ({
          contactGroupMembership: {
            contactGroupResourceName:
              m.contactGroupMembership?.contactGroupResourceName,
          },
        }))
        .filter((m: any) => m.contactGroupMembership?.contactGroupResourceName);

      const alreadyIn = memberships.some(
        (m) =>
          m.contactGroupMembership?.contactGroupResourceName ===
          groupResourceName,
      );
      if (!alreadyIn) {
        memberships.push({
          contactGroupMembership: {
            contactGroupResourceName: groupResourceName,
          },
        });
      }

      updates.set(resourceName, { etag: person.etag, memberships });
      newLabelsByResource.set(resourceName, [...currentLabels, cleanLabel]);
    }

    const results = await batchUpdatePeople(
      accessToken,
      updates,
      "memberships",
    );

    // ── Grava tudo de volta no banco local numa tacada só (upsert em lote) ────
    const nowIso = new Date().toISOString();
    const rowsToUpsert: { id: string; labels: string[]; synced_at: string }[] =
      [];
    for (const [resourceName, outcome] of results) {
      const contact = toProcess.find(
        (c) => c.google_resource_name === resourceName,
      );
      if (!contact) continue;

      if (outcome.ok) {
        rowsToUpsert.push({
          id: contact.id,
          labels: newLabelsByResource.get(resourceName) as string[],
          synced_at: nowIso,
        });
        updatedCount++;
      } else {
        errors.push(resourceName);
      }
    }
    if (rowsToUpsert.length > 0) {
      await supabase.from("google_contacts").upsert(rowsToUpsert, {
        onConflict: "id",
      });
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
