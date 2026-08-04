// lib/google/people-batch.ts
//
// Helpers pra operar em LOTE na People API do Google (batchGet /
// batchUpdateContacts), em vez de 1 GET + 1 PATCH por contato.
//
// Por que: cada rota de sincronização em massa (reenviar, operadora, tag de
// servidor, atribuir grupo) processava contato por contato — 2+ chamadas
// HTTP pro Google POR CONTATO, cada uma com latência de rede real. Numa
// function da Vercel (teto de 10s no plano usado), isso limitava a uns 10
// contatos por lote (daí o CHUNK=10 hardcoded no frontend do reenvio) —
// pra 400+ contatos, virava dezenas de idas-e-voltas manuais.
//
// A People API aceita até 200 contatos por chamada tanto pra ler
// (people:batchGet) quanto pra escrever (people:batchUpdateContacts). Usando
// isso, um lote de até 200 contatos vira ~2 chamadas HTTP no total (1 leitura
// + 1 escrita) em vez de ~400 — o mesmo trabalho cabe folgado no teto de 10s.

const MAX_BATCH = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type BatchPerson = {
  resourceName: string;
  etag?: string;
  [key: string]: any;
};

/**
 * Busca vários contatos de uma vez. Devolve um Map resourceName -> pessoa —
 * resourceNames que não vieram na resposta (não encontrados, ou erro nesse
 * item específico) simplesmente não aparecem no Map; o chamador trata a
 * ausência como "não encontrado".
 */
export async function batchGetPeople(
  accessToken: string,
  resourceNames: string[],
  personFields: string,
): Promise<Map<string, BatchPerson>> {
  const result = new Map<string, BatchPerson>();
  const uniqueNames = [...new Set(resourceNames.filter(Boolean))];

  for (const batch of chunk(uniqueNames, MAX_BATCH)) {
    if (batch.length === 0) continue;
    const url = new URL("https://people.googleapis.com/v1/people:batchGet");
    url.searchParams.set("personFields", personFields);
    for (const rn of batch) url.searchParams.append("resourceNames", rn);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) continue;
    const data = await res.json().catch(() => ({}));
    for (const r of data.responses || []) {
      if (r.person?.resourceName) result.set(r.person.resourceName, r.person);
    }
  }
  return result;
}

/**
 * Atualiza vários contatos de uma vez. `updates` é um Map
 * resourceName -> payload PARCIAL da pessoa (precisa incluir `etag`, pego
 * via batchGetPeople com personFields incluindo "metadata"). `updateMask` é
 * a lista de campos alterados (ex: "names,memberships") — mesma semântica
 * do `updatePersonFields` do updateContact de contato único: só os campos
 * listados são substituídos, o resto do contato fica intocado.
 *
 * Devolve um Map resourceName -> { ok, error? } — cada contato do lote pode
 * falhar independente dos outros (ex: etag desatualizado só naquele).
 */
export async function batchUpdatePeople(
  accessToken: string,
  updates: Map<string, Record<string, any>>,
  updateMask: string,
): Promise<Map<string, { ok: boolean; error?: string; person?: any }>> {
  const result = new Map<
    string,
    { ok: boolean; error?: string; person?: any }
  >();
  const entries = Array.from(updates.entries());

  for (const batch of chunk(entries, MAX_BATCH)) {
    if (batch.length === 0) continue;
    const contacts: Record<string, any> = {};
    for (const [rn, payload] of batch) contacts[rn] = payload;

    const res = await fetch(
      "https://people.googleapis.com/v1/people:batchUpdateContacts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contacts, updateMask, readMask: updateMask }),
      },
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error?.message || `HTTP ${res.status}`;
      for (const [rn] of batch) result.set(rn, { ok: false, error: msg });
      continue;
    }

    for (const [rn] of batch) {
      const entry = data.updateResult?.[rn];
      if (!entry) {
        result.set(rn, {
          ok: false,
          error: "sem resposta do Google pra esse contato",
        });
      } else if (entry.error) {
        result.set(rn, {
          ok: false,
          error:
            entry.error.message || JSON.stringify(entry.error).slice(0, 200),
        });
      } else {
        result.set(rn, { ok: true, person: entry.person });
      }
    }
  }
  return result;
}

/**
 * Resolve nome-de-grupo -> resourceName do Google, criando o grupo se ainda
 * não existir — uma única listagem de grupos (não uma por contato) mais uma
 * criação por label realmente novo. Ignora "mycontacts" (grupo padrão do
 * Google, não é um label nosso).
 */
export async function getOrCreateContactGroups(
  accessToken: string,
  labels: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueLabels = [
    ...new Set(labels.map((l) => (l || "").trim()).filter(Boolean)),
  ];
  if (uniqueLabels.length === 0) return result;

  const groupsRes = await fetch(
    "https://people.googleapis.com/v1/contactGroups?pageSize=200",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const groupsData = await groupsRes.json().catch(() => ({}));
  const existingGroups: any[] = groupsData.contactGroups || [];

  for (const label of uniqueLabels) {
    if (label.toLowerCase() === "mycontacts") continue;
    let found = existingGroups.find(
      (g: any) => g.name === label || g.formattedName === label,
    );
    if (!found) {
      const createRes = await fetch(
        "https://people.googleapis.com/v1/contactGroups",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ contactGroup: { name: label } }),
        },
      );
      if (createRes.ok) {
        found = await createRes.json();
        existingGroups.push(found);
      }
    }
    if (found?.resourceName) result.set(label, found.resourceName);
  }
  return result;
}

/** Renova o access_token do Google a partir do refresh_token salvo do tenant. */
export async function getGoogleAccessToken(
  refreshToken: string,
): Promise<string> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("Falha ao renovar credenciais Google.");
  return tokenData.access_token as string;
}
