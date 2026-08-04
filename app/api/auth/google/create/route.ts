// app/api/auth/google/create/route.ts
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

function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  return { type: label };
}

// ✅ Últimos 9 dígitos do telefone (sem DDI/formatação) — mesma convenção
// de comparação de número usada no resto do sistema.
function phoneTail(raw: string | null | undefined) {
  return String(raw || "")
    .replace(/\D/g, "")
    .slice(-9);
}

// ✅ Procura DIRETO no Google (não só na nossa tabela local de cache) se já
// existe um contato com esse telefone, antes de criar um novo — evita
// duplicar quando o contato existe no Google mas nunca foi registrado na
// nossa tabela local (ex: criado manualmente fora do sistema, ou de antes
// da conta Google ter sido conectada aqui). Pagina todos os contatos
// (people.connections.list, não searchContacts — o índice de busca do
// Google tem atraso pra contatos recém-criados/editados, não é confiável
// pra essa checagem).
async function findExistingResourceNameByPhone(
  accessToken: string,
  targetTail: string,
) {
  if (targetTail.length < 8) return null;
  let pageToken: string | undefined;
  do {
    const url = new URL(
      "https://people.googleapis.com/v1/people/me/connections",
    );
    url.searchParams.set("personFields", "phoneNumbers");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();

    for (const person of data.connections || []) {
      for (const phone of person.phoneNumbers || []) {
        if (phoneTail(phone.value) === targetTail) {
          return person.resourceName as string;
        }
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json();
    const { display_name, phones, emails, labels, photo_base64 } = body;

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
    if (!tokenRes.ok) throw new Error("Falha ao renovar credenciais.");
    const accessToken = tokenData.access_token;

    // ✅ Antes de criar, confere DIRETO no Google se esse telefone já é um
    // contato — se for, atualiza (nome + grupos/tags) em vez de criar um
    // segundo contato pro mesmo número. É essa duplicata (dois contatos
    // Google pro mesmo telefone) que fazia o WhatsApp mostrar o nome
    // repetido/emendado na lista de conversas.
    const primaryPhoneRaw = (phones || [])[0]?.value || null;
    const targetTail = phoneTail(primaryPhoneRaw);
    const existingResourceName = await findExistingResourceNameByPhone(
      accessToken,
      targetTail,
    );

    if (existingResourceName) {
      const getPersonRes = await fetch(
        `https://people.googleapis.com/v1/${existingResourceName}?personFields=metadata,memberships`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const personCurrentData = await getPersonRes.json();
      const etag = personCurrentData.etag;

      const groupsRes = await fetch(
        "https://people.googleapis.com/v1/contactGroups",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const groupsData = await groupsRes.json();
      const existingGroups = groupsData.contactGroups || [];

      // ✅ Grupos que o contato JÁ tem (ex: outro servidor) — preserva,
      // nunca substitui. Só ACRESCENTA o(s) grupo(s) desta sincronização.
      const currentGroupNames = new Set<string>();
      let hasMyContacts = false;
      for (const m of personCurrentData.memberships || []) {
        const rn = m.contactGroupMembership?.contactGroupResourceName;
        if (rn === "contactGroups/myContacts") hasMyContacts = true;
        const g = existingGroups.find((g: any) => g.resourceName === rn);
        if (g) currentGroupNames.add(g.formattedName || g.name);
      }
      const mergedLabels = Array.from(
        new Set([...currentGroupNames, ...(labels || [])]),
      );

      const finalMembershipsExisting: any[] = [];
      for (const lbl of mergedLabels) {
        const cleanLbl = String(lbl || "").trim();
        if (!cleanLbl || cleanLbl.toLowerCase() === "mycontacts") continue;
        let found = existingGroups.find(
          (g: any) => g.name === cleanLbl || g.formattedName === cleanLbl,
        );
        if (!found) {
          const createGrpRes = await fetch(
            "https://people.googleapis.com/v1/contactGroups",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ contactGroup: { name: cleanLbl } }),
            },
          );
          if (createGrpRes.ok) {
            found = await createGrpRes.json();
            existingGroups.push(found);
          }
        }
        if (found)
          finalMembershipsExisting.push({
            contactGroupMembership: {
              contactGroupResourceName: found.resourceName,
            },
          });
      }
      if (hasMyContacts) {
        finalMembershipsExisting.push({
          contactGroupMembership: {
            contactGroupResourceName: "contactGroups/myContacts",
          },
        });
      }

      // ✅ Só nome + grupos (operadora/tag do servidor) — não mexe em
      // telefone/email do contato já existente, que é o que a checagem
      // usou pra encontrá-lo.
      const updateRes = await fetch(
        `https://people.googleapis.com/v1/${existingResourceName}:updateContact?updatePersonFields=names,memberships`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            etag,
            names: [{ givenName: display_name || "Sem Nome" }],
            memberships: finalMembershipsExisting,
          }),
        },
      );
      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        throw new Error(
          `Google API: ${errData.error?.message || "falha ao atualizar contato existente"}`,
        );
      }

      const formattedPhonesExisting = (phones || []).map((p: any) => ({
        label: p.label,
        value: formatPhone(p.value),
      }));

      // ✅ Corrige/preenche a nossa tabela local com o resource_name real
      // — é essa ausência local que fazia a checagem por telefone (na
      // sincronização normal) não encontrar o contato e criar duplicata.
      await supabase.from("google_contacts").upsert(
        {
          tenant_id: tenantId,
          google_resource_name: existingResourceName,
          display_name,
          phones: formattedPhonesExisting,
          emails: emails || [],
          labels: mergedLabels,
          phone_e164:
            formattedPhonesExisting.length > 0
              ? formattedPhonesExisting[0].value.replace(/\D/g, "")
              : null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id, google_resource_name" },
      );

      return NextResponse.json({ success: true, matched_existing: true });
    }

    const finalMemberships: any[] = [
      {
        contactGroupMembership: {
          contactGroupResourceName: "contactGroups/myContacts",
        },
      },
    ];
    if (labels && labels.length > 0) {
      const groupsRes = await fetch(
        "https://people.googleapis.com/v1/contactGroups",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const groupsData = await groupsRes.json();
      const existingGroups = groupsData.contactGroups || [];

      for (const lbl of labels) {
        const cleanLbl = lbl.trim();
        if (cleanLbl.toLowerCase() === "mycontacts") continue;
        let found = existingGroups.find(
          (g: any) => g.name === cleanLbl || g.formattedName === cleanLbl,
        );
        if (!found) {
          const createGrpRes = await fetch(
            "https://people.googleapis.com/v1/contactGroups",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ contactGroup: { name: cleanLbl } }),
            },
          );
          if (createGrpRes.ok) found = await createGrpRes.json();
        }
        if (found)
          finalMemberships.push({
            contactGroupMembership: {
              contactGroupResourceName: found.resourceName,
            },
          });
      }
    }

    const formattedPhones = (phones || []).map((p: any) => ({
      label: p.label,
      value: formatPhone(p.value),
    }));

    const googlePayload: any = {
      names: [{ givenName: display_name || "Sem Nome" }],
      emailAddresses: (emails || []).map((e: any) => ({
        value: e.value,
        ...getGoogleLabel(e.label, "other"),
      })),
      phoneNumbers: formattedPhones.map((p: any) => ({
        value: p.value,
        ...getGoogleLabel(p.label, "mobile"),
      })),
      memberships: finalMemberships,
    };

    const createRes = await fetch(
      `https://people.googleapis.com/v1/people:createContact`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(googlePayload),
      },
    );
    if (!createRes.ok) throw new Error(`Erro ao criar contato no Google`);

    const newContact = await createRes.json();
    const google_resource_name = newContact.resourceName;

    let finalAvatarUrl = null;
    if (photo_base64 && photo_base64.includes("base64,")) {
      const base64Data = photo_base64.split(",")[1];
      const photoRes = await fetch(
        `https://people.googleapis.com/v1/${google_resource_name}:updateContactPhoto`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ photoBytes: base64Data }),
        },
      );
      if (photoRes.ok) {
        const getPhotoRes = await fetch(
          `https://people.googleapis.com/v1/${google_resource_name}?personFields=photos`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (getPhotoRes.ok) {
          const freshData = await getPhotoRes.json();
          if (freshData.photos?.[0]?.url)
            finalAvatarUrl = freshData.photos[0].url;
        }
      }
    }

    await supabase.from("google_contacts").insert({
      tenant_id: tenantId,
      google_resource_name: google_resource_name,
      display_name,
      phones: formattedPhones,
      emails,
      labels,
      phone_e164:
        formattedPhones.length > 0
          ? formattedPhones[0].value.replace(/\D/g, "")
          : null,
      avatar_url: finalAvatarUrl,
      synced_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
