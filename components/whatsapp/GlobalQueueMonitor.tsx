"use client";

// components/whatsapp/GlobalQueueMonitor.tsx
// ✅ 05/10/2026, pedido do Márcio: extraído de
// app/admin/gerenciador/cobranca/page.tsx pra também abrir pelo sino
// (AdminShell, botão "Fila WhatsApp") sem precisar ir até a página de
// Automação de Cobrança. Na página continua igual (botão "Ver Fila").
import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import { formatTimeBR } from "@/lib/date-br";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";

// ============================================================================
// ✅ FILA + HISTÓRICO DO DIA (29/08/2026 — substitui o polling automático)
// ============================================================================
// Antes ficava consultando o banco em loop (a cada 1-2min, o dia inteiro) só
// pra manter uma barra sempre visível atualizada. Desde que o disparo virou
// pg_cron nativo (docs/sql/billing_native_cron_migration.sql), o Cron 2 já
// não roda mais rápido que 2 em 2min — então continuar consultando mais
// rápido que isso nunca trazia nada novo mesmo. Agora: zero chamada em
// segundo plano; busca só quando o admin abre o painel, e só continua
// atualizando (a cada 2min, mesma cadência do cron) enquanto ele está aberto.
type QueueRow = {
  id: string;
  status: string;
  when_sp: string | null;
  when_ts_utc: string;
  origem: string | null;
  client_id: string | null;
  client_name: string | null;
  whatsapp_username: string | null;
  automation_id: string | null;
  template_name: string | null;
  message_preview: string | null;
  error_message: string | null;
  // ✅ Preenchidos depois via enriquecimento (clients/servers) — quem
  // recebeu de fato (login) e em qual servidor, não vem na view.
  server_username?: string | null;
  server_name?: string | null;
  // ✅ 04/10/2026: recibo ✓✓ da WhatsApp (whatsapp_message_receipts) —
  // undefined = mensagem sem recibo registrado (enviada antes do recurso).
  receipt?: MessageReceipt;
};

type MessageReceipt = {
  delivered_at: string | null;
  read_at: string | null;
  retry_requests: number;
  error_reason: string | null;
  forced_resend_at: string | null;
  gave_up_at: string | null;
};

// ✅ 04/10/2026, 2ª rodada (Márcio: "cuidado com as 15 tratativas"): o
// reenvio NATIVO (mesmo id, até maxMsgRetryCount=15 na VM) é automático e
// conserta o próprio balão "Aguardando mensagem" — reenviar na mão no meio
// disso DUPLICA pro cliente (incidente de 01/10). Por isso "pedido de
// reenvio" aparece como "tentando sozinho", nunca como falha; ⚠ vermelho
// só quando o automático já se esgotou de verdade.
const RECEIPT_STALE_MS = 2 * 60 * 60 * 1000; // sem nenhum sinal do celular
const RECEIPT_RETRYING_GIVE_UP_MS = 24 * 60 * 60 * 1000; // ainda "tentando" depois disso = travou
const MAX_NATIVE_RETRIES = 15;
const NO_MANUAL_RESEND = "Não reenvie manualmente — o cliente receberia duplicado.";

function ReceiptBadge({ receipt, sentAtUtc }: { receipt?: MessageReceipt; sentAtUtc: string }) {
  if (!receipt) {
    return <span className="text-[10px] text-muted-foreground/60" title="Sem recibo registrado (envio anterior a 04/10/2026)">—</span>;
  }
  const base = "text-[11px] font-medium";
  if (receipt.error_reason) {
    return (
      <span className={`${base} text-rose-500`} title={`O aparelho do cliente não conseguiu exibir: ${receipt.error_reason}`}>
        ✕ Não exibida
      </span>
    );
  }

  const forcedAt = receipt.forced_resend_at ? new Date(receipt.forced_resend_at).getTime() : null;
  const retries = receipt.retry_requests || 0;
  const now = Date.now();
  const forcedNote = receipt.forced_resend_at
    ? `O WhatsApp desistiu da 1ª mensagem depois de ${MAX_NATIVE_RETRIES} tentativas e o sistema mandou uma nova às ${formatTimeBR(receipt.forced_resend_at)} — o cliente pode ver 2 balões (um "Aguardando mensagem" e o novo).`
    : "";

  const doneAt = receipt.read_at || receipt.delivered_at;
  if (doneAt) {
    const isRead = !!receipt.read_at;
    const secondCopy = forcedAt !== null && new Date(doneAt).getTime() >= forcedAt;
    const title = [
      `${isRead ? "Lida" : "Entregue no celular"} às ${formatTimeBR(doneAt)}.`,
      forcedNote,
      !forcedNote && retries > 0 ? `Precisou de ${retries} pedido(s) de reenvio automático até chegar.` : "",
    ].filter(Boolean).join(" ");
    return (
      <span className={`${base} ${isRead ? "text-sky-500" : "text-muted-foreground"}`} title={title}>
        ✓✓ {isRead ? "Lida" : "Entregue"} {formatTimeBR(doneAt)}
        {secondCopy ? " (2ª via)" : forcedAt !== null ? " · reenviada como nova" : ""}
      </span>
    );
  }

  // Ainda não chegou no celular.
  if (forcedAt !== null) {
    if (now - forcedAt > RECEIPT_STALE_MS) {
      return (
        <span className={`${base} text-rose-500`} title={`${forcedNote} Nem a mensagem nova chegou em 2h — aqui vale falar com o cliente por outro meio.`}>
          ⚠ Não entregue
        </span>
      );
    }
    return (
      <span className={`${base} text-amber-500`} title={`${forcedNote} Aguardando a nova chegar. ${NO_MANUAL_RESEND}`}>
        ↻ Reenviada como nova
      </span>
    );
  }
  if (receipt.gave_up_at) {
    return (
      <span
        className={`${base} text-rose-500`}
        title={`O WhatsApp desistiu depois de ${MAX_NATIVE_RETRIES} tentativas às ${formatTimeBR(receipt.gave_up_at)} e não deu pra mandar uma nova automaticamente (conteúdo já fora do cache de 1h da VM). Aqui vale reenviar ou falar com o cliente.`}
      >
        ⚠ Não entregue
      </span>
    );
  }
  const age = now - new Date(sentAtUtc).getTime();
  if (retries > 0) {
    if (age > RECEIPT_RETRYING_GIVE_UP_MS) {
      return (
        <span className={`${base} text-rose-500`} title={`${retries} pedido(s) de reenvio e mais de 24h sem chegar — as tentativas automáticas pararam. Aqui vale falar com o cliente.`}>
          ⚠ Não entregue
        </span>
      );
    }
    return (
      <span
        className={`${base} text-amber-500`}
        title={`O celular do cliente não conseguiu abrir ("Aguardando mensagem") e pediu reenvio ${retries}x — o sistema reenvia sozinho a MESMA mensagem (até ${MAX_NATIVE_RETRIES}x), que conserta o balão no lugar. ${NO_MANUAL_RESEND}`}
      >
        ⏳ Tentando sozinho ({Math.min(retries, MAX_NATIVE_RETRIES)} de {MAX_NATIVE_RETRIES})
      </span>
    );
  }
  if (age > RECEIPT_STALE_MS) {
    return (
      <span
        className={`${base} text-amber-500`}
        title={`Mais de 2h sem nenhum sinal do celular do cliente (provavelmente desligado ou sem internet). O WhatsApp entrega sozinho quando ele voltar — se reenviar, chegam as duas. Se for urgente, fale por outro meio.`}
      >
        ⚠ Sem sinal do celular
      </span>
    );
  }
  return (
    <span className={`${base} text-muted-foreground`} title="Chegou no servidor do WhatsApp, aguardando o celular do cliente.">
      ✓ Enviada
    </span>
  );
}

const QUEUE_ROW_SELECT =
  "id,status,when_sp,when_ts_utc,origem,client_id,client_name,whatsapp_username,automation_id,template_name,message_preview,message_full,whatsapp_session,error_message";

function todaySPBoundsUtc() {
  const todaySp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const startUtc = new Date(`${todaySp}T00:00:00-03:00`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() };
}

type AddToastFn = (
  type: "success" | "error",
  title: string,
  msg?: string,
  durationMs?: number,
) => void;

// Sem `open`/`onOpenChange`: mostra o próprio botão "Ver Fila" e controla
// sozinho (página de cobrança). Com eles + `hideTrigger`: quem abre é o
// pai (sino do AdminShell). Sem `addToast`: usa toasts próprios (o
// AdminShell não tem toast nenhum).
export default function GlobalQueueMonitor({
  addToast: externalAddToast,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  initialTab = "fila",
}: {
  addToast?: AddToastFn;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  // Aba que abre primeiro (o sino abre direto no Histórico).
  initialTab?: "fila" | "historico";
}) {
  const tenantId = useTenantId();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setInternalOpen(v));

  const [localToasts, setLocalToasts] = useState<ToastMessage[]>([]);
  const addToast: AddToastFn =
    externalAddToast ??
    ((type, title, msg, durationMs) => {
      const id = Date.now() + Math.random();
      setLocalToasts((p) => [...p, { id, type, title, message: msg, durationMs }]);
    });
  const [tab, setTab] = useState<"fila" | "historico">(initialTab);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [queueData, setQueueData] = useState<QueueRow[]>([]);
  const [historyData, setHistoryData] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [search, setSearch] = useState("");

  const fetchAll = async () => {
    const tid = tenantId;
    if (!tid) return;
    setLoading(true);

    const { startUtc, endUtc } = todaySPBoundsUtc();

    const [pendingRes, historyRes] = await Promise.all([
      supabaseBrowser
        .from("vw_client_message_jobs_queue_details")
        .select(QUEUE_ROW_SELECT)
        .eq("tenant_id", tid)
        .in("status", ["SCHEDULED", "QUEUED", "PAUSED", "SENDING"])
        .order("when_ts_utc", { ascending: true }),
      supabaseBrowser
        .from("vw_client_message_jobs_queue_details")
        .select(QUEUE_ROW_SELECT)
        .eq("tenant_id", tid)
        .in("status", ["SENT", "FAILED", "CANCELLED"])
        .gte("when_ts_utc", startUtc)
        .lt("when_ts_utc", endUtc)
        // ✅ Mais recente primeiro — quem acabou de enviar/testar quer ver
        // no topo, sem rolar a lista (achado ao vivo, 29/08/2026).
        .order("when_ts_utc", { ascending: false }),
    ]);

    const pendingRows = (pendingRes.data as QueueRow[]) || [];
    const historyRows = (historyRes.data as QueueRow[]) || [];

    // ✅ Enriquece com login (server_username) e nome do servidor — mesmo
    // padrão do LogsModal — pra saber QUAL conta do cliente recebeu, não só
    // o nome dele (um cliente pode ter várias contas/servidores).
    try {
      const clientIds = [...new Set([...pendingRows, ...historyRows].map((r) => r.client_id).filter(Boolean))] as string[];
      if (clientIds.length > 0) {
        const [{ data: clientsData }, { data: serversData }] = await Promise.all([
          supabaseBrowser.from("clients").select("id, server_username, server_id").eq("tenant_id", tid).in("id", clientIds),
          supabaseBrowser.from("servers").select("id, name").eq("tenant_id", tid),
        ]);
        const clientsMap: Record<string, any> = {};
        (clientsData || []).forEach((c: any) => (clientsMap[c.id] = c));
        const serversMap: Record<string, string> = {};
        (serversData || []).forEach((s: any) => (serversMap[s.id] = s.name));

        for (const row of [...pendingRows, ...historyRows]) {
          const c = row.client_id ? clientsMap[row.client_id] : null;
          row.server_username = c?.server_username || null;
          row.server_name = c?.server_id ? serversMap[c.server_id] || null : null;
        }
      }
    } catch {
      // enriquecimento é só um extra visual — falhar aqui não pode derrubar a fila
    }

    // ✅ 04/10/2026: recibo ✓✓ de cada envio do histórico. Mesmo esquema do
    // enriquecimento acima — falhar não derruba nada, só some a coluna.
    try {
      const sentIds = historyRows.filter((r) => r.status === "SENT").map((r) => r.id);
      if (sentIds.length > 0) {
        const { data: receipts } = await supabaseBrowser
          .from("whatsapp_message_receipts")
          .select("job_id, is_secondary, delivered_at, read_at, retry_requests, error_reason, forced_resend_at, gave_up_at")
          .in("job_id", sentIds);
        const byJob: Record<string, MessageReceipt> = {};
        for (const r of (receipts as any[]) || []) {
          // Job com 2 mensagens (raro — envio manual a principal+secundário):
          // mostra a do principal.
          if (byJob[r.job_id] && r.is_secondary) continue;
          byJob[r.job_id] = r;
        }
        for (const row of historyRows) row.receipt = byJob[row.id];
      }
    } catch {
      // idem
    }

    setQueueData(pendingRows);
    setHistoryData(historyRows);
    setSelected(new Set());
    setLastUpdate(new Date());
    setLoading(false);
  };

  // ✅ Sem fetch automático nenhum — nem no mount, nem em intervalo enquanto
  // aberto (pedido do Márcio, 29/08/2026: virou "sync" manual). Busca só ao
  // abrir e ao clicar em "Atualizar".
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenantId]);

  const handleGlobalPause = async () => {
    setLoading(true);
    const tid = tenantId;
    if (!tid) {
      setLoading(false);
      return;
    }
    await supabaseBrowser
      .from("client_message_jobs")
      .update({ status: "PAUSED" })
      .eq("tenant_id", tid)
      .in("status", ["SCHEDULED", "QUEUED", "SENDING"]);
    await fetchAll();
  };

  const handleGlobalResume = async () => {
    setLoading(true);
    const tid = tenantId;
    if (!tid) {
      setLoading(false);
      return;
    }
    await supabaseBrowser
      .from("client_message_jobs")
      .update({ status: "QUEUED" })
      .eq("tenant_id", tid)
      .eq("status", "PAUSED");
    await fetchAll();
  };

  const handleNukeQueue = async () => {
    if (queueData.length === 0) return;
    setLoading(true);
    try {
      const tid = tenantId;
      if (!tid) return;
      const jobIdsToCancel = queueData.map((j) => j.id).filter(Boolean);
      if (jobIdsToCancel.length === 0) return;

      const { error } = await supabaseBrowser
        .from("client_message_jobs")
        .update({ status: "CANCELLED", error_message: "Cancelado via Monitor Global" })
        .eq("tenant_id", tid)
        .in("id", jobIdsToCancel);
      if (error) throw error;
      await fetchAll();
    } catch (e: any) {
      addToast("error", "Erro ao cancelar", e.message);
    } finally {
      setLoading(false);
    }
  };

  // Resolve o sino de "automacao_falha" pras automações que não têm mais
  // nenhuma falha pendente depois do reenvio/limpeza — igual ao LogsModal,
  // só que aqui pode cobrir várias automações de uma vez (painel consolidado).
  const resolveFailuresForAutomations = async (tid: string, automationIds: (string | null)[]) => {
    const unique = [...new Set(automationIds.filter(Boolean))] as string[];
    for (const autoId of unique) {
      try {
        const { count } = await supabaseBrowser
          .from("client_message_jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tid)
          .eq("automation_id", autoId)
          .eq("status", "FAILED");
        if (!count || count === 0) {
          await supabaseBrowser.rpc("resolve_notification", {
            p_tenant_id: tid,
            p_type: "automacao_falha",
            p_source_id: autoId,
          });
        }
      } catch {}
    }
  };

  const requeueIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setWorking(true);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Sessão inválida.");
      const affectedAutomationIds = historyData.filter((r) => ids.includes(r.id)).map((r) => r.automation_id);

      const { error } = await supabaseBrowser.rpc("requeue_message_jobs", {
        p_tenant_id: tid,
        p_ids: ids,
      });
      if (error) throw error;

      addToast("success", "Reenviado", `${ids.length} mensagem(ns) reenfileirada(s).`);
      await fetchAll();
      await resolveFailuresForAutomations(tid, affectedAutomationIds);
    } catch (e: any) {
      addToast("error", "Erro ao reenviar", e.message);
    } finally {
      setWorking(false);
    }
  };

  const cancelIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setWorking(true);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Sessão inválida.");
      const affectedAutomationIds = historyData.filter((r) => ids.includes(r.id)).map((r) => r.automation_id);

      const { error } = await supabaseBrowser
        .from("client_message_jobs")
        .update({ status: "CANCELLED", error_message: "Marcado como recebido manualmente" })
        .eq("tenant_id", tid)
        .in("id", ids);
      if (error) throw error;

      await fetchAll();
      await resolveFailuresForAutomations(tid, affectedAutomationIds);
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    } finally {
      setWorking(false);
    }
  };

  const activeCount = queueData.filter((j) => ["SCHEDULED", "QUEUED", "SENDING"].includes(j.status)).length;
  const pausedCount = queueData.filter((j) => j.status === "PAUSED").length;

  const matchesSearch = (row: QueueRow) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const hay = [row.client_name, row.whatsapp_username, row.server_username, row.server_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };
  const filteredQueueData = queueData.filter(matchesSearch);
  const filteredHistoryData = historyData.filter(matchesSearch);
  const failedRows = filteredHistoryData.filter((r) => r.status === "FAILED");
  const selectedArr = Array.from(selected);

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

  return (
    <>
      {!externalAddToast && (
        <ToastNotifications toasts={localToasts} removeToast={(id) => setLocalToasts((p) => p.filter((t) => t.id !== id))} />
      )}
      {!hideTrigger && (
        <button
          onClick={() => setOpen(true)}
          className="h-9 md:h-10 px-3 md:px-4 rounded-lg border border-border bg-card text-foreground hover:bg-muted font-medium text-xs md:text-sm transition-all flex items-center gap-2 whitespace-nowrap"
        >
          Ver Fila
          {queueData.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-emerald-500/15 text-emerald-600 text-[11px] font-semibold">
              {queueData.length}
            </span>
          )}
        </button>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-4xl">
          <ModalHeader onClose={() => setOpen(false)}>
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="font-medium text-lg text-foreground">Fila e Histórico de Envio</h3>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-0.5">
                <button
                  onClick={() => setTab("fila")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === "fila" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Fila ({queueData.length})
                </button>
                <button
                  onClick={() => setTab("historico")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === "historico" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Histórico de hoje ({historyData.length})
                </button>
              </div>
            </div>
          </ModalHeader>

          {/* ✅ Toolbar: busca + sync manual (sem polling — pedido do Márcio, 29/08/2026) */}
          <div className="px-6 py-2.5 border-b border-border flex items-center gap-2 flex-wrap shrink-0">
            <div className="flex-1 min-w-[160px] relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente ou WhatsApp..."
                className="w-full h-9 px-3 pr-8 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-rose-500"
                  title="Limpar busca"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={fetchAll}
              disabled={loading}
              className="h-9 px-3 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "↻"} Atualizar
            </button>
            {lastUpdate && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                Atualizado {formatTimeBR(lastUpdate)}
              </span>
            )}
          </div>

          {tab === "fila" ? (
            <>
              <ModalBody className="p-0">
                {filteredQueueData.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    {queueData.length === 0 ? "Fila vazia no momento." : "Nenhum resultado para a busca."}
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="p-4">Quando</th>
                        <th className="p-4">Origem</th>
                        <th className="p-4">Cliente</th>
                        <th className="p-4">Servidor</th>
                        <th className="p-4">Mensagem</th>
                        <th className="p-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredQueueData.map((job) => (
                        <tr key={job.id} className="hover:bg-muted/30 align-top">
                          <td className="p-4 text-muted-foreground whitespace-nowrap">{job.when_sp || "--"}</td>
                          <td className="p-4 font-medium text-foreground whitespace-nowrap">
                            {job.origem === "AUTOMACAO" ? "Automação" : "Envio Manual"}
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">
                                {job.client_name || <span className="text-muted-foreground font-medium">(cliente não encontrado)</span>}
                              </span>
                              <span className="text-[10px] text-muted-foreground">{job.whatsapp_username || "--"}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground/90 text-xs">{job.server_username || "--"}</span>
                              <span className="text-[10px] text-muted-foreground">{job.server_name || "--"}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            {job.template_name ? (
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">{job.template_name}</span>
                                <span className="text-[10px] text-muted-foreground">Template</span>
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">Personalizada</span>
                                <span className="text-[11px] text-muted-foreground/70 line-clamp-2">{job.message_preview || "--"}</span>
                              </div>
                            )}
                          </td>
                          <td className="p-4 whitespace-nowrap">
                            <span
                              className={`gap-1 px-2 py-1 rounded-lg text-xs font-medium tracking-tight shadow-sm ${job.status === "PAUSED" ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"}`}
                            >
                              {job.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ModalBody>
              <ModalFooter className="flex gap-2 justify-end flex-wrap">
                {activeCount > 0 ? (
                  <button
                    onClick={handleGlobalPause}
                    disabled={loading}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg font-medium text-xs hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "⏸️"} PAUSAR TUDO
                  </button>
                ) : (
                  <button
                    onClick={handleGlobalResume}
                    disabled={loading || pausedCount === 0}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium text-xs hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "▶️"} RETOMAR
                  </button>
                )}
                <button
                  onClick={handleNukeQueue}
                  disabled={loading || queueData.length === 0}
                  className="px-4 py-2 bg-rose-600 text-white rounded-lg font-medium text-xs hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "🚨"} CANCELAR TUDO
                </button>
              </ModalFooter>
            </>
          ) : (
            <>
              <ModalBody className="p-0">
                {filteredHistoryData.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    {historyData.length === 0 ? "Nada enviado hoje ainda." : "Nenhum resultado para a busca."}
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="p-2 w-8">
                          {failedRows.length > 0 && (
                            <input
                              type="checkbox"
                              checked={selected.size === failedRows.length && failedRows.length > 0}
                              onChange={toggleAllFailed}
                              title="Selecionar todas as falhas"
                            />
                          )}
                        </th>
                        <th className="p-2">Quando</th>
                        <th className="p-2">Cliente</th>
                        <th className="p-2">Servidor</th>
                        <th className="p-2">Mensagem</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Entrega</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredHistoryData.map((log) => {
                        const isFailed = log.status === "FAILED";
                        return (
                          <tr key={log.id} className="hover:bg-muted/30 align-top">
                            <td className="p-2">
                              {isFailed && (
                                <input type="checkbox" checked={selected.has(log.id)} onChange={() => toggleOne(log.id)} />
                              )}
                            </td>
                            <td className="p-2 text-muted-foreground text-xs whitespace-nowrap">{log.when_sp || "--"}</td>
                            <td className="p-2">
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground/90">
                                  {log.client_name || <span className="text-muted-foreground italic">(sem nome)</span>}
                                </span>
                                <span className="text-[10px] text-muted-foreground">{log.whatsapp_username || "--"}</span>
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground/90 text-xs">{log.server_username || "--"}</span>
                                <span className="text-[10px] text-muted-foreground">{log.server_name || "--"}</span>
                              </div>
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">{log.template_name || "Personalizada"}</td>
                            <td className="p-2">
                              <span
                                className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm uppercase ${
                                  log.status === "SENT"
                                    ? "bg-emerald-500/10 text-emerald-500"
                                    : log.status === "FAILED"
                                      ? "bg-rose-500/10 text-rose-500"
                                      : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {log.status === "SENT" ? "Enviado" : log.status === "FAILED" ? "Falhou" : "Resolvido"}
                              </span>
                              {log.error_message && isFailed && (
                                <div className="text-[10px] text-rose-500 mt-1 max-w-[220px] truncate" title={log.error_message}>
                                  {log.error_message}
                                </div>
                              )}
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              {log.status === "SENT" && <ReceiptBadge receipt={log.receipt} sentAtUtc={log.when_ts_utc} />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </ModalBody>
              <ModalFooter className="flex gap-2 justify-end flex-wrap">
                <button
                  onClick={() => requeueIds(selectedArr)}
                  disabled={working || selectedArr.length === 0}
                  className="px-4 py-2 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20 font-medium text-xs uppercase hover:bg-sky-500/20 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Reenviar selecionados ({selectedArr.length})
                </button>
                <button
                  onClick={() => requeueIds(failedRows.map((r) => r.id))}
                  disabled={working || failedRows.length === 0}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Reenviar todas as falhas ({failedRows.length})
                </button>
                <button
                  onClick={() => cancelIds(selectedArr)}
                  disabled={working || selectedArr.length === 0}
                  title="Cliente já recebeu — remove da lista de falhas sem reenviar"
                  className="px-4 py-2 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs uppercase hover:bg-rose-500/20 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Limpar selecionados
                </button>
              </ModalFooter>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
