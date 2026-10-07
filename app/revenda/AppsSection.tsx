"use client";
// app/revenda/AppsSection.tsx
// ✅ 07/10/2026 (redesenho, pedido do Márcio): "Gerenciar clientes e
// aplicativos" do Portal da Revenda.
//   - ao abrir: sincroniza os clientes da revenda no painel (NaTV) e mostra
//     um mini dashboard;
//   - "Adicionar aplicativo": seletor de aparelho (AppPickerModal) → escolhe
//     um CLIENTE DELA (busca) → libera MAC/Key → Configurar. O M3U é montado
//     no servidor (principal/secundária) — a revenda nunca vê link nem DNS;
//   - "Ativar aplicativo": todos os apps com renovação automática paga,
//     separados por estrela, botão "Ativar" → dados do aparelho → verifica se
//     a ativação está disponível (motivo na tela, nunca em toast). Pagamento:
//     próxima etapa;
//   - abaixo: clientes configurados pelo portal com seus apps (editar,
//     checar, reconfigurar, remover, renovar GerenciaApp grátis).
// Rotas: /api/reseller-portal/apps.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw, Search, Settings, Star, Trash2, Zap } from "lucide-react";
import AppPickerModal, { type AppPickerCatalogItem } from "@/components/apps/AppPickerModal";

type Field = { id: string; type: string; label: string };
type CatalogItem = AppPickerCatalogItem & { fields?: Field[]; can_check_expiry?: boolean; window_days?: number };
type EndClient = { id: string; username: string; server_name: string | null; expires_at: string | null; status: string | null; blocked: boolean };
type Renew = { kind: "free" | "paid" | null; available_from: string | null };
type AppRow = {
  id: string;
  end_client_id: string;
  app: { id: string; name: string; icon_url: string | null };
  device_type: string | null;
  fields: (Field & { value: string })[];
  obs: string;
  expire_date: string | null;
  list_name: string | null;
  m3u_list: "principal" | "secundaria" | null;
  configured_at: string | null;
  can_check: boolean;
  license_price: number | null;
  renew: Renew;
};
type ConfiguredClient = EndClient & { missing?: boolean; apps: AppRow[] };
type Stats = {
  total: number;
  active: number;
  expired: number;
  blocked: number;
  expiring_2d: number;
  apps_configured: number;
  clients_with_apps: number;
  gerenciaapp_used: number;
  gerenciaapp_limit: number;
  synced_at: string | null;
};
type Dashboard = { stats: Stats; clients: EndClient[]; configured: ConfiguredClient[] };
type Call = (p: Record<string, unknown>) => Promise<any>;

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const dateBR = (d: string | null | undefined) => {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  if (!m) return "—";
  return m[1] === "9999" ? "Vitalício" : `${m[3]}/${m[2]}/${m[1]}`;
};
// expires_at do painel vem em UTC (timestamptz) → data no horário de SP
const tsDateBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const isExpiredTs = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();
const input =
  "w-full h-10 px-3 rounded-lg border border-border bg-transparent text-sm text-foreground outline-none focus:border-emerald-500/60 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1";

export default function AppsSection({
  session,
  supportPhone,
  resellerName,
}: {
  session: string;
  supportPhone: string | null;
  resellerName: string;
}) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [dashErr, setDashErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pickerMode, setPickerMode] = useState<"add" | "activate" | null>(null);
  const [catalogs, setCatalogs] = useState<Record<"add" | "activate", CatalogItem[] | null>>({ add: null, activate: null });
  const [deviceIcons, setDeviceIcons] = useState<Record<string, string>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [adding, setAdding] = useState<{ app: CatalogItem; deviceType: string | null } | null>(null);
  const [activating, setActivating] = useState<CatalogItem | null>(null);
  const [editing, setEditing] = useState<{ row: AppRow; client: ConfiguredClient } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, { tone: "ok" | "err"; text: string } | undefined>>({});

  const call: Call = async (payload) => {
    const r = await fetch("/api/reseller-portal/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: session, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Falha na operação.");
    return j;
  };

  async function loadDashboard(sync: boolean) {
    if (sync) setSyncing(true);
    try {
      const j = await call({ action: "dashboard", sync });
      setDash({ stats: j.stats, clients: j.clients, configured: j.configured });
      setDashErr(null);
    } catch (e: any) {
      setDashErr(e?.message || "Não foi possível carregar.");
    } finally {
      if (sync) setSyncing(false);
    }
  }

  // abre na hora com o salvo; em seguida sincroniza com o painel
  useEffect(() => {
    void loadDashboard(false).then(() => loadDashboard(true));
  }, [session]);

  async function openPicker(mode: "add" | "activate") {
    setPickerMode(mode);
    if (catalogs[mode]) return;
    setCatalogLoading(true);
    try {
      const j = await call({ action: "catalog", mode });
      setCatalogs((c) => ({ ...c, [mode]: j.data as CatalogItem[] }));
      setDeviceIcons(j.device_icons || {});
    } catch (e: any) {
      setDashErr(e?.message);
    } finally {
      setCatalogLoading(false);
    }
  }

  const activateCatalog = useMemo(() => catalogs.activate || [], [catalogs.activate]);
  // "Ativar": sem etapa de aparelho — todos os aparelhos do catálogo, separado por estrela
  const allDevices = useMemo(() => [...new Set(activateCatalog.flatMap((a) => a.device_types || []))], [activateCatalog]) as any[];

  async function rowAction(row: AppRow, action: "check" | "configure" | "remove" | "renew_free") {
    if (action === "remove" && !window.confirm(`Remover o ${row.app.name} desse cliente? A lista dele sai do aparelho (só a dele).`)) return;
    setRowBusy(`${row.id}:${action}`);
    setRowMsg((m) => ({ ...m, [row.id]: undefined }));
    try {
      const j = await call({ action, id: row.id });
      const text =
        action === "remove"
          ? ""
          : action === "configure"
            ? `Reconfigurado (lista ${j.m3u_list === "secundaria" ? "secundária" : "principal"})${j.expire_date ? ` · vence ${dateBR(j.expire_date)}` : ""}.`
            : action === "renew_free"
              ? `Renovado${j.expire_date ? ` até ${dateBR(j.expire_date)}` : ""}.`
              : j.expire_date
                ? `Vencimento: ${dateBR(j.expire_date)}.`
                : j.is_trial
                  ? "Aparelho em modo de avaliação (sem licença ativa)."
                  : "O parceiro não informou vencimento.";
      if (text) setRowMsg((m) => ({ ...m, [row.id]: { tone: "ok", text } }));
      await loadDashboard(false);
    } catch (e: any) {
      setRowMsg((m) => ({ ...m, [row.id]: { tone: "err", text: e?.message } }));
    } finally {
      setRowBusy(null);
    }
  }

  const st = dash?.stats;
  const supportDigits = String(supportPhone || "").replace(/\D/g, "");
  const gaFull = !!st && st.gerenciaapp_used >= st.gerenciaapp_limit;

  return (
    <div className="space-y-3 sm:space-y-4 px-3 sm:px-0">
      {/* topo: título + 2 botões */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Gerenciar clientes e aplicativos</h1>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            {syncing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Atualizando seus clientes no painel...
              </>
            ) : st?.synced_at ? (
              `Clientes atualizados ${new Date(st.synced_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            ) : (
              "Seus clientes e os aplicativos configurados por aqui."
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            onClick={() => void openPicker("activate")}
            className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold inline-flex items-center justify-center gap-1.5"
          >
            <Zap className="w-4 h-4 fill-current" /> Ativar aplicativo
          </button>
          <button
            onClick={() => void openPicker("add")}
            className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Adicionar aplicativo
          </button>
        </div>
      </div>

      {dashErr && <div className="text-sm rounded-lg px-3 py-2 bg-rose-500/10 text-rose-600">{dashErr}</div>}

      {/* mini dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <StatTile label="Clientes" value={st?.total} tone="slate" />
        <StatTile label="Ativos" value={st?.active} tone="emerald" />
        <StatTile label="Vencidos" value={st?.expired} tone="rose" />
        <StatTile label="Vencem em 2 dias" value={st?.expiring_2d} tone="amber" />
        <StatTile label="Apps configurados" value={st?.apps_configured} tone="sky" />
        <StatTile
          label="GerenciaApp"
          value={st ? `${st.gerenciaapp_used}/${st.gerenciaapp_limit}` : undefined}
          tone={gaFull ? "rose" : "violet"}
          hint={gaFull ? "limite atingido" : "aparelhos em uso"}
        />
      </div>

      {/* clientes configurados pelo portal */}
      <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
        <div className="bg-muted/50 px-3 sm:px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Clientes com aplicativo configurado</h2>
          {dash && <span className="text-xs text-muted-foreground">{dash.configured.length}</span>}
        </div>
        <div className="p-3 sm:p-4">
          {!dash ? (
            <p className="text-sm text-muted-foreground animate-pulse">Carregando...</p>
          ) : dash.configured.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum aplicativo configurado ainda. Toque em <b>Adicionar aplicativo</b>, escolha o app, o seu cliente e configure.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {dash.configured.map((c) => (
                <div key={c.id} className="rounded-xl border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-muted/40 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-foreground truncate">{c.username}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.server_name || "—"}
                        {c.missing ? " · não aparece mais no painel" : ""}
                      </div>
                    </div>
                    <ClientBadge c={c} />
                  </div>
                  <div className="divide-y divide-border">
                    {c.apps.map((a) => {
                      const busy = (k: string) => rowBusy === `${a.id}:${k}`;
                      const anyBusy = !!rowBusy;
                      const msg = rowMsg[a.id];
                      const renewOpen = !!a.renew.kind && !a.renew.available_from;
                      return (
                        <div key={a.id} className="p-3 space-y-2">
                          <div className="flex items-center gap-3">
                            {a.app.icon_url ? (
                              <img src={a.app.icon_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-border" />
                            ) : (
                              <div className="w-9 h-9 rounded-lg border border-border flex items-center justify-center">📱</div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-foreground truncate">
                                {a.app.name}
                                {a.obs ? <span className="font-normal text-muted-foreground"> ({a.obs})</span> : null}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate font-mono">
                                {a.fields.map((f) => f.value).filter(Boolean).join(" · ") || "—"}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vencimento</div>
                              <div className="text-sm font-semibold text-foreground">{dateBR(a.expire_date)}</div>
                            </div>
                          </div>
                          {msg && (
                            <div className={`text-xs rounded-lg px-2.5 py-1.5 ${msg.tone === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-600"}`}>
                              {msg.text}
                            </div>
                          )}
                          {a.renew.kind && (
                            <p className="text-[11px] text-muted-foreground">
                              {a.renew.available_from === "9999-12-31"
                                ? "Licença vitalícia."
                                : a.renew.available_from
                                  ? `Renovação libera em ${dateBR(a.renew.available_from)}.`
                                  : a.renew.kind === "free"
                                    ? "Renovação disponível (grátis)."
                                    : `Renovação disponível${a.license_price ? ` · ${brl(a.license_price)}/ano` : ""} — pagamento pelo portal em breve.`}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {renewOpen && a.renew.kind === "free" && (
                              <RowBtn tone="emerald" onClick={() => void rowAction(a, "renew_free")} disabled={anyBusy} busy={busy("renew_free")}>
                                Renovar grátis
                              </RowBtn>
                            )}
                            {a.can_check && (
                              <RowBtn tone="outline" onClick={() => void rowAction(a, "check")} disabled={anyBusy} busy={busy("check")}>
                                <RefreshCw className="w-3.5 h-3.5" /> Checar
                              </RowBtn>
                            )}
                            <RowBtn tone="sky" onClick={() => void rowAction(a, "configure")} disabled={anyBusy || !!c.missing} busy={busy("configure")}>
                              Reconfigurar
                            </RowBtn>
                            <RowBtn tone="outline" onClick={() => setEditing({ row: a, client: c })} disabled={anyBusy || !!c.missing}>
                              <Pencil className="w-3.5 h-3.5" /> Editar
                            </RowBtn>
                            <RowBtn tone="rose" onClick={() => void rowAction(a, "remove")} disabled={anyBusy} busy={busy("remove")}>
                              <Trash2 className="w-3.5 h-3.5" /> Remover
                            </RowBtn>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* suporte (WhatsApp do Márcio) */}
      {supportDigits && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm sm:text-base font-bold text-foreground">💡 Mantenha os aplicativos dos seus clientes em dia</p>
            <ul className="space-y-1.5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              <li>
                📺 Seu cliente trocou de TV ou de aplicativo? Toque em <strong className="text-foreground">Editar</strong> ou adicione o app novo.
              </li>
              <li>
                🔄 O app do cliente travou ou parou de funcionar? Toque em <strong className="text-foreground">Reconfigurar</strong> no card dele.
              </li>
              <li>💬 O problema continuou, não achou o aplicativo ou ficou com alguma dúvida? Fale com o suporte.</li>
            </ul>
          </div>
          <a
            href={`https://wa.me/${supportDigits}?text=${encodeURIComponent(
              `Olá! Sou a revenda ${resellerName}, vim do Portal da Revenda (clientes e aplicativos) e preciso de ajuda.`,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5a] text-white font-bold text-sm px-5 py-3 shadow-sm hover:shadow-md transition-all"
          >
            Falar com o suporte
          </a>
        </div>
      )}

      {/* seletor: Adicionar (por aparelho) / Ativar (todos, por estrela) */}
      <AppPickerModal
        open={pickerMode === "add"}
        onClose={() => setPickerMode(null)}
        catalog={catalogs.add || []}
        catalogLoading={catalogLoading}
        busyAppId={null}
        variant="portal"
        title="Adicionar aplicativo"
        subtitle="Em qual aparelho o seu cliente vai usar?"
        supportWhatsapp={supportPhone}
        deviceIcons={deviceIcons}
        guide={<AddGuide />}
        onSelectApp={(appId, deviceType) => {
          const app = (catalogs.add || []).find((c) => c.id === appId);
          if (!app) return;
          setPickerMode(null);
          setAdding({ app, deviceType: deviceType || null });
        }}
      />
      <AppPickerModal
        open={pickerMode === "activate"}
        onClose={() => setPickerMode(null)}
        catalog={activateCatalog}
        catalogLoading={catalogLoading}
        busyAppId={null}
        variant="portal"
        title="Ativar aplicativo"
        presetDeviceTypes={allDevices.length ? allDevices : undefined}
        actionLabel="Ativar"
        supportWhatsapp={supportPhone}
        deviceIcons={deviceIcons}
        guide={<ActivateGuide />}
        onSelectApp={(appId) => {
          const app = activateCatalog.find((c) => c.id === appId);
          if (!app) return;
          setPickerMode(null);
          setActivating(app);
        }}
      />

      {adding && dash && (
        <AddModal
          app={adding.app}
          deviceType={adding.deviceType}
          clients={dash.clients}
          gaFull={gaFull && /gerencia|gpc/i.test(adding.app.name) ? st! : null}
          call={call}
          onBack={() => {
            setAdding(null);
            setPickerMode("add");
          }}
          onClose={() => setAdding(null)}
          onDone={() => void loadDashboard(false)}
        />
      )}
      {activating && (
        <ActivateModal
          app={activating}
          call={call}
          onBack={() => {
            setActivating(null);
            setPickerMode("activate");
          }}
          onClose={() => setActivating(null)}
        />
      )}
      {editing && (
        <EditModal
          row={editing.row}
          client={editing.client}
          call={call}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void loadDashboard(false);
          }}
        />
      )}
    </div>
  );
}

function StatTile({ label, value, tone, hint }: { label: string; value: number | string | undefined; tone: string; hint?: string }) {
  const tones: Record<string, string> = {
    slate: "text-foreground",
    emerald: "text-emerald-600",
    rose: "text-rose-500",
    amber: "text-amber-600",
    sky: "text-sky-600",
    violet: "text-violet-600",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
      <div className={`text-xl sm:text-2xl font-bold mt-0.5 ${tones[tone] || ""}`}>{value ?? "—"}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ClientBadge({ c }: { c: EndClient }) {
  const expired = c.status ? c.status.toLowerCase() !== "ativo" : isExpiredTs(c.expires_at);
  return (
    <div className="text-right shrink-0">
      <span
        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
          c.blocked ? "bg-slate-500/15 text-slate-500" : expired ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-600"
        }`}
      >
        {c.blocked ? "Bloqueado" : expired ? "Vencido" : "Ativo"}
      </span>
      <div className="text-[10px] text-muted-foreground mt-0.5">vence {tsDateBR(c.expires_at)}</div>
    </div>
  );
}

function RowBtn({
  children,
  onClick,
  disabled,
  busy,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone: "sky" | "outline" | "rose" | "emerald";
}) {
  const tones = {
    sky: "bg-sky-500 hover:bg-sky-600 text-white border-transparent",
    emerald: "bg-emerald-600 hover:bg-emerald-500 text-white border-transparent",
    outline: "border-border text-foreground hover:bg-muted",
    rose: "bg-rose-500/10 border-rose-500/20 text-rose-500 hover:bg-rose-500/20",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 ${tones[tone]}`}
    >
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

function ModalShell({
  children,
  onClose,
  onBack,
  app,
  subtitle,
}: {
  children: React.ReactNode;
  onClose: () => void;
  onBack?: () => void;
  app: { name: string; icon_url?: string | null };
  subtitle: string;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {onBack && (
            <button onClick={onBack} className="w-8 h-8 rounded-lg bg-muted hover:bg-muted/70 text-foreground shrink-0" title="Escolher outro aplicativo">
              ←
            </button>
          )}
          {app.icon_url ? <img src={app.icon_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-border" /> : null}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">{app.name}</div>
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground text-lg">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function FieldInputs({
  fields,
  vals,
  setVals,
  disabled,
}: {
  fields: Field[];
  vals: Record<string, string>;
  setVals: (fn: (v: Record<string, string>) => Record<string, string>) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {fields.map((f) => (
        <div key={f.id}>
          <label className={labelCls}>{f.label}</label>
          <input
            value={vals[f.id] || ""}
            disabled={disabled}
            onChange={(e) => setVals((v) => ({ ...v, [f.id]: e.target.value }))}
            className={`${input} font-mono`}
            placeholder={f.type === "mac" ? "XX:XX:XX:XX:XX:XX" : ""}
          />
        </div>
      ))}
    </>
  );
}

/** Adicionar: escolhe o CLIENTE dela primeiro; só então libera os campos e o Configurar. */
function AddModal({
  app,
  deviceType,
  clients,
  gaFull,
  call,
  onBack,
  onClose,
  onDone,
}: {
  app: CatalogItem;
  deviceType: string | null;
  clients: EndClient[];
  gaFull: Stats | null;
  call: Call;
  onBack: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [client, setClient] = useState<EndClient | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [done, setDone] = useState(false);

  const fields = app.fields || [];
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? clients.filter((c) => c.username.toLowerCase().includes(t)) : clients).slice(0, 50);
  }, [q, clients]);
  const filled = !!client && fields.every((f) => (vals[f.id] || "").trim());

  async function configure() {
    if (!client) return;
    setBusy(true);
    setMsg(null);
    try {
      const j = await call({ action: "configure_new", end_client_id: client.id, app_id: app.id, device_type: deviceType, field_values: vals, obs });
      setMsg({
        tone: "ok",
        text: `Configurado para ${client.username}: lista ${j.list_name}${j.expire_date ? ` · app vence ${dateBR(j.expire_date)}` : j.is_trial ? " · aparelho em avaliação" : ""}.`,
      });
      setDone(true);
      onDone();
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell app={app} onBack={onBack} onClose={onClose} subtitle={`${deviceType || "Aparelho"} · configuração automática`}>
      {gaFull && (
        <div className="text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-700">
          Você já usa {gaFull.gerenciaapp_used} de {gaFull.gerenciaapp_limit} aparelhos GerenciaApp. Remova um que não usa mais ou fale com o suporte pra
          aumentar.
        </div>
      )}
      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.tone === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-600"}`}>{msg.text}</div>}

      {done ? (
        <button onClick={onClose} className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold">
          Concluir
        </button>
      ) : (
        <>
          <div>
            <label className={labelCls}>Cliente</label>
            {client ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold text-sm text-foreground truncate">{client.username}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {client.server_name} · vence {tsDateBR(client.expires_at)}
                  </div>
                </div>
                <button onClick={() => setClient(null)} disabled={busy} className="text-xs font-semibold text-sky-600 hover:underline">
                  Trocar
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-border">
                <div className="relative border-b border-border">
                  <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="w-full h-10 pl-9 pr-3 bg-transparent text-sm text-foreground outline-none"
                    placeholder="Buscar pelo usuário do cliente"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-border">
                  {filtered.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-3">
                      {clients.length === 0 ? "Nenhum cliente encontrado no seu painel." : "Nenhum cliente com esse usuário."}
                    </p>
                  ) : (
                    filtered.map((c) => (
                      <button key={c.id} onClick={() => setClient(c)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted">
                        <span className="font-mono text-sm text-foreground truncate">{c.username}</span>
                        <ClientBadge c={c} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {!client && <p className="text-[11px] text-muted-foreground">Escolha o cliente pra liberar os dados do aparelho.</p>}
          <FieldInputs fields={fields} vals={vals} setVals={setVals} disabled={!client || busy} />
          <div>
            <label className={labelCls}>
              Ambiente <span className="normal-case font-medium">(opcional)</span>
            </label>
            <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={120} disabled={!client || busy} className={input} placeholder="Ex.: TV da sala" />
          </div>
          <button
            onClick={() => void configure()}
            disabled={busy || !filled}
            className="w-full h-11 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Configurando...
              </>
            ) : (
              <>
                <Settings className="w-4 h-4" /> Configurar
              </>
            )}
          </button>
        </>
      )}
    </ModalShell>
  );
}

/** Ativar: só os dados do aparelho → disponibilidade (motivo NA TELA). */
function ActivateModal({ app, call, onBack, onClose }: { app: CatalogItem; call: Call; onBack: () => void; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);
  const fields = app.fields || [];
  const filled = fields.every((f) => (vals[f.id] || "").trim());

  async function check() {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await call({ action: "activate_check", app_id: app.id, field_values: vals }));
    } catch (e: any) {
      setErr(e?.message);
    } finally {
      setBusy(false);
    }
  }

  const lifetime = res?.available_from === "9999-12-31" || /^9999/.test(String(res?.expire_date || ""));
  return (
    <ModalShell app={app} onBack={onBack} onClose={onClose} subtitle={`Ativação${app.license_price ? ` · ${brl(Number(app.license_price))}/ano` : ""}`}>
      <FieldInputs
        fields={fields}
        vals={vals}
        setVals={(fn) => {
          setRes(null);
          setVals(fn);
        }}
        disabled={busy}
      />

      {err && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600">
          <b>Não foi possível verificar.</b> {err}
        </div>
      )}

      {res &&
        (res.available && !lifetime ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <p className="text-sm font-bold text-emerald-700">✅ Ativação disponível</p>
            <p className="text-xs text-muted-foreground">
              {res.checked
                ? res.expire_date
                  ? `Licença atual vence em ${dateBR(res.expire_date)}.`
                  : res.is_trial
                    ? "O aparelho está em avaliação (sem licença ativa)."
                    : "O aparelho está sem licença ativa."
                : "Não conseguimos consultar o vencimento desse aplicativo antes. Confira no app do cliente: se o aparelho já tiver licença ativa, a ativação é feita do mesmo jeito e o valor não é devolvido."}
            </p>
            <button disabled className="w-full h-11 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-60">
              Pagar {res.price ? brl(Number(res.price)) : ""} e ativar
            </button>
            <p className="text-[11px] text-muted-foreground text-center">O pagamento pelo portal entra na próxima atualização.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
            <p className="text-sm font-bold text-amber-700">⏳ Ativação não disponível</p>
            <p className="text-xs text-muted-foreground">
              {lifetime
                ? "Esse aparelho já tem licença vitalícia — não precisa ativar."
                : `A licença desse aparelho vence em ${dateBR(res.expire_date)}. A ativação libera ${res.window_days} dias antes do vencimento, a partir de ${dateBR(res.available_from)}.`}
            </p>
          </div>
        ))}

      {!res && (
        <button
          onClick={() => void check()}
          disabled={busy || !filled}
          className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Verificando...
            </>
          ) : (
            "Verificar disponibilidade"
          )}
        </button>
      )}
    </ModalShell>
  );
}

/** Editar dados do app (campos + Ambiente) e reconfigurar. */
function EditModal({
  row,
  client,
  call,
  onClose,
  onDone,
}: {
  row: AppRow;
  client: ConfiguredClient;
  call: Call;
  onClose: () => void;
  onDone: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(row.fields.map((f) => [f.id, f.value])));
  const [obs, setObs] = useState(row.obs || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const filled = row.fields.every((f) => (vals[f.id] || "").trim());

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await call({ action: "update", id: row.id, field_values: vals, obs });
      onDone();
    } catch (e: any) {
      setErr(e?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell app={row.app} onClose={onClose} subtitle={`Cliente ${client.username}`}>
      {err && <div className="text-sm rounded-lg px-3 py-2 bg-rose-500/10 text-rose-600">{err}</div>}
      <FieldInputs fields={row.fields} vals={vals} setVals={setVals} disabled={busy} />
      <div>
        <label className={labelCls}>
          Ambiente <span className="normal-case font-medium">(opcional)</span>
        </label>
        <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={120} disabled={busy} className={input} placeholder="Ex.: TV da sala" />
      </div>
      <button
        onClick={() => void save()}
        disabled={busy || !filled}
        className="w-full h-11 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {busy ? "Salvando..." : "Salvar e reconfigurar"}
      </button>
    </ModalShell>
  );
}

const Badge = ({ kind }: { kind: "config" | "renew" }) =>
  kind === "config" ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-bold text-sky-600">
      <Settings className="w-3 h-3" /> configuração automática
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-600">
      <Zap className="w-3 h-3 fill-current" /> renovação automática
    </span>
  );

function GuideShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Guia rápido
        </span>
      </div>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs sm:text-sm text-muted-foreground marker:font-bold marker:text-foreground/70">{children}</ol>
    </div>
  );
}

function AddGuide() {
  return (
    <GuideShell title="Como adicionar um aplicativo">
      <li>
        Escolha o aparelho do seu cliente. Veja quais desses aplicativos existem na <strong className="text-foreground">loja de aplicativos</strong> da TV dele
        (Samsung, LG, Roku, Android) ou do celular.
      </li>
      <li>
        Todos aqui têm <Badge kind="config" />. Quanto mais <Star className="inline w-3.5 h-3.5 fill-amber-400 text-amber-400 -mt-0.5" strokeWidth={1.5} />,
        melhor. <strong className="text-foreground">Todos têm teste grátis</strong> de alguns dias.
      </li>
      <li>
        Escolha o aplicativo e depois o <strong className="text-foreground">seu cliente</strong> na lista (ativo ou vencido).
      </li>
      <li>
        Preencha os dados que aparecem na tela do app do cliente (MAC, Device Key…) e toque em <strong className="text-foreground">Configurar</strong> — a
        lista entra com o usuário dele e já mostramos o vencimento do app.
      </li>
      <li>
        Travou? <strong className="text-foreground">Reconfigurar</strong> no card do cliente, aqui embaixo.
      </li>
    </GuideShell>
  );
}

function ActivateGuide() {
  return (
    <GuideShell title="Como ativar um aplicativo">
      <li>
        Aqui estão os aplicativos com <Badge kind="renew" />: a licença é ativada sozinha depois do pagamento.
      </li>
      <li>
        Toque em <strong className="text-foreground">Ativar</strong> e preencha os dados que aparecem na tela do app do cliente (MAC, Device Key, e-mail…).
      </li>
      <li>
        Toque em <strong className="text-foreground">Verificar disponibilidade</strong>: mostramos o vencimento atual e se a ativação já está liberada (vencido,
        ou faltando até 7 dias nos apps AtivaApp e 30 dias nos demais).
      </li>
    </GuideShell>
  );
}
