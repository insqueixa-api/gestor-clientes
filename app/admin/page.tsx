import { createClient } from "@/lib/supabase/server";
import { SimpleBarChart } from "@/app/admin/simplebarchart";
import { RankingCard } from "@/app/admin/ranking-card";
import type { ReactNode } from "react";
import Link from "next/link";
import { EyeToggle } from "@/app/admin/eye-toggle";
import { DashboardFilter } from "./dashboard-filter";
import EvolucaoFinanceira from "./evolucao-chart";

export const dynamic = "force-dynamic";

/* =====================
   Tipos (views)
===================== */

type VwKpis = {
  tenant_id: string;
  active_clients: number | string | null;
  active_mrr_brl_estimated: number | string | null;
  overdue_clients: number | string | null;
  overdue_amount_brl_estimated: number | string | null;
  trials_created_month: number | string | null;
  trials_active_month: number | string | null;
  trials_converted_month: number | string | null;
  trials_conversion_percent: number | string | null;
};

type VwDue5Days = {
  tenant_id: string;
  day_offset: number | null; // -2..+2
  qty: number | string | null;
  amount_brl_estimated: number | string | null;
};

type VwFinanceCards = {
  tenant_id: string;

  clients_paid_today_qty: number | string | null;
  clients_paid_today_brl_estimated: number | string | null;
  reseller_paid_today_qty: number | string | null;
  reseller_paid_today_brl: number | string | null;

  clients_paid_month_qty: number | string | null;
  clients_paid_month_brl_estimated: number | string | null;
  reseller_paid_month_qty: number | string | null;
  reseller_paid_month_brl: number | string | null;

  clients_paid_prev_month_qty: number | string | null;
  clients_paid_prev_month_brl_estimated: number | string | null;
  reseller_paid_prev_month_qty: number | string | null;
  reseller_paid_prev_month_brl: number | string | null;

  to_receive_clients_qty: number | string | null;
  to_receive_brl_estimated: number | string | null;
};

type VwNewRegsDaily = {
  tenant_id: string;
  day: string;
  clients_created: number | string | null;
  trials_created: number | string | null;
};

type VwPaymentsDaily = {
  tenant_id: string;
  day: string;
  clients_paid_brl_estimated: number | string | null;
  reseller_paid_brl: number | string | null;
};

type VwTopServers = {
  tenant_id: string;
  server_id: string;
  server_name: string;
  clients_created: number | string | null;
};

type VwTopApps = {
  tenant_id: string;
  app_id: string;
  app_name: string;
  clients_count: number | string | null;
};

/* =====================
   Tipos (UI)
===================== */

type Accent = "green" | "red" | "amber" | "yellow" | "blue" | "gray";

type SimpleBarChartDatum = {
  label: string;
  value: number;
  displayValue: number;
  tooltipTitle: string;
  tooltipContent: string;
};

type BarItem = {
  label: string;
  value: number;
};

type DueBucket = {
  qty: number;
  amount: number;
};

/* =====================
   Helpers (UI only)
===================== */

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v,
  );

const fmtBRLNoSymbol = (v: number) =>
  fmtBRL(v)
    .replace(/\s?R\$\s?/g, "")
    .trim();

const fmtInt = (v: number) => new Intl.NumberFormat("pt-BR").format(v);

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

function monthLabelPtBr(d = new Date()): string {
  return d.toLocaleDateString("pt-BR", {
    timeZone: TZ_SP,
    month: "long",
    year: "numeric",
  });
}

const TZ_SP = "America/Sao_Paulo";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayInSaoPaulo(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_SP,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "01");
  const d = Number(parts.find((p) => p.type === "day")?.value ?? "01");

  return new Date(y, m - 1, d);
}

function isoDateFromYMD(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function spTitleFromISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ_SP,
    day: "numeric",
    month: "long",
  }).format(dt);
}

function daysFromMonthStartToTodaySP(): { iso: string; dayNum: number }[] {
  const today = todayInSaoPaulo();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const lastDay = today.getDate();

  const out: { iso: string; dayNum: number }[] = [];
  for (let d = 1; d <= lastDay; d++) {
    out.push({ iso: isoDateFromYMD(y, m, d), dayNum: d });
  }
  return out;
}

function normalizeDayKey(day: string): string {
  return (day ?? "").slice(0, 10);
}

/* =====================
   Página
===================== */

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const supabase = await createClient();
  const resolvedParams = await searchParams;

  // Sessão (single-user)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tenant id pra filtrar consultas diretas (server_credit_purchases, fin_*)
  const memberResult = user
    ? await supabase
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", user.id)
        .maybeSingle()
    : null;
  const myTenantId = (memberResult?.data as any)?.tenant_id ?? null;

  // Filtro: apenas IPTV e Financeiro
  const availableModules = ["iptv", "financeiro"] as const;
  const paramViews = resolvedParams?.view
    ? resolvedParams.view
        .split(",")
        .filter((v) => (availableModules as readonly string[]).includes(v))
    : [];
  const activeViews =
    paramViews.length > 0 ? paramViews : [...availableModules];
  const showClientesView = activeViews.includes("iptv");
  const showTestes = activeViews.includes("iptv");
  const showRankings = activeViews.includes("iptv");
  const showFinView = activeViews.includes("financeiro");

  // Datas do mês atual para o painel de finanças pessoais
  const _finToday = todayInSaoPaulo();
  const _finYear = _finToday.getFullYear();
  const _finMonth = _finToday.getMonth() + 1;
  const _finMonthStart = isoDateFromYMD(_finYear, _finMonth, 1);
  const _finMonthEnd = isoDateFromYMD(
    _finYear,
    _finMonth,
    new Date(_finYear, _finMonth, 0).getDate(),
  );

  const [
    kpisRes,
    dueRes,
    financeRes,
    regsRes,
    paymentsRes,
    topServersRes,
    topAppsRes,
    purchasesRes,
  ] = await Promise.all([
    supabase.from("vw_dashboard_kpis_current_month").select("*").limit(1),
    supabase.from("vw_dashboard_due_5_days").select("*"),
    supabase.from("vw_dashboard_finance_cards").select("*").limit(1),
    supabase
      .from("vw_dashboard_new_registrations_daily_current_month")
      .select("*")
      .order("day", { ascending: true }),
    supabase
      .from("vw_dashboard_payments_daily_current_month")
      .select("*")
      .order("day", { ascending: true }),
    supabase
      .from("vw_dashboard_top_servers_current_month")
      .select("*")
      .order("clients_created", { ascending: false })
      .limit(5),
    supabase
      .from("vw_dashboard_top_apps_current_month")
      .select("*")
      .order("clients_count", { ascending: false })
      .limit(5),
    (myTenantId
      ? supabase
          .from("server_credit_purchases")
          .select("created_at, total_amount_brl")
          .eq("tenant_id", myTenantId)
          .gte(
            "created_at",
            isoDateFromYMD(
              new Date(
                todayInSaoPaulo().getFullYear(),
                todayInSaoPaulo().getMonth() - 1,
                1,
              ).getFullYear(),
              new Date(
                todayInSaoPaulo().getFullYear(),
                todayInSaoPaulo().getMonth() - 1,
                1,
              ).getMonth() + 1,
              1,
            ),
          )
      : Promise.resolve({ data: null })) as Promise<any>,
  ]);

  const kpis = (kpisRes.data?.[0] ?? null) as VwKpis | null;
  const finance = (financeRes.data?.[0] ?? null) as VwFinanceCards | null;

  // Despesas (server_credit_purchases) para cálculo de Lucro
  const purchasesRows = (purchasesRes?.data ?? []) as {
    created_at: string;
    total_amount_brl: number;
  }[];
  let expensesMonthVal = 0;
  let expensesPrevMonthVal = 0;

  const today = todayInSaoPaulo();
  for (const row of purchasesRows) {
    const d = new Date(row.created_at);
    if (
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    ) {
      expensesMonthVal += toNumber(row.total_amount_brl);
    } else {
      expensesPrevMonthVal += toNumber(row.total_amount_brl);
    }
  }

  // ── Finanças Pessoais ───────
  type FinTrx = {
    id: string;
    tipo: "RECEITA" | "DESPESA";
    valor: number;
    status: string;
    data_vencimento: string;
    data_pagamento: string | null;
    categoria_id: string | null;
  };

  let finTrxRows: FinTrx[] = [];
  const finCatById = new Map<string, { nome: string; icone: string }>();
  let finSaldoAtual = 0;

  if (myTenantId) {
    const _finNextMonthStart = isoDateFromYMD(
      _finMonth === 12 ? _finYear + 1 : _finYear,
      _finMonth === 12 ? 1 : _finMonth + 1,
      1,
    );

    const [trxRes, catRes] = await Promise.allSettled([
      supabase
        .from("fin_transacoes")
        .select(
          "id, tipo, valor, status, data_vencimento, data_pagamento, categoria_id",
        )
        .eq("tenant_id", myTenantId)
        .or(
          `and(data_vencimento.gte.${_finMonthStart},data_vencimento.lte.${_finMonthEnd}),` +
            `and(status.eq.PAGO,data_pagamento.gte.${_finMonthStart},data_pagamento.lt.${_finNextMonthStart})`,
        ),
      supabase
        .from("fin_categorias")
        .select("id, nome, icone")
        .eq("tenant_id", myTenantId),
    ]);

    if (trxRes.status === "fulfilled" && !trxRes.value.error) {
      const seen = new Set<string>();
      for (const t of trxRes.value.data ?? []) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          finTrxRows.push(t as FinTrx);
        }
      }
    } else {
    }

    if (catRes.status === "fulfilled" && !catRes.value.error) {
      for (const c of catRes.value.data ?? []) {
        finCatById.set(c.id, { nome: c.nome, icone: c.icone });
      }
    } else {
    }

    // Saldo atual: soma de todas as contas via RPC
    const contasRes = await supabase
      .from("fin_contas_bancarias")
      .select("id")
      .eq("tenant_id", myTenantId);

    if (contasRes.data && contasRes.data.length > 0) {
      const saldos = await Promise.allSettled(
        contasRes.data.map((c) =>
          supabase.rpc("get_saldo_conta", { p_conta_id: c.id }),
        ),
      );
      for (const s of saldos) {
        if (s.status === "fulfilled" && !s.value.error) {
          finSaldoAtual += toNumber(s.value.data);
        }
      }
    }
  }

  const isFinPagoNoMes = (t: FinTrx) => {
    if (t.status !== "PAGO" || !t.data_pagamento) return false;
    const iso = t.data_pagamento.split("T")[0];
    return iso >= _finMonthStart && iso <= _finMonthEnd;
  };

  const finReceitasPagas = finTrxRows
    .filter((t) => t.tipo === "RECEITA" && isFinPagoNoMes(t))
    .reduce((acc, t) => acc + toNumber(t.valor), 0);

  const finDespesasPagas = finTrxRows
    .filter((t) => t.tipo === "DESPESA" && isFinPagoNoMes(t))
    .reduce((acc, t) => acc + toNumber(t.valor), 0);

  const finReceitasTotal =
    finTrxRows
      .filter(
        (t) =>
          t.tipo === "RECEITA" &&
          t.data_vencimento >= _finMonthStart &&
          t.data_vencimento <= _finMonthEnd,
      )
      .reduce((acc, t) => acc + toNumber(t.valor), 0) +
    toNumber(finance?.to_receive_brl_estimated);

  const finDespesasTotal = finTrxRows
    .filter(
      (t) =>
        t.tipo === "DESPESA" &&
        t.data_vencimento >= _finMonthStart &&
        t.data_vencimento <= _finMonthEnd,
    )
    .reduce((acc, t) => acc + toNumber(t.valor), 0);

  const finReceitasPendentes = finTrxRows
    .filter(
      (t) =>
        t.tipo === "RECEITA" &&
        t.status !== "PAGO" &&
        t.data_vencimento >= _finMonthStart &&
        t.data_vencimento <= _finMonthEnd,
    )
    .reduce((acc, t) => acc + toNumber(t.valor), 0);

  const finDespesasPendentes = finTrxRows
    .filter(
      (t) =>
        t.tipo === "DESPESA" &&
        t.status !== "PAGO" &&
        t.data_vencimento >= _finMonthStart &&
        t.data_vencimento <= _finMonthEnd,
    )
    .reduce((acc, t) => acc + toNumber(t.valor), 0);

  // Rankings por categoria (Separando Previsto e Executado)
  const catRevPrevMap = new Map<string, { label: string; value: number }>();
  const catRevExecMap = new Map<string, { label: string; value: number }>();
  const catExpPrevMap = new Map<string, { label: string; value: number }>();
  const catExpExecMap = new Map<string, { label: string; value: number }>();

  const _finTodayIso = isoDateFromYMD(_finYear, _finMonth, _finToday.getDate());

  for (const t of finTrxRows) {
    const dpDate = t.data_pagamento ? t.data_pagamento.split("T")[0] : null;

    // Executado: PAGO com data_pagamento no mês (normalizado para evitar bug do último dia)
    const inExec =
      t.status === "PAGO" &&
      !!dpDate &&
      dpDate >= _finMonthStart &&
      dpDate <= _finMonthEnd;

    // Previsto: vencimento no mês (independente de status ou data de pagamento)
    const inPrev =
      t.data_vencimento >= _finMonthStart && t.data_vencimento <= _finMonthEnd;

    if (!inPrev && !inExec) continue;

    const cat = t.categoria_id ? finCatById.get(t.categoria_id) : null;
    const label = cat ? `${cat.icone} ${cat.nome}` : "📦 Sem categoria";
    const key = t.categoria_id ?? "__none__";
    const val = toNumber(t.valor);

    if (inPrev) {
      const map = t.tipo === "RECEITA" ? catRevPrevMap : catExpPrevMap;
      const prev = map.get(key) ?? { label, value: 0 };
      map.set(key, { ...prev, value: prev.value + val });
    }
    if (inExec) {
      const map = t.tipo === "RECEITA" ? catRevExecMap : catExpExecMap;
      const prev = map.get(key) ?? { label, value: 0 };
      map.set(key, { ...prev, value: prev.value + val });
    }
  }

  const getTop5 = (map: Map<string, { label: string; value: number }>) =>
    Array.from(map.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

  const finCatRevPrevItems = getTop5(catRevPrevMap);
  const finCatRevExecItems = getTop5(catRevExecMap);
  const finCatExpPrevItems = getTop5(catExpPrevMap);
  const finCatExpExecItems = getTop5(catExpExecMap);

  const dueRows = (dueRes.data ?? []) as VwDue5Days[];
  const regsRows = (regsRes.data ?? []) as VwNewRegsDaily[];
  const paymentsRows = (paymentsRes.data ?? []) as VwPaymentsDaily[];
  const topServers = (topServersRes.data ?? []) as VwTopServers[];
  const topApps = (topAppsRes.data ?? []) as VwTopApps[];

  // KPIs
  const activeClients = toNumber(kpis?.active_clients);
  const activeMrr = toNumber(kpis?.active_mrr_brl_estimated);

  const overdueClients = toNumber(kpis?.overdue_clients);
  const overdueAmount = toNumber(kpis?.overdue_amount_brl_estimated);

  const trialsCreated = toNumber(kpis?.trials_created_month);
  const trialsActive = toNumber(kpis?.trials_active_month);
  const trialsConverted = toNumber(kpis?.trials_converted_month);
  const trialsConvPct = toNumber(kpis?.trials_conversion_percent);

  // Due buckets por offset
  const dueByOffset = new Map<number, DueBucket>();
  for (const row of dueRows) {
    const off = Number(row.day_offset);
    if (!Number.isFinite(off)) continue;
    dueByOffset.set(off, {
      qty: toNumber(row.qty),
      amount: toNumber(row.amount_brl_estimated),
    });
  }

  // Finance cards
  const clientsTodayQty = toNumber(finance?.clients_paid_today_qty);
  const clientsTodayVal = toNumber(finance?.clients_paid_today_brl_estimated);
  const resellerTodayQty = toNumber(finance?.reseller_paid_today_qty);
  const resellerTodayVal = toNumber(finance?.reseller_paid_today_brl);

  const clientsMonthQty = toNumber(finance?.clients_paid_month_qty);
  const clientsMonthVal = toNumber(finance?.clients_paid_month_brl_estimated);
  const resellerMonthQty = toNumber(finance?.reseller_paid_month_qty);
  const resellerMonthVal = toNumber(finance?.reseller_paid_month_brl);

  const clientsPrevMonthQty = toNumber(finance?.clients_paid_prev_month_qty);
  const clientsPrevMonthVal = toNumber(
    finance?.clients_paid_prev_month_brl_estimated,
  );
  const resellerPrevMonthQty = toNumber(finance?.reseller_paid_prev_month_qty);
  const resellerPrevMonthVal = toNumber(finance?.reseller_paid_prev_month_brl);

  const toReceiveQty = toNumber(finance?.to_receive_clients_qty);
  const toReceiveVal = toNumber(finance?.to_receive_brl_estimated);

  // Gráfico: novos cadastros
  const regsMap = new Map<string, { clients: number; trials: number }>();
  for (const r of regsRows) {
    const key = normalizeDayKey(r.day);
    regsMap.set(key, {
      clients: toNumber(r.clients_created),
      trials: toNumber(r.trials_created),
    });
  }

  const chartRegsData: SimpleBarChartDatum[] =
    daysFromMonthStartToTodaySP().map(({ iso, dayNum }) => {
      const found = regsMap.get(iso) ?? { clients: 0, trials: 0 };
      const total = found.clients + found.trials;

      return {
        label: String(dayNum),
        value: total,
        displayValue: total,
        tooltipTitle: spTitleFromISO(iso),
        tooltipContent: `${fmtInt(found.clients)} Clientes / ${fmtInt(found.trials)} Testes`,
      };
    });

  // Gráfico: pagamentos
  const payMap = new Map<string, { clients: number; reseller: number }>();
  for (const r of paymentsRows) {
    const key = normalizeDayKey(r.day);
    payMap.set(key, {
      clients: toNumber(r.clients_paid_brl_estimated),
      reseller: toNumber(r.reseller_paid_brl),
    });
  }

  const chartPaymentsData: SimpleBarChartDatum[] =
    daysFromMonthStartToTodaySP().map(({ iso, dayNum }) => {
      const found = payMap.get(iso) ?? { clients: 0, reseller: 0 };
      const totalVal = found.clients + found.reseller;

      return {
        label: String(dayNum),
        value: totalVal,
        displayValue: totalVal,
        tooltipTitle: spTitleFromISO(iso),
        tooltipContent: `Clientes: ${fmtBRL(found.clients)} • Revenda: ${fmtBRL(found.reseller)} • Total: ${fmtBRL(totalVal)}`,
      };
    });

  const topServersItems: BarItem[] = topServers.map((s) => ({
    label: s.server_name,
    value: toNumber(s.clients_created),
  }));

  const topAppsItems: BarItem[] = topApps.map((a) => ({
    label: a.app_name,
    value: toNumber(a.clients_count),
  }));

  return (
    <div
      id="dashboard-values"
      className="space-y-6 pt-0 pb-6 px-0 sm:px-6 text-zinc-800 dark:text-zinc-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">Dashboard</h1>
            <EyeToggle />
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-md">
              {monthLabelPtBr()}
            </p>
          </div>
        </div>

        <DashboardFilter
          availableModules={[...availableModules]}
          currentViews={activeViews}
        />
      </div>

      {/* CARDS TOPO */}
      {showClientesView && (
        <div
          className={`grid grid-cols-1 gap-3 sm:gap-6 ${showTestes ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}
        >
          <MetricCardView
            title="Ativos"
            accent="green"
            leftLabel="Clientes"
            leftValue={fmtInt(activeClients)}
            rightLabel="MRR Estimado"
            rightValue={fmtBRL(activeMrr)}
            footer="Mês atual"
            href="/admin/cliente?filter=ativos"
          />

          <MetricCardView
            title="Vencidos"
            accent="red"
            leftLabel="Clientes"
            leftValue={fmtInt(overdueClients)}
            rightLabel="Pendente"
            rightValue={fmtBRL(overdueAmount)}
            footer="Mês atual"
            href="/admin/cliente?filter=vencidos"
          />

          {showTestes && (
            <MetricCardView
              title="Testes"
              accent="blue"
              leftLabel="Criados"
              leftValue={fmtInt(trialsCreated)}
              rightLabel="Conversão"
              rightValue={fmtPct(trialsConvPct)}
              footer={`Ativos: ${fmtInt(trialsActive)} • Convertidos: ${fmtInt(trialsConverted)}`}
              href="/admin/teste"
            />
          )}
        </div>
      )}

      {/* VENCIMENTOS */}
      {showClientesView && (
        <>
          <SectionTitle title="VENCIMENTOS (5 DIAS)" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-5">
            <VencimentoCard
              diff={-2}
              map={dueByOffset}
              title="Venceu há 2 dias"
              color="gray"
            />
            <VencimentoCard
              diff={-1}
              map={dueByOffset}
              title="Venceu Ontem"
              color="gray"
            />
            <VencimentoCard
              diff={0}
              map={dueByOffset}
              title="Vence Hoje"
              color="yellow"
            />
            <VencimentoCard
              diff={1}
              map={dueByOffset}
              title="Vence Amanhã"
              color="amber"
            />
            <VencimentoCard
              diff={2}
              map={dueByOffset}
              title="Vence em 2 dias"
              color="blue"
            />
          </div>
        </>
      )}

      {showClientesView && (
        <>
          <div className="sm:hidden">
            <SectionTitle title="FINANCEIRO R$" />
          </div>
          <div className="hidden sm:block">
            <SectionTitle title="FINANCEIRO" />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCardView
              title="Recebidos Hoje"
              accent="green"
              leftLabel={`Clientes (${fmtInt(clientsTodayQty)})`}
              leftValue={
                <>
                  <span className="sm:hidden">
                    {fmtBRLNoSymbol(clientsTodayVal)}
                  </span>
                  <span className="hidden sm:inline">
                    {fmtBRL(clientsTodayVal)}
                  </span>
                </>
              }
              rightLabel={`Revenda (${fmtInt(resellerTodayQty)})`}
              rightValue={
                <>
                  <span className="sm:hidden">
                    {fmtBRLNoSymbol(resellerTodayVal)}
                  </span>
                  <span className="hidden sm:inline">
                    {fmtBRL(resellerTodayVal)}
                  </span>
                </>
              }
              footer={
                <>
                  <span className="sm:hidden">
                    Total: {fmtBRLNoSymbol(clientsTodayVal + resellerTodayVal)}
                  </span>
                  <span className="hidden sm:inline">
                    Total: {fmtBRL(clientsTodayVal + resellerTodayVal)}
                  </span>
                </>
              }
            />

            <MetricCardView
              title="Faturamento (Mês)"
              accent="green"
              leftLabel={`Clientes (${fmtInt(clientsMonthQty)})`}
              leftValue={
                <>
                  <span className="sm:hidden">
                    {fmtBRLNoSymbol(clientsMonthVal)}
                  </span>
                  <span className="hidden sm:inline">
                    {fmtBRL(clientsMonthVal)}
                  </span>
                </>
              }
              rightLabel={`Revenda (${fmtInt(resellerMonthQty)})`}
              rightValue={
                <>
                  <span className="sm:hidden">
                    {fmtBRLNoSymbol(resellerMonthVal)}
                  </span>
                  <span className="hidden sm:inline">
                    {fmtBRL(resellerMonthVal)}
                  </span>
                </>
              }
              footer={
                <div className="flex justify-between items-center w-full">
                  <div>
                    <span className="sm:hidden">
                      Total:{" "}
                      {fmtBRLNoSymbol(clientsMonthVal + resellerMonthVal)}
                    </span>
                    <span className="hidden sm:inline">
                      Total: {fmtBRL(clientsMonthVal + resellerMonthVal)}
                    </span>
                  </div>
                  <div
                    className={`${clientsMonthVal + resellerMonthVal - expensesMonthVal < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    <span className="sm:hidden">
                      Lucro:{" "}
                      {fmtBRLNoSymbol(
                        clientsMonthVal + resellerMonthVal - expensesMonthVal,
                      )}
                    </span>
                    <span className="hidden sm:inline">
                      Lucro:{" "}
                      {fmtBRL(
                        clientsMonthVal + resellerMonthVal - expensesMonthVal,
                      )}
                    </span>
                  </div>
                </div>
              }
            />

            <MetricCardView
              title="A Receber (Ativos)"
              accent="amber"
              leftLabel={`Clientes (${fmtInt(toReceiveQty)})`}
              leftValue={
                <>
                  <span className="sm:hidden">
                    {fmtBRLNoSymbol(toReceiveVal)}
                  </span>
                  <span className="hidden sm:inline">
                    {fmtBRL(toReceiveVal)}
                  </span>
                </>
              }
              footer="Até o fim do mês"
            />

            <MetricCardView
              title="Mês Anterior"
              accent="gray"
              leftLabel={`Clientes (${fmtInt(clientsPrevMonthQty)})`}
              leftValue={
                <>
                  <span className="sm:hidden">
                    {fmtBRLNoSymbol(clientsPrevMonthVal)}
                  </span>
                  <span className="hidden sm:inline">
                    {fmtBRL(clientsPrevMonthVal)}
                  </span>
                </>
              }
              rightLabel={`Revenda (${fmtInt(resellerPrevMonthQty)})`}
              rightValue={
                <>
                  <span className="sm:hidden">
                    {fmtBRLNoSymbol(resellerPrevMonthVal)}
                  </span>
                  <span className="hidden sm:inline">
                    {fmtBRL(resellerPrevMonthVal)}
                  </span>
                </>
              }
              footer={
                <div className="flex justify-between items-center w-full">
                  <div>
                    <span className="sm:hidden">
                      Total:{" "}
                      {fmtBRLNoSymbol(
                        clientsPrevMonthVal + resellerPrevMonthVal,
                      )}
                    </span>
                    <span className="hidden sm:inline">
                      Total:{" "}
                      {fmtBRL(clientsPrevMonthVal + resellerPrevMonthVal)}
                    </span>
                  </div>
                  <div
                    className={`${clientsPrevMonthVal + resellerPrevMonthVal - expensesPrevMonthVal < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    <span className="sm:hidden">
                      Lucro:{" "}
                      {fmtBRLNoSymbol(
                        clientsPrevMonthVal +
                          resellerPrevMonthVal -
                          expensesPrevMonthVal,
                      )}
                    </span>
                    <span className="hidden sm:inline">
                      Lucro:{" "}
                      {fmtBRL(
                        clientsPrevMonthVal +
                          resellerPrevMonthVal -
                          expensesPrevMonthVal,
                      )}
                    </span>
                  </div>
                </div>
              }
            />
          </div>
        </>
      )}

      {/* CONTROLE FINANCEIRO */}
      {showFinView && (
        <>
          <SectionTitle title="CONTROLE FINANCEIRO" />
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-4">
            <MetricCardView
              title="💰 Receitas do Mês"
              accent="green"
              leftLabel="Recebido no Mês"
              leftValue={fmtBRL(finReceitasPagas)}
              rightLabel="A Receber"
              rightValue={fmtBRL(finReceitasPendentes)}
              footer={`Previsão total: ${fmtBRL(finReceitasTotal)}`}
            />
            <MetricCardView
              title="📉 Despesas do Mês"
              accent="red"
              leftLabel="Pago no Mês"
              leftValue={fmtBRL(finDespesasPagas)}
              rightLabel="A Pagar"
              rightValue={fmtBRL(finDespesasPendentes)}
              footer={`Previsão total: ${fmtBRL(finDespesasTotal)}`}
            />
            <MetricCardView
              title="📊 Saldo do Mês"
              accent={
                finReceitasPagas - finDespesasPagas >= 0 ? "green" : "red"
              }
              leftLabel="Resultado no Mês"
              leftValue={fmtBRL(finReceitasPagas - finDespesasPagas)}
              footer={`Previsão: ${fmtBRL(finReceitasTotal - finDespesasTotal)}`}
            />
            <MetricCardView
              title="💰 Saldo Atual"
              accent={finSaldoAtual >= 0 ? "green" : "red"}
              leftLabel="Saldo em conta"
              leftValue={fmtBRL(finSaldoAtual)}
              footer="Atualizar saldo..."
              href="/admin/settings/financeiro_pessoal"
            />
          </div>

          {finCatRevPrevItems.length > 0 ||
          finCatRevExecItems.length > 0 ||
          finCatExpPrevItems.length > 0 ||
          finCatExpExecItems.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:gap-6 lg:grid-cols-2">
              {(finCatRevPrevItems.length > 0 ||
                finCatRevExecItems.length > 0) && (
                <div className="sv">
                  <RankingCard
                    title="Receitas por Categoria"
                    itemsPrevisto={finCatRevPrevItems}
                    itemsExecutado={finCatRevExecItems}
                    accentColor="emerald"
                    mode="currency"
                  />
                </div>
              )}
              {(finCatExpPrevItems.length > 0 ||
                finCatExpExecItems.length > 0) && (
                <div className="sv">
                  <RankingCard
                    title="Despesas por Categoria"
                    itemsPrevisto={finCatExpPrevItems}
                    itemsExecutado={finCatExpExecItems}
                    accentColor="rose"
                    mode="currency"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-border p-10 text-center text-slate-400 dark:text-white/30 text-sm">
              Nenhuma transação registrada no mês.{" "}
              <Link
                href="/admin/settings/financeiro_pessoal"
                className="underline hover:text-slate-600 dark:hover:text-white/60"
              >
                Adicionar transações →
              </Link>
            </div>
          )}
        </>
      )}

      {/* GRÁFICOS IPTV */}
      {showClientesView && (
        <div
          className={`grid grid-cols-1 gap-3 sm:gap-6 ${showRankings ? "lg:grid-cols-2" : "lg:grid-cols-2 xl:grid-cols-2"}`}
        >
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 sm:p-6 shadow-sm">
            <div className="flex justify-between items-center mb-2 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-zinc-800 dark:text-zinc-200">
                  Novos clientes
                </h3>
              </div>
            </div>
            <div className="sv w-full">
              <SimpleBarChart
                data={chartRegsData}
                colorClass="from-emerald-400 to-emerald-600 ring-emerald-500"
                label="Cadastros"
                heightClass="h-40 sm:h-56"
              />
              {chartRegsData.length === 0 && (
                <div className="text-zinc-400 text-sm mt-3">
                  Sem dados no mês atual.
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 sm:p-6 shadow-sm">
            <div className="flex justify-between items-center mb-2 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-zinc-800 dark:text-zinc-200">
                  Pagamentos Recebidos
                </h3>
              </div>
            </div>
            <div className="sv w-full">
              <SimpleBarChart
                data={chartPaymentsData}
                colorClass="from-sky-400 to-blue-600 ring-blue-500"
                label="BRL"
                heightClass="h-40 sm:h-56"
              />
              {chartPaymentsData.length === 0 && (
                <div className="text-zinc-400 text-sm mt-3">
                  Sem dados no mês atual.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RANKINGS */}
      {showRankings && (
        <div className="grid grid-cols-1 gap-3 sm:gap-6 lg:grid-cols-2">
          <div className="sv">
            <RankingCard
              title="Top Servidores (Mês Atual)"
              items={topServersItems}
              accentColor="sky"
            />
          </div>
          <div className="sv">
            <RankingCard
              title="Top Aplicativos (Mês Atual)"
              items={topAppsItems}
              accentColor="emerald"
            />
          </div>
        </div>
      )}

      {/* EVOLUÇÃO 12 MESES (Apenas na visão exclusiva do Financeiro) */}
      {activeViews.length === 1 && activeViews.includes("financeiro") && (
        <div id="evolucao-financeira" className="scroll-mt-24 sv">
          <EvolucaoFinanceira myTenantId={myTenantId} />
        </div>
      )}
    </div>
  );
}

/* =====================
   COMPONENTES VISUAIS
===================== */

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-4 py-2 opacity-50">
      <div className="h-px flex-1 bg-current" />
      <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 tracking-widest uppercase">
        {title}
      </span>
      <div className="h-px flex-1 bg-current" />
    </div>
  );
}

function VencimentoCard({
  diff,
  map,
  title,
  color,
}: {
  diff: number;
  map: Map<number, DueBucket>;
  title: string;
  color: Accent;
}) {
  const d = map.get(diff) ?? { qty: 0, amount: 0 };

  let filterSlug = "";
  if (diff === -2) filterSlug = "venceu_2_dias";
  if (diff === -1) filterSlug = "venceu_ontem";
  if (diff === 0) filterSlug = "vence_hoje";
  if (diff === 1) filterSlug = "vence_amanha";
  if (diff === 2) filterSlug = "vence_2_dias";

  return (
    <MetricCardView
      title={title}
      accent={color}
      leftLabel="Qtd"
      leftValue={fmtInt(d.qty)}
      rightLabel="Valor"
      rightValue={fmtBRL(d.amount)}
      href={filterSlug ? `/admin/cliente?filter=${filterSlug}` : undefined}
    />
  );
}

function MetricCardView({
  title,
  accent,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  footer,
  href,
}: {
  title: string;
  accent: Accent;
  leftLabel: string;
  leftValue: ReactNode;
  rightLabel?: string;
  rightValue?: ReactNode;
  footer?: ReactNode;
  href?: string;
}) {
  const colors: Record<Accent, string> = {
    green: "border-l-emerald-500",
    red: "border-l-rose-500",
    amber: "border-l-amber-500",
    yellow: "border-l-yellow-500",
    blue: "border-l-blue-500",
    gray: "border-l-zinc-500",
  };

  const content = (
    <>
      <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-black/5 dark:border-border font-semibold text-zinc-800 dark:text-zinc-200 text-[13px] sm:text-sm flex justify-between items-center">
        {title}
        {href && <span className="opacity-40 text-xs">↗</span>}
      </div>
      <div className="p-3 sm:p-4 flex gap-2 sm:gap-4 flex-1">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-wider opacity-70 mb-1">
            {leftLabel}
          </div>
          <div className="sv text-[15px] sm:text-xl font-bold text-zinc-800 dark:text-zinc-200 leading-tight whitespace-nowrap tabular-nums">
            {leftValue}
          </div>
        </div>

        {rightLabel && rightValue && (
          <div className="text-right min-w-0 flex-1">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-wider opacity-70 mb-1">
              {rightLabel}
            </div>
            <div className="sv text-[15px] sm:text-xl font-bold text-zinc-800 dark:text-zinc-200 leading-tight whitespace-nowrap tabular-nums">
              {rightValue}
            </div>
          </div>
        )}
      </div>

      {footer && (
        <div className="sv px-3 sm:px-4 py-2 text-[11px] sm:text-xs bg-black/5 dark:bg-white/5 opacity-80">
          {footer}
        </div>
      )}
    </>
  );

  const baseClass = `rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col border-l-4 ${colors[accent]}`;

  if (href) {
    return (
      <Link
        href={href}
        target="_blank"
        className={`${baseClass} hover:scale-[1.02] transition-transform cursor-pointer hover:shadow-md`}
      >
        {content}
      </Link>
    );
  }

  return <div className={baseClass}>{content}</div>;
}
