import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

type ParsedRow = {
  tipo: "RECEITA" | "DESPESA";
  descricao: string;
  valor: number;
  data_vencimento: string; // YYYY-MM-DD
  status: "PAGO" | "PENDENTE";
  data_pagamento: string | null; // YYYY-MM-DD ou null
  conta_nome: string;
  categoria_nome: string;
  recorrencia: string; // Única | Recorrente | Parcelada
  frequencia: string;
  parcelas: number | null;
  observacoes: string;
};

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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// Aceita DD/MM/YYYY ou YYYY-MM-DD
function parseDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;

  // DD/MM/YYYY
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;

  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return s;

  return null;
}

// Aceita 1500.00 / 1500,00 / R$ 1.500,00
function parseValor(raw: string): number | null {
  const s = (raw ?? "").toString().trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized = s;
  if (hasComma && hasDot) normalized = s.replace(/\./g, "").replace(",", ".");
  else if (hasComma && !hasDot) normalized = s.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId);

  if (error) return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };

  const tenantIds: string[] = Array.from(
    new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))
  );

  if (tenantIds.length === 0) return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Seu usuário não está vinculado a um tenant." };

  if (tenantIds.length === 1) {
    const only = tenantIds[0];
    if (tenantFromQuery && tenantFromQuery !== only) return { tenant_id: null, status: 403, error: "forbidden_tenant" };
    return { tenant_id: only, status: 200 };
  }

  if (!tenantFromQuery) return { tenant_id: null, status: 400, error: "tenant_required", hint: "Informe tenant_id na querystring." };
  if (!tenantIds.includes(tenantFromQuery)) return { tenant_id: null, status: 403, error: "forbidden_tenant" };

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

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_missing", hint: "Envie multipart/form-data com campo 'file'." }, { status: 400 });
  }

  // Leitura do Excel
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

  const requiredHeaders = [
    "tipo",
    "descricao",
    "valor",
    "data vencimento",
    "status",
    "conta",
    "categoria",
  ];

  const missing = requiredHeaders.filter((h) => !colIndex.has(normalizeHeader(h)));
  if (missing.length) {
    return NextResponse.json(
      { error: "invalid_headers", missing, hint: "Use o template oficial. Colunas obrigatórias: Tipo, Descrição, Valor, Data Vencimento, Status, Conta, Categoria." },
      { status: 400 }
    );
  }

  // Pré-carregar contas do tenant
  const { data: contas, error: cErr } = await supabase
    .from("fin_contas_bancarias")
    .select("id, nome")
    .eq("tenant_id", tenant_id);

  if (cErr) return NextResponse.json({ error: "contas_lookup_failed", details: cErr.message }, { status: 500 });

  const contaByNome = new Map<string, string>();
  for (const c of (contas ?? []) as any[]) {
    contaByNome.set(normText(c.nome), String(c.id));
  }

  // Pré-carregar categorias do tenant
  const { data: categorias, error: catErr } = await supabase
    .from("fin_categorias")
    .select("id, nome, tipo")
    .eq("tenant_id", tenant_id);

  if (catErr) return NextResponse.json({ error: "categorias_lookup_failed", details: catErr.message }, { status: 500 });

  const categoriaByNome = new Map<string, string>();
  for (const c of (categorias ?? []) as any[]) {
    categoriaByNome.set(normText(c.nome), String(c.id));
  }

  let inserted = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];
  const warnings: Array<{ row: number; warning: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as any[];
    const rowNum = i + 2;

    try {
      const get = (key: string): string => {
        const idx = colIndex.get(normalizeHeader(key));
        if (idx === undefined) return "";
        const val = r[idx];

        if (val instanceof Date) {
          const dd = String(val.getDate()).padStart(2, "0");
          const mm = String(val.getMonth() + 1).padStart(2, "0");
          const yyyy = String(val.getFullYear());
          if (val.getFullYear() <= 1900) {
            const hh = String(val.getHours()).padStart(2, "0");
            const min = String(val.getMinutes()).padStart(2, "0");
            return `${hh}:${min}`;
          }
          return `${dd}/${mm}/${yyyy}`;
        }

        if (typeof val === "number") return val.toLocaleString("fullwide", { useGrouping: false });

        let valStr = (val ?? "").toString().trim();
        if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(valStr)) {
          const parsedNum = Number(valStr.replace(",", "."));
          if (!Number.isNaN(parsedNum)) return parsedNum.toLocaleString("fullwide", { useGrouping: false });
        }

        return valStr;
      };

      // Tipo
      const tipoRaw = get("Tipo").toUpperCase().trim();
      if (tipoRaw !== "RECEITA" && tipoRaw !== "DESPESA") {
        throw new Error(`Tipo inválido: "${tipoRaw}". Use RECEITA ou DESPESA.`);
      }

      // Descrição
      const descricao = get("Descrição") || get("Descricao");
      if (!descricao.trim()) throw new Error("Descrição vazia.");

      // Valor
      const valorRaw = get("Valor");
      const valor = parseValor(valorRaw);
      if (valor === null || valor <= 0) throw new Error(`Valor inválido: "${valorRaw}".`);

      // Data Vencimento
      const vencRaw = get("Data Vencimento") || get("Data Vencimento");
      const data_vencimento = parseDate(vencRaw);
      if (!data_vencimento) throw new Error(`Data Vencimento inválida: "${vencRaw}". Use DD/MM/YYYY.`);

      // Status
      const statusRaw = get("Status").toUpperCase().trim();
      if (statusRaw !== "PAGO" && statusRaw !== "PENDENTE") {
        throw new Error(`Status inválido: "${statusRaw}". Use PAGO ou PENDENTE.`);
      }

      // Data Pagamento (obrigatória se PAGO)
      const pagRaw = get("Data Pagamento");
      let data_pagamento: string | null = parseDate(pagRaw);
      if (statusRaw === "PAGO" && !data_pagamento) {
        // fallback: usa a data de vencimento
        data_pagamento = data_vencimento;
        warnings.push({ row: rowNum, warning: `Data Pagamento vazia com Status=PAGO. Usando Data Vencimento como data de pagamento.` });
      }
      if (statusRaw === "PENDENTE") data_pagamento = null;

      // Conta
      const contaNome = get("Conta");
      const conta_id = contaByNome.get(normText(contaNome));
      if (!conta_id) throw new Error(`Conta não encontrada: "${contaNome}". Crie a conta antes de importar.`);

      // Categoria
      const categoriaNome = get("Categoria");
      const categoria_id = categoriaByNome.get(normText(categoriaNome));
      if (!categoria_id) throw new Error(`Categoria não encontrada: "${categoriaNome}". Crie a categoria antes de importar.`);

      // Recorrência
      const recorrenciaRaw = normText(get("Recorrencia") || get("Recorrência") || "unica");
      const isRecorrente = recorrenciaRaw === "recorrente";
      const isParcelada = recorrenciaRaw === "parcelada";

      // Frequência
      const frequenciaRaw = (get("Frequencia") || get("Frequência") || "").toUpperCase().trim();
      const frequencias_validas = ["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"];
      const frequencia = frequencias_validas.includes(frequenciaRaw) ? frequenciaRaw : null;
      if ((isRecorrente || isParcelada) && !frequencia) {
        warnings.push({ row: rowNum, warning: `Frequência inválida ou vazia para recorrente/parcelado. Usando MENSAL como padrão.` });
      }

      // Parcelas
      const parcelasRaw = get("Parcelas");
      const parcelas = parcelasRaw ? parseInt(parcelasRaw, 10) : null;
      if (isParcelada && (!parcelas || parcelas < 2)) {
        throw new Error(`Parcelas inválidas: "${parcelasRaw}". Informe um número >= 2 para lançamentos parcelados.`);
      }

      // Observações
      const observacoes = get("Observacoes") || get("Observações") || "";

      // Monta o registro base
      const baseInsert = {
        tenant_id,
        tipo: tipoRaw as "RECEITA" | "DESPESA",
        descricao,
        valor,
        data_vencimento,
        status: statusRaw as "PAGO" | "PENDENTE",
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
        // Lançamento único
        const { error: insErr } = await supabase.from("fin_transacoes").insert(baseInsert);
        if (insErr) throw new Error(`Erro ao inserir: ${insErr.message}`);
        inserted++;
      } else {
        // Recorrente ou Parcelado — insere a primeira e depois as futuras
        const { data: firstTrx, error: firstErr } = await supabase
          .from("fin_transacoes")
          .insert(baseInsert)
          .select("id")
          .single();

        if (firstErr) throw new Error(`Erro ao inserir parcela 1: ${firstErr.message}`);
        const recorrencia_id = firstTrx.id;

        // Vincula recorrencia_id na própria linha
        await supabase.from("fin_transacoes").update({ recorrencia_id }).eq("id", recorrencia_id);

        const totalOcorrencias = isParcelada ? parcelas! : 60; // 60 meses = 5 anos

        const baseDate = new Date(`${data_vencimento}T12:00:00`);
        const baseDia = baseDate.getDate();

        function addMeses(base: Date, dia: number, meses: number): Date {
          const tY = base.getFullYear() + Math.floor((base.getMonth() + meses) / 12);
          const tM = (base.getMonth() + meses) % 12;
          const ultimo = new Date(tY, tM + 1, 0).getDate();
          return new Date(tY, tM, Math.min(dia, ultimo), 12, 0, 0);
        }

        const freq = (frequencia ?? "MENSAL");
        const multiplos: Record<string, number> = {
          MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12,
        };
        const multiplo = multiplos[freq] ?? 1;

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

        if (inserts.length > 0) {
          const BATCH = 100;
          for (let b = 0; b < inserts.length; b += BATCH) {
            const { error: bErr } = await supabase.from("fin_transacoes").insert(inserts.slice(b, b + BATCH));
            if (bErr) throw new Error(`Erro ao inserir lotes futuros: ${bErr.message}`);
          }
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