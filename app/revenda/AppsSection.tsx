"use client";
// app/revenda/AppsSection.tsx
// ✅ 07/10/2026: "Meus Aplicativos" do Portal da Revenda (etapa A).
// Usa o MESMO seletor de apps do portal do cliente (AppPickerModal) — pedido
// do Márcio: "traga o módulo, depois ajustamos". Rotas: /api/reseller-portal/apps.
// Pagamento da licença (PIX) entra na etapa B; até lá GerenciaApp fica com o
// Configurar bloqueado ("paga antes de configurar").
import { useEffect, useState } from "react";
import AppPickerModal, { type AppPickerCatalogItem } from "@/components/apps/AppPickerModal";

type CatalogItem = AppPickerCatalogItem & { fields?: { id: string; type: string; label: string }[] };
type Row = {
  id: string;
  client_label: string;
  app: { id: string; name: string; icon_url: string | null };
  device_type: string | null;
  fields: { id: string; type: string; label: string; value: string }[];
  expire_date: string | null;
  m3u_username: string | null;
  server_name: string | null;
  list_name: string | null;
  configured_at: string | null;
  license_price: number | null;
  license_paid_until: string | null;
  configure_blocked: boolean;
  can_check: boolean;
};

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const dateBR = (d: string | null) => {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  if (!m) return "—";
  return m[1] === "9999" ? "Vitalício" : `${m[3]}/${m[2]}/${m[1]}`;
};

export default function AppsSection({ session, supportPhone }: { session: string; supportPhone: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [deviceIcons, setDeviceIcons] = useState<Record<string, string>>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState<{ app: CatalogItem; deviceType: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function call(payload: Record<string, unknown>) {
    const r = await fetch("/api/reseller-portal/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: session, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Falha na operação.");
    return j;
  }

  async function loadList() {
    try {
      const j = await call({ action: "list" });
      setRows(j.data as Row[]);
    } catch (e: any) {
      setRows([]);
      setMsg({ tone: "err", text: e?.message });
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function openPicker() {
    setPickerOpen(true);
    if (catalog.length) return;
    setCatalogLoading(true);
    try {
      const j = await call({ action: "catalog" });
      setCatalog(j.data as CatalogItem[]);
      setDeviceIcons(j.device_icons || {});
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message });
    } finally {
      setCatalogLoading(false);
    }
  }

  async function act(row: Row, action: "configure" | "check" | "remove") {
    if (action === "remove" && !window.confirm(`Remover ${row.app.name} de ${row.client_label}? A lista dele sai do aparelho (só a dele).`)) return;
    setBusy(`${row.id}:${action}`);
    setMsg(null);
    try {
      const j = await call({ action, id: row.id });
      setMsg({
        tone: "ok",
        text:
          action === "configure"
            ? `Configurado: lista ${j.list_name}${j.expire_date ? ` · vence ${dateBR(j.expire_date)}` : ""}.`
            : action === "check"
              ? j.expire_date
                ? `Vencimento: ${dateBR(j.expire_date)}.`
                : j.is_trial
                  ? "Aparelho em modo de avaliação (sem licença ativa)."
                  : "O parceiro não informou vencimento."
              : "Removido.",
      });
      await loadList();
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
        <div className="bg-muted/50 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">📱 Aplicativos dos seus clientes</h2>
          <button
            onClick={() => void openPicker()}
            className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
          >
            + Adicionar aplicativo
          </button>
        </div>
        <div className="p-3 sm:p-4 space-y-3">
          {msg && (
            <div className={`text-sm rounded-lg px-3 py-2 ${msg.tone === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-600"}`}>
              {msg.text}
            </div>
          )}
          {rows === null ? (
            <p className="text-sm text-muted-foreground animate-pulse">Carregando...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum aplicativo ainda. Toque em <b>+ Adicionar aplicativo</b>, escolha o app do seu cliente e informe o MAC e o link M3U dele.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rows.map((r) => (
                <div key={r.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    {r.app.icon_url ? (
                      <img src={r.app.icon_url} alt={r.app.name} className="w-10 h-10 rounded-lg object-cover border border-border" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg border border-border flex items-center justify-center">📱</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-foreground truncate">{r.client_label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.app.name}
                        {r.device_type ? ` · ${r.device_type}` : ""} · {r.m3u_username || "—"}
                        {r.server_name ? ` (${r.server_name})` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vencimento</div>
                      <div className="text-sm font-semibold text-foreground">{dateBR(r.expire_date)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {r.fields.map((f) => (
                      <div key={f.id} className="rounded-lg bg-muted px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.label}</div>
                        <div className="font-mono text-foreground truncate">{f.value || "—"}</div>
                      </div>
                    ))}
                  </div>
                  {r.configure_blocked && (
                    <p className="text-[11px] text-amber-600">
                      Licença {r.license_price ? `${brl(r.license_price)}/ano` : ""} — pague a licença para liberar o Configurar (pagamento pelo portal em breve).
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => void act(r, "configure")}
                      disabled={!!busy || r.configure_blocked}
                      className="h-9 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold disabled:opacity-50"
                    >
                      {busy === `${r.id}:configure` ? "Configurando..." : r.configured_at ? "Reconfigurar" : "Configurar m3u"}
                    </button>
                    <button
                      onClick={() => void act(r, "check")}
                      disabled={!!busy || !r.can_check}
                      className="h-9 rounded-lg border border-border text-emerald-600 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                    >
                      {busy === `${r.id}:check` ? "Verificando..." : "Verificar"}
                    </button>
                    <button
                      onClick={() => void act(r, "remove")}
                      disabled={!!busy}
                      className="h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      {busy === `${r.id}:remove` ? "Removendo..." : "Remover"}
                    </button>
                  </div>
                  {r.license_price != null && !r.configure_blocked && (
                    <p className="text-[10px] text-muted-foreground">Licença: {brl(r.license_price)}/ano</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AppPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        catalog={catalog}
        catalogLoading={catalogLoading}
        busyAppId={null}
        variant="portal"
        supportWhatsapp={supportPhone}
        deviceIcons={deviceIcons}
        onSelectApp={(appId, deviceType) => {
          const app = catalog.find((c) => c.id === appId);
          if (!app) return;
          setPickerOpen(false);
          setAdding({ app, deviceType: deviceType || null });
        }}
      />

      {adding && (
        <AddAppModal
          app={adding.app}
          deviceType={adding.deviceType}
          onClose={() => setAdding(null)}
          onSave={async (payload) => {
            await call({ action: "add", app_id: adding.app.id, device_type: adding.deviceType, ...payload });
            setAdding(null);
            setMsg({ tone: "ok", text: "Aplicativo adicionado. Agora toque em Configurar m3u." });
            await loadList();
          }}
        />
      )}
    </div>
  );
}

function AddAppModal({
  app,
  deviceType,
  onClose,
  onSave,
}: {
  app: CatalogItem;
  deviceType: string | null;
  onClose: () => void;
  onSave: (p: { client_label: string; m3u_url: string; field_values: Record<string, string> }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [m3u, setM3u] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      await onSave({ client_label: label.trim(), m3u_url: m3u.trim(), field_values: vals });
    } catch (e: any) {
      setErr(e?.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full h-10 px-3 rounded-lg border border-border bg-transparent text-sm text-foreground outline-none focus:border-emerald-500/60";
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {app.icon_url ? <img src={app.icon_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-border" /> : null}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground truncate">{app.name}</div>
            <div className="text-xs text-muted-foreground">
              {deviceType || "Aparelho"}
              {app.license_price ? ` · licença ${brl(Number(app.license_price))}/ano` : ""}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-muted text-muted-foreground text-lg">×</button>
        </div>
        <div className="p-4 space-y-3">
          {err && <div className="text-sm rounded-lg px-3 py-2 bg-rose-500/10 text-rose-600">{err}</div>}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Nome do seu cliente</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={input} placeholder="Ex: João da Silva" />
          </div>
          {(app.fields || []).map((f) => (
            <div key={f.id}>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">{f.label}</label>
              <input
                value={vals[f.id] || ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.id]: e.target.value }))}
                className={`${input} font-mono`}
                placeholder={f.type === "mac" ? "XX:XX:XX:XX:XX:XX" : ""}
              />
            </div>
          ))}
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Link M3U do cliente</label>
            <input value={m3u} onChange={(e) => setM3u(e.target.value)} className={`${input} font-mono text-xs`} placeholder="http://…/get.php?username=…&password=…" />
            <p className="text-[10px] text-muted-foreground mt-1">O usuário do link vira o nome da lista no aparelho (ex.: usuario_NaTV).</p>
          </div>
          <button
            onClick={() => void save()}
            disabled={saving || !label.trim() || !m3u.trim()}
            className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Adicionar"}
          </button>
        </div>
      </div>
    </div>
  );
}
