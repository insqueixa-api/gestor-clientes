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
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { ConfirmDialogProps } from "@/components/ui/ConfirmDialog";
import Pagination from "@/components/ui/Pagination";
import { APP_FIELD_LABELS, AppFieldType } from "@/lib/apps/field-types";

type AppRequestRow = {
  id: string;
  client_id: string;
  client_app_id: string | null;
  client_name: string;
  client_whatsapp: string;
  server_username: string;
  server_name: string;
  app_name: string;
  fields_snapshot: Record<string, string> | null;
  action: "setup" | "removal";
  status: "pending" | "done" | "cancelled";
  created_at: string;
  completed_at: string | null;
};

// ✅ client_app_activity_log (docs/sql/client_app_activity_log.sql) — cobre
// os eventos que client_app_requests não vê: adicionar, remover app com
// integração automática, configurar (sucesso/falha), editar campos,
// verificar validade. Auditado em 25/07/2026.
type ActivityEvent =
  | "added"
  | "removed"
  | "removed_partner_failed"
  | "configured"
  | "configure_failed"
  | "fields_updated"
  | "check_validity"
  | "check_validity_failed";

type ActivityRow = {
  id: string;
  client_name: string;
  client_whatsapp: string;
  server_username: string;
  server_name: string;
  app_name: string;
  event: ActivityEvent;
  detail: Record<string, any> | null;
  created_at: string;
};

const ACTIVITY_LABELS: Record<ActivityEvent, { label: string; tone: string }> = {
  added: { label: "Adicionou", tone: "bg-sky-500/10 text-sky-500 border-sky-500/20" },
  removed: { label: "Removeu", tone: "bg-muted text-muted-foreground border-border" },
  removed_partner_failed: { label: "Removeu (painel falhou)", tone: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  configured: { label: "Configurou", tone: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  configure_failed: { label: "Falha ao configurar", tone: "bg-rose-500/10 text-rose-500 border-rose-500/20" },
  fields_updated: { label: "Editou campos", tone: "bg-sky-500/10 text-sky-500 border-sky-500/20" },
  check_validity: { label: "Verificou validade", tone: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  check_validity_failed: { label: "Falha ao verificar", tone: "bg-rose-500/10 text-rose-500 border-rose-500/20" },
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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [tab, setTab] = useState<"pedidos" | "atividade">("pedidos");
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = useState(25);

  // ✅ "Quantos Marcio existem" (pedido do Márcio, 26/07/2026) — client_name
  // sozinho não identifica ninguém quando vários clientes têm o mesmo nome.
  // WhatsApp username + servidor (Username do servidor + nome do servidor)
  // são as infos cruciais que faltavam aqui.
  const [appFieldsByName, setAppFieldsByName] = useState<Record<string, { id: string; type: string; label?: string }[]>>({});

  useEffect(() => {
    async function loadAppFields() {
      const { data } = await supabaseBrowser.from("apps").select("name, fields_config").eq("tenant_id", tenantId);
      const map: Record<string, any[]> = {};
      (data || []).forEach((a: any) => {
        map[a.name] = Array.isArray(a.fields_config) ? a.fields_config : [];
      });
      setAppFieldsByName(map);
    }
    if (tenantId) loadAppFields();
  }, [tenantId]);

  // ✅ Resolve fields_snapshot (chaves são IDs de campo, ex: "f_b1ukp") pro
  // nome real do campo (Device ID, Device Key...) via apps.fields_config do
  // catálogo — antes mostrava só o valor cru, sem dizer o que era. Data
  // ("Vencimento") sai daqui de propósito: pedido do Márcio, não é
  // informação relevante nessa tela.
  function resolveFieldsSnapshot(appName: string, snapshot: Record<string, string> | null) {
    if (!snapshot) return [];
    const config = appFieldsByName[appName] || [];
    const byId = new Map(config.map((f: any) => [String(f.id), f]));
    return Object.entries(snapshot)
      .filter(([k, v]) => !k.startsWith("_config_") && String(v || "").trim())
      .map(([k, v]) => {
        const f = byId.get(k);
        const type = f?.type as AppFieldType | undefined;
        if (type === "date") return null;
        const label = (type && APP_FIELD_LABELS[type]) || f?.label || k;
        return { label, value: String(v) };
      })
      .filter((x): x is { label: string; value: string } => x !== null);
  }

  async function loadActivity() {
    setActivityLoading(true);
    const { data, error } = await supabaseBrowser
      .from("client_app_activity_log")
      .select("id, app_name, event, detail, created_at, clients(display_name, whatsapp_username, server_username, servers(name))")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      setActivityRows(
        data.map((r: any) => ({
          id: r.id,
          client_name: r.clients?.display_name || "Cliente",
          client_whatsapp: r.clients?.whatsapp_username || "",
          server_username: r.clients?.server_username || "",
          server_name: r.clients?.servers?.name || "",
          app_name: r.app_name,
          event: r.event,
          detail: r.detail,
          created_at: r.created_at,
        })),
      );
    }
    setActivityLoading(false);
  }

  useEffect(() => {
    if (tab === "atividade") loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tenantId]);

  async function loadData() {
    setLoading(true);
    const { data, error } = await supabaseBrowser
      .from("client_app_requests")
      .select("id, client_id, client_app_id, app_name, fields_snapshot, action, status, created_at, completed_at, clients(display_name, whatsapp_username, server_username, servers(name))")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      const mapped = data.map((r: any) => ({
        id: r.id,
        client_id: r.client_id,
        client_app_id: r.client_app_id,
        client_name: r.clients?.display_name || "Cliente",
        client_whatsapp: r.clients?.whatsapp_username || "",
        server_username: r.clients?.server_username || "",
        server_name: r.clients?.servers?.name || "",
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (filterStatus === "pending" ? r.status === "pending" : true))
      .filter((r) => {
        if (!q) return true;
        return (
          r.client_name.toLowerCase().includes(q) ||
          r.client_whatsapp.toLowerCase().includes(q) ||
          r.app_name.toLowerCase().includes(q) ||
          r.server_username.toLowerCase().includes(q) ||
          r.server_name.toLowerCase().includes(q)
        );
      });
  }, [rows, filterStatus, search]);

  useEffect(() => {
    setPage(1);
  }, [search, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const paginated = visible.slice((page - 1) * pageSize, page * pageSize);

  const visibleActivity = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    if (!q) return activityRows;
    return activityRows.filter((r) => {
      const eventLabel = (ACTIVITY_LABELS[r.event]?.label || r.event).toLowerCase();
      return (
        r.client_name.toLowerCase().includes(q) ||
        r.client_whatsapp.toLowerCase().includes(q) ||
        r.app_name.toLowerCase().includes(q) ||
        r.server_username.toLowerCase().includes(q) ||
        r.server_name.toLowerCase().includes(q) ||
        eventLabel.includes(q)
      );
    });
  }, [activityRows, activitySearch]);

  useEffect(() => {
    setActivityPage(1);
  }, [activitySearch]);

  const activityTotalPages = Math.max(1, Math.ceil(visibleActivity.length / activityPageSize));
  const paginatedActivity = visibleActivity.slice((activityPage - 1) * activityPageSize, activityPage * activityPageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 md:px-0 border-b border-border pb-3">
        <button
          onClick={() => setTab("pedidos")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
            tab === "pedidos"
              ? "bg-card text-foreground border-border shadow-sm"
              : "bg-transparent text-muted-foreground border-transparent hover:bg-muted"
          }`}
        >
          Pedidos manuais
        </button>
        <button
          onClick={() => setTab("atividade")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
            tab === "atividade"
              ? "bg-card text-foreground border-border shadow-sm"
              : "bg-transparent text-muted-foreground border-transparent hover:bg-muted"
          }`}
        >
          Atividade do portal
        </button>
      </div>

      {tab === "atividade" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 md:px-0">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <input
                value={activitySearch}
                onChange={(e) => setActivitySearch(e.target.value)}
                placeholder="Buscar por cliente, WhatsApp, app ou servidor..."
                className="w-full h-10 px-3 pr-8 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
              />
              {activitySearch && (
                <button
                  onClick={() => setActivitySearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
                  title="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {activityLoading ? (
            <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-none sm:rounded-xl border border-border">
              Carregando atividade...
            </div>
          ) : visibleActivity.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground italic bg-card rounded-none sm:rounded-xl border border-border">
              {activityRows.length === 0 ? "Nenhuma atividade registrada ainda." : "Nenhum resultado pra essa busca."}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible sm:mx-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3">Quando</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Servidor</th>
                      <th className="px-4 py-3">Aplicativo</th>
                      <th className="px-4 py-3">Evento</th>
                      <th className="px-4 py-3">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-border">
                    {paginatedActivity.map((r) => {
                      const meta = ACTIVITY_LABELS[r.event] || { label: r.event, tone: "bg-muted text-muted-foreground border-border" };
                      return (
                        <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">há {timeAgo(r.created_at)}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{r.client_name}</div>
                            {r.client_whatsapp && <div className="text-[11px] text-muted-foreground">{r.client_whatsapp}</div>}
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground/80 whitespace-nowrap">
                            {r.server_username || r.server_name
                              ? `${r.server_username || "—"}${r.server_name ? ` (${r.server_name})` : ""}`
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-foreground/90">{r.app_name}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-lg text-[10px] font-medium uppercase border ${meta.tone}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {r.detail?.error || (r.detail?.expireDate ? `Vencimento: ${String(r.detail.expireDate).split("T")[0].split("-").reverse().join("/")}` : "") || (r.detail?.fields ? `Campos: ${r.detail.fields.join(", ")}` : "") || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={activityPage}
                totalPages={activityTotalPages}
                onPageChange={setActivityPage}
                pageSize={activityPageSize}
                onPageSizeChange={(s) => {
                  setActivityPageSize(s);
                  setActivityPage(1);
                }}
                pageSizeOptions={[25, 50, 100]}
              />
            </div>
          )}
        </div>
      ) : (
        <>
      <div className="flex items-center gap-2 px-3 md:px-0 flex-wrap">
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
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente, WhatsApp, app ou servidor..."
            className="w-full h-9 px-3 pr-8 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
              title="Limpar busca"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-none sm:rounded-xl border border-border">
          Carregando pedidos...
        </div>
      ) : visible.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground italic bg-card rounded-none sm:rounded-xl border border-border">
          {rows.length === 0 ? `Nenhum pedido ${filterStatus === "pending" ? "pendente" : "registrado"}.` : "Nenhum resultado pra essa busca."}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible sm:mx-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[850px]">
              <thead>
                <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Servidor</th>
                  <th className="px-4 py-3">Aplicativo</th>
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Campos</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-border">
                {paginated.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      há {timeAgo(r.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{r.client_name}</div>
                      {r.client_whatsapp && <div className="text-[11px] text-muted-foreground">{r.client_whatsapp}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground/80 whitespace-nowrap">
                      {r.server_username || r.server_name
                        ? `${r.server_username || "—"}${r.server_name ? ` (${r.server_name})` : ""}`
                        : "—"}
                    </td>
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
                        {resolveFieldsSnapshot(r.app_name, r.fields_snapshot).map((f, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 bg-muted text-muted-foreground border border-border text-[10px] font-mono rounded"
                          >
                            <span className="font-bold text-foreground/70">{f.label}:</span> {f.value}
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
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            pageSizeOptions={[25, 50, 100]}
          />
        </div>
      )}
        </>
      )}
    </div>
  );
}
