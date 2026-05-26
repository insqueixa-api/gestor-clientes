import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function onlyDigits(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\D+/g, "");
}

// Normaliza para 11 dígitos nacionais brasileiros (sem DDI 55)
// Ex: "+5521999998888" → "21999998888"
//     "21999998888"   → "21999998888"
function normalizeToNational(raw: string | null | undefined): string {
  const d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return d.slice(2); // +5521... → 21...
  if (d.startsWith("0") && d.length >= 10) return d.slice(1);  // 021... → 21...
  return d;
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

    // ── Tenant ────────────────────────────────────────────────────────────
    const { data: tenantData } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const tenantId = tenantData?.tenant_id;
    if (!tenantId) throw new Error("Tenant não encontrado.");

    // ── Google refresh token ───────────────────────────────────────────────
    const { data: tenantConfig } = await supabase
      .from("tenants")
      .select("google_refresh_token")
      .eq("id", tenantId)
      .single();
    if (!tenantConfig?.google_refresh_token) throw new Error("Conta do Google não vinculada.");

    // ── Renova access token ────────────────────────────────────────────────
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

    // ── Carrega contatos Google do banco local ─────────────────────────────
    const { data: googleContacts, error: gcErr } = await supabase
      .from("google_contacts")
      .select("id, google_resource_name, phones, labels, display_name, emails")
      .eq("tenant_id", tenantId);
    if (gcErr) throw new Error(gcErr.message);
    if (!googleContacts?.length) return NextResponse.json({ success: true, updated: 0, message: "Nenhum contato Google encontrado." });

    // ── Carrega clientes com server_name ───────────────────────────────────
    const { data: clients, error: clErr } = await supabase
      .from("clients")
      .select("id, display_name, phone_e164, secondary_phone_e164, server_id, servers!inner(name)")
      .eq("tenant_id", tenantId)
      .eq("is_archived", false);
    if (clErr) throw new Error(clErr.message);
    if (!clients?.length) return NextResponse.json({ success: true, updated: 0, message: "Nenhum cliente encontrado." });

    // ── Monta índice: dígitos_nacionais → server_name ──────────────────────
    // Usa os dois telefones (primário e secundário)
    const phoneIndex = new Map<string, string>(); // national_digits → server_name
    for (const client of clients as any[]) {
      const serverName: string = client.servers?.name ?? "";
      if (!serverName) continue;

      const primary = normalizeToNational(client.phone_e164);
      const secondary = normalizeToNational(client.secondary_phone_e164);

      if (primary)   phoneIndex.set(primary,   serverName);
      if (secondary) phoneIndex.set(secondary, serverName);
    }

    // ── Carrega grupos existentes no Google para resolver resourceNames ─────
    const groupsRes = await fetch("https://people.googleapis.com/v1/contactGroups?pageSize=200", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const groupsData = await groupsRes.json();
    let existingGroups: any[] = groupsData.contactGroups || [];

    async function getOrCreateGroup(name: string): Promise<string | null> {
      const found = existingGroups.find((g: any) => g.name === name || g.formattedName === name);
      if (found) return found.resourceName;

      const createRes = await fetch("https://people.googleapis.com/v1/contactGroups", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contactGroup: { name } }),
      });
      if (!createRes.ok) return null;
      const created = await createRes.json();
      existingGroups.push(created);
      return created.resourceName ?? null;
    }

    // ── Processa cada contato Google ───────────────────────────────────────
    let updatedCount = 0;
    const errors: string[] = [];

    for (const contact of googleContacts) {
      // Extrai todos os telefones do contato Google
      const phones: { label: string; value: string }[] = Array.isArray(contact.phones) ? contact.phones : [];
      if (!phones.length) continue;

      // Verifica se algum telefone bate com um cliente
      let matchedServer: string | null = null;
      for (const p of phones) {
        const nat = normalizeToNational(p.value);
        if (nat && phoneIndex.has(nat)) {
          matchedServer = phoneIndex.get(nat)!;
          break;
        }
      }
      if (!matchedServer) continue;

      // Verifica se o label do servidor já está no contato (evita chamada desnecessária)
      const currentLabels: string[] = Array.isArray(contact.labels) ? contact.labels : [];
      if (currentLabels.includes(matchedServer)) continue;

      const newLabels = [...currentLabels, matchedServer];

      // ── Monta memberships para o Google ─────────────────────────────────
      try {
        // Busca etag atual do contato
        const personRes = await fetch(
          `https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=metadata,memberships,names,emailAddresses,phoneNumbers`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!personRes.ok) continue;
        const personData = await personRes.json();
        const etag = personData.etag;

        // Mantém memberships existentes
        let finalMemberships: any[] = personData.memberships
          ? personData.memberships.map((m: any) => ({
              contactGroupMembership: { contactGroupResourceName: m.contactGroupMembership?.contactGroupResourceName },
            })).filter((m: any) => m.contactGroupMembership?.contactGroupResourceName)
          : [];

        // Adiciona o grupo do servidor se não existir
        const serverGroupResourceName = await getOrCreateGroup(matchedServer);
        if (serverGroupResourceName) {
          const alreadyIn = finalMemberships.some(
            m => m.contactGroupMembership?.contactGroupResourceName === serverGroupResourceName
          );
          if (!alreadyIn) {
            finalMemberships.push({ contactGroupMembership: { contactGroupResourceName: serverGroupResourceName } });
          }
        }

        const updatePayload: any = {
  etag,
  memberships: finalMemberships,
};

const updateRes = await fetch(
  `https://people.googleapis.com/v1/${contact.google_resource_name}:updateContact?updatePersonFields=memberships`,
  {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(updatePayload),
  }
);

        if (!updateRes.ok) {
          const errData = await updateRes.json();
          errors.push(`${contact.display_name}: ${errData.error?.message}`);
          continue;
        }

        // ── Atualiza banco local ─────────────────────────────────────────
        await supabase
          .from("google_contacts")
          .update({ labels: newLabels, synced_at: new Date().toISOString() })
          .eq("id", contact.id)
          .eq("tenant_id", tenantId);

        updatedCount++;

        // Pequena pausa para não estourar rate limit da Google API (10 req/s)
        await new Promise(r => setTimeout(r, 120));

      } catch (err: any) {
        errors.push(`${contact.display_name}: ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `${updatedCount} contato(s) vinculado(s) ao servidor.`,
    });

  } catch (error: any) {
    console.error("Erro em sync-labels-from-clients:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
