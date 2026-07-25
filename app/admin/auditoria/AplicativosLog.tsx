"use client";
// app/admin/auditoria/AplicativosLog.tsx
//
// Aba "Aplicativos" da Auditoria — log de pedidos do Bloco 3 do portal
// (/renew-beta) pra apps SEM integração automática (integration_type null,
// ou handler com useApi:false como o IboSol hoje bloqueado por Cloudflare):
//   - action "setup": cliente pediu ajuda pra CONFIGURAR o app.
//   - action "removal": cliente pediu pra EXCLUIR o app (não tem como
//     desconfigurar sozinho no painel do parceiro).
// "Concluir" tem efeito diferente em cada caso: setup só marca o pedido
// como feito (você configurou por fora); removal de fato APAGA a linha em
// client_apps nesse momento (até lá o app continua na tela do cliente,
// marcado como "exclusão solicitada").
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { ConfirmDialogProps } from "@/components/ui/ConfirmDialog";

type AppRequestRow = {
  id: string;
  client_id: string;
  client_app_id: string | null;
  client_name: string;
  app_name: string;
  fields_snapshot: Record<string, string> | null;
  action: "setup" | "removal";
  status: "pending" | "done" | "cancelled";
  created_at: string;
  completed_at: string | null;
};

type ConfirmFn = (
  options: Omit<ConfirmDialogProps, "open" | "onConfirm" | "onCancel" | "loading">,
) => Promise<boolean>;

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function AplicativosLog({
  tenantId,
  addToast,
  confirm,
  onPendingCountChange,
}: {
  tenantId: string;
  addToast: (type: "success" | "error" | "warning", title: string, message?: string) => void;
  confirm: ConfirmFn;
  onPendingCountChange?: (count: number) => void;
}) {
  const [rows, setRows] = useState<AppRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<"pending" | "todos">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabaseBrowser
      .from("client_app_requests")
      .select("id, client_id, client_app_id, app_name, fields_snapshot, action, status, created_at, completed_at, clients(display_name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      const mapped = data.map((r: any) => ({
        id: r.id,
        client_id: r.client_id,
        client_app_id: r.client_app_id,
        client_name: r.clients?.display_name || "Cliente",
        app_name: r.app_name,
        fields_snapshot: r.fields_snapshot,
        action: r.action as "setup" | "removal",
        status: r.status,
        created_at: r.created_at,
        completed_at: r.completed_at,
      }));
      setRows(mapped);
      onPendingCountChange?.(mapped.filter((r) => r.status === "pending").length);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function handleConcluir(row: AppRequestRow) {
    const isRemoval = row.action === "removal";
    const ok = await confirm({
      title: isRemoval ? "Concluir exclusão" : "Concluir configuração",
      subtitle: isRemoval
        ? `Você já removeu "${row.app_name}" do painel do parceiro? Isso vai apagar o app da conta de ${row.client_name} agora.`
        : `Você já configurou "${row.app_name}" pra ${row.client_name}?`,
      tone: "emerald",
      icon: "✅",
      confirmText: "Sim, Concluir",
      cancelText: "Voltar",
    });
    if (!ok) return;

    setBusyId(row.id);
    try {
      const { data: userData } = await supabaseBrowser.auth.getUser();

      // ✅ Pedido de remoção: apaga a linha client_apps DE VERDADE agora
      // (até aqui o app ainda existia, só marcado como "exclusão
      // solicitada" pro cliente). Pedido de configuração nunca apaga nada.
      if (isRemoval && row.client_app_id) {
        const { error: delErr } = await supabaseBrowser.from("client_apps").delete().eq("id", row.client_app_id);
        if (delErr) throw delErr;
      }

      const { error } = await supabaseBrowser
        .from("client_app_requests")
        .update({ status: "done", completed_at: new Date().toISOString(), completed_by: userData?.user?.id || null })
        .eq("id", row.id);
      if (error) throw error;

      await supabaseBrowser.rpc("resolve_notification", {
        p_tenant_id: tenantId,
        p_type: isRemoval ? "app_removal_pending" : "app_setup_pending",
        p_source_id: row.id,
      });

      addToast("success", "Concluído!", isRemoval ? `"${row.app_name}" foi excluído.` : `"${row.app_name}" marcado como configurado.`);
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao concluir", e?.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelar(row: AppRequestRow) {
    const isRemoval = row.action === "removal";
    const ok = await confirm({
      title: "Cancelar pedido",
      subtitle: isRemoval
        ? `Cancelar o pedido de exclusão de "${row.app_name}" (${row.client_name})? O app continua na conta dele.`
        : `Cancelar o pedido de configuração de "${row.app_name}" (${row.client_name})?`,
      tone: "rose",
      icon: "🚫",
      confirmText: "Sim, Cancelar",
      cancelText: "Voltar",
    });
    if (!ok) return;

    setBusyId(row.id);
    try {
      const { error } = await supabaseBrowser
        .from("client_app_requests")
        .update({ status: "cancelled" })
        .eq("id", row.id);
      if (error) throw error;

      await supabaseBrowser.rpc("resolve_notification", {
        p_tenant_id: tenantId,
        p_type: isRemoval ? "app_removal_pending" : "app_setup_pending",
        p_source_id: row.id,
      });

      addToast("success", "Cancelado", "Pedido removido da fila.");
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao cancelar", e?.message);
    } finally {
      setBusyId(null);
    }
  }

  const visible = rows.filter((r) => (filterStatus === "pending" ? r.status === "pending" : true));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 md:px-0">
        <button
          onClick={() => setFilterStatus("pending")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            filterStatus === "pending"
              ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
              : "bg-transparent text-muted-foreground border-border hover:bg-muted"
          }`}
        >
          Pendentes ({rows.filter((r) => r.status === "pending").length})
        </button>
        <button
          onClick={() => setFilterStatus("todos")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            filterStatus === "todos"
              ? "bg-card text-emerald-500 border-emerald-500/30"
              : "bg-transparent text-muted-foreground border-border hover:bg-muted"
          }`}
        >
          Todos
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-none sm:rounded-xl border border-border">
          Carregando pedidos...
        </div>
      ) : visible.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground italic bg-card rounded-none sm:rounded-xl border border-border">
          Nenhum pedido {filterStatus === "pending" ? "pendente" : "registrado"}.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible sm:mx-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[750px]">
              <thead>
                <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Aplicativo</th>
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Campos</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-border">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      há {timeAgo(r.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{r.client_name}</td>
                    <td className="px-4 py-3 text-foreground/90">{r.app_name}</td>
                    <td className="px-4 py-3">
                      {r.action === "removal" ? (
                        <span className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-500 text-[10px] font-medium uppercase border border-rose-500/20">
                          Excluir
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-500 text-[10px] font-medium uppercase border border-sky-500/20">
                          Configurar
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(r.fields_snapshot || {})
                          .filter(([k, v]) => !k.startsWith("_config_") && String(v || "").trim())
                          .map(([k, v]) => (
                            <span
                              key={k}
                              className="px-1.5 py-0.5 bg-muted text-muted-foreground border border-border text-[10px] font-mono rounded"
                            >
                              {String(v)}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.status === "pending" && (
                        <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-500 text-[10px] font-medium uppercase border border-amber-500/20">
                          Pendente
                        </span>
                      )}
                      {r.status === "done" && (
                        <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 text-[10px] font-medium uppercase border border-emerald-500/20">
                          Concluído
                        </span>
                      )}
                      {r.status === "cancelled" && (
                        <span className="px-2 py-1 rounded-lg bg-rose-500/10 text-rose-500 text-[10px] font-medium uppercase border border-rose-500/20">
                          Cancelado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.status === "pending" ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            disabled={busyId === r.id}
                            onClick={() => handleConcluir(r)}
                            className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-emerald-500/20 disabled:opacity-50"
                          >
                            Concluir
                          </button>
                          <button
                            disabled={busyId === r.id}
                            onClick={() => handleCancelar(r)}
                            className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-rose-500/20 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/60 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
