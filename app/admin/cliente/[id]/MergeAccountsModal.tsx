"use client";

// app/admin/cliente/[id]/MergeAccountsModal.tsx
// ✅ 08/10/2026, pedido do Márcio — "Mesclar e excluir a conta antiga".
// Cliente que trocou de servidor (ex: Sandra NaTV → Fast): traz o histórico
// da conta antiga pra principal e exclui a antiga. Cada registro continua no
// servidor onde aconteceu (carimbo — docs/sql/server_snapshot_history.sql),
// então nada "pula" de servidor. Regras/travas no banco:
// docs/sql/merge_client_accounts.sql (mesmo WhatsApp, cupom em conflito
// bloqueia, tudo numa transação).
import { useEffect, useState } from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatDateBR } from "@/lib/date-br";

type Sibling = {
  id: string;
  display_name: string | null;
  server_username: string | null;
  server_name: string;
  status: string;
  vencimento: string | null;
};

type Preview = {
  renewals: number;
  portal_payments: number;
  events: number;
  alerts: number;
  open_alerts: number;
  apps: number;
  message_jobs: number;
  pending_jobs: number;
  revenue_by_server: Record<string, number>;
  coupon_conflicts: number;
};

export async function loadMergeSiblings(
  tenantId: string,
  clientId: string,
  whatsapp: string | null | undefined,
): Promise<Sibling[]> {
  if (!whatsapp) return [];
  const { data } = await supabaseBrowser
    .from("clients")
    .select("id, display_name, server_username, is_trial, is_archived, deep_archived_at, vencimento, servers(name)")
    .eq("tenant_id", tenantId)
    .eq("whatsapp_username", whatsapp)
    .neq("id", clientId);
  return (data || []).map((c: any) => ({
    id: c.id,
    display_name: c.display_name,
    server_username: c.server_username,
    server_name: c.servers?.name || "sem servidor",
    status: c.deep_archived_at ? "Arquivado" : c.is_archived ? "Na lixeira" : c.is_trial ? "Teste" : "Ativo",
    vencimento: c.vencimento,
  }));
}

export default function MergeAccountsModal({
  tenantId,
  current,
  siblings,
  onClose,
  onMerged,
  confirm,
  addToast,
}: {
  tenantId: string;
  current: { id: string; username: string; server_name: string };
  siblings: Sibling[];
  onClose: () => void;
  onMerged: (keepId: string) => void;
  confirm: (opts: any) => Promise<boolean>;
  addToast: (type: "success" | "error", title: string, msg?: string) => void;
}) {
  const [otherId, setOtherId] = useState<string>(siblings.length === 1 ? siblings[0].id : "");
  const [keepCurrent, setKeepCurrent] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);

  const other = siblings.find((s) => s.id === otherId) || null;
  const keepId = keepCurrent ? current.id : otherId;
  const removeId = keepCurrent ? otherId : current.id;
  const removeLabel = keepCurrent
    ? `${other?.server_username || "—"} (${other?.server_name || "—"})`
    : `${current.username} (${current.server_name})`;
  const keepLabel = keepCurrent
    ? `${current.username} (${current.server_name})`
    : `${other?.server_username || "—"} (${other?.server_name || "—"})`;

  useEffect(() => {
    setPreview(null);
    if (!otherId) return;
    let cancelled = false;
    (async () => {
      setLoadingPreview(true);
      const { data, error } = await supabaseBrowser.rpc("merge_client_accounts_preview", {
        p_tenant_id: tenantId,
        p_keep: keepId,
        p_remove: removeId,
      });
      if (cancelled) return;
      setLoadingPreview(false);
      if (error) {
        addToast("error", "Não deu pra conferir", error.message);
        return;
      }
      setPreview(data as Preview);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherId, keepCurrent]);

  async function handleMerge() {
    if (!otherId || !preview) return;
    if (preview.coupon_conflicts > 0) return;
    const ok = await confirm({
      tone: "rose",
      title: "Mesclar e excluir a conta antiga?",
      subtitle: `A conta ${removeLabel} será EXCLUÍDA. Todo o histórico dela vem pra ${keepLabel}, cada registro no servidor onde aconteceu. Não dá pra desfazer.`,
      details: [
        `${preview.renewals} renovação(ões) · ${preview.portal_payments} pagamento(s) no Log do Portal`,
        `${preview.events} evento(s) da Linha do Tempo · ${preview.alerts} sino(s)`,
        `${preview.apps} aplicativo(s) (sem a lista M3U do servidor antigo)`,
        preview.pending_jobs > 0 ? `${preview.pending_jobs} mensagem(ns) agendada(s) pra conta antiga serão canceladas` : "",
      ].filter(Boolean),
      confirmText: "Mesclar e excluir",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setMerging(true);
    const { error } = await supabaseBrowser.rpc("merge_client_accounts", {
      p_tenant_id: tenantId,
      p_keep: keepId,
      p_remove: removeId,
    });
    setMerging(false);
    if (error) {
      addToast("error", "Não deu pra mesclar", error.message);
      return;
    }
    addToast("success", "Contas mescladas", `Histórico trazido pra ${keepLabel}; a conta antiga foi excluída.`);
    onMerged(keepId);
  }

  const revenue = preview ? Object.entries(preview.revenue_by_server || {}) : [];

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <ModalHeader onClose={onClose}>
        <h3 className="font-medium text-lg text-foreground">Mesclar contas</h3>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Pra quando o cliente trocou de servidor e a conta antiga já foi apagada no painel. O histórico da
          conta antiga vem pra principal — <strong className="text-foreground">cada registro continua no servidor onde aconteceu</strong> — e a
          antiga é excluída. Contas paralelas ativas (uma por servidor) não devem ser mescladas.
        </p>

        <div className="space-y-1.5">
          <p className="text-xs font-bold text-foreground">Outra conta com o mesmo WhatsApp</p>
          {siblings.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setOtherId(s.id)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                otherId === s.id ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-card hover:bg-muted"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground truncate">
                  {s.server_username || "—"} <span className="font-medium text-muted-foreground">· {s.server_name}</span>
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0">{s.status}</span>
              </div>
              {s.vencimento && (
                <div className="text-[11px] text-muted-foreground mt-0.5">Vencimento {formatDateBR(s.vencimento, "")}</div>
              )}
            </button>
          ))}
        </div>

        {otherId && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-foreground">Qual conta fica?</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: `${current.username} · ${current.server_name}`, hint: "esta página" },
                { v: false, label: `${other?.server_username || "—"} · ${other?.server_name || "—"}`, hint: "a selecionada" },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setKeepCurrent(o.v)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                    keepCurrent === o.v ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  <div className="text-xs font-bold text-foreground truncate">{o.label}</div>
                  <div className="text-[10px] text-muted-foreground">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingPreview && <p className="text-xs text-muted-foreground">Conferindo o que será movido...</p>}
        {preview && (
          <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-1 text-xs text-muted-foreground">
            <p className="font-bold text-foreground">Vem da conta {removeLabel}:</p>
            <p>
              {preview.renewals} renovação(ões) · {preview.portal_payments} pagamento(s) · {preview.events} evento(s) ·{" "}
              {preview.alerts} sino(s){preview.open_alerts > 0 ? ` (${preview.open_alerts} em aberto)` : ""} · {preview.apps} app(s)
            </p>
            {revenue.length > 0 && (
              <p>
                Renovações por servidor (continuam onde foram feitas):{" "}
                {revenue.map(([srv, v]) => `${srv} R$ ${Number(v).toFixed(2).replace(".", ",")}`).join(" · ")}
              </p>
            )}
            {preview.pending_jobs > 0 && (
              <p className="text-amber-600">{preview.pending_jobs} mensagem(ns) agendada(s) pra ela serão canceladas.</p>
            )}
            {preview.coupon_conflicts > 0 && (
              <p className="text-rose-500 font-medium">
                As duas contas usaram o mesmo cupom — mesclar liberaria o cupom de novo. Resolva o cupom antes.
              </p>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleMerge}
          disabled={!preview || merging || (preview?.coupon_conflicts || 0) > 0}
          className="px-4 py-2 rounded-lg bg-rose-600 text-white font-bold text-sm hover:bg-rose-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {merging ? "Mesclando..." : "Mesclar e excluir a antiga"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
