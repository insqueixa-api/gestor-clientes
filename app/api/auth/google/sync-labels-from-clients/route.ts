// app/api/auth/google/sync-labels-from-clients/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  batchGetPeople,
  batchUpdatePeople,
  getOrCreateContactGroups,
  getGoogleAccessToken,
} from "@/lib/google/people-batch";

export const dynamic = "force-dynamic";

function onlyDigits(raw: string | null | undefined): string {
  return (raw || "").replace(/\D+/g, "");
}

// Normaliza para dígitos nacionais brasileiros (sem DDI 55) ou mantém internacional
// "+5521999998888" → "21999998888"
// "021 99999-8888" → "21999998888"
// "+353830852053"  → "353830852053"
function normalizePhone(raw: string | null | undefined): string {
  const d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return d.slice(2);
  if (d.startsWith("0") && d.length >= 10) return d.slice(1);
  return d;
}

// E no índice, indexa também a versão sem o 9 para BR:
function phoneVariants(normalized: string): string[] {
  const variants = [normalized];
  if (normalized.length === 11 && normalized[2] === "9") {
    variants.push(normalized.slice(0, 2) + normalized.slice(3));
  }
  if (normalized.length === 10) {
    variants.push(normalized.slice(0, 2) + "9" + normalized.slice(2));
  }
  return variants;
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
    const contactIds: string[] | null = body.contact_ids ?? null;

    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const tenantId = tenantData?.tenant_id;
    if (!tenantId) throw new Error("Tenant não encontrado.");

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

    let gcQuery = supabase
      .from("google_contacts")
      .select("id, google_resource_name, phones, labels, display_name")
      .eq("tenant_id", tenantId);

    if (contactIds && contactIds.length > 0) {
      gcQuery = gcQuery.in("id", contactIds);
    }

    const { data: googleContacts, error: gcErr } = await gcQuery;
    if (gcErr) throw new Error(gcErr.message);
    if (!googleContacts?.length) {
      return NextResponse.json({
        success: true,
        updated: 0,
        message: "Nenhum contato para processar.",
      });
    }

    const { data: clients, error: clErr } = await supabase
      .from("clients")
      .select("phone_e164, secondary_phone_e164, servers!inner(name)")
      .eq("tenant_id", tenantId)
      .eq("is_archived", false);
    if (clErr) throw new Error(clErr.message);
    if (!clients?.length) {
      return NextResponse.json({
        success: true,
        updated: 0,
        message: "Nenhum cliente cadastrado.",
      });
    }

    const phoneIndex = new Map<string, Set<string>>();
    for (const client of clients as any[]) {
      const serverName: string = client.servers?.name ?? "";
      if (!serverName) continue;
      const p = normalizePhone(client.phone_e164);
      const s = normalizePhone(client.secondary_phone_e164);
      for (const v of phoneVariants(p)) {
        if (!phoneIndex.has(v)) phoneIndex.set(v, new Set());
        phoneIndex.get(v)!.add(serverName);
      }
      for (const v of phoneVariants(s)) {
        if (!phoneIndex.has(v)) phoneIndex.set(v, new Set());
        phoneIndex.get(v)!.add(serverName);
      }
    }

    // ── Passo 1 (só local, sem API): decide quem precisa mudar ────────────────
    type Pending = {
      contact: (typeof googleContacts)[number];
      matchedServers: Set<string>;
      labelsParaAdicionar: string[];
      labelsParaRemover: string[];
    };
    const pending: Pending[] = [];

    for (const contact of googleContacts) {
      const phones: { label: string; value: string }[] = Array.isArray(
        contact.phones,
      )
        ? contact.phones
        : [];
      if (!phones.length) continue;
      if (!contact.google_resource_name) continue;

      const matchedServers = new Set<string>();
      for (const p of phones) {
        const nat = normalizePhone(p.value);
        const servers = nat ? phoneIndex.get(nat) : undefined;
        if (servers) servers.forEach((s) => matchedServers.add(s));
      }

      // ✅ Regra: só mexe em labels que são NOME DE SERVIDOR — nunca em grupo
      // pessoal/outro que o contato já tenha no Google (ver raciocínio
      // completo no comentário original desta rota, mantido por baixo).
      const currentLabels: string[] = Array.isArray(contact.labels)
        ? contact.labels
        : [];
      const labelsParaAdicionar = [...matchedServers].filter(
        (s) => !currentLabels.includes(s),
      );
      const labelsParaRemover = currentLabels.filter(
        (l) => !matchedServers.has(l),
      );

      if (labelsParaAdicionar.length === 0 && labelsParaRemover.length === 0)
        continue;

      pending.push({
        contact,
        matchedServers,
        labelsParaAdicionar,
        labelsParaRemover,
      });
    }

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        total: googleContacts.length,
        message: `Nenhum contato precisou de ajuste (${googleContacts.length} verificado(s)).`,
      });
    }

    // ── Grupos: uma listagem + criação só dos labels realmente novos ──────────
    const allLabelsInvolved = pending.flatMap((p) => [
      ...p.labelsParaAdicionar,
      ...p.labelsParaRemover,
    ]);
    const groupByLabel = await getOrCreateContactGroups(
      accessToken,
      allLabelsInvolved,
    );

    // ── Busca etag + memberships atuais de todos os pendentes de uma vez ──────
    const personByResource = await batchGetPeople(
      accessToken,
      pending.map((p) => p.contact.google_resource_name as string),
      "metadata,memberships",
    );

    const updates = new Map<string, Record<string, any>>();
    const newLabelsByResource = new Map<string, string[]>();
    const errors: string[] = [];

    for (const p of pending) {
      const resourceName = p.contact.google_resource_name as string;
      const person = personByResource.get(resourceName);
      if (!person?.etag) {
        errors.push(`${p.contact.display_name}: falha ao buscar etag`);
        continue;
      }

      const resourceNamesParaRemover = new Set(
        p.labelsParaRemover.map((l) => groupByLabel.get(l)).filter(Boolean),
      );

      const existingMemberships: any[] = (person.memberships || [])
        .map((m: any) => ({
          contactGroupMembership: {
            contactGroupResourceName:
              m.contactGroupMembership?.contactGroupResourceName,
          },
        }))
        .filter((m: any) => m.contactGroupMembership?.contactGroupResourceName)
        .filter(
          (m: any) =>
            !resourceNamesParaRemover.has(
              m.contactGroupMembership.contactGroupResourceName,
            ),
        );

      for (const serverName of p.labelsParaAdicionar) {
        const rn = groupByLabel.get(serverName);
        if (!rn) continue;
        const alreadyIn = existingMemberships.some(
          (m) => m.contactGroupMembership?.contactGroupResourceName === rn,
        );
        if (!alreadyIn) {
          existingMemberships.push({
            contactGroupMembership: { contactGroupResourceName: rn },
          });
        }
      }

      updates.set(resourceName, {
        etag: person.etag,
        memberships: existingMemberships,
      });
      newLabelsByResource.set(resourceName, [...p.matchedServers]);
    }

    // ── Envia todas as trocas de grupo de uma vez ──────────────────────────────
    const results = await batchUpdatePeople(
      accessToken,
      updates,
      "memberships",
    );

    // ── Grava tudo de volta no banco local numa tacada só (upsert em lote) ────
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    const rowsToUpsert: { id: string; labels: string[]; synced_at: string }[] =
      [];
    for (const [resourceName, outcome] of results) {
      const p = pending.find(
        (x) => x.contact.google_resource_name === resourceName,
      );
      if (!p) continue;

      if (outcome.ok) {
        rowsToUpsert.push({
          id: p.contact.id,
          labels: newLabelsByResource.get(resourceName) as string[],
          synced_at: nowIso,
        });
        updatedCount++;
      } else {
        errors.push(`${p.contact.display_name}: ${outcome.error}`);
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
      total: googleContacts.length,
      errors: errors.length > 0 ? errors : undefined,
      message:
        updatedCount > 0
          ? `${updatedCount} de ${googleContacts.length} contato(s) atualizado(s) (grupos de servidor sincronizados).`
          : `Nenhum contato precisou de ajuste (${googleContacts.length} verificado(s)).`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
