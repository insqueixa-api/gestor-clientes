"use client";

// app/admin/gerenciador/aplicativo/[id]/page.tsx
// ✅ 12/10/2026, pedido do Márcio — "Aplicativo ID", no mesmo espírito das
// páginas de Cliente/Revenda: quantos clientes usam, configuração e
// integração, pagamentos com custo e margem estimados, ativações em
// confiança e histórico de configurações. Dados: /api/admin/apps/[id]/overview
// (lib/apps/app-overview.ts). Só leitura — editar continua no catálogo.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import TierStars from "@/components/apps/TierStars";

type Overview = any;

const EVENT_LABELS: Record<string, string> = {
  added: "Adicionou",
  removed: "Removeu",
  configured: "Configurou",
  configure_failed: "Falha ao configurar",
  fields_updated: "Editou os dados",
  check_validity: "Verificou vencimento",
  check_validity_failed: "Falha ao verificar vencimento",
  removed_partner_failed: "Falha ao remover no parceiro",
};

const brl = (v: number | null | undefined, cur = "BRL") =>
  v == null ? "--" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(v);
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "--";
const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "--";
const PERIOD: Record<string, string> = { annual: "ano", monthly: "mês", lifetime: "vitalício", semiannual: "semestre", quarterly: "trimestre" };

export default function AppDetailPage() {
  const params = useParams() as any;
  const id = String(params?.id || "");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState<"ativos" | "todos">("ativos");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabaseBrowser.auth.getSession();
        const token = sess?.session?.access_token;
        const res = await fetch(`/api/admin/apps/${id}/overview`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Falha ao carregar");
        setData(json);
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar");
      }
    })();
  }, [id]);

  const users = useMemo(() => {
    const list = (data?.users || []) as any[];
    const q = search.trim().toLowerCase();
    return list
      .filter((u) => (userFilter === "ativos" ? u.client_status === "ativo" : true))
      .filter((u) => !q || [u.client_name, u.server_username, u.mac, u.ambiente].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => String(a.expiration || "9999").localeCompare(String(b.expiration || "9999")));
  }, [data, userFilter, search]);

  if (error) return <div className="p-10 text-center text-rose-500 font-medium">{error}</div>;
  if (!data) return <div className="p-10 text-center text-muted-foreground animate-pulse">Carregando...</div>;

  const { app, stats, payments, trust_activations, activity } = data;
  const today = new Date().toISOString().slice(0, 10);
  const revenue = Object.entries(stats.revenue_by_currency || {}) as [string, number][];

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {app.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={app.icon_url} alt="" className="w-14 h-14 rounded-xl object-cover border border-border shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0">📱</div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">{app.name}</h1>
              {!app.is_active && <Badge tone="rose">Inativo</Badge>}
              {app.is_hidden && <Badge tone="muted">Oculto</Badge>}
              {app.discontinued_replacement_name && <Badge tone="amber">Descontinuado → {app.discontinued_replacement_name}</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {app.tier ? <TierStars value={app.tier} size={14} /> : <span className="text-xs text-muted-foreground">Sem estrelas</span>}
              <Badge tone={app.integration_type ? "emerald" : "muted"}>
                {app.integration_type ? `⚡ ${app.integration_label || app.integration_type}` : "🔧 Configuração manual"}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/admin/gerenciador/aplicativo" className="h-9 px-3 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted inline-flex items-center">
            Voltar
          </Link>
          <Link
            href={`/admin/gerenciador/aplicativo?editar=${app.id}`}
            className="h-9 px-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm font-medium hover:bg-amber-500/20 inline-flex items-center"
          >
            Editar
          </Link>
        </div>
      </div>

      {/* Números */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Clientes usando"
          value={String(stats.active_users)}
          hint={`${stats.active_devices} aparelho(s) · ${stats.total_rows} cadastro(s) no total${stats.trial_users ? ` · ${stats.trial_users} em teste` : ""}`}
        />
        <Kpi
          label="Vencimentos"
          value={`${stats.expiring_30d} em 30 dias`}
          hint={stats.expired ? `${stats.expired} já vencido(s)` : "nenhum vencido"}
          tone={stats.expired ? "rose" : stats.expiring_30d ? "amber" : undefined}
        />
        <Kpi
          label="Pagamentos recebidos"
          value={String(stats.payments_count)}
          hint={revenue.length ? revenue.map(([c, v]) => brl(v, c)).join(" · ") : "nenhum ainda"}
        />
        <Kpi
          label="Lucro estimado"
          value={stats.estimated_profit_brl != null ? brl(stats.estimated_profit_brl) : "--"}
          hint="pagamentos em R$ − custo de cada ativação"
          tone={stats.estimated_profit_brl > 0 ? "emerald" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Preço e margem */}
        <Card title="💰 Preço e margem">
          <Row label="Preço de venda" value={app.license_price != null ? `${brl(app.license_price)} / ${PERIOD[app.license_period] || app.license_period || "--"}` : app.cost_type === "free" ? "Gratuito" : "--"} />
          <Row label="Custo por ativação" value={stats.cost_per_activation != null ? brl(stats.cost_per_activation) : "--"} sub={stats.cost_source} />
          <Row
            label="Margem por ativação"
            value={
              stats.margin_per_activation != null
                ? `${brl(stats.margin_per_activation)}${app.license_price ? ` (${Math.round((stats.margin_per_activation / app.license_price) * 100)}%)` : ""}`
                : "--"
            }
            strong
          />
          <p className="text-[11px] text-muted-foreground pt-1">Custo calculado com os preços atuais dos parceiros.</p>
        </Card>

        {/* Configuração e integração */}
        <Card title="⚙️ Configuração e integração">
          <Row label="Integração" value={app.integration_type ? `${app.integration_label || app.integration_type}${app.integration_active === false ? " (desligada)" : ""}` : "Manual"} />
          <Row
            label="Renovação da licença"
            value={
              app.appativa_app_id
                ? `Appativa${app.appativa_app_name ? ` · ${app.appativa_app_name}` : ""}`
                : String(app.integration_type || "").toUpperCase() === "DUPLECAST"
                  ? "DupleCast"
                  : String(app.integration_type || "").toUpperCase() === "GERENCIAAPP"
                    ? "GerenciaApp"
                    : "Manual"
            }
          />
          {app.partner_server && <Row label="Parceria com servidor" value={app.partner_server} />}
          <Row label="Aparelhos" value={(app.device_types || []).join(", ") || "--"} />
          <Row label="Campos pedidos" value={(app.fields || []).map((f: any) => f.label).join(", ") || "--"} />
          <Row label="Instruções no portal" value={app.has_portal_instructions ? "Sim" : "Não"} />
          <Row label="No catálogo desde" value={fmtDate(app.created_at)} />
        </Card>
      </div>

      {/* Quem usa */}
      <Card
        title={`👥 Quem usa (${users.length} aparelho${users.length === 1 ? "" : "s"})`}
        right={
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, MAC..."
              className="h-8 w-40 sm:w-56 px-2.5 bg-transparent border border-border rounded-lg text-xs text-foreground outline-none focus:border-emerald-500/50"
            />
            <div className="flex rounded-lg border border-border p-0.5 bg-muted/50">
              {(["ativos", "todos"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setUserFilter(k)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium ${userFilter === k ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
                >
                  {k === "ativos" ? "Ativos" : "Todos"}
                </button>
              ))}
            </div>
          </div>
        }
        noPad
      >
        <Table
          head={["Cliente", "Servidor", "Aparelho", "Vencimento do app"]}
          empty="Nenhum cliente."
          rows={users.map((u) => [
            <div key="c" className="flex flex-col min-w-0">
              <Link href={`/admin/cliente/${u.client_id}`} prefetch={false} className="font-medium text-foreground hover:text-emerald-500 hover:underline truncate">
                {u.client_name}
              </Link>
              {u.client_status !== "ativo" && <span className="text-[10px] text-muted-foreground">{u.client_status}</span>}
            </div>,
            <div key="s" className="flex flex-col text-xs">
              <span className="text-foreground/90">{u.server_username}</span>
              <span className="text-muted-foreground">{u.server_name}</span>
            </div>,
            <div key="d" className="flex flex-col text-xs font-mono">
              <span className="text-foreground/90">{u.mac || "--"}</span>
              <span className="text-muted-foreground font-sans">
                {[u.device_key && `Key ${u.device_key}`, u.ambiente].filter(Boolean).join(" · ")}
              </span>
            </div>,
            <span
              key="v"
              className={`text-xs font-medium px-2 py-0.5 rounded-lg ${
                u.trial_hint
                  ? "text-sky-500 bg-sky-500/10"
                  : !u.expiration
                    ? "text-muted-foreground bg-muted"
                    : u.expiration < today
                      ? "text-rose-500 bg-rose-500/10"
                      : "text-emerald-600 bg-emerald-500/10"
              }`}
            >
              {u.trial_hint ? "Avaliação" : fmtDate(u.expiration)}
            </span>,
          ])}
        />
      </Card>

      {/* Pagamentos */}
      <Card title={`🧾 Pagamentos e renovações (${payments.length})`} noPad>
        <Table
          head={["Data", "Cliente", "Valor", "Custo / margem", "Forma"]}
          empty="Nenhum pagamento desse aplicativo ainda."
          rows={payments.map((p: any) => [
            <div key="d" className="flex flex-col text-xs">
              <span className="text-foreground/90">{fmtDateTime(p.paid_at || p.created_at)}</span>
              {p.bundled && <span className="text-[10px] text-muted-foreground">junto da mensalidade</span>}
            </div>,
            <Link key="c" href={`/admin/cliente/${p.client_id}`} prefetch={false} className="text-sm font-medium text-foreground hover:text-emerald-500 hover:underline">
              {p.client_name}
            </Link>,
            <div key="v" className="flex flex-col text-xs">
              <span className={`font-semibold ${p.counted ? "text-foreground" : "text-muted-foreground line-through"}`}>{brl(p.amount, p.currency)}</span>
              {p.coupon_code && <span className="text-[10px] text-muted-foreground">cupom {p.coupon_code} (−{brl(p.discount, p.currency)})</span>}
              {!p.counted && <span className="text-[10px] text-rose-500">não contabilizado ({p.fulfillment_status || p.status})</span>}
            </div>,
            <div key="m" className="flex flex-col text-xs">
              <span className="text-muted-foreground">{p.margin != null ? `− ${brl(stats.cost_per_activation)}` : "--"}</span>
              {p.margin != null && (
                <span className={`font-semibold ${p.margin >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{brl(p.margin, p.currency)}</span>
              )}
            </div>,
            <span key="f" className="text-xs text-muted-foreground">{p.method === "manual" ? "Manual" : p.gateway || p.method || "--"}</span>,
          ])}
        />
      </Card>

      {/* Ativações em confiança */}
      {trust_activations.length > 0 && (
        <Card title={`🤝 Ativações em confiança (${trust_activations.length})`} noPad>
          <Table
            head={["Ativado em", "Cliente", "Valor", "Situação"]}
            empty=""
            rows={trust_activations.map((a: any) => [
              <span key="d" className="text-xs text-foreground/90">{fmtDate(a.activation_date || a.created_at)}</span>,
              <Link key="c" href={`/admin/cliente/${a.client_id}`} prefetch={false} className="text-sm font-medium text-foreground hover:text-emerald-500 hover:underline">
                {a.client_name}
              </Link>,
              <div key="v" className="flex flex-col text-xs">
                <span className="font-semibold text-foreground">{brl(Number(a.amount || 0), a.currency || "BRL")}</span>
                {a.meta?.coupon_code && <span className="text-[10px] text-muted-foreground">cupom {a.meta.coupon_code}</span>}
              </div>,
              <span
                key="s"
                className={`text-xs font-medium px-2 py-0.5 rounded-lg ${a.status === "OPEN" ? "text-amber-600 bg-amber-500/10" : "text-emerald-600 bg-emerald-500/10"}`}
              >
                {a.status === "OPEN" ? "Aguardando pagamento" : `Fechado em ${fmtDate(a.closed_at)}`}
              </span>,
            ])}
          />
        </Card>
      )}

      {/* Histórico de configurações */}
      <Card title={`🛠️ Histórico de configurações (${activity.length})`} noPad>
        <Table
          head={["Quando", "Cliente", "O que aconteceu"]}
          empty="Nenhum registro."
          rows={activity.map((a: any) => [
            <span key="d" className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(a.created_at)}</span>,
            a.client_id ? (
              <Link key="c" href={`/admin/cliente/${a.client_id}`} prefetch={false} className="text-sm font-medium text-foreground hover:text-emerald-500 hover:underline">
                {a.client_name}
              </Link>
            ) : (
              <span key="c" className="text-sm text-muted-foreground">—</span>
            ),
            <div key="e" className="flex flex-col text-xs">
              <span className={`font-medium ${/failed/.test(a.event) ? "text-rose-500" : "text-foreground/90"}`}>{EVENT_LABELS[a.event] || a.event}</span>
              {a.detail?.error && <span className="text-[10px] text-muted-foreground line-clamp-2" title={String(a.detail.error)}>{String(a.detail.error)}</span>}
            </div>,
          ])}
        />
      </Card>
    </div>
  );
}

function Badge({ tone, children }: { tone: "emerald" | "rose" | "amber" | "muted"; children: React.ReactNode }) {
  const c = {
    emerald: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    amber: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    muted: "bg-muted text-muted-foreground border-border",
  }[tone];
  return <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border ${c}`}>{children}</span>;
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "emerald" | "amber" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "rose" ? "text-rose-500" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg sm:text-xl font-bold ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function Card({ title, right, children, noPad }: { title: string; right?: React.ReactNode; children: React.ReactNode; noPad?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {right}
      </div>
      <div className={noPad ? "" : "p-4 space-y-2 text-sm"}>{children}</div>
    </div>
  );
}

function Row({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className={strong ? "font-bold text-foreground" : "font-medium text-foreground/90"}>{value}</span>
        {sub && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground text-[11px] uppercase sticky top-0 z-10">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((cells, i) => (
            <tr key={i} className="hover:bg-muted/30 align-top">
              {cells.map((c, k) => <td key={k} className="px-4 py-2.5">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
