// app/api/auth/google/push-to-google/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  batchGetPeople,
  batchUpdatePeople,
  getOrCreateContactGroups,
  getGoogleAccessToken,
} from "@/lib/google/people-batch";

export const dynamic = "force-dynamic";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function onlyDigits(raw: string | null | undefined): string {
  return (raw || "").replace(/\D+/g, "");
}

// Traduz o label local para o type do Google.
// Valores canônicos viram type nativo; qualquer outra coisa (ex: "Claro:")
// vira type customizado — o Google aceita string livre em `type`.
function getGoogleLabel(label: string, defaultType: string): { type: string } {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase().replace(/:$/, "").trim();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  return { type: label.replace(/:$/, "").trim() }; // operadora direto, sem os dois-pontos
}

function getGoogleEmailLabel(label: string): { type: string } {
  if (!label) return { type: "other" };
  const low = label.toLowerCase().trim();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["pessoal", "personal"].includes(low)) return { type: "other" };
  return { type: label.trim() };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const contactIds: string[] = Array.isArray(body.contact_ids)
      ? body.contact_ids
      : [];
    if (contactIds.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato selecionado." },
        { status: 400 },
      );
    }

    // ── Tenant ────────────────────────────────────────────────────────────────
    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const tenantId = tenantData?.tenant_id;
    if (!tenantId) throw new Error("Tenant não encontrado.");

    // ── Google access token ─────────────────────────────────────────────────
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

    // ── Carrega os contatos selecionados ──────────────────────────────────────
    const { data: contacts, error: cErr } = await supabase
      .from("google_contacts")
      .select("id, google_resource_name, display_name, phones, emails, labels")
      .in("id", contactIds)
      .eq("tenant_id", tenantId);
    if (cErr) throw new Error(cErr.message);
    if (!contacts?.length) {
      return NextResponse.json(
        { error: "Contatos não encontrados." },
        { status: 404 },
      );
    }

    // ── Grupos existentes no Google (uma listagem só, não uma por contato) ────
    const allLabels = contacts.flatMap((c) =>
      Array.isArray(c.labels) ? c.labels : [],
    );
    const groupByLabel = await getOrCreateContactGroups(accessToken, allLabels);

    // ── Busca o etag atual de TODOS os contatos numa tacada só (batchGet) ─────
    const withResource = contacts.filter((c) => c.google_resource_name);
    const semResource = contacts.filter((c) => !c.google_resource_name);

    const personByResource = await batchGetPeople(
      accessToken,
      withResource.map((c) => c.google_resource_name as string),
      "metadata",
    );

    // ── Monta o payload de cada contato (mesma lógica de antes, só que
    //    coletando tudo pra mandar num batchUpdateContacts só) ────────────────
    const updates = new Map<string, Record<string, any>>();
    const errors: string[] = [];

    for (const c of semResource) {
      errors.push(`${c.display_name}: sem resourceName no Google`);
    }

    for (const contact of withResource) {
      const resourceName = contact.google_resource_name as string;
      const person = personByResource.get(resourceName);
      if (!person?.etag) {
        errors.push(`${contact.display_name}: não encontrado no Google`);
        continue;
      }

      const phones: { label: string; value: string }[] = Array.isArray(
        contact.phones,
      )
        ? contact.phones
        : [];
      const emails: { label: string; value: string }[] = Array.isArray(
        contact.emails,
      )
        ? contact.emails
        : [];
      const labels: string[] = Array.isArray(contact.labels)
        ? contact.labels
        : [];

      const phoneNumbers = phones
        .filter((p) => p.value && onlyDigits(p.value))
        .map((p) => ({ value: p.value, ...getGoogleLabel(p.label, "mobile") }));

      const emailAddresses = emails
        .filter((e) => e.value && e.value.trim())
        .map((e) => ({ value: e.value, ...getGoogleEmailLabel(e.label) }));

      const names = [
        {
          displayName: contact.display_name || "",
          givenName: contact.display_name || "",
          familyName: "",
        },
      ];

      const memberships: any[] = labels
        .filter((l) => l && l.trim())
        .map((l) => groupByLabel.get(l.trim()))
        .filter((rn): rn is string => Boolean(rn))
        .map((rn) => ({
          contactGroupMembership: { contactGroupResourceName: rn },
        }));
      // Garante que o contato continue em "myContacts"
      memberships.push({
        contactGroupMembership: {
          contactGroupResourceName: "contactGroups/myContacts",
        },
      });

      updates.set(resourceName, {
        etag: person.etag,
        names,
        phoneNumbers,
        emailAddresses,
        memberships,
      });
    }

    // ── Envia tudo num (ou poucos, se >200) batchUpdateContacts ────────────────
    const results = await batchUpdatePeople(
      accessToken,
      updates,
      "names,phoneNumbers,emailAddresses,memberships",
    );

    // ── Grava tudo de volta no banco local numa tacada só (upsert em lote,
    //    não 1 UPDATE por contato — pra listas grandes isso sozinho já
    //    passava de 10s de latência acumulada) ─────────────────────────────
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    const rowsToUpsert: { id: string; synced_at: string }[] = [];
    for (const contact of withResource) {
      const resourceName = contact.google_resource_name as string;
      const outcome = results.get(resourceName);
      if (!outcome) continue; // já caiu no "não encontrado" acima
      if (outcome.ok) {
        rowsToUpsert.push({ id: contact.id, synced_at: nowIso });
        updatedCount++;
      } else {
        errors.push(`${contact.display_name}: ${outcome.error}`);
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
      total: contacts.length,
      errors: errors.length > 0 ? errors : undefined,
      message:
        updatedCount > 0
          ? `${updatedCount} de ${contacts.length} contato(s) reenviado(s) ao Google.`
          : `Nenhum contato reenviado (${contacts.length} verificado(s)).`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
