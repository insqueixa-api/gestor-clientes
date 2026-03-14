import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// Normaliza MAC: aceita com/sem separadores, maiúsculas/minúsculas, ç→c
// Valida: exatamente 12 hex após limpeza
function normalizeMAC(raw: string): string | null {
  if (!raw) return null;

  // Substitui caracteres comuns de confusão
  let s = raw
    .trim()
    .toUpperCase()
    .replace(/Ç/g, "C")   // ç digitado errado
    .replace(/O/g, "0")   // O maiúsculo confundido com zero (opcional — comente se não quiser)
    .replace(/[^A-F0-9]/g, ""); // remove tudo que não for hex

  if (s.length !== 12) return null; // inválido

  // Formata como 00:1A:2B:3C:4D:5E
  return s.match(/.{2}/g)!.join(":");
}

// Mapeamento label fixo → tipo
const LABEL_TO_TYPE: Record<string, string> = {
  "Vencimento":      "date",
  "Device ID (MAC)": "mac",
  "Device Key":      "device_key",
  "E-mail":          "email",
  "Senha":           "password",
  "URL":             "url",
  "Obs":             "obs",
};

// Colunas fixas obrigatórias
const REQUIRED_HEADERS = ["cliente", "usuario", "servidor", "app"];

function normalizeHeader(h: string) {
  return (h || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normText(v: any): string {
  return (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// DD/MM/AAAA → YYYY-MM-DD (formato que o banco espera nos campos date)
function parseDateBR(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function resolveTenantIdForUser(
  supabase: any,
  userId: string,
  tenantFromQuery: string | null
) {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId);

  if (error) {
    return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };
  }

  const tenantIds = Array.from(
    new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))
  ) as string[];

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
      hint: "Você participa de múltiplos tenants. Informe tenant_id na querystring.",
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

  // --- Lê o arquivo ---
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "file_missing", hint: "Envie multipart/form-data com campo 'file'." },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  const dataRows = allRows.filter((r: any[]) => {
    const first = String(r[0] ?? "").trim();
    if (!first) return false;                         // linha vazia
    if (first.startsWith("⚠️")) return false;         // cabeçalho de instruções
    if (first.startsWith("•")) return false;          // bullet de instrução
    return true;
  });

  if (dataRows.length < 2) {
    return NextResponse.json({ error: "empty_file", hint: "O arquivo não contém linhas de dados." }, { status: 400 });
  }

  const headers = (dataRows[0] as any[]).map(String);
  const rows = dataRows.slice(1) as any[][];

  // Mapa header normalizado → índice da coluna
  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeader(h), idx));

  // Valida cabeçalhos obrigatórios
  const missing = REQUIRED_HEADERS.filter((h) => !colIndex.has(h));
  if (missing.length) {
    return NextResponse.json(
      { error: "invalid_headers", missing, hint: "Use o template oficial de aplicativos." },
      { status: 400 }
    );
  }

  // Helper para ler célula
  const getCell = (row: any[], key: string): string => {
    const idx = colIndex.get(normalizeHeader(key));
    if (idx === undefined) return "";
    const val = row[idx];
    if (val instanceof Date) {
      if (val.getFullYear() <= 1900) {
        // serial de hora pura — não esperado aqui
        return "";
      }
      const dd = String(val.getDate()).padStart(2, "0");
      const mm = String(val.getMonth() + 1).padStart(2, "0");
      const yyyy = String(val.getFullYear());
      return `${dd}/${mm}/${yyyy}`;
    }
    return (val ?? "").toString().trim();
  };

  // --- Pré-carrega servidores (nome → id) ---
  const { data: serversData, error: srvErr } = await supabase
    .from("servers")
    .select("id, name")
    .eq("tenant_id", tenant_id);

  if (srvErr) {
    return NextResponse.json({ error: "servers_lookup_failed", details: srvErr.message }, { status: 500 });
  }

  const serverIdByName = new Map<string, string>();
  for (const s of (serversData ?? []) as any[]) {
    serverIdByName.set(normText(s.name), String(s.id));
  }

 // --- Pré-carrega apps (nome → { id, fields_config }) ---
  // ✅ Usando a RPC segura para puxar os Apps Locais (Overrides) e os Globais do Admin que o usuário enxerga!
  const { data: appsData, error: appsErr } = await supabase
    .rpc("get_my_visible_apps");

  if (appsErr) {
    return NextResponse.json({ error: "apps_lookup_failed", details: appsErr.message }, { status: 500 });
  }

  type AppEntry = { id: string; fields_config: { id: string; type: string }[] };
  const appByName = new Map<string, AppEntry>();
  for (const a of (appsData ?? []) as any[]) {
    appByName.set(normText(a.name), {
      id: String(a.id),
      fields_config: Array.isArray(a.fields_config) ? a.fields_config : [],
    });
  }

  // --- Pré-carrega clientes (server_id + server_username → client_id) ---
  const { data: clientsData, error: cliErr } = await supabase
    .from("clients")
    .select("id, server_id, server_username")
    .eq("tenant_id", tenant_id);

  if (cliErr) {
    return NextResponse.json({ error: "clients_lookup_failed", details: cliErr.message }, { status: 500 });
  }

  // chave: `${server_id}::${server_username_normalizado}`
  const clientIdByKey = new Map<string, string>();
  for (const c of (clientsData ?? []) as any[]) {
    const key = `${c.server_id}::${normText(c.server_username)}`;
    clientIdByKey.set(key, String(c.id));
  }

  // --- Processa linhas ---
  let inserted = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];
  const warnings: Array<{ row: number; warning: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // linha 1 = header, linha 2 = primeiro dado

    try {
      const usuario    = getCell(row, "Usuario");
      const servidorNm = getCell(row, "Servidor");
      const appNome    = getCell(row, "App");

      if (!usuario.trim())    throw new Error("Coluna 'Usuario' está vazia.");
      if (!servidorNm.trim()) throw new Error("Coluna 'Servidor' está vazia.");
      if (!appNome.trim())    throw new Error("Coluna 'App' está vazia.");

      // Resolve servidor
      const server_id = serverIdByName.get(normText(servidorNm));
      if (!server_id) throw new Error(`Servidor não encontrado: "${servidorNm}".`);

      // Resolve cliente
      const clientKey = `${server_id}::${normText(usuario)}`;
      const client_id = clientIdByKey.get(clientKey);
      if (!client_id) {
        throw new Error(`Cliente não encontrado (Usuario="${usuario}", Servidor="${servidorNm}"). Importe o cliente primeiro.`);
      }

      // Resolve app
      const app = appByName.get(normText(appNome));
      if (!app) throw new Error(`App não encontrado no catálogo: "${appNome}".`);

      // Reconstrói field_values: { [fieldId]: valor }
      // Ignora _config_cost e _config_partner — não fazem mais parte do modelo
      const field_values: Record<string, string> = {};

      for (const field of app.fields_config) {
        // Acha o label fixo correspondente ao tipo
        const label = Object.entries(LABEL_TO_TYPE).find(([, t]) => t === field.type)?.[0];
        if (!label) continue; // tipo desconhecido — ignora

        const rawValue = getCell(row, label);
        if (!rawValue) continue; // campo vazio — não grava

        // Converte data para YYYY-MM-DD
        if (field.type === "date") {
          const iso = parseDateBR(rawValue);
          if (!iso) {
            warnings.push({ row: rowNum, warning: `Data inválida no campo "${label}": "${rawValue}". Use DD/MM/AAAA. Campo ignorado.` });
            continue;
          }
          field_values[field.id] = iso;
        } else if (field.type === "mac") {
          const mac = normalizeMAC(rawValue);
          if (!mac) {
            warnings.push({ row: rowNum, warning: `MAC inválido no campo "${label}": "${rawValue}". Precisa ter 12 caracteres hexadecimais. Campo ignorado.` });
            continue;
          }
          field_values[field.id] = mac;
        } else {
          field_values[field.id] = rawValue;
        }
      }

      // Insere novo client_app (sempre insert — nunca sobrescreve)
      const { error: insErr } = await supabase
        .from("client_apps")
        .insert({
          tenant_id,
          client_id,
          app_id: app.id,
          field_values,
        });

      if (insErr) throw new Error(`Erro ao inserir client_app: ${insErr.message}`);

      inserted++;
    } catch (e: any) {
      rowErrors.push({ row: rowNum, error: e?.message || "Falha ao importar linha." });
    }
  }

  return NextResponse.json({
    ok: rowErrors.length === 0,
    total: rows.length,
    inserted,
    errors: rowErrors,
    warnings,
  });
}