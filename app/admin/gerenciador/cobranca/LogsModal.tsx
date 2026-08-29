"use client";
// app/admin/gerenciador/cobranca/LogsModal.tsx
// Extraído de page.tsx (15/08/2026) — modal de logs/histórico da automação
// (lê vw_client_message_jobs_queue_details, com reenvio e cancelamento de
// falhas), carrega via next/dynamic só quando abre.
import { useState, useEffect, useMemo } from "react";
import { Loader2, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

type JobLogRow = {
  id: string;
  status: string;
  when_sp: string | null;
  when_ts_utc: string;
  client_id: string | null;
  client_name: string | null;
  whatsapp_username: string | null;
  template_name: string | null;
  message_preview: string | null;
  error_message: string | null;
  whatsapp_session: string | null;
  server_username?: string | null; // ✅ Login no painel (preenchido após enriquecimento)
  server_name?: string | null; // ✅ Nome do servidor (preenchido após enriquecimento)
};

export default function LogsModal({
  ruleId,
  ruleName,
  onClose,
}: {
  ruleId: string;
  ruleName: string;
  onClose: () => void;
}) {
  const tenantId = useTenantId();
  const [logs, setLogs] = useState<JobLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ✅ Filtro rápido do log
  const [logSearch, setLogSearch] = useState("");
  const [logStatusFilter, setLogStatusFilter] = useState("Todos");
  const [logServerFilter, setLogServerFilter] = useState("Todos");

  const fetchLogs = async () => {
    setLoading(true);
    const tid = tenantId;
    if (!tid) {
      setLoading(false);
      return;
    }

    const baseSelect =
      "id, status, when_sp, when_ts_utc, client_id, client_name, whatsapp_username, template_name, message_preview, error_message, whatsapp_session";

    // ✅ 29/08/2026, achado do Márcio: com só 1 query (100 mais recentes de
    // qualquer status) uma automação com bastante volume enterra as FAILED
    // antigas fora da janela assim que o envio volta ao normal — o sino
    // fica ligado (a checagem de resolução não tem esse limite) mas o modal
    // mostra "sem erro", parecendo que não tem nada pra fazer. FAILED busca
    // à parte, sem limite de recência (o volume real de falha é sempre
    // baixo — dezenas, não centenas), garante que toda falha apareça aqui
    // sempre, e as duas listas se juntam pra exibição.
    const [failedRes, recentRes] = await Promise.all([
      supabaseBrowser
        .from("vw_client_message_jobs_queue_details")
        .select(baseSelect)
        .eq("tenant_id", tid)
        .eq("automation_id", ruleId)
        .eq("status", "FAILED")
        .order("when_ts_utc", { ascending: false }),
      supabaseBrowser
        .from("vw_client_message_jobs_queue_details")
        .select(baseSelect)
        .eq("tenant_id", tid)
        .eq("automation_id", ruleId)
        .in("status", ["SENT", "CANCELLED"])
        .order("when_ts_utc", { ascending: false })
        .limit(100),
    ]);

    if (failedRes.error || recentRes.error) {
      setLogs([]);
      setSelected(new Set());
      setLoading(false);
      return;
    }

    const merged = [...((failedRes.data as JobLogRow[]) || []), ...((recentRes.data as JobLogRow[]) || [])];
    const rows = Array.from(new Map(merged.map((r) => [r.id, r])).values()).sort(
      (a, b) => new Date(b.when_ts_utc).getTime() - new Date(a.when_ts_utc).getTime(),
    );

    // ✅ Enriquece com login (server_username) e nome do servidor, igual à Auditoria
    try {
      const clientIds = [
        ...new Set(rows.map((r) => r.client_id).filter(Boolean)),
      ] as string[];

      if (clientIds.length > 0) {
        // ✅ Nenhuma depende da outra (servers nem usa clientIds) — paralelo
        // em vez de uma esperar a outra terminar.
        const [{ data: clientsData }, { data: serversData }] =
          await Promise.all([
            supabaseBrowser
              .from("clients")
              .select("id, server_username, server_id")
              .eq("tenant_id", tid)
              .in("id", clientIds),
            supabaseBrowser.from("servers").select("id, name").eq("tenant_id", tid),
          ]);

        const clientsMap: Record<string, any> = {};
        (clientsData || []).forEach((c: any) => {
          clientsMap[c.id] = c;
        });

        const serversMap: Record<string, string> = {};
        (serversData || []).forEach((s: any) => {
          serversMap[s.id] = s.name;
        });

        rows.forEach((r) => {
          const c = r.client_id ? clientsMap[r.client_id] : null;
          r.server_username = c?.server_username || null;
          r.server_name = c?.server_id ? serversMap[c.server_id] || null : null;
        });
      }
    } catch {
      // se o enriquecimento falhar, segue sem login/servidor
    }

    setLogs(rows);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId]);

  const uniqueLogServers = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      if (l.server_name) set.add(l.server_name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [logs]);

  // ✅ Só mostra no filtro os status que realmente existem nesta regra
  const availableLogStatusOptions = useMemo(() => {
    const options = [
      { value: "SENT", label: "Enviado" },
      { value: "FAILED", label: "Falhou" },
      { value: "CANCELLED", label: "Resolvido" },
    ];
    return options.filter((o) => logs.some((l) => l.status === o.value));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs.filter((l) => {
      if (logStatusFilter !== "Todos" && l.status !== logStatusFilter)
        return false;
      if (logServerFilter !== "Todos" && l.server_name !== logServerFilter)
        return false;
      if (q) {
        const hay = [l.client_name, l.server_username, l.whatsapp_username]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, logSearch, logStatusFilter, logServerFilter]);

  const hasActiveLogFilters =
    logStatusFilter !== "Todos" || logServerFilter !== "Todos";

  function clearLogFilters() {
    setLogSearch("");
    setLogStatusFilter("Todos");
    setLogServerFilter("Todos");
  }

  const failedRows = filteredLogs.filter((l) => l.status === "FAILED");

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFailed = () => {
    if (selected.size === failedRows.length && failedRows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(failedRows.map((r) => r.id)));
    }
  };

  // ✅ NOVO: se não sobrou nenhuma falha pra essa automação, resolve a notificação do sino
  const resolveIfNoMoreFailures = async (tid: string) => {
    try {
      const { count } = await supabaseBrowser
        .from("client_message_jobs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tid)
        .eq("automation_id", ruleId)
        .eq("status", "FAILED");

      if (!count || count === 0) {
        await supabaseBrowser.rpc("resolve_notification", {
          p_tenant_id: tid,
          p_type: "automacao_falha",
          p_source_id: ruleId,
        });
      }
    } catch {}
  };

  // Reenfileira: cria NOVOS jobs SCHEDULED (escadinha) e marca os antigos como CANCELLED
  const requeueIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setWorking(true);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Sessão inválida.");

      // Puxa os dados originais EXATOS dos jobs (a view não traz image_url/template_id)
      const { data: originals, error: origErr } = await supabaseBrowser
        .from("client_message_jobs")
        .select(
          "id, client_id, reseller_id, message, image_url, message_template_id, whatsapp_session, automation_id",
        )
        .eq("tenant_id", tid)
        .in("id", ids);

      if (origErr) throw origErr;
      if (!originals || originals.length === 0)
        throw new Error("Jobs originais não encontrados.");

      // Monta novos jobs em escadinha (T+10s, T+20s...) pra não floodar a VM
      let currentSendAt = new Date();
      const inserts = originals.map((o: any) => {
        const delaySecs = Math.floor(Math.random() * 20) + 10; // 10–30s
        currentSendAt = new Date(currentSendAt.getTime() + delaySecs * 1000);
        const base: any = {
          tenant_id: tid,
          message: o.message,
          image_url: o.image_url || null,
          message_template_id: o.message_template_id || null,
          automation_id: o.automation_id || null,
          whatsapp_session: o.whatsapp_session || "default",
          status: "SCHEDULED",
          send_at: currentSendAt.toISOString(),
        };
        if (o.reseller_id) base.reseller_id = o.reseller_id;
        else base.client_id = o.client_id;
        return base;
      });

      const { error: insErr } = await supabaseBrowser
        .from("client_message_jobs")
        .insert(inserts);
      if (insErr) throw insErr;

      // Marca os antigos como CANCELLED pra saírem do alerta de falhas
      const { error: updErr } = await supabaseBrowser
        .from("client_message_jobs")
        .update({
          status: "CANCELLED",
          error_message: "Reenfileirado manualmente via Logs",
        })
        .eq("tenant_id", tid)
        .in("id", ids);
      if (updErr) throw updErr;

      await fetchLogs();
      await resolveIfNoMoreFailures(tid);
    } catch {
    } finally {
      setWorking(false);
    }
  };

  // Marca como recebido (cliente já recebeu apesar do erro): vira CANCELLED, sem reenviar
  const cancelIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setWorking(true);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Sessão inválida.");

      const { error } = await supabaseBrowser
        .from("client_message_jobs")
        .update({
          status: "CANCELLED",
          error_message: "Marcado como recebido manualmente",
        })
        .eq("tenant_id", tid)
        .in("id", ids);
      if (error) throw error;

      await fetchLogs();
      await resolveIfNoMoreFailures(tid);
    } catch {
    } finally {
      setWorking(false);
    }
  };

  const selectedArr = Array.from(selected);

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <h3 className="text-lg font-medium text-foreground">
          Logs de Envio
        </h3>
        <p className="text-xs text-foreground/70">
          Regra: <strong>{ruleName}</strong>
          {failedRows.length > 0 && (
            <span className="ml-2 text-rose-500 font-medium">
              • {failedRows.length} falha(s)
            </span>
          )}
        </p>
      </ModalHeader>

        {/* ✅ FILTRO RÁPIDO DO LOG */}
        {logs.length > 0 && (
          <div className="px-6 py-3 border-b border-border bg-transparent flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[160px] relative">
              <input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className="w-full h-9 px-3 pr-8 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
              />
              {logSearch && (
                <button
                  onClick={() => setLogSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-rose-500"
                  title="Limpar busca"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={logStatusFilter}
              onChange={(e) => setLogStatusFilter(e.target.value)}
              className="h-9 px-2 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
            >
              <option value="Todos">Status (Todos)</option>
              {availableLogStatusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {uniqueLogServers.length > 0 && (
              <select
                value={logServerFilter}
                onChange={(e) => setLogServerFilter(e.target.value)}
                className="h-9 px-2 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
              >
                <option value="Todos">Servidor (Todos)</option>
                {uniqueLogServers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}

            {hasActiveLogFilters && (
              <button
                onClick={clearLogFilters}
                className="h-9 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-xs font-medium hover:bg-rose-500/20 transition-colors flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> Limpar
              </button>
            )}
          </div>
        )}

        <ModalBody className="p-4">
          {loading ? (
            <div className="text-center py-10 text-muted-foreground">
              Carregando...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              Nenhum registro encontrado.
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              Nenhum registro encontrado para os filtros selecionados.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="p-2 w-8">
                    {failedRows.length > 0 && (
                      <input
                        type="checkbox"
                        checked={
                          selected.size === failedRows.length &&
                          failedRows.length > 0
                        }
                        onChange={toggleAllFailed}
                        title="Selecionar todas as falhas"
                      />
                    )}
                  </th>
                  <th className="p-2">Data/Hora</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Login / Servidor</th>
                  <th className="p-2">WhatsApp</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const isFailed = log.status === "FAILED";
                  return (
                    <tr
                      key={log.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="p-2">
                        {isFailed && (
                          <input
                            type="checkbox"
                            checked={selected.has(log.id)}
                            onChange={() => toggleOne(log.id)}
                          />
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground text-xs whitespace-nowrap">
                        {log.when_sp || "--"}
                      </td>
                      <td className="p-2 font-medium text-foreground/90">
                        {log.client_name || (
                          <span className="text-muted-foreground italic">
                            (sem nome)
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground/90 text-xs">
                            {log.server_username || "--"}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {log.server_name || "--"}
                          </span>
                        </div>
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {log.whatsapp_username || "--"}
                      </td>
                      <td className="p-2">
                        <span
                          className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm uppercase ${
                            log.status === "SENT"
                              ? "bg-emerald-500/10 text-emerald-500"
                              : log.status === "FAILED"
                                ? "bg-rose-500/10 text-rose-500"
                                : log.status === "CANCELLED"
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-transparent text-muted-foreground"
                          }`}
                        >
                          {log.status === "SENT"
                            ? "Enviado"
                            : log.status === "FAILED"
                              ? "Falhou"
                              : log.status === "CANCELLED"
                                ? "Resolvido"
                                : log.status}
                        </span>
                        {log.error_message && isFailed && (
                          <div
                            className="text-[10px] text-rose-500 mt-1 max-w-[220px] truncate"
                            title={log.error_message}
                          >
                            {log.error_message}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ModalBody>

        <ModalFooter className="flex justify-between items-center gap-2 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => requeueIds(selectedArr)}
              disabled={working || selectedArr.length === 0}
              className="px-4 py-2 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20 font-medium text-xs uppercase hover:bg-sky-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-1.5"
            >
              {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Reenviar selecionados ({selectedArr.length})
            </button>
            <button
              onClick={() => requeueIds(failedRows.map((r) => r.id))}
              disabled={working || failedRows.length === 0}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-900/20 flex items-center gap-1.5"
            >
              {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Reenviar todas as falhas ({failedRows.length})
            </button>
            <button
              onClick={() => cancelIds(selectedArr)}
              disabled={working || selectedArr.length === 0}
              className="px-4 py-2 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs uppercase hover:bg-rose-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-1.5"
              title="Cliente já recebeu — remove da lista de falhas sem reenviar"
            >
              {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Limpar selecionados
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg border border-border bg-muted text-foreground/80 font-medium text-xs uppercase hover:bg-muted/80 hover:text-foreground transition-colors shadow-sm"
          >
            Fechar
          </button>
        </ModalFooter>
    </Modal>
  );
}
