"use client";
// app/admin/settings/api-server/gerenciaapp_apps_modal.tsx
//
// ✅ 03/10/2026, pedido do Márcio: "Aplicativos" do GerenciaApp — cada app do
// painel deles (nome livre + código de postagem, o ranking_app_id) e o app do
// catálogo que usa esse código. A integração (app/api/integrations/apps/
// gerenciaapp) lê daqui pelo app vinculado: app novo no painel deles = criar o
// app no catálogo, vincular aqui com o código e pronto.
//   Em uso   = tem código e app vinculado
//   Sem uso  = tem código, sem app vinculado (pode renomear/reaproveitar)
//   Pendente = sem código ainda (ex: PLAYNX, ex-GPC LG, não liberado)
import { useEffect, useMemo, useState } from "react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

type Props = {
  onClose: () => void;
  onSaved: () => void;
  onError?: (msg: string) => void;
};

type Row = {
  id?: string; // vazio = linha nova
  name: string;
  code: string; // texto no input; vazio = pendente
  app_id: string; // "" = sem vínculo
};

type CatalogApp = { id: string; name: string; integration_type: string | null };

function statusOf(r: Row): { label: string; cls: string } {
  if (!r.code.trim()) return { label: "Pendente", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" };
  if (r.app_id) return { label: "Em uso", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" };
  return { label: "Sem uso", cls: "bg-muted text-muted-foreground border-border" };
}

export default function GerenciaAppAppsModal({ onClose, onSaved, onError }: Props) {
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: list }, { data: apps }] = await Promise.all([
        supabaseBrowser
          .from("gerenciaapp_ranking_apps")
          .select("id, name, code, app_id")
          .eq("tenant_id", tenantId)
          .order("code", { ascending: true, nullsFirst: false }),
        supabaseBrowser
          .from("apps")
          .select("id, name, integration_type")
          .eq("tenant_id", tenantId)
          .order("name", { ascending: true }),
      ]);
      if (cancelled) return;
      const loaded = (list || []).map((r: any) => ({
        id: r.id,
        name: r.name || "",
        code: r.code == null ? "" : String(r.code),
        app_id: r.app_id || "",
      }));
      setRows(loaded);
      setOriginalIds(loaded.map((r) => r.id!));
      setCatalog((apps || []) as CatalogApp[]);
      setLoading(false);
    }
    if (tenantId) load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // apps ligados à integração GerenciaApp primeiro, depois o resto
  const catalogSorted = useMemo(() => {
    const isGA = (a: CatalogApp) => String(a.integration_type || "").toUpperCase() === "GERENCIAAPP";
    return [...catalog.filter(isGA), ...catalog.filter((a) => !isGA(a))];
  }, [catalog]);
  const catalogById = useMemo(() => new Map(catalog.map((a) => [a.id, a])), [catalog]);

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setError("");
  }

  function validate(): string {
    const seenApp = new Map<string, string>();
    const seenCode = new Map<string, string>();
    for (const r of rows) {
      if (!r.name.trim()) return "Todo aplicativo precisa de um nome.";
      if (r.code.trim() && !/^\d+$/.test(r.code.trim())) return `Código de "${r.name}" precisa ser um número.`;
      if (r.app_id) {
        if (seenApp.has(r.app_id)) return `O mesmo app do catálogo está vinculado em "${seenApp.get(r.app_id)}" e "${r.name}".`;
        seenApp.set(r.app_id, r.name);
      }
      if (r.code.trim()) {
        const c = r.code.trim();
        if (seenCode.has(c)) return `O código ${c} está repetido em "${seenCode.get(c)}" e "${r.name}".`;
        seenCode.set(c, r.name);
      }
    }
    return "";
  }

  async function handleSave() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    try {
      const keepIds = new Set(rows.filter((r) => r.id).map((r) => r.id!));
      const removed = originalIds.filter((id) => !keepIds.has(id));
      if (removed.length) {
        const { error: delErr } = await supabaseBrowser
          .from("gerenciaapp_ranking_apps")
          .delete()
          .in("id", removed)
          .eq("tenant_id", tenantId);
        if (delErr) throw delErr;
      }
      // solta os vínculos antes de regravar (índice único por app evita
      // conflito quando um app troca de linha)
      const existing = rows.filter((r) => r.id);
      if (existing.length) {
        const { error: clrErr } = await supabaseBrowser
          .from("gerenciaapp_ranking_apps")
          .update({ app_id: null })
          .in("id", existing.map((r) => r.id!))
          .eq("tenant_id", tenantId);
        if (clrErr) throw clrErr;
      }
      for (const r of rows) {
        const payload = {
          tenant_id: tenantId,
          name: r.name.trim(),
          code: r.code.trim() ? Number(r.code.trim()) : null,
          app_id: r.app_id || null,
          updated_at: new Date().toISOString(),
        };
        const { error: upErr } = r.id
          ? await supabaseBrowser.from("gerenciaapp_ranking_apps").update(payload).eq("id", r.id).eq("tenant_id", tenantId)
          : await supabaseBrowser.from("gerenciaapp_ranking_apps").insert(payload);
        if (upErr) throw upErr;
      }
      onSaved();
    } catch (e: any) {
      const msg = e?.message || "Erro ao salvar.";
      setError(msg);
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }

  const input =
    "w-full h-9 rounded-lg border border-border bg-transparent px-2.5 text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors";

  return (
    <Modal onClose={onClose} maxWidth="max-w-4xl">
      <ModalHeader onClose={onClose}>
        <h2 className="text-lg font-medium text-foreground tracking-tight">Aplicativos do GerenciaApp</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Código de postagem (ranking_app_id) de cada app do painel. A integração usa o código do app vinculado.
        </p>
      </ModalHeader>

      <ModalBody className="p-4 sm:p-6 space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-6">Carregando...</div>
        ) : (
          <>
            <div className="hidden sm:grid grid-cols-[1fr_90px_1fr_86px_32px] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <span>Nome no GerenciaApp</span>
              <span>Código</span>
              <span>App do catálogo</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map((r, i) => {
              const st = statusOf(r);
              const linked = r.app_id ? catalogById.get(r.app_id) : null;
              const notLinkedToIntegration =
                linked && String(linked.integration_type || "").toUpperCase() !== "GERENCIAAPP";
              return (
                <div key={r.id || `new-${i}`} className="rounded-lg border border-border p-2 sm:p-1.5 sm:border-0">
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_90px_1fr_86px_32px] gap-2 items-center">
                    <input
                      className={`${input} col-span-2 sm:col-span-1`}
                      value={r.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                      placeholder="Ex: PLAYNX"
                    />
                    <input
                      className={`${input} font-mono`}
                      value={r.code}
                      onChange={(e) => update(i, { code: e.target.value.replace(/\D/g, "") })}
                      placeholder="—"
                      inputMode="numeric"
                    />
                    <select
                      className={`${input} cursor-pointer`}
                      value={r.app_id}
                      onChange={(e) => update(i, { app_id: e.target.value })}
                    >
                      <option value="">— sem vínculo —</option>
                      {catalogSorted.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <span
                      className={`inline-flex justify-center items-center text-[10px] font-medium border px-2 py-1 rounded-full uppercase ${st.cls}`}
                    >
                      {st.label}
                    </span>
                    <button
                      type="button"
                      title="Remover da lista"
                      onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                      className="h-8 w-8 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors justify-self-end"
                    >
                      ✕
                    </button>
                  </div>
                  {notLinkedToIntegration && (
                    <p className="text-[11px] text-amber-500 mt-1 px-1">
                      ⚠️ "{linked!.name}" não está com a integração GerenciaApp no catálogo — ligue na tela de Aplicativos pra configurar automático.
                    </p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { name: "", code: "", app_id: "" }])}
              className="w-full h-10 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              + Adicionar aplicativo
            </button>
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-sm text-rose-500">{error}</div>
            )}
          </>
        )}
      </ModalBody>

      <ModalFooter className="space-y-3">
        <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-lg text-xs text-sky-500">
          ℹ️ App vinculado <strong>sem código</strong> (Pendente) trava o Configurar com aviso claro — nunca chuta um código.
          Trocar o código de um app <strong>Em uso</strong> vale para as próximas configurações (os MACs já criados no painel não mudam).
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium shadow-lg shadow-emerald-900/20 transition-all"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
