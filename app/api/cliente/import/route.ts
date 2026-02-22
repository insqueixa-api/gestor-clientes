import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

// ✅ NOVOS
  valor_plano_raw: string;     // "Valor Plano" (opcional: se vazio, calcula)
  tabela_preco_label: string;  // "Tabela Preco" (opcional: se vazio, usa default por moeda)
  m3u_url: string;             // "M3U URL" (opcional)
  external_user_id: string;    // "ID Externo" (opcional) // ✅ NOVO
  cadastro_dia: string;        // "Data do cadastro" (opcional)
  cadastro_hora: string;       // "Cadastro hora" (opcional)
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

  // SP (UTC-3) — mantém padrão do seu sistema
  const isoLike = `${yyyy}-${mm}-${dd}T${HH}:${MIN}:00-03:00`;
  const dt = new Date(isoLike);
  if (Number.isNaN(dt.getTime())) return null;

  return dt.toISOString();
}

// Para cadastro: exige dia válido se preenchido; hora pode ser vazia (assume 00:00)
function combineCadastro(diaBR: string, hora: string): string | null {
  const d = (diaBR || "").trim();
  const h = (hora || "").trim();

  if (!d) return null; // não altera created_at

  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;

  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];

  let HH = "00";
  let MIN = "00";
  if (h) {
    const hm = h.match(/^(\d{1,2}):(\d{2})$/);
    if (!hm) return null;
    HH = String(hm[1]).padStart(2, "0");
    MIN = hm[2];
  }

  const isoLike = `${yyyy}-${mm}-${dd}T${HH}:${MIN}:00-03:00`;
  const dt = new Date(isoLike);
  if (Number.isNaN(dt.getTime())) return null;

  return dt.toISOString();
}

function normText(v: any): string {
  return (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

  // tolerância
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

function parseCurrency(raw: string): "BRL" | "USD" | "EUR" {
  const s = (raw || "").trim().toUpperCase();
  if (s === "BRL" || s === "USD" || s === "EUR") return s;
  throw new Error(`Currency inválida: "${raw}". Use BRL, USD ou EUR.`);
}

// aceita 40.00 / 40,00 / R$ 40,00 / 40
function parsePriceAmount(raw: string): number | null {
  const s0 = (raw || "").trim();
  if (!s0) return null;

  // remove moeda e espaços
  const s1 = s0.replace(/[^\d.,-]/g, "").trim();
  if (!s1) return null;

  // se tiver vírgula e ponto, assume ponto milhar e vírgula decimal (pt-BR)
  // ex: 1.234,56 => 1234.56
  let normalized = s1;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    normalized = normalized.replace(",", ".");
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
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

// Se já tem +, mantém; se não, assume BR (+55)
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

  // ✅ created_by sempre vem do user autenticado
  const created_by = user.id;

  // ✅ tenant seguro (mesma regra do export)
  const url = new URL(req.url);
  const tenantFromQuery = url.searchParams.get("tenant_id");

  const resolved = await resolveTenantIdForUser(supabase, user.id, tenantFromQuery);
  if (!resolved.tenant_id) {
    return NextResponse.json(
      { error: resolved.error, hint: (resolved as any).hint, details: (resolved as any).details },
      { status: resolved.status || 400 }
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

  // ✅ Cabeçalhos obrigatórios do TEMPLATE ATUAL
  const requiredHeaders = [
    "saudacao",
    "nome completo",
    "telefone principal",
    "whatsapp username",
    "aceita mensagem",
    "servidor",
    "usuario",
    "senha",
    "tecnologia",
    // currency pode ser "Currency" ou "Moeda"
    "plano",
    "telas",
    "vencimento dia",
    "vencimento hora",
    "aplicativos nome",
    "obs",
// novos (sempre no final no seu template)
    "valor plano",
    "tabela preco",
    "m3u url",
    "id externo", // ✅ NOVO (Lembre-se do normalize: letras minúsculas sem acento)
    "data do cadastro",
    "cadastro hora",
  ];

  const missingBase = requiredHeaders.filter((h) => !colIndex.has(normalizeHeader(h)));

  const hasCurrency = colIndex.has(normalizeHeader("currency"));
  const hasMoeda = colIndex.has(normalizeHeader("moeda"));
  const missingCurrency = !hasCurrency && !hasMoeda;

  const missing = [
    ...missingBase.filter((h) => h !== "currency"), // (só pra não duplicar)
    ...(missingCurrency ? ["currency|moeda"] : []),
  ];

  if (missing.length) {
    return NextResponse.json(
      {
        error: "invalid_headers",
        missing,
        hint: "Use o template oficial (mesma ordem/nomes). Precisa conter também 'Currency' (ou 'Moeda').",
      },
      { status: 400 }
    );
  }

  // 1) Pré-carregar servidores (resolver por nome)
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
  const duplicateServers = new Set<string>();

  for (const s of (servers ?? []) as any[]) {
    const nameKey = normText(s.name);
    if (!nameKey) continue;
    if (byServerName.has(nameKey)) duplicateServers.add(nameKey);
    byServerName.set(nameKey, String(s.id));
  }

  // 2) Pré-carregar plan_tables (resolver por label + defaults por currency)
  const { data: planTables, error: ptErr } = await supabase
    .from("plan_tables")
    .select("id,name,currency,is_system_default")
    .eq("tenant_id", tenant_id);

  if (ptErr) {
    return NextResponse.json(
      { error: "plan_tables_lookup_failed", details: ptErr.message, hint: "Confirme se a tabela é 'plan_tables'." },
      { status: 500 }
    );
  }

  const planTableByLabel = new Map<string, { id: string; currency: string; name: string }>();
  const duplicatePlanTableLabels = new Set<string>();
  const defaultPlanTableIdByCurrency = new Map<"BRL" | "USD" | "EUR", string>();

  for (const pt of (planTables ?? []) as any[]) {
    const id = String(pt.id);
    const name = String(pt.name ?? "").trim();
    const labelKey = normText(name);
    const cur = String(pt.currency ?? "").toUpperCase();
    const isDefault = !!pt.is_system_default;

    if (labelKey) {
      if (planTableByLabel.has(labelKey)) duplicatePlanTableLabels.add(labelKey);
      planTableByLabel.set(labelKey, { id, currency: cur, name });
    }

    if (isDefault && (cur === "BRL" || cur === "USD" || cur === "EUR")) {
      // se tiver mais de 1 default por moeda, vai dar erro por linha depois; mas já marca aqui
      if (!defaultPlanTableIdByCurrency.has(cur as any)) {
        defaultPlanTableIdByCurrency.set(cur as any, id);
      } else {
        // múltiplos defaults: isso é problema de configuração
        // vamos responder 500 (consistência)
        return NextResponse.json(
          {
            error: "multiple_default_plan_tables",
            currency: cur,
            hint: "Você tem mais de uma plan_table com is_system_default=true para a mesma moeda. Deixe apenas 1 default por moeda.",
          },
          { status: 500 }
        );
      }
    }
  }

  // 3) Pré-carregar apps catalog
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
    const nameKey = normText(a.name);
    if (!nameKey) continue;
    appIdByName.set(nameKey, String(a.id));
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
        saudacao: get("Saudacao") || get("Saudação"),
        nome_completo: get("Nome Completo"),
        telefone_principal: get("Telefone principal"),
        whatsapp_username: get("Whatsapp Username"),
        aceita_mensagem: parseBool(get("Aceita mensagem")),

        servidor_nome: get("Servidor"),
        usuario: get("Usuario") || get("Usuário"),
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

// ✅ novos
        valor_plano_raw: get("Valor Plano"),
        tabela_preco_label: get("Tabela Preco"),
        m3u_url: get("M3U URL"),
        external_user_id: get("ID Externo") || get("ID_Externo") || get("External ID"), // ✅ NOVO
        cadastro_dia: get("Data do cadastro"),
        cadastro_hora: get("Cadastro hora"),
      };

      if (!parsed.servidor_nome?.trim()) throw new Error("Servidor vazio (coluna 'Servidor').");
      if (!parsed.usuario?.trim()) throw new Error("Usuário vazio (coluna 'Usuario').");
      if (!parsed.plano?.trim()) throw new Error("Plano vazio (coluna 'Plano').");

      // resolve server
      const serverKey = normText(parsed.servidor_nome);
      if (duplicateServers.has(serverKey)) {
        throw new Error(`Servidor duplicado no tenant: "${parsed.servidor_nome}". Renomeie para ficar único.`);
      }
      const server_id = byServerName.get(serverKey);
      if (!server_id) throw new Error(`Servidor não encontrado no tenant: "${parsed.servidor_nome}".`);

      const screens = parsed.telas && parsed.telas > 0 ? parsed.telas : 1;

      // resolve plan_table_id
      let plan_table_id: string | null = null;
      const labelRaw = (parsed.tabela_preco_label || "").trim();

      if (labelRaw) {
        const labelKey = normText(labelRaw);
        if (duplicatePlanTableLabels.has(labelKey)) {
          throw new Error(`Tabela Preco ambígua (nome duplicado no tenant): "${labelRaw}". Deixe os nomes únicos.`);
        }
        const pt = planTableByLabel.get(labelKey);
        if (!pt) {
          throw new Error(`Tabela Preco não encontrada no tenant: "${labelRaw}".`);
        }
        if ((pt.currency || "").toUpperCase() !== parsed.currency) {
          throw new Error(
            `Tabela Preco "${pt.name}" é da moeda ${pt.currency}, mas a linha está com Currency=${parsed.currency}.`
          );
        }
        plan_table_id = pt.id;
      } else {
        // vazio: usa default por moeda
        plan_table_id = defaultPlanTableIdByCurrency.get(parsed.currency) ?? null;
        if (!plan_table_id) {
          throw new Error(`Não existe plan_table default (is_system_default=true) para ${parsed.currency}.`);
        }
      }

      // vencimento
      const vencimentoISO = combineDiaHoraBR(parsed.vencimento_dia, parsed.vencimento_hora);
      // vencimento pode ser vazio (não altera), então não trava aqui

      // cadastro (created_at) — só altera se vier preenchido e válido
      const cadastroISO = combineCadastro(parsed.cadastro_dia, parsed.cadastro_hora);
      if (parsed.cadastro_dia?.trim() && !cadastroISO) {
        throw new Error(`Data do cadastro/Cadastro hora inválidos. Use DD/MM/AAAA e HH:MM.`);
      }

      // resolve preço
      const providedPrice = parsePriceAmount(parsed.valor_plano_raw);
      let price_amount: number | null = providedPrice;

      if (price_amount === null) {
        const defaultPriceAmount = await resolveDefaultPriceAmount(supabase, {
          tenant_id,
          plan_table_id,
          plan_label: parsed.plano || null,
          screens,
        });

        if (defaultPriceAmount === null) {
          throw new Error(
            `Preço padrão não encontrado na plan_table (${parsed.currency}) para Plano="${parsed.plano}" e Telas=${screens}.`
          );
        }
        price_amount = defaultPriceAmount;
      }

      // nome
      const nameParts = splitNomeCompleto(parsed.nome_completo);
      if (!nameParts.display_name) throw new Error("Nome Completo vazio.");

      // apps
      const appNames = (parsed.aplicativos_nome || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      const appIds: string[] = [];
      const missingApps: string[] = [];

      for (const nm of Array.from(new Set(appNames))) {
        const id = appIdByName.get(normText(nm));
        if (id) appIds.push(id);
        else missingApps.push(nm);
      }

      if (missingApps.length) {
        warnings.push({
          row: rowNum,
          warning: `Apps não encontrados no catálogo: ${missingApps.join(", ")} (não foram vinculados).`,
        });
      }

      // lookup existente (best effort)
      const { data: existing, error: exErr } = await supabase
        .from("clients")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("server_id", server_id)
        .eq("server_username", parsed.usuario)
        .maybeSingle();

      if (exErr && exErr.code !== "PGRST116") {
        throw new Error(
          `Falha ao consultar cliente existente: ${exErr.message}. Se RLS bloqueou SELECT, precisamos trocar por RPC de lookup.`
        );
      }

      let client_id: string | null = existing?.id ?? null;

      // telefone
      const phoneE164 = toE164Phone(parsed.telefone_principal);

      if (!client_id) {
        // ✅ CREATE via RPC
        const { data: created, error: crErr } = await supabase.rpc("create_client_and_setup", {
          p_tenant_id: tenant_id,
          p_created_by: created_by,

          p_display_name: nameParts.display_name,

          p_server_id: server_id,
          p_server_username: parsed.usuario,
          p_server_password: parsed.senha || null,

          p_screens: screens,
          p_plan_label: parsed.plano || null,

          // ✅ preço + moeda
          p_price_amount: price_amount,
          p_price_currency: parsed.currency,

          // ✅ NOVO: plan_table_id
          p_plan_table_id: plan_table_id,

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

        // fallback: reconsulta
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

          // ✅ preço + moeda
          p_price_amount: price_amount,
          p_price_currency: parsed.currency,

          // ✅ NOVO: plan_table_id
          p_plan_table_id: plan_table_id,

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

      // ✅ extras (m3u_url + created_at + saudacao no create)
      {
        const createdAtToSet = cadastroISO ? new Date(cadastroISO).toISOString() : null;

        const { error: ex2Err } = await supabase.rpc("import_set_client_extras", {
          p_tenant_id: tenant_id,
          p_client_id: client_id,
          p_name_prefix: (parsed.saudacao || "").trim() || null,
          p_m3u_url: (parsed.m3u_url || "").trim() || null,
          p_created_at: createdAtToSet,
        });

        if (ex2Err) {
          // não quebra import inteiro: vira warning
          warnings.push({ row: rowNum, warning: `Extras não aplicados (import_set_client_extras): ${ex2Err.message}` });
        }
        
        // ✅ ATUALIZAR EXTERNAL_USER_ID SE EXISTIR
        if (parsed.external_user_id?.trim()) {
           const { error: extErr } = await supabase
             .from("clients")
             .update({ external_user_id: parsed.external_user_id.trim() })
             .eq("id", client_id)
             .eq("tenant_id", tenant_id);
             
           if (extErr) {
             warnings.push({ row: rowNum, warning: `ID Externo não aplicado: ${extErr.message}` });
           }
        }
      }

      // ✅ Apps via RPC (sincroniza lista inteira)
      {
        const { error: appErr } = await supabase.rpc("set_client_apps", {
          p_tenant_id: tenant_id,
          p_client_id: client_id,
          p_app_ids: appIds,
        });
        if (appErr) throw new Error(`set_client_apps: ${appErr.message}`);
      }

      // ✅ Telefones via RPC
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