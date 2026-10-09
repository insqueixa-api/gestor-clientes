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

type Sibling = {
  id: string;
  display_name: string | null;
  server_username: string | null;
  server_name: string;
  server_logo_url: string | null;
  status: string;
  vencimento: string | null;
  created_at: string | null;
};

type Preview = {
  renewals: number;
  portal_payments: number;
  events: number;
  alerts: number;
  open_alerts: number;
  apps: number;
  apps_new: number;
  apps_existing: number;
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
    .select("id, display_name, server_username, is_trial, is_archived, deep_archived_at, vencimento, created_at, servers(name, logo_url)")
    .eq("tenant_id", tenantId)
    .eq("whatsapp_username", whatsapp)
    .neq("id", clientId);
  return (data || []).map((c: any) => ({
    id: c.id,
    display_name: c.display_name,
    server_username: c.server_username,
    server_name: c.servers?.name || "sem servidor",
    server_logo_url: c.servers?.logo_url || null,
    status: c.deep_archived_at ? "Arquivado" : c.is_archived ? "Na lixeira" : c.is_trial ? "Teste" : "Ativo",
    vencimento: c.vencimento,
    created_at: c.created_at || null,
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
  current: { id: string; username: string; server_name: string; server_logo_url?: string | null; created_at?: string | null };
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
      subtitle: `${removeLabel} será excluída e o histórico vai pra ${keepLabel}. Não dá pra desfazer.`,
      details: [
        `${plural(preview.renewals, "renovação", "renovações")} · ${plural(preview.portal_payments, "pagamento", "pagamentos")} · ${plural(preview.events, "evento", "eventos")}`,
        `${plural(preview.apps_new, "app novo", "apps novos")} · ${plural(preview.apps_existing, "app que já existe", "apps que já existem")}`,
        preview.pending_jobs > 0 ? `${plural(preview.pending_jobs, "mensagem agendada cancelada", "mensagens agendadas canceladas")}` : "",
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
  const curAcc = { user: current.username, server: current.server_name, logo: current.server_logo_url || null, hint: "esta página", since: current.created_at || null };
  const othAcc = { user: other?.server_username || "—", server: other?.server_name || "—", logo: other?.server_logo_url || null, hint: other?.status || "", since: other?.created_at || null };
  const keepAcc = keepCurrent ? curAcc : othAcc;
  const removeAcc = keepCurrent ? othAcc : curAcc;
  // A conta que fica herda a data de cadastro MAIS ANTIGA das duas, seja
  // ela a que recebe ou a que envia (merge_client_accounts, passo 6).
  const oldestSince = [curAcc.since, othAcc.since].filter(Boolean).sort()[0] || null;

  return (
    <Modal onClose={onClose}>
      <ModalHeader onClose={onClose}>
        <h3 className="font-medium text-lg text-foreground">Mesclar contas</h3>
      </ModalHeader>
      <ModalBody>
        {/* Mais de uma conta irmã: escolhe qual entra na mesclagem */}
        {siblings.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setOtherId(s.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  otherId === s.id ? "border-emerald-500 bg-emerald-500/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {s.server_username || "—"} · {s.server_name}
              </button>
            ))}
          </div>
        )}

        {otherId && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-stretch gap-3">
            <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Principal (manter)</p>
              <AccountLine acc={keepAcc} />
            </div>
            <button
              type="button"
              onClick={() => setKeepCurrent((v) => !v)}
              className="self-center justify-self-center h-9 w-9 rounded-full border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Trocar qual conta fica"
            >
              ⇄
            </button>
            <div className="rounded-xl border-2 border-rose-500/30 bg-rose-500/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-rose-500">Antiga (excluir)</p>
              <AccountLine acc={removeAcc} />
            </div>
          </div>
        )}

        {loadingPreview && <p className="text-xs text-muted-foreground">Conferindo o que será movido...</p>}

        {preview && (
          <div className="rounded-xl border border-border divide-y divide-border text-sm">
            <Section title="Cadastro">
              <Row label="Data do cadastro (fica a mais antiga)" value={fmtDate(oldestSince)} />
            </Section>
            <Section title="Histórico (vai pra principal)">
              <Row
                label="Renovações"
                value={
                  preview.renewals > 0 && revenue.length > 0
                    ? `${preview.renewals} · ${revenue.map(([srv, v]) => `${srv} ${brl(Number(v))}`).join(" · ")}`
                    : String(preview.renewals)
                }
              />
              <Row label="Pagamentos no Log do Portal" value={String(preview.portal_payments)} />
              <Row label="Eventos da Linha do Tempo" value={String(preview.events)} />
              <Row
                label="Sinos"
                value={preview.open_alerts > 0 ? `${preview.alerts} (${preview.open_alerts} em aberto)` : String(preview.alerts)}
              />
            </Section>
            <Section title="Aplicativos">
              <Row label="Novos (entram com vencimento)" value={String(preview.apps_new)} />
              <Row label="Já existem (completa só o que faltar)" value={String(preview.apps_existing)} />
            </Section>
            {preview.pending_jobs > 0 && (
              <Section title="Fila do WhatsApp">
                <Row label="Mensagens agendadas pra antiga (canceladas)" value={String(preview.pending_jobs)} tone="amber" />
              </Section>
            )}
            {preview.coupon_conflicts > 0 && (
              <div className="px-4 py-3 text-xs font-medium text-rose-500">
                As duas contas usaram o mesmo cupom — mesclar liberaria o cupom de novo. Resolva o cupom antes.
              </div>
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

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function brl(v: number) {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-foreground/80">{label}</span>
      <span className={`font-semibold tabular-nums text-right ${tone === "amber" ? "text-amber-600" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

// ✅ Logo do servidor em cada lado — reduz o risco de manter/excluir a conta errada.
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function AccountLine({ acc }: { acc: { user: string; server: string; logo: string | null; hint: string; since: string | null } }) {
  return (
    <div className="mt-2 flex items-center gap-3 min-w-0">
      {acc.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={acc.logo} alt={acc.server} className="h-10 w-10 shrink-0 rounded-lg object-cover border border-border bg-card" />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded-lg border border-border bg-card flex items-center justify-center text-xs font-bold text-muted-foreground">
          {acc.server.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{acc.user}</p>
        <p className="text-xs text-muted-foreground truncate">
          {acc.server}
          {acc.hint ? ` · ${acc.hint}` : ""}
        </p>
        {acc.since && <p className="text-[11px] text-muted-foreground">Cliente desde {fmtDate(acc.since)}</p>}
      </div>
    </div>
  );
}
