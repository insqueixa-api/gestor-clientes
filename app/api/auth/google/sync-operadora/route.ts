// app/api/auth/google/sync-operadora/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  batchGetPeople,
  batchUpdatePeople,
  getGoogleAccessToken,
} from "@/lib/google/people-batch";

export const dynamic = "force-dynamic";

// Formata o telefone apenas com dígitos para enviar para a API de consulta
function onlyDigits(raw: string | null | undefined) {
  if (!raw) return "";
  return raw.replace(/\D+/g, "");
}

// 🪄 TRADUTOR DE LABELS PARA O GOOGLE
function getGoogleLabel(label: string, defaultType: string) {
  if (!label) return { type: defaultType };
  const low = label.toLowerCase();
  if (["casa", "home"].includes(low)) return { type: "home" };
  if (["trabalho", "work", "empresa"].includes(low)) return { type: "work" };
  if (["celular", "mobile"].includes(low)) return { type: "mobile" };
  if (["pessoal", "other", "outro"].includes(low)) return { type: "other" };
  return { type: label }; // Aceita o nome da operadora direto
}

// 🌍 MAPA DE DDI PARA IDENTIFICAÇÃO INTERNACIONAL
const DDI_OPTIONS = [
  { code: "1", label: "EUA/Canadá" },
  { code: "351", label: "Portugal" },
  { code: "353", label: "Irlanda" },
  { code: "507", label: "Panamá" },
  { code: "506", label: "Costa Rica" },
  { code: "595", label: "Paraguai" },
  { code: "591", label: "Bolívia" },
  { code: "234", label: "Nigéria" },
  { code: "254", label: "Quênia" },
  { code: "212", label: "Marrocos" },
  { code: "971", label: "Emirados Árabes" },
  { code: "966", label: "Arábia Saudita" },
  { code: "44", label: "Reino Unido" },
  { code: "34", label: "Espanha" },
  { code: "49", label: "Alemanha" },
  { code: "33", label: "França" },
  { code: "39", label: "Itália" },
  { code: "52", label: "México" },
  { code: "54", label: "Argentina" },
  { code: "56", label: "Chile" },
  { code: "57", label: "Colômbia" },
  { code: "58", label: "Venezuela" },
  { code: "32", label: "Bélgica" },
  { code: "46", label: "Suécia" },
  { code: "31", label: "Holanda" },
  { code: "41", label: "Suíça" },
  { code: "45", label: "Dinamarca" },
  { code: "48", label: "Polônia" },
  { code: "30", label: "Grécia" },
  { code: "27", label: "África do Sul" },
  { code: "20", label: "Egito" },
  { code: "86", label: "China" },
  { code: "91", label: "Índia" },
  { code: "81", label: "Japão" },
  { code: "82", label: "Coreia do Sul" },
  { code: "66", label: "Tailândia" },
  { code: "62", label: "Indonésia" },
  { code: "60", label: "Malásia" },
  { code: "98", label: "Irã" },
  { code: "90", label: "Turquia" },
  { code: "61", label: "Austrália" },
  { code: "64", label: "Nova Zelândia" },
];

function inferDDI(digits: string): string {
  if (!digits) return "55";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }
  return "55";
}

// 📡 INTEGRAÇÃO COM A TELEIN DE PORTABILIDADE/OPERADORA
// (fica de fora do batch do Google de propósito — é uma API externa
// diferente, com o próprio limite de taxa, então continua sendo consultada
// telefone por telefone, com pausa entre chamadas.)
async function consultarOperadoraExterna(
  phoneDigits: string,
): Promise<string | null> {
  try {
    const chave = (process.env.TELEIN_API_KEY || "")
      .replace(/['"]/g, "")
      .trim();
    if (!chave) return null;

    const numeroTratado = phoneDigits.startsWith("55")
      ? phoneDigits.substring(2)
      : phoneDigits;

    const res = await fetch(
      `http://consultanumero1.telein.com.br/sistema/consulta_numero.php?chave=${chave}&numero=${numeroTratado}`,
      { signal: AbortSignal.timeout(5000) },
    );

    if (!res.ok) return null;

    const textoRetorno = await res.text();
    const partes = textoRetorno.split("#");

    if (partes.length === 0) return null;

    const codigoDaOperadora = partes[0].trim();

    if (codigoDaOperadora.startsWith("99")) {
      return null;
    }

    const mapOperadoras: Record<string, string> = {
      "20": "Vivo",
      "21": "Claro",
      "31": "Oi",
      "41": "TIM",
      "12": "Algar",
      "14": "Oi", // Antiga Brasil Telecom
      "77": "Claro", // Antiga Nextel
      "34": "Vivo", // Telefônica Fixo
      "35": "Claro", // Embratel Fixo
      "36": "Oi", // Telemar Fixo
      "38": "Vivo", // GVT Fixo
      "40": "TIM", // TIM Fixo
    };

    return mapOperadoras[codigoDaOperadora] || "Celular/Fixo";
  } catch {
    return null;
  }
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
    const { contact_ids } = body;

    if (
      !contact_ids ||
      !Array.isArray(contact_ids) ||
      contact_ids.length === 0
    ) {
      return NextResponse.json(
        { error: "Nenhum contato selecionado." },
        { status: 400 },
      );
    }

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

    const { data: contacts } = await supabase
      .from("google_contacts")
      .select("*")
      .in("id", contact_ids)
      .eq("tenant_id", tenantId);

    if (!contacts || contacts.length === 0) {
      return NextResponse.json(
        { error: "Contatos não encontrados no banco." },
        { status: 404 },
      );
    }

    // ✅ Confere no Google, de uma vez pra todo mundo, ANTES de gastar
    // crédito da Telein — mesma garantia de antes (não consulta a Telein pra
    // um contato que o Google não vai aceitar depois), só que 1 chamada em
    // vez de 1 por contato.
    const personByResource = await batchGetPeople(
      accessToken,
      contacts
        .map((c) => c.google_resource_name)
        .filter((rn): rn is string => Boolean(rn)),
      "metadata,phoneNumbers",
    );

    let successCount = 0;
    const errors: string[] = [];
    const updates = new Map<string, Record<string, any>>();
    const localPhonesByResource = new Map<string, any[]>();

    for (const contact of contacts) {
      try {
        const resourceName = contact.google_resource_name as string | null;
        const person = resourceName
          ? personByResource.get(resourceName)
          : undefined;
        if (!person?.etag) {
          throw new Error(
            `Google indisponível pra ${contact.display_name} — Telein não foi consultada.`,
          );
        }

        let hasChanges = false;
        const updatedPhones = contact.phones ? [...contact.phones] : [];

        for (let i = 0; i < updatedPhones.length; i++) {
          const phone = updatedPhones[i];
          const digits = onlyDigits(phone.value);

          const rawValue = phone.value || "";
          let ddi = "55";
          let national = digits;

          if (rawValue.trim().startsWith("+") || digits.length > 11) {
            ddi = inferDDI(digits);
            national = digits.startsWith(ddi)
              ? digits.slice(ddi.length)
              : digits;
          }

          if (ddi === "55") {
            if (national.startsWith("0")) national = national.slice(1);

            if (national.length >= 10 && national.length <= 11) {
              const fullDigits = `55${national}`;
              const operadoraName = await consultarOperadoraExterna(fullDigits);

              if (operadoraName) {
                if (phone.label !== operadoraName) {
                  updatedPhones[i].label = operadoraName;
                  hasChanges = true;
                }
              } else {
                throw new Error(`Falha na Telein (Número: ${fullDigits})`);
              }
            }
          } else {
            const countryLabel =
              DDI_OPTIONS.find((o) => o.code === ddi)?.label || "Internacional";
            if (phone.label !== countryLabel) {
              updatedPhones[i].label = countryLabel;
              hasChanges = true;
            }
          }
        }

        if (hasChanges && resourceName) {
          updates.set(resourceName, {
            etag: person.etag,
            phoneNumbers: updatedPhones.map((p: any) => ({
              value: p.value,
              ...getGoogleLabel(p.label, "mobile"),
            })),
          });
          localPhonesByResource.set(resourceName, updatedPhones);
        }
      } catch (err: any) {
        errors.push(`${contact.display_name}: ${err.message}`);
      }

      // Pausa só pro rate limit da Telein (o Google agora vai tudo num
      // batchUpdateContacts só, no final, fora deste loop).
      await new Promise((r) => setTimeout(r, 300));
    }

    // ── Envia todas as trocas de telefone/operadora pro Google de uma vez ──────
    const results = await batchUpdatePeople(
      accessToken,
      updates,
      "phoneNumbers",
    );

    // ── Grava tudo de volta no banco local numa tacada só (upsert em lote) ────
    const nowIso = new Date().toISOString();
    const rowsToUpsert: { id: string; phones: any[]; synced_at: string }[] = [];
    for (const [resourceName, outcome] of results) {
      const contact = contacts.find(
        (c) => c.google_resource_name === resourceName,
      );
      if (!contact) continue;

      if (outcome.ok) {
        rowsToUpsert.push({
          id: contact.id,
          phones: localPhonesByResource.get(resourceName),
          synced_at: nowIso,
        });
        successCount++;
      } else {
        errors.push(
          `${contact.display_name}: Falha no Google API — ${outcome.error}`,
        );
      }
    }
    if (rowsToUpsert.length > 0) {
      await supabase.from("google_contacts").upsert(rowsToUpsert, {
        onConflict: "id",
      });
    }

    return NextResponse.json({
      success: true,
      message: `${successCount} contatos atualizados.`,
      errors,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
