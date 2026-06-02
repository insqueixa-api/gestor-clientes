import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

// Sleep util para backoff
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Fetch com retry/backoff para 429/503 do Google
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let attempt = 0;
  let lastRes: Response | null = null;
  while (attempt <= maxRetries) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 503) return res;
    lastRes = res;
    const wait = 400 * Math.pow(2, attempt); // 400, 800, 1600...
    await sleep(wait);
    attempt++;
  }
  return lastRes!;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : [];
    if (contactIds.length === 0) {
      return NextResponse.json({ error: "Nenhum contato selecionado." }, { status: 400 });
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

    // ── Carrega os contatos selecionados ──────────────────────────────────────
    const { data: contacts, error: cErr } = await supabase
      .from("google_contacts")
      .select("id, google_resource_name, display_name, phones, emails, labels")
      .in("id", contactIds)
      .eq("tenant_id", tenantId);
    if (cErr) throw new Error(cErr.message);
    if (!contacts?.length) {
      return NextResponse.json({ error: "Contatos não encontrados." }, { status: 404 });
    }

    // ── Grupos existentes no Google (para resolver labels → memberships) ───────
    const groupsRes = await fetch(
      "https://people.googleapis.com/v1/contactGroups?pageSize=200",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const groupsData = await groupsRes.json();
    let existingGroups: any[] = groupsData.contactGroups || [];

    async function getOrCreateGroup(name: string): Promise<string | null> {
      const found = existingGroups.find(
        (g: any) => g.name === name || g.formattedName === name,
      );
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

    // ── Processa cada contato ──────────────────────────────────────────────────
    let updatedCount = 0;
    const errors: string[] = [];

    for (const contact of contacts) {
      if (!contact.google_resource_name) {
        errors.push(`${contact.display_name}: sem resourceName no Google`);
        continue;
      }

      // Monta os campos a partir do que está no Supabase
      const phones: { label: string; value: string }[] = Array.isArray(contact.phones) ? contact.phones : [];
      const emails: { label: string; value: string }[] = Array.isArray(contact.emails) ? contact.emails : [];
      const labels: string[] = Array.isArray(contact.labels) ? contact.labels : [];

      const phoneNumbers = phones
        .filter((p) => p.value && onlyDigits(p.value))
        .map((p) => ({ value: p.value, ...getGoogleLabel(p.label, "mobile") }));

      const emailAddresses = emails
        .filter((e) => e.value && e.value.trim())
        .map((e) => ({ value: e.value, ...getGoogleEmailLabel(e.label) }));

      const names = [{ displayName: contact.display_name || "", givenName: contact.display_name || "" }];

      // Resolve labels → memberships (cria grupo se não existir)
      const memberships: any[] = [];
      for (const lbl of labels.filter((l) => l && l.trim())) {
        const grp = await getOrCreateGroup(lbl.trim());
        if (grp) {
          memberships.push({ contactGroupMembership: { contactGroupResourceName: grp } });
        }
      }
      // Garante que o contato continue em "myContacts"
      memberships.push({
        contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" },
      });

      // Tenta o PATCH com re-fetch de etag em caso de conflito (até 2 tentativas)
      let success = false;
      let lastErrMsg = "";
      for (let tryNum = 0; tryNum < 2 && !success; tryNum++) {
        // GET fresco do etag
        const personRes = await fetchWithRetry(
          `https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=metadata`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!personRes.ok) {
          lastErrMsg = "falha ao buscar etag";
          continue;
        }
        const personData = await personRes.json();
        const etag = personData.etag;

        const payload = {
          etag,
          names,
          phoneNumbers,
          emailAddresses,
          memberships,
        };

        const updateFields = "names,phoneNumbers,emailAddresses,memberships";
        const patchRes = await fetchWithRetry(
          `https://people.googleapis.com/v1/${contact.google_resource_name}:updateContact?updatePersonFields=${updateFields}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );

        if (patchRes.ok) {
          success = true;
        } else {
          const errData = await patchRes.json().catch(() => ({}));
          lastErrMsg = errData.error?.message || `HTTP ${patchRes.status}`;
          // etag velho → tenta de novo buscando etag fresco
          if (patchRes.status === 400 && /etag|precondition/i.test(lastErrMsg)) {
            await sleep(200);
            continue;
          }
          break; // outro erro: não adianta repetir
        }
      }

      if (success) {
        await supabase
          .from("google_contacts")
          .update({ synced_at: new Date().toISOString() })
          .eq("id", contact.id)
          .eq("tenant_id", tenantId);
        updatedCount++;
      } else {
        errors.push(`${contact.display_name}: ${lastErrMsg}`);
      }

      // Pausa curta entre contatos para aliviar rate limit
      await sleep(150);
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
