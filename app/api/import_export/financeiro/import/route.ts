import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// ============================================================================
// NORMALIZAÇÃO
// ============================================================================

function normText(v: any): string {
  return (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeHeader(h: string) {
  return (h || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

// Aceita qualquer formato de data legível:
// DD/MM/YYYY, YYYY-MM-DD, "20 jan 26", "20 jan 2026", "20 janeiro 2026", etc.
function parseDate(raw: any): string | null {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;

  // Célula do Excel já veio como objeto Date (XLSX cellDates)
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m1) {
    const d = m1[1].padStart(2, "0");
    const m = m1[2].padStart(2, "0");
    const y = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
    return `${y}-${m}-${d}`;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Mapeamento de nomes de meses (pt-BR e en-US)
  const meses: Record<string, string> = {
    jan: "01", fev: "02", feb: "02", mar: "03", abr: "04", apr: "04",
    mai: "05", may: "05", jun: "06", jul: "07", ago: "08", aug: "08",
    set: "09", sep: "09", out: "10", oct: "10", nov: "11", dez: "12", dec: "12",
    janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05",
    junho: "06", julho: "07", agosto: "08", setembro: "09", outubro: "10",
    novembro: "11", dezembro: "12",
  };

  const normalized = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // "20 jan 26" ou "20 jan 2026"
  const textMatch1 = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{2,4})$/);
  if (textMatch1) {
    const [, day, monthKey, year] = textMatch1;
    const monthNum = meses[monthKey];
    if (monthNum) {
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${monthNum}-${day.padStart(2, "0")}`;
    }
  }

  // "jan 20 2026" ou "jan 20, 2026"
  const textMatch2 = normalized.match(/^([a-z]+)\s+(\d{1,2})[,\s]+(\d{2,4})$/);
  if (textMatch2) {
    const [, monthKey, day, year] = textMatch2;
    const monthNum = meses[monthKey];
    if (monthNum) {
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${monthNum}-${day.padStart(2, "0")}`;
    }
  }

  // Último recurso: tenta pelo JS nativo
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

// Aceita: R$ 1.500,00 / 1500,00 / 1500.00 / 1.500 / R$40 / 40,50
function parseValor(raw: any): number | null {
  let s = (raw ?? "").toString().trim();
  if (!s) return null;

  // Remove símbolo de moeda e espaços
  s = s.replace(/R\$\s*/gi, "").replace(/\s+/g, "").trim();
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // pt-BR: 1.500,00 → remove pontos de milhar → troca vírgula decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    // 1500,00 → 1500.00
    s = s.replace(",", ".");
  }
  // Apenas ponto: pode ser decimal (1500.00) ou milhar (1.500) — tenta direto

  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Tipo: aceita qualquer case/acento
function normalizeTipo(raw: string): "RECEITA" | "DESPESA" | null {
  const s = normText(raw);
  if (s.includes("receita") || s === "r" || s === "rec" || s === "entrada") return "RECEITA";
  if (s.includes("despesa") || s.includes("gasto") || s.includes("saida") || s === "d" || s === "des") return "DESPESA";
  return null;
}

// Status: aceita qualquer variação
function normalizeStatus(raw: string): "PAGO" | "PENDENTE" | null {
  const s = normText(raw);
  if (["pago", "paga", "recebido", "recebida", "pago/recebido", "sim", "1", "true", "ok", "concluido", "feito"].includes(s)) return "PAGO";
  if (["pendente", "aberto", "aguardando", "nao", "nao pago", "0", "false", "emaberto"].includes(s)) return "PENDENTE";
  return null;
}

// Frequência: tolerante
function normalizeFrequencia(raw: string): string | null {
  const s = normText(raw);
  if (["mensal", "mes", "monthly", "m", "1mes", "1x/mes"].includes(s)) return "MENSAL";
  if (["bimestral", "bim", "2meses", "2mes"].includes(s)) return "BIMESTRAL";
  if (["trimestral", "tri", "trimestre", "3meses"].includes(s)) return "TRIMESTRAL";
  if (["semestral", "sem", "semestre", "6meses"].includes(s)) return "SEMESTRAL";
  if (["anual", "ano", "annual", "a", "anualmente", "12meses"].includes(s)) return "ANUAL";
  return null;
}

// Recorrência: tolerante
function normalizeRecorrencia(raw: string): "UNICA" | "RECORRENTE" | "PARCELADA" {
  const s = normText(raw);
  if (s.includes("recorr") || s === "r" || s === "fixo" || s === "continuo") return "RECORRENTE";
  if (s.includes("parcel") || s === "p" || s === "parcelado") return "PARCELADA";
  return "UNICA";
}

// ============================================================================
// TENANT RESOLVER
// ============================================================================

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", userId);
  if (error) return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };

  const tenantIds: string[] = Array.from(
    new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))
  );

  if (tenantIds.length === 0) return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Sem tenant vinculado." };
  if (tenantIds.length === 1) {
    const only = tenantIds[0];
    if (tenantFromQuery && tenantFromQuery !== only) return { tenant_id: null, status: 403, error: "forbidden_tenant" };
    return { tenant_id: only, status: 200 };
  }
  if (!tenantFromQuery) return { tenant_id: null, status: 400, error: "tenant_required", hint: "Informe tenant_id na querystring." };
  if (!tenantIds.includes(tenantFromQuery)) return { tenant_id: null, status: 403, error: "forbidden_tenant" };
  return { tenant_id: tenantFromQuery, status: 200 };
}

// ============================================================================
// ROUTE
// ============================================================================

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

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_missing", hint: "Envie multipart/form-data com campo 'file'." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  const dataRows = allRows.filter((r: any[]) => r.join("").trim() !== "");

  const headers = (dataRows[0] || []).map(String);
  const rows = dataRows.slice(1);

  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeader(h), idx));

  const requiredHeaders = ["tipo", "descricao", "valor", "data vencimento", "status", "conta", "categoria"];
  const missing = requiredHeaders.filter((h) => !colIndex.has(normalizeHeader(h)));
  if (missing.length) {
    return NextResponse.json(
      { error: "invalid_headers", missing, hint: "Colunas obrigatórias: Tipo, Descrição, Valor, Data Vencimento, Status, Conta, Categoria." },
      { status: 400 }
    );
  }

  // Pré-carregar contas e categorias
  const { data: contasDB } = await supabase.from("fin_contas_bancarias").select("id, nome").eq("tenant_id", tenant_id);
  const { data: categoriasDB } = await supabase.from("fin_categorias").select("id, nome, tipo").eq("tenant_id", tenant_id);

  // Maps mutáveis — crescem quando criamos novos itens on-the-fly
  const contaByNome = new Map<string, string>();
  for (const c of (contasDB ?? []) as any[]) contaByNome.set(normText(c.nome), String(c.id));

  const categoriaByNome = new Map<string, string>();
  for (const c of (categoriasDB ?? []) as any[]) categoriaByNome.set(normText(c.nome), String(c.id));

  async function resolveOrCreateConta(nome: string): Promise<string> {
    const key = normText(nome);
    if (contaByNome.has(key)) return contaByNome.get(key)!;
    const { data, error } = await supabase
      .from("fin_contas_bancarias")
      .insert({ tenant_id, nome: nome.trim(), icone: "🏦" })
      .select("id")
      .single();
    if (error) throw new Error(`Falha ao criar conta "${nome}": ${error.message}`);
    const id = String(data.id);
    contaByNome.set(key, id);
    return id;
  }

  async function resolveOrCreateCategoria(nome: string, tipo: "RECEITA" | "DESPESA"): Promise<string> {
    const key = normText(nome);
    if (categoriaByNome.has(key)) return categoriaByNome.get(key)!;
    const { data, error } = await supabase
      .from("fin_categorias")
      .insert({ tenant_id, nome: nome.trim(), icone: "📦", tipo })
      .select("id")
      .single();
    if (error) throw new Error(`Falha ao criar categoria "${nome}": ${error.message}`);
    const id = String(data.id);
    categoriaByNome.set(key, id);
    return id;
  }

  let inserted = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];
  const warnings: Array<{ row: number; warning: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as any[];
    const rowNum = i + 2;

    try {
      const getRaw = (key: string): any => {
        const idx = colIndex.get(normalizeHeader(key));
        return idx !== undefined ? r[idx] : "";
      };

      const get = (key: string): string => {
        const val = getRaw(key);
        if (val instanceof Date) {
          const dd = String(val.getDate()).padStart(2, "0");
          const mm = String(val.getMonth() + 1).padStart(2, "0");
          const yyyy = String(val.getFullYear());
          if (val.getFullYear() <= 1900) {
            return `${String(val.getHours()).padStart(2,"0")}:${String(val.getMinutes()).padStart(2,"0")}`;
          }
          return `${dd}/${mm}/${yyyy}`;
        }
        if (typeof val === "number") return val.toLocaleString("fullwide", { useGrouping: false });
        let s = (val ?? "").toString().trim();
        if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(s)) {
          const n = Number(s.replace(",", "."));
          if (!isNaN(n)) return n.toLocaleString("fullwide", { useGrouping: false });
        }
        return s;
      };

      // TIPO
      const tipoRaw = get("Tipo");
      const tipo = normalizeTipo(tipoRaw);
      if (!tipo) throw new Error(`Tipo inválido: "${tipoRaw}". Use RECEITA ou DESPESA.`);

      // DESCRIÇÃO
      const descricao = get("Descrição") || get("Descricao");
      if (!descricao.trim()) throw new Error("Descrição vazia.");

      // VALOR — passa o valor raw (pode ser número nativo do Excel)
      const valorRawVal = getRaw("Valor");
      const valor = parseValor(valorRawVal);
      if (valor === null || valor <= 0) throw new Error(`Valor inválido: "${valorRawVal}". Ex: 1500,00 ou R$ 1.500,00`);

      // DATA VENCIMENTO — passa o raw para aproveitar Date do XLSX
      const vencRawVal = getRaw("Data Vencimento") ?? getRaw("Data Vencimento");
      const data_vencimento = parseDate(vencRawVal) ?? parseDate(get("Data Vencimento"));
      if (!data_vencimento) throw new Error(`Data Vencimento inválida: "${get("Data Vencimento")}". Ex: 30/04/2026 ou 30 abr 2026`);

      // STATUS
      const statusRaw = get("Status");
      const status = normalizeStatus(statusRaw);
      if (!status) throw new Error(`Status inválido: "${statusRaw}". Use PAGO ou PENDENTE.`);

      // DATA PAGAMENTO
      const pagRawVal = getRaw("Data Pagamento");
      let data_pagamento: string | null = parseDate(pagRawVal) ?? parseDate(get("Data Pagamento"));

      if (status === "PAGO" && !data_pagamento) {
        data_pagamento = data_vencimento;
        warnings.push({ row: rowNum, warning: `Data Pagamento vazia com Status PAGO. Usando Data Vencimento como fallback.` });
      }
      if (status === "PENDENTE") data_pagamento = null;

      // CONTA — cria se não existir
      const contaNome = get("Conta");
      if (!contaNome.trim()) throw new Error("Conta vazia.");
      const conta_id = await resolveOrCreateConta(contaNome.trim());

      // CATEGORIA — cria se não existir
      const categoriaNome = get("Categoria");
      if (!categoriaNome.trim()) throw new Error("Categoria vazia.");
      const categoria_id = await resolveOrCreateCategoria(categoriaNome.trim(), tipo);

      // RECORRÊNCIA
      const tipoRec = normalizeRecorrencia(get("Recorrencia") || get("Recorrência") || "");
      const isRecorrente = tipoRec === "RECORRENTE";
      const isParcelada = tipoRec === "PARCELADA";

      // FREQUÊNCIA
      const frequencia = normalizeFrequencia(get("Frequencia") || get("Frequência") || "");
      if ((isRecorrente || isParcelada) && !frequencia) {
        warnings.push({ row: rowNum, warning: `Frequência não reconhecida. Usando MENSAL como padrão.` });
      }

      // PARCELAS
      const parcelasStr = get("Parcelas").replace(/\D/g, "");
      const parcelas = parcelasStr ? parseInt(parcelasStr, 10) : null;
      if (isParcelada && (!parcelas || parcelas < 2)) {
        throw new Error(`Parcelas inválidas: "${get("Parcelas")}". Informe um número >= 2 para parcelado.`);
      }

      // OBSERVAÇÕES
      const observacoes = get("Observacoes") || get("Observações") || "";

      const baseInsert: any = {
        tenant_id,
        tipo,
        descricao,
        valor,
        data_vencimento,
        status,
        data_pagamento: data_pagamento ? new Date(`${data_pagamento}T12:00:00`).toISOString() : null,
        conta_id,
        categoria_id,
        is_recorrente: isRecorrente || isParcelada,
        frequencia: (isRecorrente || isParcelada) ? (frequencia ?? "MENSAL") : null,
        observacoes: observacoes || null,
        parcela_atual: isParcelada ? 1 : null,
        parcela_total: isParcelada ? parcelas : null,
      };

      if (!isRecorrente && !isParcelada) {
        const { error: insErr } = await supabase.from("fin_transacoes").insert(baseInsert);
        if (insErr) throw new Error(`Erro ao inserir: ${insErr.message}`);
        inserted++;
      } else {
        const { data: firstTrx, error: firstErr } = await supabase
          .from("fin_transacoes").insert(baseInsert).select("id").single();
        if (firstErr) throw new Error(`Erro ao inserir parcela 1: ${firstErr.message}`);

        const recorrencia_id = firstTrx.id;
        await supabase.from("fin_transacoes").update({ recorrencia_id }).eq("id", recorrencia_id);

        const totalOcorrencias = isParcelada ? parcelas! : 60;
        const baseDate = new Date(`${data_vencimento}T12:00:00`);
        const baseDia = baseDate.getDate();
        const freq = frequencia ?? "MENSAL";
        const multiplos: Record<string, number> = { MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
        const multiplo = multiplos[freq] ?? 1;

        function addMeses(base: Date, dia: number, meses: number): Date {
          const tY = base.getFullYear() + Math.floor((base.getMonth() + meses) / 12);
          const tM = (base.getMonth() + meses) % 12;
          const ultimo = new Date(tY, tM + 1, 0).getDate();
          return new Date(tY, tM, Math.min(dia, ultimo), 12, 0, 0);
        }

        const inserts = [];
        for (let j = 1; j < totalOcorrencias; j++) {
          const dataVenc = addMeses(baseDate, baseDia, j * multiplo);
          inserts.push({
            ...baseInsert,
            data_vencimento: dataVenc.toISOString().split("T")[0],
            status: "PENDENTE",
            data_pagamento: null,
            recorrencia_id,
            parcela_atual: isParcelada ? j + 1 : null,
          });
        }

        const BATCH = 100;
        for (let b = 0; b < inserts.length; b += BATCH) {
          const { error: bErr } = await supabase.from("fin_transacoes").insert(inserts.slice(b, b + BATCH));
          if (bErr) throw new Error(`Erro ao inserir lotes futuros: ${bErr.message}`);
        }

        inserted++;
      }
    } catch (e: any) {
      rowErrors.push({ row: rowNum, error: e?.message || "Falha ao importar linha" });
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
