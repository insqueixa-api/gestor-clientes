import { createClient } from "@/lib/supabase/server";
import { SimpleBarChart } from "./simplebarchart";
import type { ReactNode } from "react";
import Link from "next/link"; // <--- ADICIONAR ISSO
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
  day: string; // date
  clients_created: number | string | null;
  trials_created: number | string | null;
};

type VwPaymentsDaily = {
  tenant_id: string;
  day: string; // date
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
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtBRLNoSymbol = (v: number) =>
  fmtBRL(v).replace(/\s?R\$\s?/g, "").trim();


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

// pega "hoje" no timezone de SP (sem depender do timezone do server)
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

  // cria um Date “local” só pra manipular dia/mês/ano (nós controlamos o y/m/d)
  return new Date(y, m - 1, d);
}

function isoDateFromYMD(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`; // YYYY-MM-DD
}

function spTitleFromISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  // Meio-dia UTC => nunca “vira” o dia quando formata em SP
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

// normaliza r.day vindo da view (geralmente já é YYYY-MM-DD)
function normalizeDayKey(day: string): string {
  return (day ?? "").slice(0, 10);
}


// type guard para remover nulls sem "as any[]"
function isChartDatum(v: SimpleBarChartDatum | null): v is SimpleBarChartDatum {
  return v !== null;
}

/* =====================
   Página
===================== */

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // Views only
  const [
    kpisRes,
    dueRes,
    financeRes,
    regsRes,
    paymentsRes,
    topServersRes,
    topAppsRes,
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
  ]);

  // Fallback de UI (não é cálculo de negócio)
  if (kpisRes.error) console.warn("[dashboard] kpis error:", kpisRes.error.message);
  if (dueRes.error) console.warn("[dashboard] due error:", dueRes.error.message);
  if (financeRes.error) console.warn("[dashboard] finance error:", financeRes.error.message);
  if (regsRes.error) console.warn("[dashboard] regs error:", regsRes.error.message);
  if (paymentsRes.error) console.warn("[dashboard] payments error:", paymentsRes.error.message);
  if (topServersRes.error) console.warn("[dashboard] top servers error:", topServersRes.error.message);
  if (topAppsRes.error) console.warn("[dashboard] top apps error:", topAppsRes.error.message);

  const kpis = (kpisRes.data?.[0] ?? null) as VwKpis | null;
  const finance = (financeRes.data?.[0] ?? null) as VwFinanceCards | null;

  const dueRows = (dueRes.data ?? []) as VwDue5Days[];
  const regsRows = (regsRes.data ?? []) as VwNewRegsDaily[];
  const paymentsRows = (paymentsRes.data ?? []) as VwPaymentsDaily[];
  const topServers = (topServersRes.data ?? []) as VwTopServers[];
  const topApps = (topAppsRes.data ?? []) as VwTopApps[];

  // KPIs (view pode vir vazia => zeros)
  const activeClients = toNumber(kpis?.active_clients);
  const activeMrr = toNumber(kpis?.active_mrr_brl_estimated);

  const overdueClients = toNumber(kpis?.overdue_clients);
  const overdueAmount = toNumber(kpis?.overdue_amount_brl_estimated);

  const trialsCreated = toNumber(kpis?.trials_created_month);
  const trialsActive = toNumber(kpis?.trials_active_month);
  const trialsConverted = toNumber(kpis?.trials_converted_month);
  const trialsConvPct = toNumber(kpis?.trials_conversion_percent);

  // Due buckets por offset (-2..+2) (só organiza output da view)
  const dueByOffset = new Map<number, DueBucket>();
  for (const row of dueRows) {
    const off = Number(row.day_offset);
    if (!Number.isFinite(off)) continue;

    dueByOffset.set(off, {
      qty: toNumber(row.qty),
      amount: toNumber(row.amount_brl_estimated),
    });
  }

  // Finance cards (já vem pronto)
  const clientsTodayQty = toNumber(finance?.clients_paid_today_qty);
  const clientsTodayVal = toNumber(finance?.clients_paid_today_brl_estimated);
  const resellerTodayQty = toNumber(finance?.reseller_paid_today_qty);
  const resellerTodayVal = toNumber(finance?.reseller_paid_today_brl);

  const clientsMonthQty = toNumber(finance?.clients_paid_month_qty);
  const clientsMonthVal = toNumber(finance?.clients_paid_month_brl_estimated);
  const resellerMonthQty = toNumber(finance?.reseller_paid_month_qty);
  const resellerMonthVal = toNumber(finance?.reseller_paid_month_brl);

  const clientsPrevMonthQty = toNumber(finance?.clients_paid_prev_month_qty);
  const clientsPrevMonthVal = toNumber(finance?.clients_paid_prev_month_brl_estimated);
  const resellerPrevMonthQty = toNumber(finance?.reseller_paid_prev_month_qty);
  const resellerPrevMonthVal = toNumber(finance?.reseller_paid_prev_month_brl);

  const toReceiveQty = toNumber(finance?.to_receive_clients_qty);
  const toReceiveVal = toNumber(finance?.to_receive_brl_estimated);

  // Gráfico: novos cadastros (view já vem por dia)
  const regsMap = new Map<string, { clients: number; trials: number }>();
for (const r of regsRows) {
  const key = normalizeDayKey(r.day);
  regsMap.set(key, {
    clients: toNumber(r.clients_created),
    trials: toNumber(r.trials_created),
  });
}

const chartRegsData: SimpleBarChartDatum[] = daysFromMonthStartToTodaySP().map(({ iso, dayNum }) => {
  const found = regsMap.get(iso) ?? { clients: 0, trials: 0 };
  const total = found.clients + found.trials;

  return {
    label: String(dayNum), // eixo X limpo: 1,2,3...
    value: total,
    displayValue: total,
    tooltipTitle: spTitleFromISO(iso),
    tooltipContent: `${fmtInt(found.clients)} Clientes / ${fmtInt(found.trials)} Testes`,
  };
});


  // Gráfico: pagamentos (BRL por dia)
const payMap = new Map<string, { clients: number; reseller: number }>();
for (const r of paymentsRows) {
  const key = normalizeDayKey(r.day);
  payMap.set(key, {
    clients: toNumber(r.clients_paid_brl_estimated),
    reseller: toNumber(r.reseller_paid_brl),
  });
}

const chartPaymentsData: SimpleBarChartDatum[] = daysFromMonthStartToTodaySP().map(({ iso, dayNum }) => {
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
  <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 text-zinc-900 dark:text-zinc-100">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-0">

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Visão Geral - {monthLabelPtBr()}
          </p>
        </div>
      </div>

      {/* CARDS TOPO */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
        <MetricCardView
          title="Ativos"
          accent="green"
          leftLabel="Clientes"
          leftValue={fmtInt(activeClients)}
          rightLabel="MRR Estimado"
          rightValue={fmtBRL(activeMrr)}
          footer="Mês atual"
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

        <MetricCardView
          title="Testes"
          accent="blue"
          leftLabel="Criados"
          leftValue={fmtInt(trialsCreated)}
          rightLabel="Conversão"
          rightValue={fmtPct(trialsConvPct)}
          footer={`Ativos: ${fmtInt(trialsActive)} • Convertidos: ${fmtInt(trialsConverted)}`}
        />
      </div>

      {/* VENCIMENTOS */}
      <SectionTitle title="VENCIMENTOS (5 DIAS)" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-5">

        <VencimentoCard diff={-2} map={dueByOffset} title="Venceu há 2 dias" color="gray" />
        <VencimentoCard diff={-1} map={dueByOffset} title="Venceu Ontem" color="gray" />
        <VencimentoCard diff={0} map={dueByOffset} title="Vence Hoje" color="yellow" />
        <VencimentoCard diff={1} map={dueByOffset} title="Vence Amanhã" color="amber" />
        <VencimentoCard diff={2} map={dueByOffset} title="Vence em 2 dias" color="blue" />
      </div>

      {/* FINANCEIRO */}
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
    <span className="sm:hidden">{fmtBRLNoSymbol(clientsTodayVal)}</span>


    <span className="hidden sm:inline">{fmtBRL(clientsTodayVal)}</span>
  </>
}
          rightLabel={`Revenda (${fmtInt(resellerTodayQty)})`}
          rightValue={
  <>
    <span className="sm:hidden">{fmtBRLNoSymbol(resellerTodayVal)}</span>

    <span className="hidden sm:inline">{fmtBRL(resellerTodayVal)}</span>
  </>
}
          footer="Hoje"
        />

        <MetricCardView
          title="Faturamento (Mês)"
          accent="green"
          leftLabel={`Clientes (${fmtInt(clientsMonthQty)})`}
          leftValue={
  <>
    
    <span className="sm:hidden">{fmtBRLNoSymbol(clientsMonthVal)}</span>

    <span className="hidden sm:inline">{fmtBRL(clientsMonthVal)}</span>
  </>
}
          rightLabel={`Revenda (${fmtInt(resellerMonthQty)})`}
          rightValue={
  <>
    <span className="sm:hidden">{fmtBRLNoSymbol(resellerMonthVal)}</span>
    <span className="hidden sm:inline">{fmtBRL(resellerMonthVal)}</span>
  </>
}
    footer={
  <>
    <span className="sm:hidden">
      Total: {fmtBRLNoSymbol(clientsMonthVal + resellerMonthVal)}
    </span>
    <span className="hidden sm:inline">
      Total: {fmtBRL(clientsMonthVal + resellerMonthVal)}
    </span>
  </>
}

        />

        <MetricCardView
          title="A Receber (Ativos)"
          accent="amber"
          leftLabel={`Clientes (${fmtInt(toReceiveQty)})`}
          leftValue={
  <>
    <span className="sm:hidden">{fmtBRLNoSymbol(toReceiveVal)}</span>
    <span className="hidden sm:inline">{fmtBRL(toReceiveVal)}</span>
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
    <span className="sm:hidden">{fmtBRLNoSymbol(clientsPrevMonthVal)}</span>
    <span className="hidden sm:inline">{fmtBRL(clientsPrevMonthVal)}</span>
  </>
}
          rightLabel={`Revenda (${fmtInt(resellerPrevMonthQty)})`}
          rightValue={
  <>
    <span className="sm:hidden">{fmtBRLNoSymbol(resellerPrevMonthVal)}</span>
    <span className="hidden sm:inline">{fmtBRL(resellerPrevMonthVal)}</span>
  </>
}
          footer={
  <>
    <span className="sm:hidden">Total: {fmtBRLNoSymbol(clientsPrevMonthVal + resellerPrevMonthVal)}</span>

    <span className="hidden sm:inline">Total: {fmtBRL(clientsPrevMonthVal + resellerPrevMonthVal)}</span>
  </>
}
        />
      </div>

<SectionTitle title="GRÁFICOS" />

      {/* GRÁFICOS */}
      <div className="grid grid-cols-1 gap-3 sm:gap-6 lg:grid-cols-2">



        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 sm:p-6 shadow-sm">
          <div className="flex justify-between items-center mb-2 sm:mb-4">


            <div>
              <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
  Novos clientes
</h3>

            </div>
          </div>
          <div className="w-full">
<SimpleBarChart
  data={chartRegsData}
  colorClass="from-emerald-400 to-emerald-600 ring-emerald-500"
  label="Cadastros"
  heightClass="h-40 sm:h-56"
/>

            {chartRegsData.length === 0 && (
              <div className="text-zinc-400 text-sm mt-3">Sem dados no mês atual.</div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 sm:p-6 shadow-sm">
          <div className="flex justify-between items-center mb-2 sm:mb-4">


            <div>
              <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
  Pagamentos Recebidos
</h3>

            </div>
          </div>
          <div className="w-full">
            <SimpleBarChart
              data={chartPaymentsData}
              colorClass="from-sky-400 to-blue-600 ring-blue-500"
              label="BRL"
              heightClass="h-40 sm:h-56"
            />
            {chartPaymentsData.length === 0 && (
              <div className="text-zinc-400 text-sm mt-3">Sem dados no mês atual.</div>
            )}
          </div>
        </div>
      </div>

      {/* RANKINGS */}
      <div className="grid grid-cols-1 gap-3 sm:gap-6 lg:grid-cols-2">
        <BarCard title="Top Servidores (Mês Atual)" items={topServersItems} />
        <BarCard title="Top Aplicativos (Mês Atual)" items={topAppsItems} />
      </div>
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
      <span className="text-xs font-bold tracking-widest uppercase">{title}</span>
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

  // Mapeia o diff para o slug do filtro na página de clientes
  let filterSlug = "";
  if (diff === -2) filterSlug = "venceu_2_dias";
  if (diff === -1) filterSlug = "venceu_ontem";
  if (diff === 0)  filterSlug = "vence_hoje";
  if (diff === 1)  filterSlug = "vence_amanha";
  if (diff === 2)  filterSlug = "vence_2_dias";

  return (
    <MetricCardView
      title={title}
      accent={color}
      leftLabel="Qtd"
      leftValue={fmtInt(d.qty)}
      rightLabel="Valor"
      rightValue={fmtBRL(d.amount)}
      // Passa o link se houver slug
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
  href, // <--- NOVO PROP
}: {
  title: string;
  accent: Accent;
  leftLabel: string;
  leftValue: ReactNode;
  rightLabel?: string;
  rightValue?: ReactNode;
  footer?: ReactNode;
  href?: string; // <--- TIPO NOVO
}) {

  const colors: Record<Accent, string> = {
    green:
      "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
    red:
      "border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800 text-rose-900 dark:text-rose-100",
    amber:
      "border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 text-amber-900 dark:text-amber-100",
    yellow:
      "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800 text-yellow-900 dark:text-yellow-100",
    blue:
      "border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 text-blue-900 dark:text-blue-100",
    gray:
      "border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100",
  };

  // Extraimos o conteúdo para não duplicar código
  const content = (
    <>
      <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-black/5 dark:border-white/5 font-bold text-[13px] sm:text-sm flex justify-between items-center">
        {title}
        {/* Ícone discreto indicando link */}
        {href && <span className="opacity-40 text-xs">↗</span>}
      </div>
      <div className="p-3 sm:p-4 flex gap-2 sm:gap-4 flex-1">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-wider opacity-70 mb-1">
            {leftLabel}
          </div>
          <div className="text-[15px] sm:text-xl font-bold leading-tight whitespace-nowrap tabular-nums">
            {leftValue}
          </div>
        </div>

        {rightLabel && rightValue && (
          <div className="text-right min-w-0 flex-1">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-wider opacity-70 mb-1">
              {rightLabel}
            </div>
            <div className="text-[15px] sm:text-xl font-bold leading-tight whitespace-nowrap tabular-nums">
              {rightValue}
            </div>
          </div>
        )}
      </div>

      {footer && (
        <div className="px-3 sm:px-4 py-2 text-[11px] sm:text-xs bg-black/5 dark:bg-white/5 opacity-80">
          {footer}
        </div>
      )}
    </>
  );

  const baseClass = `rounded-xl border shadow-sm overflow-hidden flex flex-col ${colors[accent]}`;

  // Se tiver link, retorna Link. Senão, retorna div.
  if (href) {
    return (
      <Link 
        href={href} 
        target="_blank" // Nova aba
        className={`${baseClass} hover:scale-[1.02] transition-transform cursor-pointer hover:shadow-md`}
      >
        {content}
      </Link>
    );
  }

  return <div className={baseClass}>{content}</div>;
}

function BarCard({ title, items }: { title: string; items: BarItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 sm:p-6 shadow-sm">

      <h3 className="text-base sm:text-lg font-bold mb-4">{title}</h3>


      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex justify-between text-xs mb-1 font-medium">
              <span>{item.label}</span>
              <span>{fmtInt(item.value)}</span>
            </div>
            <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}

        {items.length === 0 && <div className="text-zinc-400 text-sm">Sem dados.</div>}
      </div>
    </div>
  );
}
