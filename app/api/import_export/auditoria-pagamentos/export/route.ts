// app/api/import_export/auditoria-pagamentos/export/route.ts
// ✅ 05/09/2026, pedido do Márcio: exportar o histórico de pagamentos
// APROVADOS do Portal (independente do status de renovação/fulfillment) —
// pra guarda fiscal (Reforma Tributária / NFS-e, ver docs/fiscal/) e
// conferência bancária. Mesmo padrão dos outros exports (xlsx, GET com
// query params) — ver app/api/import_export/financeiro/export/route.ts.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveAdminTenant } from "@/lib/api/auth-server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

const exportHeaders = [
  "Data da Transação",
  "Mês da Transação",
  "Nome",
  "Username",
  "Servidor",
  "Plano",
  "Telas",
  "Valor Pago",
  "Banco",
];

// ✅ Mesmo mapa de app/admin/auditoria/page.tsx (GATEWAY_LABELS) — duplicado
// de propósito (rota server-side não importa de um client component) em
// vez de extrair um módulo compartilhado só pra isso.
const GATEWAY_LABELS: Record<string, string> = {
  mercadopago: "Mercado Pago PJ",
  stripe: "Stripe",
  fastpay: "FastPay",
  fastflow: "FastFlow",
  depix: "DePix",
  pix_manual: "PIX (Manual)",
  transfer_manual_eur: "Revolut (Manual)",
  transfer_manual_usd: "Revolut (Manual)",
  manual: "Transferência Manual",
};
function gatewayLabel(raw: string | null): string {
  if (!raw) return "";
  return GATEWAY_LABELS[raw] || raw;
}

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function formatDataHoraBR(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function formatValor(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return "";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
  } catch {
    return String(amount);
  }
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const resolved = await resolveAdminTenant(supabase, user.id);
  if (!resolved) {
    return NextResponse.json({ error: "tenant_lookup_failed" }, { status: 500 });
  }
  const tenant_id = resolved.tenantId;

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || "", 10);
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? parseInt(monthParam, 10) : null;

  if (!Number.isFinite(year) || year < 2000) {
    return NextResponse.json({ error: "year é obrigatório (YYYY)" }, { status: 400 });
  }
  if (month !== null && (!Number.isFinite(month) || month < 1 || month > 12)) {
    return NextResponse.json({ error: "month deve ser 1-12" }, { status: 400 });
  }

  // ✅ Janela em horário de São Paulo (mesma timezone usada no resto do
  // sistema pra "dia"/"mês") — evita virar o ano/mês errado perto da
  // virada por causa do UTC.
  const startMonth = month ?? 1;
  const endMonth = month ?? 12;
  const startISO = new Date(`${year}-${String(startMonth).padStart(2, "0")}-01T00:00:00-03:00`).toISOString();
  const endDate = new Date(`${year}-${String(endMonth).padStart(2, "0")}-01T00:00:00-03:00`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const endISO = endDate.toISOString();

  const { data: rows, error } = await supabase
    .from("client_portal_payments")
    .select(`
      created_at,
      plan_label,
      app_name_snapshot,
      price_amount,
      price_currency,
      gateway_type,
      clients (
        display_name,
        server_username,
        screens,
        servers ( name )
      )
    `)
    .eq("tenant_id", tenant_id)
    .in("status", ["approved", "manual_approved"])
    .gte("created_at", startISO)
    .lt("created_at", endISO)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "export_failed", details: error.message }, { status: 500 });
  }

  const dataAsArrays = (rows || []).map((r: any) => {
    const d = new Date(r.created_at);
    const mesNome = !Number.isNaN(d.getTime())
      ? `${MESES_PT[Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", month: "numeric" }).format(d)) - 1]}/${year}`
      : "";
    return [
      formatDataHoraBR(r.created_at),
      mesNome,
      r.clients?.display_name || "",
      r.clients?.server_username || "",
      r.clients?.servers?.name || "",
      r.plan_label || r.app_name_snapshot || "",
      r.clients?.screens ?? "",
      formatValor(r.price_amount, r.price_currency),
      gatewayLabel(r.gateway_type),
    ];
  });

  const worksheet = XLSX.utils.aoa_to_sheet([exportHeaders, ...dataAsArrays]);
  worksheet["!cols"] = [
    { wch: 18 }, // Data da Transação
    { wch: 16 }, // Mês da Transação
    { wch: 22 }, // Nome
    { wch: 18 }, // Username
    { wch: 14 }, // Servidor
    { wch: 14 }, // Plano
    { wch: 8 },  // Telas
    { wch: 14 }, // Valor Pago
    { wch: 18 }, // Banco
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Pagamentos");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const filename = month
    ? `pagamentos_${year}-${String(month).padStart(2, "0")}.xlsx`
    : `pagamentos_${year}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
