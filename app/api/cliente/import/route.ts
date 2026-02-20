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

  // ✅ NOVOS (template)
  valor_plano_raw: string;     // "Valor Plano"
  tabela_preco_raw: string;    // "Tabela Preco" (LABEL)
  m3u_url: string;             // "M3U URL"
  cadastro_dia: string;        // "Data do cadastro"
  cadastro_hora: string;       // "Cadastro hora"
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

// ✅ dd/mm/yyyy + hh:mm (hora opcional) -> ISO
function combineDiaHoraBR(diaBR: string, hora: string): string | null {
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

function parseCurrency(raw: string): "BRL" | "USD" | "EUR" {
  const s = (raw || "").trim().toUpperCase();
  if (s === "BRL" || s === "USD" || s === "EUR") return s;
  throw new Error(`Currency inválida: "${raw}". Use BRL, USD ou EUR.`);
}

function normText(v: any): string {
  return (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pickRpcClientId(data: any): string | null {
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

function onlyDigits(v: string) {
  return (v || "").replace(/\D+/g, "");
}

// ✅ regra simples: se já tem +, mantém; se não, assume BR (+55)
function toE164Phone(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!s) return null;

  if (s.startsWith("+")) {
    const digits = onlyDigits(s);
    return digits ? `+${digits}` : null;
  }

  const digits = onlyDigits(s);
  if (!digits) return null;

  const withDdi = digits.startsWith("55") ? digits : `55${digits}`;
  return `+${withDdi}`;
}

function parseMoney(raw: string): number | null {
  const s0 = (raw || "").trim();
  if (!s0) return null;

  // tira símbolos comuns e espaços
  let s = s0.replace(/\s+/g, "");
  s = s.replace(/[R$\u00A0]/g, "");

  // mantém só dígitos, ponto, vírgula, sinal
  s = s.replace(/[^0-9,.\-]/g, "");

  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  // "1.234,56" -> remove pontos e troca vírgula por ponto
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else if (hasComma && !hasDot) {
    // "1234,56" -> troca vírgula por ponto
    s = s.replace(/,/g, ".");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((v || "").trim());
}

function mapPlanLabelToPeriod(planLabel: string | null): string | null {
  const s = normText(planLabel);
  if (!s) return null;

  if (s.includes("monthly") || s === "mensal" || s.includes("mens")) return "MONTHLY";
  if (s.includes("bimonthly") || s === "bimestral" || s.includes("bimes")) return "BIMONTHLY";
  if (s.includes("quarterly") || s === "trimestral" || s.includes("trim")) return "QUARTERLY";
  if (s.includes("semiannual") || s === "semestral" || s.includes("semest")) return "SEMIANNUAL";
  if (s.includes("annual") || s === "anual" || s.includes("anua")) return "ANNUAL";

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

  return 0;
}

async function resolveDefaultPriceAmount(
  supabase: any,
  args: {
    tenant_id: string;
    plan_table_id: string;
    plan_label: string | null;
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

/**
 * ✅ Segurança: resolve tenant pelo membership.
 * - Se o usuário tiver 1 tenant: usa ele.
 * - Se tiver múltiplos: exige tenant_id na query e valida que pertence ao user.
 */
async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId);

  if (error) {
    return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };
  }

  const tenantIds = Array.from(
    new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))
  );

  if (tenantIds.length === 0) {
    return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Seu usuário não está vinculado a um tenant." };
  }

  if (tenantIds.length === 1) {
    const only = tenantIds[0];
    if (tenantFromQuery && tenantFromQuery !== only) {
      return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "tenant_id não pertence ao seu usuário." };
    }
    return { tenant_id: only, status: 200 };
  }

  if (!tenantFromQuery) {
    return {
      tenant_id: null,
      status: 400,
      error: "tenant_required",
      hint: "Você participa de múltiplos tenants. Informe tenant_id na querystring para importar no tenant desejado.",
    };
  }

  if (!tenantIds.includes(tenantFromQuery)) {
    return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "tenant_id não pertence ao seu usuário." };
  }

  return { tenant_id: tenantFromQuery, status: 200 };
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const created_by = user.id;

  const url = new URL(req.url);
  const tenantFromQuery = url.searchParams.get("tenant_id");

  const resolved = await resolveTenantIdForUser(supabase, user.id, tenantFromQuery);
  if (!resolved.tenant_id) {
    return NextResponse.json(
      { error: (resolved as any).error, hint: (resolved as any).hint, details: (resolved as any).details },
      { status: (resolved as any).status || 400 }
    );
  }
  const tenant_id = resolved.tenant_id;

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

  const getCell = (r: string[], key: string) => {
    const idx = colIndex.get(normalizeHeader(key));
    return idx === undefined ? "" : (r[idx] ?? "").toString().trim();
  };

  // 1) Servidores do tenant (resolver por nome)
  const { data: servers, error: sErr } = await supabase
    .from("servers")
    .select("id,name")
    .eq("tenant_id", tenant_id);

  if (sErr) {
    return NextResponse.json(
      { error: "servers_lookup_failed", details: sErr.message },
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

  // 2) Plan tables do tenant (default por moeda + map por name)
  const { data: planTables, error: ptErr } = await supabase
    .from("plan_tables")
    .select("id,currency,is_system_default,name")
    .eq("tenant_id", tenant_id);

  if (ptErr) {
    return NextResponse.json(
      { error: "plan_tables_lookup_failed", details: ptErr.message },
      { status: 500 }
    );
  }

  const defaultPlanTableIdByCurrency = new Map<"BRL" | "USD" | "EUR", string>();
  const planTablesByName = new Map<string, Array<{ id: string; currency: "BRL" | "USD" | "EUR" }>>();
  const planTableById = new Map<string, { id: string; currency: "BRL" | "USD" | "EUR"; name: string }>();

  const multipleDefaults: string[] = [];

  for (const pt of (planTables ?? []) as any[]) {
    const cur = (pt.currency ?? "").toString().trim().toUpperCase();
    const isDefault = !!pt.is_system_default;

    if (cur === "BRL" || cur === "USD" || cur === "EUR") {
      const id = String(pt.id);
      const name = String(pt.name ?? "");
      planTableById.set(id, { id, currency: cur as any, name });

      const keyName = normText(name);
      if (keyName) {
        const arr = planTablesByName.get(keyName) ?? [];
        arr.push({ id, currency: cur as any });
        planTablesByName.set(keyName, arr);
      }

      if (isDefault) {
        if (defaultPlanTableIdByCurrency.has(cur as any)) multipleDefaults.push(cur);
        else defaultPlanTableIdByCurrency.set(cur as any, id);
      }
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

  // 3) Apps catalog
  const { data: apps, error: aErr } = await supabase
    .from("apps")
    .select("id,name")
    .eq("tenant_id", tenant_id);

  if (aErr) {
    return NextResponse.json(
      { error: "apps_lookup_failed", details: aErr.message },
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

  // cache do cálculo de preço padrão (evita bater plan_tables toda hora)
  const priceCache = new Map<string, number | null>();

  // evita spam se o RPC extra não existir ainda
  let extrasRpcMissingWarned = false;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    try {
      const parsed: ParsedRow = {
        saudacao: getCell(r, "Saudacao"),
        nome_completo: getCell(r, "Nome Completo"),
        telefone_principal: getCell(r, "Telefone principal"),
        whatsapp_username: getCell(r, "Whatsapp Username"),
        aceita_mensagem: parseBool(getCell(r, "Aceita mensagem")),

        servidor_nome: getCell(r, "Servidor"),
        usuario: getCell(r, "Usuario"),
        senha: getCell(r, "Senha"),
        tecnologia: getCell(r, "Tecnologia"),

        currency: parseCurrency(getCell(r, "Currency") || getCell(r, "Moeda")),

        plano: getCell(r, "Plano"),
        telas: (() => {
          const raw = getCell(r, "Telas");
          const n = Number(raw);
          if (!raw) return null;
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),

        vencimento_dia: getCell(r, "Vencimento dia"),
        vencimento_hora: getCell(r, "Vencimento hora"),

        aplicativos_nome: getCell(r, "Aplicativos nome"),
        obs: getCell(r, "Obs"),

        // ✅ NOVOS
        valor_plano_raw: getCell(r, "Valor Plano"),
        tabela_preco_raw: getCell(r, "Tabela Preco"),
        m3u_url: getCell(r, "M3U URL"),
        cadastro_dia: getCell(r, "Data do cadastro"),
        cadastro_hora: getCell(r, "Cadastro hora"),
      };

      if (!parsed.servidor_nome?.trim()) throw new Error("Servidor vazio (coluna 'Servidor').");
      if (!parsed.usuario?.trim()) throw new Error("Usuário vazio (coluna 'Usuario').");

      const serverKey = parsed.servidor_nome.trim().toLowerCase();
      if (duplicates.has(serverKey)) {
        throw new Error(`Servidor duplicado no tenant: "${parsed.servidor_nome}". Renomeie para ficar único.`);
      }
      const server_id = byServerName.get(serverKey);
      if (!server_id) throw new Error(`Servidor não encontrado no tenant: "${parsed.servidor_nome}".`);

      const screens = parsed.telas && parsed.telas > 0 ? parsed.telas : 1;

      // ✅ resolve plan_table_id:
      // - se vier UUID em "Tabela Preco", aceita
      // - se vier LABEL, resolve por plan_tables.name (preferindo a mesma currency da linha)
      // - se vazio, usa default da currency
      let plan_table_id: string | null = null;

      const rawTabela = (parsed.tabela_preco_raw || "").trim();
      if (rawTabela) {
        if (isUuidLike(rawTabela)) {
          const meta = planTableById.get(rawTabela);
          if (!meta) throw new Error(`Tabela Preco UUID não existe no tenant: ${rawTabela}`);
          if (meta.currency !== parsed.currency) {
            throw new Error(
              `Tabela Preco (${meta.name}) é ${meta.currency}, mas a linha está Currency=${parsed.currency}.`
            );
          }
          plan_table_id = meta.id;
        } else {
          const key = normText(rawTabela);
          const candidates = planTablesByName.get(key) ?? [];
          if (!candidates.length) throw new Error(`Tabela Preco não encontrada no tenant: "${rawTabela}".`);

          const sameCur = candidates.find((c) => c.currency === parsed.currency);
          if (sameCur) plan_table_id = sameCur.id;
          else if (candidates.length === 1) plan_table_id = candidates[0].id;
          else {
            throw new Error(
              `Tabela Preco "${rawTabela}" é ambígua (existe em múltiplas moedas). Preencha Currency corretamente ou use um nome único por moeda.`
            );
          }
        }
      } else {
        plan_table_id = defaultPlanTableIdByCurrency.get(parsed.currency) ?? null;
      }

      if (!plan_table_id) throw new Error(`Não existe plan_table default para ${parsed.currency}.`);

      const vencimentoISO = combineDiaHoraBR(parsed.vencimento_dia, parsed.vencimento_hora);

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

      // ✅ preço: se vier "Valor Plano", usa; senão calcula pelo plan_table + plano + telas
      let price_amount: number | null = null;
      const manualPrice = parseMoney(parsed.valor_plano_raw);

      if (manualPrice !== null) {
        price_amount = manualPrice;
      } else {
        const cacheKey = `${plan_table_id}|${normText(parsed.plano)}|${screens}`;
        if (priceCache.has(cacheKey)) {
          price_amount = priceCache.get(cacheKey)!;
        } else {
          const computed = await resolveDefaultPriceAmount(supabase, {
            tenant_id,
            plan_table_id,
            plan_label: parsed.plano || null,
            screens,
          });

          if (computed === null) {
            throw new Error(
              `Preço padrão não encontrado na plan_table (${parsed.currency}) para Plano="${parsed.plano}" e Telas=${screens}.`
            );
          }

          priceCache.set(cacheKey, computed);
          price_amount = computed;
        }
      }

      if (price_amount === null) {
        throw new Error(`Valor Plano inválido: "${parsed.valor_plano_raw}"`);
      }

      // ✅ upsert lógico: existe?
      const { data: existing, error: exErr } = await supabase
        .from("clients")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("server_id", server_id)
        .eq("server_username", parsed.usuario)
        .maybeSingle();

      if (exErr && exErr.code !== "PGRST116") {
        throw new Error(`Falha ao consultar cliente existente: ${exErr.message}`);
      }

      let client_id: string | null = existing?.id ?? null;

      // ✅ cadastro (created_at override) vindo do CSV
      const cadastroISO = combineDiaHoraBR(parsed.cadastro_dia, parsed.cadastro_hora);

      if (!client_id) {
        const phoneE164 = toE164Phone(parsed.telefone_principal);

        const { data: created, error: crErr } = await supabase.rpc("create_client_and_setup", {
          p_tenant_id: tenant_id,
          p_created_by: created_by,

          p_display_name: nameParts.display_name,

          p_server_id: server_id,
          p_server_username: parsed.usuario,
          p_server_password: parsed.senha || null,

          p_screens: screens,
          p_plan_label: parsed.plano || null,
          p_price_amount: price_amount,
          p_price_currency: parsed.currency,

          p_vencimento: vencimentoISO,
          p_is_trial: false,
          p_notes: parsed.obs || null,

          p_phone_primary_e164: phoneE164,

          p_whatsapp_opt_in: parsed.aceita_mensagem,
          p_whatsapp_username: parsed.whatsapp_username || null,

          p_whatsapp_snooze_until: null,
          p_clear_whatsapp_snooze_until: true,

          p_app_ids: appIds,
          p_is_archived: false,

          p_technology: (parsed.tecnologia || "").trim() || "IPTV",
        });

        if (crErr) throw new Error(`create_client_and_setup: ${crErr.message}`);

        client_id = pickRpcClientId(created);

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
          p_price_amount: price_amount,
          p_price_currency: parsed.currency,

          p_vencimento: vencimentoISO,
          p_is_trial: false,

          p_whatsapp_opt_in: parsed.aceita_mensagem,
          p_whatsapp_username: parsed.whatsapp_username || null,

          p_whatsapp_snooze_until: null,
          p_clear_whatsapp_snooze_until: true,

          p_is_archived: false,
          p_technology: (parsed.tecnologia || "").trim() || "IPTV",
        });

        if (upErr) throw new Error(`update_client: ${upErr.message}`);
        updated++;
      }

      // ✅ Apps via RPC
      {
        const { error: appErr } = await supabase.rpc("set_client_apps", {
          p_tenant_id: tenant_id,
          p_client_id: client_id,
          p_app_ids: appIds,
        });
        if (appErr) throw new Error(`set_client_apps: ${appErr.message}`);
      }

      // ✅ Telefones via RPC
      const phoneE164 = toE164Phone(parsed.telefone_principal);
      if (phoneE164) {
        const { error: phErr } = await supabase.rpc("set_client_phones", {
          p_tenant_id: tenant_id,
          p_client_id: client_id,
          p_primary_e164: phoneE164,
          p_secondary_e164: [],
        });

        if (phErr) {
          warnings.push({ row: rowNum, warning: `Telefone não foi importado (set_client_phones): ${phErr.message}` });
        }
      }

      // ✅ Extras (plan_table_id, m3u_url, created_at) via RPC extra
      // Se ainda não existir, vira warning (sem quebrar seu import).
      {
        const payload = {
          p_tenant_id: tenant_id,
          p_client_id: client_id,
          p_plan_table_id: plan_table_id,
          p_m3u_url: (parsed.m3u_url || "").trim() || null,
          p_created_at: cadastroISO, // pode ser null (se vazio/invalid)
        };

        const { error: exSetErr } = await supabase.rpc("import_set_client_extras", payload);

        if (exSetErr) {
          const msg = exSetErr.message || "Falha ao setar extras";
          if (!extrasRpcMissingWarned && /does not exist|42883/i.test(msg)) {
            extrasRpcMissingWarned = true;
            warnings.push({
              row: rowNum,
              warning:
                `RPC import_set_client_extras não existe ainda. Extras (Tabela Preco/M3U/Data do cadastro) não foram aplicados. ` +
                `Crie o RPC usando o SQL que te enviei.`,
            });
          } else if (!/does not exist|42883/i.test(msg)) {
            warnings.push({ row: rowNum, warning: `Extras não aplicados (import_set_client_extras): ${msg}` });
          }
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