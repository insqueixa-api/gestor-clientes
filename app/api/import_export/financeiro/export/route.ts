import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

const exportHeaders = [
  "Tipo",
  "Descrição",
  "Valor",
  "Data Vencimento",
  "Status",
  "Data Pagamento",
  "Conta",
  "Categoria",
  "Recorrência",
  "Frequência",
  "Parcela Atual",
  "Total Parcelas",
  "Observações",
];

function formatDiaBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId);

  if (error) {
    return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };
  }

  const tenantIds: string[] = Array.from(
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
      hint: "Você participa de múltiplos tenants. Informe tenant_id na querystring.",
    };
  }

  if (!tenantIds.includes(tenantFromQuery)) {
    return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "tenant_id não pertence ao seu usuário." };
  }

  return { tenant_id: tenantFromQuery, status: 200 };
}

export async function GET(req: Request) {
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

  const yearsParam = url.searchParams.get("years");
  const statusParam = url.searchParams.get("status");

  const years = yearsParam
    ? yearsParam.split(",").map(y => parseInt(y.trim(), 10)).filter(y => !isNaN(y))
    : [];

  let q = supabase
    .from("fin_transacoes")
    .select(`
      tipo,
      descricao,
      valor,
      data_vencimento,
      status,
      data_pagamento,
      is_recorrente,
      frequencia,
      parcela_atual,
      parcela_total,
      observacoes,
      fin_contas_bancarias (nome),
      fin_categorias (nome)
    `)
    .eq("tenant_id", tenant_id)
    .order("data_vencimento", { ascending: false });

  if (years.length > 0) {
    // Monta range OR: data_vencimento entre 01/01/YYYY e 31/12/YYYY para cada ano
    const orFilters = years.map(y => `and(data_vencimento.gte.${y}-01-01,data_vencimento.lte.${y}-12-31)`).join(",");
    q = q.or(orFilters);
  }

  if (statusParam === "PAGO" || statusParam === "PENDENTE") {
    q = q.eq("status", statusParam);
  }

  const { data: transacoes, error } = await q;

  if (error) {
    return NextResponse.json({ error: "export_failed", details: error.message }, { status: 500 });
  }

  const rows = (transacoes ?? []) as any[];

  // Sem dados — retorna planilha só com cabeçalho
  if (rows.length === 0) {
    const emptySheet = XLSX.utils.aoa_to_sheet([exportHeaders]);
    emptySheet["!cols"] = [
      { wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 16 },
      { wch: 10 }, { wch: 16 }, { wch: 20 }, { wch: 25 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 40 },
    ];
    const emptyWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(emptyWb, emptySheet, "Financeiro");
    const emptyBuffer = XLSX.write(emptyWb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(emptyBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="financeiro_export.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const dataAsArrays = rows.map((t: any) => {
    let recorrencia = "Única";
    if (t.parcela_total) recorrencia = "Parcelada";
    else if (t.is_recorrente) recorrencia = "Recorrente";

    return [
      t.tipo ?? "",
      t.descricao ?? "",
      t.valor !== null && t.valor !== undefined
        ? String(t.valor).replace(".", ",")
        : "",
      formatDiaBR(t.data_vencimento),
      t.status ?? "",
      formatDiaBR(t.data_pagamento),
      t.fin_contas_bancarias?.nome ?? "",
      t.fin_categorias?.nome ?? "",
      recorrencia,
      t.frequencia ?? "",
      t.parcela_atual ?? "",
      t.parcela_total ?? "",
      t.observacoes ?? "",
    ];
  });

  const worksheet = XLSX.utils.aoa_to_sheet([exportHeaders, ...dataAsArrays]);

  // Forçar coluna Valor (col 2) como texto para preservar formato pt-BR
  for (let R = 1; R <= dataAsArrays.length; R++) {
    const cellAddress = XLSX.utils.encode_cell({ r: R, c: 2 });
    if (worksheet[cellAddress]) {
      worksheet[cellAddress].t = "s";
      worksheet[cellAddress].z = "@";
    }
  }

  worksheet["!cols"] = [
    { wch: 10 }, // Tipo
    { wch: 30 }, // Descrição
    { wch: 12 }, // Valor
    { wch: 16 }, // Data Vencimento
    { wch: 10 }, // Status
    { wch: 16 }, // Data Pagamento
    { wch: 20 }, // Conta
    { wch: 25 }, // Categoria
    { wch: 14 }, // Recorrência
    { wch: 14 }, // Frequência
    { wch: 14 }, // Parcela Atual
    { wch: 16 }, // Total Parcelas
    { wch: 40 }, // Observações
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Financeiro");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const filename = `financeiro_export_${y}-${m}-${d}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}