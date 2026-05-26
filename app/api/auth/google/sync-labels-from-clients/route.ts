import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  // BR celular com 9: DDD(2) + 9 + número(8) = 11 dígitos → adiciona sem o 9
  if (normalized.length === 11 && normalized[2] === "9") {
    variants.push(normalized.slice(0, 2) + normalized.slice(3)); // sem o 9
  }
  // BR celular sem 9: DDD(2) + número(8) = 10 dígitos → adiciona com o 9
  if (normalized.length === 10) {
    variants.push(normalized.slice(0, 2) + "9" + normalized.slice(2)); // com o 9
  }
  return variants;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const contactIds: string[] | null = body.contact_ids ?? null;

    // ── Tenant ──────────────────────────────────────────────────────────────
    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const tenantId = tenantData?.tenant_id;
    if (!tenantId) throw new Error("Tenant não encontrado.");

    // ── Google access token ──────────────────────────────────────────────────
    const { data: tenantConfig } = await supabase
      .from("tenants")
      .select("google_refresh_token")
      .eq("id", tenantId)
      .single();
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

    // ── Carrega apenas os contatos selecionados (ou todos se nenhum selecionado) ──
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
      return NextResponse.json({ success: true, updated: 0, message: "Nenhum contato para processar." });
    }

    // ── Carrega clientes com server name ─────────────────────────────────────
    const { data: clients, error: clErr } = await supabase
      .from("clients")
      .select("phone_e164, secondary_phone_e164, servers!inner(name)")
      .eq("tenant_id", tenantId)
      .eq("is_archived", false);
    if (clErr) throw new Error(clErr.message);
    if (!clients?.length) {
      return NextResponse.json({ success: true, updated: 0, message: "Nenhum cliente cadastrado." });
    }

    // ── Índice: dígitos normalizados → server name ───────────────────────────
    const phoneIndex = new Map<string, string>();
    for (const client of clients as any[]) {
      const serverName: string = client.servers?.name ?? "";
      if (!serverName) continue;
      const p = normalizePhone(client.phone_e164);
      const s = normalizePhone(client.secondary_phone_e164);
      phoneVariants(p).forEach(v => phoneIndex.set(v, serverName));
phoneVariants(s).forEach(v => phoneIndex.set(v, serverName));
    }

    // ── Grupos existentes no Google ──────────────────────────────────────────
    const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups?pageSize=200", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const groupsData = await groupsRes.json();
    let existingGroups: any[] = groupsData.contactGroups || [];

    async function getOrCreateGroup(name: string): Promise<string | null> {
      const found = existingGroups.find((g: any) => g.name === name || g.formattedName === name);
      if (found) return found.resourceName;
      const res = await fetch("https://people.googleapis.com/v1/contactGroups", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contactGroup: { name } }),
      });
      if (!res.ok) return null;
      const created = await res.json();
      existingGroups.push(created);
      return created.resourceName ?? null;
    }

    // ── Processa cada contato ────────────────────────────────────────────────
    let updatedCount = 0;
    const errors: string[] = [];

    for (const contact of googleContacts) {
      const phones: { label: string; value: string }[] = Array.isArray(contact.phones) ? contact.phones : [];
      if (!phones.length) continue;

      // Cruza telefones com o índice de clientes
      let matchedServer: string | null = null;
      for (const p of phones) {
        const nat = normalizePhone(p.value);
        if (nat && phoneIndex.has(nat)) {
          matchedServer = phoneIndex.get(nat)!;
          break;
        }
      }
      if (!matchedServer) continue;

      // Já tem o label? Pula
      const currentLabels: string[] = Array.isArray(contact.labels) ? contact.labels : [];
      if (currentLabels.includes(matchedServer)) continue;

      try {
        // GET no Google apenas para pegar o etag (necessário para o PATCH)
        const personRes = await fetch(
          `https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=metadata,memberships`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!personRes.ok) {
          errors.push(`${contact.display_name}: falha ao buscar etag`);
          continue;
        }
        const personData = await personRes.json();
        const etag = personData.etag;

        // Mantém memberships existentes + adiciona o novo grupo
        const existingMemberships: any[] = (personData.memberships || [])
          .map((m: any) => ({
            contactGroupMembership: {
              contactGroupResourceName: m.contactGroupMembership?.contactGroupResourceName,
            },
          }))
          .filter((m: any) => m.contactGroupMembership?.contactGroupResourceName);

        const serverGroupResourceName = await getOrCreateGroup(matchedServer);
        if (serverGroupResourceName) {
          const alreadyIn = existingMemberships.some(
            m => m.contactGroupMembership?.contactGroupResourceName === serverGroupResourceName
          );
          if (!alreadyIn) {
            existingMemberships.push({
              contactGroupMembership: { contactGroupResourceName: serverGroupResourceName },
            });
          }
        }

        // PATCH — SÓ memberships, nada mais
        const patchRes = await fetch(
          `https://people.googleapis.com/v1/${contact.google_resource_name}:updateContact?updatePersonFields=memberships`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ etag, memberships: existingMemberships }),
          }
        );

        if (!patchRes.ok) {
          const errData = await patchRes.json();
          errors.push(`${contact.display_name}: ${errData.error?.message}`);
          continue;
        }

        // Atualiza só o labels no banco local
        const newLabels = [...currentLabels, matchedServer];
        await supabase
          .from("google_contacts")
          .update({ labels: newLabels, synced_at: new Date().toISOString() })
          .eq("id", contact.id)
          .eq("tenant_id", tenantId);

        updatedCount++;

      } catch (err: any) {
        errors.push(`${contact.display_name}: ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      total: googleContacts.length,
      errors: errors.length > 0 ? errors : undefined,
      message: updatedCount > 0
        ? `${updatedCount} de ${googleContacts.length} contato(s) vinculado(s) ao servidor.`
        : `Nenhum contato novo para vincular (${googleContacts.length} verificado(s)).`,
    });

  } catch (error: any) {
    console.error("Erro em sync-labels-from-clients:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
