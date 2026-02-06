import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ParsedRow = {
  saudacao: string;
  nome_completo: string;
  telefone_principal: string;
  whatsapp_username: string;
  aceita_mensagem: boolean;

  servidor_nome: string;
  usuario: string;
  senha: string;
  tecnologia: string;

  currency: "BRL" | "USD" | "EUR";
  plano: string;
  telas: number | null;

  vencimento_dia: string;
  vencimento_hora: string;

  aplicativos_nome: string;
  obs: string;
};

function normalizeHeader(h: string) {
  return (h || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function parseBool(v: string): boolean {
  const s = (v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "sim" || s === "yes" || s === "y";
}

// Parser CSV simples (suporta ; e aspas)
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const input = text.replace(/^\uFEFF/, "");
  const lines = input.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);

  const rows: string[][] = [];
  for (const line of lines) {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && ch === ";") {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    rows.push(out.map((x) => x.trim()));
  }

  const headers = rows[0] ?? [];
  const data = rows.slice(1);
  return { headers, rows: data };
}

function splitNomeCompleto(full: string): { first_name: string | null; last_name: string | null; display_name: string } {
  const name = (full || "").trim().replace(/\s+/g, " ");
  if (!name) return { first_name: null, last_name: null, display_name: "" };

  const parts = name.split(" ");
  if (parts.length === 1) return { first_name: parts[0], last_name: null, display_name: name };

  const first = parts[0];
  const last = parts.slice(1).join(" ");
  return { first_name: first, last_name: last, display_name: name };
}

function combineVencimento(diaBR: string, hora: string): string | null {
  const d = (diaBR || "").trim();
  const h = (hora || "").trim();
  if (!d) return null;

  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;

  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];

  const hm = h.match(/^(\d{1,2}):(\d{2})$/);
  const HH = hm ? String(hm[1]).padStart(2, "0") : "00";
  const MIN = hm ? hm[2] : "00";

  const isoLike = `${yyyy}-${mm}-${dd}T${HH}:${MIN}:00-03:00`;
  const dt = new Date(isoLike);
  if (Number.isNaN(dt.getTime())) return null;

  return dt.toISOString();
}

async function resolveTenantIdFromMember(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return data?.tenant_id ?? null;
}

function normText(v: any): string {
  return (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickFirstExistingField(row: any, keys: string[]): any {
  for (const k of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, k)) return row[k];
  }
  return undefined;
}

function mapPlanLabelToPeriod(planLabel: string | null): string | null {
  const s = normText(planLabel);

  if (!s) return null;

  // Aceita tanto "Mensal" quanto "MONTHLY"
  if (s.includes("monthly") || s === "mensal") return "MONTHLY";
  if (s.includes("bimonthly") || s === "bimestral") return "BIMONTHLY";
  if (s.includes("quarterly") || s === "trimestral") return "QUARTERLY";
  if (s.includes("semiannual") || s === "semestral") return "SEMIANNUAL";
  if (s.includes("annual") || s === "anual") return "ANNUAL";

  // tolerância (caso venha "Mensalidade", "Plano Mensal", etc.)
  if (s.includes("mens")) return "MONTHLY";
  if (s.includes("bimes")) return "BIMONTHLY";
  if (s.includes("trim")) return "QUARTERLY";
  if (s.includes("semest")) return "SEMIANNUAL";
  if (s.includes("anua")) return "ANNUAL";

  return null;
}

function pickPriceLikeRenewal(
  items: Array<{
    period?: string | null;
    prices?: Array<{ screens_count?: number | null; price_amount?: number | null }> | null;
  }>,
  period: string,
  screens: number
): number | null {
  const it = items.find((x) => (x.period || "") === period);
  if (!it) return null;

  const prices = it.prices || [];
  const exact = prices.find((p) => Number(p.screens_count) === screens);
  if (exact && exact.price_amount != null) return Number(exact.price_amount);

  const one = prices.find((p) => Number(p.screens_count) === 1);
  if (one && one.price_amount != null) return Number(one.price_amount) * screens;

  // mesma ideia da sua tela: se existir item mas não tiver preço, retorna 0 (ou null se quiser travar)
  return 0;
}

async function resolveDefaultPriceAmount(
  supabase: any,
  args: {
    tenant_id: string;
    plan_table_id: string;
    plan_label: string | null; // "Mensal" vindo do CSV
    screens: number;
  }
): Promise<number | null> {
  const { tenant_id, plan_table_id, plan_label, screens } = args;

  const period = mapPlanLabelToPeriod(plan_label);
  if (!period) {
    throw new Error(
      `Plano inválido no CSV: "${plan_label}". Use Mensal/Bimestral/Trimestral/Semestral/Anual (ou MONTHLY...).`
    );
  }

  // Busca igual sua tela de renovação (itens + prices)
  const { data, error } = await supabase
    .from("plan_tables")
    .select(
      `id,
       items:plan_table_items (
         id,
         period,
         prices:plan_table_item_prices (screens_count, price_amount)
       )`
    )
    .eq("tenant_id", tenant_id)
    .eq("id", plan_table_id)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`plan_tables lookup failed: ${error.message}`);

  const items = (data?.items || []) as any[];
  if (!items.length) return null;

  const price = pickPriceLikeRenewal(items, period, screens);
  return price === null ? null : Number(price);
}




function parseCurrency(raw: string): "BRL" | "USD" | "EUR" {
  const s = (raw || "").trim().toUpperCase();
  if (s === "BRL" || s === "USD" || s === "EUR") return s;
  throw new Error(`Currency inválida: "${raw}". Use BRL, USD ou EUR.`);
}

function pickRpcClientId(data: any): string | null {
  // cobre os retornos mais comuns do PostgREST:
  // - uuid string
  // - [{ id: uuid }]
  // - { id: uuid } / { client_id: uuid }
  if (!data) return null;
  if (typeof data === "string") return data;
  if (Array.isArray(data) && data.length) {
    const row = data[0];
    if (row?.id) return row.id;
    if (row?.client_id) return row.client_id;
  }
  if (data?.id) return data.id;
  if (data?.client_id) return data.client_id;
  return null;
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ✅ created_by sempre vem do user autenticado (sem hardcode)
  const created_by = user.id;

  // ✅ tenant vem do lugar correto (query OU tenant_members)
  const url = new URL(req.url);
  const tenantFromQuery = url.searchParams.get("tenant_id");
  const tenantFromMember = await resolveTenantIdFromMember(supabase, user.id);
  const tenant_id = tenantFromQuery || tenantFromMember;

  if (!tenant_id) {
    return NextResponse.json({ error: "tenant_id_missing" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "file_missing", hint: "Envie multipart/form-data com campo 'file'." },
      { status: 400 }
    );
  }

  const text = await file.text();
  const { headers, rows } = parseCsv(text);

  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeader(h), idx));

  const requiredHeadersBase = [
    "saudacao",
    "nome completo",
    "telefone principal",
    "whatsapp username",
    "aceita mensagem",
    "servidor",
    "usuario",
    "senha",
    "tecnologia",
    "plano",
    "telas",
    "vencimento dia",
    "vencimento hora",
    "aplicativos nome",
    "obs",
  ];

  const missingBase = requiredHeadersBase.filter((h) => !colIndex.has(normalizeHeader(h)));

  const hasCurrency = colIndex.has(normalizeHeader("currency"));
  const hasMoeda = colIndex.has(normalizeHeader("moeda"));
  const missingCurrency = !hasCurrency && !hasMoeda;

  const missing = [...missingBase, ...(missingCurrency ? ["currency|moeda"] : [])];

  if (missing.length) {
    return NextResponse.json(
      {
        error: "invalid_headers",
        missing,
        hint: "Precisa conter todas as colunas obrigatórias e também 'Currency' ou 'Moeda'.",
      },
      { status: 400 }
    );
  }

  // 1) Pré-carregar servidores do tenant (resolver por nome)
  const { data: servers, error: sErr } = await supabase
    .from("servers")
    .select("id,name")
    .eq("tenant_id", tenant_id);

  if (sErr) {
    return NextResponse.json(
      { error: "servers_lookup_failed", details: sErr.message, hint: "Confirme se a tabela é 'servers'." },
      { status: 500 }
    );
  }

  const byServerName = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const s of (servers ?? []) as any[]) {
    const name = (s.name ?? "").toString().trim().toLowerCase();
    if (!name) continue;
    if (byServerName.has(name)) duplicates.add(name);
    byServerName.set(name, s.id);
  }

  // 1.1) Pré-carregar plan_tables do tenant (validar default por moeda)
  const { data: planTables, error: ptErr } = await supabase
    .from("plan_tables")
    .select("id,currency,is_system_default,name")
    .eq("tenant_id", tenant_id);

  if (ptErr) {
    return NextResponse.json(
      { error: "plan_tables_lookup_failed", details: ptErr.message, hint: "Confirme se a tabela é 'plan_tables'." },
      { status: 500 }
    );
  }

  const defaultPlanTableIdByCurrency = new Map<"BRL" | "USD" | "EUR", string>();
  const multipleDefaults: string[] = [];

  for (const pt of (planTables ?? []) as any[]) {
    const cur = (pt.currency ?? "").toString().trim().toUpperCase();
    const isDefault = !!pt.is_system_default;
    if (!isDefault) continue;

    if (cur === "BRL" || cur === "USD" || cur === "EUR") {
      if (defaultPlanTableIdByCurrency.has(cur as any)) multipleDefaults.push(cur);
      else defaultPlanTableIdByCurrency.set(cur as any, pt.id);
    }
  }

  if (multipleDefaults.length) {
    return NextResponse.json(
      {
        error: "multiple_default_plan_tables",
        currencies: Array.from(new Set(multipleDefaults)),
        hint: "Você tem mais de uma plan_table com is_system_default=true para a mesma moeda. Deixe apenas 1 default por moeda.",
      },
      { status: 500 }
    );
  }

  const missingDefaults: string[] = [];
  if (!defaultPlanTableIdByCurrency.has("BRL")) missingDefaults.push("BRL");
  if (!defaultPlanTableIdByCurrency.has("USD")) missingDefaults.push("USD");
  if (!defaultPlanTableIdByCurrency.has("EUR")) missingDefaults.push("EUR");

  if (missingDefaults.length) {
    return NextResponse.json(
      {
        error: "default_plan_tables_missing",
        missing: missingDefaults,
        hint: "Crie/ajuste plan_tables para ter 1 default por moeda: is_system_default=true (BRL, USD, EUR).",
      },
      { status: 500 }
    );
  }

  // 2) Pré-carregar apps catalog
  const { data: apps, error: aErr } = await supabase
    .from("apps")
    .select("id,name")
    .eq("tenant_id", tenant_id);

  if (aErr) {
    return NextResponse.json(
      { error: "apps_lookup_failed", details: aErr.message, hint: "Confirme se existe tabela 'apps' com tenant_id,name." },
      { status: 500 }
    );
  }

  const appIdByName = new Map<string, string>();
  for (const a of (apps ?? []) as any[]) {
    const name = (a.name ?? "").toString().trim().toLowerCase();
    if (!name) continue;
    appIdByName.set(name, a.id);
  }

  let inserted = 0;
  let updated = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];
  const warnings: Array<{ row: number; warning: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    try {
      const get = (key: string) => {
        const idx = colIndex.get(normalizeHeader(key));
        return idx === undefined ? "" : (r[idx] ?? "").toString().trim();
      };

      const parsed: ParsedRow = {
        saudacao: get("Saudação"),
        nome_completo: get("Nome Completo"),
        telefone_principal: get("Telefone principal"),
        whatsapp_username: get("Whatsapp Username"),
        aceita_mensagem: parseBool(get("Aceita mensagem")),

        servidor_nome: get("Servidor"),
        usuario: get("Usuário"),
        senha: get("Senha"),
        tecnologia: get("Tecnologia"),

        currency: parseCurrency(get("Currency") || get("Moeda")),

        plano: get("Plano"),
        telas: (() => {
          const raw = get("Telas");
          const n = Number(raw);
          if (!raw) return null;
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),

        vencimento_dia: get("Vencimento dia"),
        vencimento_hora: get("Vencimento hora"),

        aplicativos_nome: get("Aplicativos nome"),
        obs: get("Obs"),
      };

      if (!parsed.servidor_nome?.trim()) throw new Error("Servidor vazio (coluna 'Servidor').");
      if (!parsed.usuario?.trim()) throw new Error("Usuário vazio (coluna 'Usuário').");

      const serverKey = parsed.servidor_nome.trim().toLowerCase();
      if (duplicates.has(serverKey)) {
        throw new Error(`Servidor duplicado no tenant: "${parsed.servidor_nome}". Renomeie para ficar único.`);
      }
      const server_id = byServerName.get(serverKey);
      if (!server_id) throw new Error(`Servidor não encontrado no tenant: "${parsed.servidor_nome}".`);

      const vencimentoISO = combineVencimento(parsed.vencimento_dia, parsed.vencimento_hora);

      // ✅ valida default plan table por moeda (sem gravar nada)
      const defaultPlanTableId = defaultPlanTableIdByCurrency.get(parsed.currency);
      if (!defaultPlanTableId) {
        throw new Error(`Não existe plan_table default para ${parsed.currency}.`);
      }

      const nameParts = splitNomeCompleto(parsed.nome_completo);
      if (!nameParts.display_name) throw new Error("Nome Completo vazio.");

      // ✅ resolve apps
      const appNames = (parsed.aplicativos_nome || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      const appIds: string[] = [];
      const missingApps: string[] = [];

      for (const nm of Array.from(new Set(appNames))) {
        const id = appIdByName.get(nm.toLowerCase());
        if (id) appIds.push(id);
        else missingApps.push(nm);
      }

      if (missingApps.length) {
        warnings.push({
          row: rowNum,
          warning: `Apps não encontrados no catálogo: ${missingApps.join(", ")} (não foram vinculados).`,
        });
      }

      // ✅ Upsert lógico: buscar existente (SELECT pode ser permitido; seu erro atual foi no INSERT)
      const { data: existing, error: exErr } = await supabase
        .from("clients")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("server_id", server_id)
        .eq("server_username", parsed.usuario)
        .maybeSingle();

      if (exErr && exErr.code !== "PGRST116") {
        throw new Error(
          `Falha ao consultar cliente existente: ${exErr.message}. Se RLS bloqueou SELECT, precisamos trocar por view/RPC de lookup.`
        );
      }

      let client_id: string | null = existing?.id ?? null;



const screens = parsed.telas && parsed.telas > 0 ? parsed.telas : 1;

const plan_table_id = defaultPlanTableIdByCurrency.get(parsed.currency);
if (!plan_table_id) throw new Error(`Não existe plan_table default para ${parsed.currency}.`);

const defaultPriceAmount = await resolveDefaultPriceAmount(supabase, {
  tenant_id,
  plan_table_id,
  plan_label: parsed.plano || null, // "Mensal"
  screens,
});

if (defaultPriceAmount === null) {
  throw new Error(
    `Preço padrão não encontrado na plan_table default (${parsed.currency}) para Plano="${parsed.plano}" e Telas=${screens}.`
  );
}




      if (!client_id) {
        // ✅ CREATE via RPC (SECURITY DEFINER)
        const { data: created, error: crErr } = await supabase.rpc("create_client_and_setup", {
          p_tenant_id: tenant_id,
          p_created_by: created_by,

          p_display_name: nameParts.display_name,

          p_server_id: server_id,
          p_server_username: parsed.usuario,
          p_server_password: parsed.senha || null,

          p_screens: screens,
          p_plan_label: parsed.plano || null,
          p_price_amount: defaultPriceAmount, // ✅ agora vem da tabela padrão
          p_price_currency: parsed.currency,


          p_vencimento: vencimentoISO,
          p_is_trial: false,
          p_notes: parsed.obs || null,

          p_phone_primary_e164: parsed.telefone_principal || null,

          p_whatsapp_opt_in: parsed.aceita_mensagem,
          p_whatsapp_username: parsed.whatsapp_username || null,
          p_whatsapp_snooze_until: null,

          p_app_ids: appIds,
          p_is_archived: false,

          // ✅ sempre enviar para bater na assinatura “completa”
          p_technology: parsed.tecnologia || null,
        });

        if (crErr) throw new Error(`create_client_and_setup: ${crErr.message}`);

        client_id = pickRpcClientId(created);

        // ✅ fallback se a RPC não retornar id: re-consulta (sem inventar banco)
        if (!client_id) {
          const { data: again, error: againErr } = await supabase
            .from("clients")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("server_id", server_id)
            .eq("server_username", parsed.usuario)
            .maybeSingle();

          if (againErr) throw new Error(`Criou via RPC, mas não consegui recuperar o id: ${againErr.message}`);
          client_id = again?.id ?? null;
        }

        if (!client_id) throw new Error("Criou via RPC, mas não consegui obter o client_id.");

        inserted++;
      } else {
        // ✅ UPDATE via RPC
        const { error: upErr } = await supabase.rpc("update_client", {
          p_tenant_id: tenant_id,
          p_client_id: client_id,

          p_display_name: nameParts.display_name,
          p_name_prefix: parsed.saudacao || null,

          p_notes: parsed.obs || null,
          p_clear_notes: false,

          p_server_id: server_id,
          p_server_username: parsed.usuario,
          p_server_password: parsed.senha || null,

          p_screens: screens,
          p_plan_label: parsed.plano || null,
          p_price_amount: defaultPriceAmount, // ✅ agora vem da tabela padrão
          p_price_currency: parsed.currency,


          p_vencimento: vencimentoISO,
          p_is_trial: false,

          p_whatsapp_opt_in: parsed.aceita_mensagem,
          p_whatsapp_username: parsed.whatsapp_username || null,
          p_whatsapp_snooze_until: null,

          p_is_archived: false,

          // ✅ sempre enviar para bater na assinatura “completa”
          p_technology: parsed.tecnologia || null,
        });

        if (upErr) throw new Error(`update_client: ${upErr.message}`);
        updated++;
      }

      // ✅ Apps via RPC (sincroniza lista inteira)
      {
        const { error: appErr } = await supabase.rpc("set_client_apps", {
          p_tenant_id: tenant_id,
          p_client_id: client_id,
          p_app_ids: appIds, // pode ser []
        });
        if (appErr) throw new Error(`set_client_apps: ${appErr.message}`);
      }

      // ✅ Telefones via RPC (primário; secundários = [])
      if (parsed.telefone_principal) {
        const { error: phErr } = await supabase.rpc("set_client_phones", {
          p_tenant_id: tenant_id,
          p_client_id: client_id,
          p_primary_e164: parsed.telefone_principal,
          p_secondary_e164: [],
        });

        if (phErr) {
          warnings.push({ row: rowNum, warning: `Telefone não foi importado (set_client_phones): ${phErr.message}` });
        }
      }
    } catch (e: any) {
      rowErrors.push({ row: rowNum, error: e?.message || "Falha ao importar linha" });
    }
  }

  return NextResponse.json({
    ok: rowErrors.length === 0,
    total: rows.length,
    inserted,
    updated,
    errors: rowErrors,
    warnings,
  });
}
