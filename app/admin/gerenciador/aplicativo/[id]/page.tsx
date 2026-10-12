"use client";

// app/admin/gerenciador/aplicativo/[id]/page.tsx
// ✅ 12/10/2026, pedido do Márcio — "Aplicativo ID", no mesmo espírito das
// páginas de Cliente/Revenda: quantos clientes usam, configuração e
// integração, pagamentos com custo e margem estimados, ativações em
// confiança e histórico de configurações. Dados: /api/admin/apps/[id]/overview
// (lib/apps/app-overview.ts). Só leitura — editar continua no catálogo.
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, CheckCircle2, Copy, CreditCard, ExternalLink, Loader2, Pencil } from "lucide-react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import TierStars from "@/components/apps/TierStars";
import type { ClientData } from "@/app/admin/cliente/novo_cliente";

const NovoCliente = dynamic(() => import("@/app/admin/cliente/novo_cliente"), { ssr: false });

type Overview = any;

// ✅ 12/10/2026, pedido do Márcio: 50 por página, no máximo 100 por tabela
const PAGE_SIZE = 50;
const MAX_ROWS = 100;

type UserFilter = "ativos" | "renovar" | "vencendo" | "vencidos" | "todos";
const USER_FILTERS: Record<UserFilter, { label: string; test: (u: any) => boolean }> = {
  ativos: { label: "Ativos", test: (u) => u.client_status === "ativo" },
  renovar: { label: "Renovação aberta", test: (u) => !!u.renewable },
  vencendo: {
    label: "Vencem em 30 dias",
    test: (u) => u.client_status === "ativo" && u.days_left != null && u.days_left >= 0 && u.days_left <= 30,
  },
  vencidos: { label: "Vencidos", test: (u) => u.client_status === "ativo" && u.days_left != null && u.days_left < 0 },
  todos: { label: "Todos", test: () => true },
};

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
  const tenantId = useTenantId();
  const [userFilter, setUserFilter] = useState<UserFilter>("ativos");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<Record<string, number>>({});
  const pageOf = (k: string) => pages[k] || 0;
  const setPage = (k: string, p: number) => setPages((prev) => ({ ...prev, [k]: p }));
  // modal de edição do cliente, aberto na aba do aplicativo
  const [edit, setEdit] = useState<{ client: ClientData; clientAppId: string } | null>(null);
  const [openingEdit, setOpeningEdit] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // ✅ "Verificar vencimento" — mesma rota do botão do modal do cliente
  // (/api/admin/apps/check-validity, que já grava a data nova no banco).
  // Atualiza só a linha na tela, sem recarregar a página toda.
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [checkMsg, setCheckMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  async function checkValidity(u: any) {
    const key = u.client_app_id;
    setChecking((s) => ({ ...s, [key]: true }));
    setCheckMsg((s) => {
      const n = { ...s };
      delete n[key];
      return n;
    });
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch("/api/admin/apps/check-validity", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tenant_id: tenantId, client_app_id: key }),
      });
      const j = await res.json().catch(() => ({}) as any);
      if (!j?.ok) {
        setCheckMsg((s) => ({ ...s, [key]: { ok: false, text: j?.error || "Não foi possível verificar" } }));
        return;
      }
      const exp = j.expireDate ? String(j.expireDate).slice(0, 10) : null;
      const patch = j.isTrial
        ? { trial_hint: true }
        : exp
          ? { trial_hint: false, expiration: exp, days_left: daysUntilSP(exp) }
          : null;
      if (patch) {
        setData((d: any) =>
          d ? { ...d, users: d.users.map((x: any) => (x.client_app_id === key ? { ...x, ...patch, renewable: renewableAfter({ ...x, ...patch }, d.app) } : x)) } : d,
        );
      }
      setCheckMsg((s) => ({
        ...s,
        [key]: {
          ok: true,
          text: j.isTrial ? "Verificado: em avaliação" : exp ? "Verificado agora ✓" : "Painel sem data — mantida a salva",
        },
      }));
    } catch {
      setCheckMsg((s) => ({ ...s, [key]: { ok: false, text: "Falha de conexão" } }));
    } finally {
      setChecking((s) => ({ ...s, [key]: false }));
    }
  }

  // mesmo registro que a lista/página do cliente usam (views), numa ida só
  async function openEdit(clientId: string, clientAppId: string) {
    setOpeningEdit(clientAppId);
    try {
      const [a, b] = await Promise.all([
        supabaseBrowser.from("vw_clients_list_active").select("*").eq("id", clientId).maybeSingle(),
        supabaseBrowser.from("vw_clients_list_archived").select("*").eq("id", clientId).maybeSingle(),
      ]);
      const r: any = a.data ?? b.data;
      if (!r) {
        alert("Não foi possível abrir a edição deste cliente.");
        return;
      }
      setEdit({
        clientAppId,
        client: {
          id: String(r.id),
          client_name: r.client_name,
          name_prefix: r.name_prefix ?? undefined,
          username: r.username,
          server_password: r.server_password ?? undefined,
          whatsapp_e164: r.whatsapp_e164 ?? undefined,
          whatsapp_username: r.whatsapp_username ?? undefined,
          whatsapp_opt_in: r.whatsapp_opt_in ?? true,
          secondary_display_name: r.secondary_display_name ?? undefined,
          secondary_name_prefix: r.secondary_name_prefix ?? undefined,
          secondary_phone_e164: r.secondary_phone_e164 ?? undefined,
          secondary_whatsapp_username: r.secondary_whatsapp_username ?? undefined,
          dont_message_until: r.dont_message_until ?? undefined,
          server_id: String(r.server_id ?? ""),
          screens: Number(r.screens || 1),
          technology: r.technology ?? undefined,
          plan_name: r.plan_name ?? undefined,
          price_amount: r.price_amount ?? undefined,
          price_currency: r.price_currency ?? undefined,
          plan_table_id: r.plan_table_id ?? null,
          m3u_url: r.m3u_url ?? "",
          vencimento: r.vencimento ?? undefined,
          notes: r.notes ?? undefined,
          apps_names: r.apps_names ?? undefined,
        } as ClientData,
      });
    } finally {
      setOpeningEdit(null);
    }
  }

  const users = useMemo(() => {
    const list = (data?.users || []) as any[];
    const q = search.trim().toLowerCase();
    return list
      .filter((u) => USER_FILTERS[userFilter].test(u))
      .filter(
        (u) =>
          !q ||
          [u.client_name, u.server_username, u.server_name, ...(u.fields || []).map((f: any) => f.value)].some((v) =>
            String(v || "").toLowerCase().includes(q),
          ),
      )
      .sort((a, b) => String(a.expiration || "9999").localeCompare(String(b.expiration || "9999")));
  }, [data, userFilter, search]);
  const filterCounts = useMemo(() => {
    const list = (data?.users || []) as any[];
    return Object.fromEntries(
      (Object.keys(USER_FILTERS) as UserFilter[]).map((k) => [k, list.filter((u) => USER_FILTERS[k].test(u)).length]),
    ) as Record<UserFilter, number>;
  }, [data]);

  if (error) return <div className="p-10 text-center text-rose-500 font-medium">{error}</div>;
  if (!data) return <div className="p-10 text-center text-muted-foreground animate-pulse">Carregando...</div>;

  const { app, stats, payments, trust_activations, activity } = data;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // dia em SP
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
          hint={stats.has_foreign_currency && stats.fx_as_of
            ? `pagamentos (EUR/USD em R$ pela cotação de ${fmtDate(stats.fx_as_of)}) − custo de cada ativação`
            : "pagamentos em R$ − custo de cada ativação"}
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
              onChange={(e) => {
                setSearch(e.target.value);
                setPage("users", 0);
              }}
              placeholder="Buscar cliente, login, MAC, key..."
              className="h-8 w-40 sm:w-56 px-2.5 bg-transparent border border-border rounded-lg text-xs text-foreground outline-none focus:border-emerald-500/50"
            />
          </div>
        }
        noPad
      >
        <div className="px-4 py-2 border-b border-border flex flex-wrap gap-1.5">
          {(Object.keys(USER_FILTERS) as UserFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setUserFilter(k);
                setPage("users", 0);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                userFilter === k ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {USER_FILTERS[k].label} <span className="opacity-70">({filterCounts[k]})</span>
            </button>
          ))}
        </div>
        <Table
          head={["Cliente", "Aparelho", "Vencimento do app", ""]}
          empty="Nenhum cliente nesse filtro."
          rows={paged(users, pageOf("users")).map((u) => [
            <ClientCell key="c" id={u.client_id} name={u.client_name} username={u.server_username} server={u.server_name} status={u.client_status} />,
            <div key="d" className="flex flex-col gap-1">
              {(u.fields || []).length === 0 && <span className="text-xs text-muted-foreground">--</span>}
              {(u.fields || []).map((f: any) => (
                <CopyField key={f.label} label={f.label} value={f.value} mono={f.type === "mac" || f.type === "device_key"} />
              ))}
            </div>,
            <div key="v" className="flex flex-col items-start gap-1">
              <ExpiryBadge expiration={u.expiration} trial={u.trial_hint} today={today} />
              {checkMsg[u.client_app_id] && (
                <span className={`text-[10px] ${checkMsg[u.client_app_id].ok ? "text-emerald-600" : "text-rose-500"}`}>
                  {checkMsg[u.client_app_id].text}
                </span>
              )}
            </div>,
            <div key="a" className="flex items-center justify-end gap-1.5">
              {app.can_check_validity && (
                <button
                  type="button"
                  onClick={() => void checkValidity(u)}
                  disabled={!!checking[u.client_app_id]}
                  className="h-8 w-8 rounded-lg border border-border text-emerald-500 hover:bg-emerald-500/10 inline-flex items-center justify-center disabled:opacity-60"
                  title="Verificar vencimento no painel do app (grava a data nova)"
                >
                  {checking[u.client_app_id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                </button>
              )}
              {u.renewable && (
                <button
                  type="button"
                  onClick={() => void openEdit(u.client_id, u.client_app_id)}
                  disabled={openingEdit === u.client_app_id}
                  className="h-8 w-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 inline-flex items-center justify-center disabled:opacity-60"
                  title={`Renovar — renovação aberta${app.renew_window_days ? ` (até ${app.renew_window_days} dias antes do vencimento)` : ""}; abre o app deste cliente com os botões de licença`}
                >
                  {openingEdit === u.client_app_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                </button>
              )}
              {app.info_url && (
                <a
                  href={app.info_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 w-8 rounded-lg border border-border text-muted-foreground hover:bg-muted inline-flex items-center justify-center"
                  title={`Abrir o site do app (${app.info_url})`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => void openEdit(u.client_id, u.client_app_id)}
                disabled={openingEdit === u.client_app_id}
                className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 inline-flex items-center justify-center disabled:opacity-60"
                title="Editar o cliente (abre na aba Aplicativos)"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>,
          ])}
        />
        <Pager total={users.length} page={pageOf("users")} onPage={(p) => setPage("users", p)} />
      </Card>

      {/* Pagamentos */}
      <Card title={`🧾 Pagamentos e renovações (${payments.length})`} noPad>
        <Table
          head={["Data", "Cliente", "Valor", "Custo / margem", "Forma"]}
          empty="Nenhum pagamento desse aplicativo ainda."
          rows={paged(payments, pageOf("payments")).map((p: any) => [
            <div key="d" className="flex flex-col text-xs">
              <span className="text-foreground/90">{fmtDateTime(p.paid_at || p.created_at)}</span>
              {p.bundled && <span className="text-[10px] text-muted-foreground">junto da mensalidade</span>}
            </div>,
            <Link key="c" href={`/admin/cliente/${p.client_id}`} prefetch={false} className="text-sm font-medium text-foreground hover:text-emerald-500 hover:underline">
              {p.client_name}
            </Link>,
            <div key="v" className="flex flex-col text-xs">
              <span className={`font-semibold ${p.counted ? "text-foreground" : "text-muted-foreground line-through"}`}>{brl(p.amount, p.currency)}</span>
              {p.currency !== "BRL" && p.amount_brl != null && <span className="text-[10px] text-muted-foreground">≈ {brl(p.amount_brl)}</span>}
              {p.coupon_code && <span className="text-[10px] text-muted-foreground">cupom {p.coupon_code} (−{brl(p.discount, p.currency)})</span>}
              {!p.counted && <span className="text-[10px] text-rose-500">não contabilizado ({p.fulfillment_status || p.status})</span>}
            </div>,
            <div key="m" className="flex flex-col text-xs">
              <span className="text-muted-foreground">{p.margin != null ? `− ${brl(stats.cost_per_activation)}` : "--"}</span>
              {p.margin != null && (
                <span className={`font-semibold ${p.margin >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{p.currency !== "BRL" ? "≈ " : ""}{brl(p.margin)}</span>
              )}
            </div>,
            <span key="f" className="text-xs text-muted-foreground">{p.method === "manual" ? "Manual" : p.gateway || p.method || "--"}</span>,
          ])}
        />
        <Pager total={payments.length} page={pageOf("payments")} onPage={(p) => setPage("payments", p)} />
      </Card>

      {/* Ativações em confiança */}
      {trust_activations.length > 0 && (
        <Card title={`🤝 Ativações em confiança (${trust_activations.length})`} noPad>
          <Table
            head={["Ativado em", "Cliente", "Valor", "Situação"]}
            fixed
            empty=""
            rows={paged(trust_activations, pageOf("trust")).map((a: any) => [
              <span key="d" className="text-xs text-foreground/90">{fmtDate(a.activation_date || a.created_at)}</span>,
              <ClientCell key="c" id={a.client_id} name={a.client_name} username={a.server_username} server={a.server_name} />,
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
          <Pager total={trust_activations.length} page={pageOf("trust")} onPage={(p) => setPage("trust", p)} />
        </Card>
      )}

      {/* Histórico de configurações */}
      <Card title={`🛠️ Histórico de configurações (${activity.length >= 50 ? "últimos 50" : activity.length})`} noPad>
        <Table
          head={["Quando", "Cliente", "Aparelho", "Vencimento do app", "O que aconteceu"]}
          fixed
          empty="Nenhum registro."
          rows={paged(activity, pageOf("activity")).map((a: any) => [
            <span key="d" className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(a.created_at)}</span>,
            a.client_id ? (
              <ClientCell key="c" id={a.client_id} name={a.client_name} username={a.server_username} server={a.server_name} />
            ) : (
              <span key="c" className="text-sm text-muted-foreground">—</span>
            ),
            <div key="m" className="flex flex-col gap-1">
              {(a.fields || []).length === 0 && <span className="text-xs text-muted-foreground">--</span>}
              {(a.fields || []).map((f: any) => (
                <CopyField key={f.label} label={f.label} value={f.value} mono={f.type === "mac" || f.type === "device_key"} />
              ))}
            </div>,
            a.expiration || a.trial_hint ? (
              <div key="v" className="flex flex-col items-start gap-0.5">
                <ExpiryBadge expiration={a.expiration} trial={a.trial_hint} today={today} />
                <span className="text-[10px] text-muted-foreground">{a.expiration_at_time ? "informado na hora" : "atual"}</span>
              </div>
            ) : (
              <span key="v" className="text-xs text-muted-foreground">--</span>
            ),
            <div key="e" className="flex flex-col text-xs">
              <span className={`font-medium ${/failed/.test(a.event) ? "text-rose-500" : "text-foreground/90"}`}>
                {a.detail?.renew ? "Renovou a licença" : EVENT_LABELS[a.event] || a.event}
              </span>
              {eventDetail(a) && <span className="text-[10px] text-muted-foreground">{eventDetail(a)}</span>}
              {a.detail?.error && <span className="text-[10px] text-muted-foreground line-clamp-2" title={String(a.detail.error)}>{String(a.detail.error)}</span>}
            </div>,
          ])}
        />
        <Pager total={activity.length} page={pageOf("activity")} onPage={(p) => setPage("activity", p)} />
      </Card>

      {edit && (
        <NovoCliente
          key={`${edit.client.id}-${edit.clientAppId}`}
          clientToEdit={edit.client}
          initialTab="apps"
          focusClientAppId={edit.clientAppId}
          onClose={() => setEdit(null)}
          onSuccess={() => {
            setEdit(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// o que o registro guardou, em português (lista usada, troca de lista,
// origem, e se o MAC é o aparelho atual por dedução)
function eventDetail(a: any): string {
  const d = a.detail || {};
  const parts: string[] = [];
  if (d.lista) parts.push(`lista ${d.lista === "secundaria" ? "secundária" : d.lista}`);
  if (d.rotacionou) parts.push("trocou de lista");
  if (d.source === "admin") parts.push("pelo admin");
  else if (String(d.source || "").startsWith("portal")) parts.push("pelo portal");
  if (Array.isArray(d.fields) && d.fields.length) parts.push(`campos: ${d.fields.join(", ")}`);
  if (a.device_guess) parts.push("aparelho atual do cliente");
  return parts.join(" · ");
}

// mesma regra de lib/apps/app-overview.ts (janela de renovação), refeita
// na linha depois de "Verificar vencimento" trazer a data nova
const daysUntilSP = (d: string) => {
  const todaySP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const n = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todaySP}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(n) ? n : null;
};
const renewableAfter = (u: any, app: any) =>
  app.renew_window_days != null &&
  u.client_status === "ativo" &&
  (u.trial_hint || u.days_left == null || u.days_left <= app.renew_window_days);

// página fora do alcance (a lista encolheu depois de salvar) cai na última
const clampPage = (total: number, page: number) => Math.max(0, Math.min(page, Math.ceil(Math.min(total, MAX_ROWS) / PAGE_SIZE) - 1));

function paged<T>(list: T[], page: number): T[] {
  const p = clampPage(list.length, page);
  return list.slice(0, MAX_ROWS).slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
}

function Pager({ total, page: rawPage, onPage }: { total: number; page: number; onPage: (p: number) => void }) {
  const page = clampPage(total, rawPage);
  const shown = Math.min(total, MAX_ROWS);
  const pageCount = Math.ceil(shown / PAGE_SIZE);
  if (pageCount <= 1 && total <= MAX_ROWS) return null;
  return (
    <div className="px-4 py-2 border-t border-border flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {page * PAGE_SIZE + 1}–{Math.min(shown, (page + 1) * PAGE_SIZE)} de {shown}
        {total > MAX_ROWS ? ` (mostrando os ${MAX_ROWS} primeiros de ${total} — use a busca/filtros)` : ""}
      </span>
      <div className="flex gap-1">
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPage(i)}
            className={`h-7 min-w-7 px-2 rounded-md border text-xs font-medium ${
              i === page ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600" : "border-border hover:bg-muted"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClientCell({ id, name, username, server, status }: { id: string; name: string; username?: string | null; server?: string | null; status?: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <Link href={`/admin/cliente/${id}`} prefetch={false} className="font-medium text-sm text-foreground hover:text-emerald-500 hover:underline truncate">
        {name}
      </Link>
      <span className="text-xs text-muted-foreground truncate">
        {[username && username !== "—" ? username : null, server && server !== "—" ? server : null].filter(Boolean).join(" · ") || "--"}
      </span>
      {status && status !== "ativo" && <span className="text-[10px] text-muted-foreground">{status}</span>}
    </div>
  );
}

function ExpiryBadge({ expiration, trial, today }: { expiration: string | null; trial?: boolean; today: string }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-lg whitespace-nowrap ${
        trial
          ? "text-sky-500 bg-sky-500/10"
          : !expiration
            ? "text-muted-foreground bg-muted"
            : expiration < today
              ? "text-rose-500 bg-rose-500/10"
              : "text-emerald-600 bg-emerald-500/10"
      }`}
    >
      {trial ? "Avaliação" : fmtDate(expiration)}
    </span>
  );
}

// valor + botão de copiar (MAC, key, e-mail, senha... os campos do app)
function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="group/cp flex items-center gap-1.5 text-left text-xs min-w-0"
      title={`Copiar ${label}`}
    >
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className={`text-foreground/90 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-500 shrink-0" />
      ) : (
        <Copy className="w-3 h-3 text-muted-foreground/50 group-hover/cp:text-emerald-500 shrink-0" />
      )}
    </button>
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

// fixed: colunas repartidas por igual na largura toda (pedido do Márcio)
function Table({ head, rows, empty, fixed }: { head: string[]; rows: React.ReactNode[][]; empty: string; fixed?: boolean }) {
  if (!rows.length) return <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
      <table className={`w-full text-left text-sm ${fixed ? "table-fixed min-w-[720px]" : ""}`}>
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
