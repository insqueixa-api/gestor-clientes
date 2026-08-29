"use client";
// app/admin/gerenciador/cobranca/page.tsx
import {
  MessageCircle,
  Loader2,
  Clock3,
  CalendarDays,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { useState, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import FormattedTimeInput from "@/components/ui/FormattedTimeInput";
import { isoDateInSaoPaulo } from "@/lib/date-br";
import { loadWhatsAppSessionOptions } from "@/lib/admin/whatsapp-modal-data";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { type ClientLight, TYPES, BILLING_TZ, Label, Input } from "./shared";
import {
  MAX_DELAY_SECS,
  MIN_DELAY_SECS,
  normalizeBillingDelayWindow,
  DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS,
  DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS,
  normalizeSecondaryContactDelay,
  DEFAULT_WINDOW_START_MIN,
  DEFAULT_WINDOW_START_MAX,
  normalizeWindowStartRange,
} from "@/lib/admin/billing-campaign-window";

// ✅ Carregamento sob demanda (15/08/2026) — os 3 modais só carregam quando
// o admin realmente abre um deles: AutomationWizard (criar/editar regra,
// o mais pesado), ImpactListModal (clientes afetados hoje) e LogsModal
// (histórico de envios da regra).
const AutomationWizard = dynamic(() => import("./AutomationWizard"), {
  ssr: false,
});
const ImpactListModal = dynamic(() => import("./ImpactListModal"), {
  ssr: false,
});
const LogsModal = dynamic(() => import("./LogsModal"), { ssr: false });

// --- TIPOS ---
type Automation = {
  id: string;
  name: string;
  is_active: boolean;
  is_automatic: boolean;
  type: string;
  // ✅ Legado — não usados mais pelo billing_enqueue_scheduled (agora lê
  // billing_campaign_settings, compartilhado entre as regras). Ficam
  // opcionais/nuláveis porque regras novas não os preenchem mais.
  schedule_time?: string | null;
  schedule_days?: number[] | null;

  // Regras
  target_status: string[];
  target_servers: string[];
  target_plans: string[];
  target_apps: string[];
  rule_date_field: string;
  rule_days_diff: number;

  message_template?: { name: string };
  last_run_at: string | null;

  // ✅ NOVOS CAMPOS (Para Edição e Controle)
  execution_status?: "IDLE" | "RUNNING" | "PAUSED";
  message_template_id: string; // Obrigatório para o formulário saber qual ID selecionar na edição
  whatsapp_session?: string;
  delay_min?: number;
};

type SelectOption = { id: string; label: string };

const DAYS_OF_WEEK = [
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
  { id: 0, label: "Dom" },
];

// =====================
// TIMEZONE (SP) + HELPERS (GLOBAL)
// =====================
function formatDateTimeSP(input?: string | null): string {
  if (!input) return "Nunca";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "Nunca";
  return d.toLocaleString("pt-BR", { timeZone: BILLING_TZ });
}

function getExpectedRunDateSP(baseDateStr: string, daysDiff: number) {
  const dBase = new Date(baseDateStr);
  if (isNaN(dBase.getTime())) return null;

  // Descobre que dia foi em SP a data base
  const baseDateSP = isoDateInSaoPaulo(dBase);

  // Força meio dia para somar/subtrair sem bugar por fuso
  const dTarget = new Date(`${baseDateSP}T12:00:00-03:00`);
  dTarget.setDate(dTarget.getDate() + daysDiff);

  return isoDateInSaoPaulo(dTarget);
}


// ============================================================================
// PÁGINA PRINCIPAL
// ============================================================================

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
};

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

function GlobalQueueMonitor({
  addToast,
}: {
  addToast: (
    type: "success" | "error",
    title: string,
    msg?: string,
    durationMs?: number,
  ) => void;
}) {
  const tenantId = useTenantId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"fila" | "historico">("fila");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [queueData, setQueueData] = useState<QueueRow[]>([]);
  const [historyData, setHistoryData] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

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
        .order("when_ts_utc", { ascending: true }),
    ]);

    setQueueData((pendingRes.data as QueueRow[]) || []);
    setHistoryData((historyRes.data as QueueRow[]) || []);
    setSelected(new Set());
    setLastUpdate(new Date());
    setLoading(false);
  };

  // ✅ Sem fetch no mount de propósito — pedido do Márcio, 29/08/2026: zero
  // chamada automática enquanto o painel não é aberto, nem para mostrar
  // contagem no botão. Só busca quando ele clica.
  //
  // Enquanto o painel está aberto, atualiza a cada 2min — mesma cadência do
  // Cron 2 (billing_dispatch_check); mais rápido que isso nunca mostraria
  // nada novo. Fecha o painel, para de consultar.
  useEffect(() => {
    if (!open) return;
    fetchAll();
    const id = setInterval(fetchAll, 2 * 60 * 1000);
    return () => clearInterval(id);
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
  const failedRows = historyData.filter((r) => r.status === "FAILED");
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
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              {lastUpdate && (
                <span className="text-[10px] text-muted-foreground">
                  Atualizado {lastUpdate.toLocaleTimeString("pt-BR")}
                </span>
              )}
            </div>
          </ModalHeader>

          {tab === "fila" ? (
            <>
              <ModalBody className="p-0">
                {queueData.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">Fila vazia no momento.</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 text-muted-foreground font-medium text-xs uppercase sticky top-0">
                      <tr>
                        <th className="p-4">Quando</th>
                        <th className="p-4">Origem</th>
                        <th className="p-4">Cliente</th>
                        <th className="p-4">WhatsApp</th>
                        <th className="p-4">Mensagem</th>
                        <th className="p-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {queueData.map((job) => (
                        <tr key={job.id} className="hover:bg-muted/30 align-top">
                          <td className="p-4 text-muted-foreground whitespace-nowrap">{job.when_sp || "--"}</td>
                          <td className="p-4 font-medium text-foreground whitespace-nowrap">
                            {job.origem === "AUTOMACAO" ? "Automação" : "Envio Manual"}
                          </td>
                          <td className="p-4 font-medium text-foreground">
                            {job.client_name || <span className="text-muted-foreground font-medium">(cliente não encontrado)</span>}
                          </td>
                          <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">{job.whatsapp_username || "--"}</td>
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
                {historyData.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">Nada enviado hoje ainda.</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 text-muted-foreground font-medium text-xs uppercase sticky top-0">
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
                        <th className="p-2">WhatsApp</th>
                        <th className="p-2">Mensagem</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {historyData.map((log) => {
                        const isFailed = log.status === "FAILED";
                        return (
                          <tr key={log.id} className="hover:bg-muted/30 align-top">
                            <td className="p-2">
                              {isFailed && (
                                <input type="checkbox" checked={selected.has(log.id)} onChange={() => toggleOne(log.id)} />
                              )}
                            </td>
                            <td className="p-2 text-muted-foreground text-xs whitespace-nowrap">{log.when_sp || "--"}</td>
                            <td className="p-2 font-medium text-foreground/90">
                              {log.client_name || <span className="text-muted-foreground italic">(sem nome)</span>}
                            </td>
                            <td className="p-2 text-muted-foreground text-xs whitespace-nowrap">{log.whatsapp_username || "--"}</td>
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

// ✅ Configuração única por tenant do início/intervalo de disparo compartilhado
// entre TODAS as regras automáticas — substitui o horário fixo por regra
// (schedule_time/delay_min individuais) por uma janela única embaralhada
// entre si, reduzindo o padrão robótico de horário. Ver
// docs/sql/billing_enqueue_scheduled_campaign_window.sql.
function CampaignWindowCard({
  addToast,
  onSaved,
}: {
  addToast: (type: "success" | "error", title: string, msg?: string) => void;
  onSaved?: () => void;
}) {
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [settings, setSettings] = useState({
    window_start_min: DEFAULT_WINDOW_START_MIN,
    window_start_max: DEFAULT_WINDOW_START_MAX,
    delay_min_secs: MIN_DELAY_SECS,
    delay_max_secs: MAX_DELAY_SECS,
    secondary_contact_delay_min_secs: DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS,
    secondary_contact_delay_max_secs: DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS,
    schedule_days: [0, 1, 2, 3, 4, 5, 6] as number[],
    is_active: true,
  });

  // ✅ Texto "cru" dos 4 campos numéricos (minutos) — desacoplado de
  // `settings` (que guarda segundos já normalizados). Sem isso, cada
  // keystroke chamava normalize/clamp e reescrevia o campo na hora — apagar
  // o valor pra digitar outro fazia o input "pular" pro mínimo permitido no
  // meio do caminho. Agora só normaliza (e sincroniza em `settings`) no blur.
  const [draft, setDraft] = useState({
    delayMin: String(Math.round(MIN_DELAY_SECS / 60)),
    delayMax: String(Math.round(MAX_DELAY_SECS / 60)),
    secondaryMin: String(Math.round(DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS / 60)),
    secondaryMax: String(Math.round(DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS / 60)),
  });

  useEffect(() => {
    (async () => {
      const tid = tenantId;
      if (!tid) {
        setLoading(false);
        return;
      }
      const { data } = await supabaseBrowser
        .from("billing_campaign_settings")
        .select(
          "window_start_min, window_start_max, delay_min_secs, delay_max_secs, secondary_contact_delay_min_secs, secondary_contact_delay_max_secs, schedule_days, is_active",
        )
        .eq("tenant_id", tid)
        .maybeSingle();
      if (data) {
        const normalized = normalizeBillingDelayWindow(
          data.delay_min_secs ?? MIN_DELAY_SECS,
          data.delay_max_secs ?? MAX_DELAY_SECS,
        );
        const normalizedSecondary = normalizeSecondaryContactDelay(
          data.secondary_contact_delay_min_secs ?? DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS,
          data.secondary_contact_delay_max_secs ?? DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS,
        );
        const normalizedWindow = normalizeWindowStartRange(
          String(data.window_start_min || DEFAULT_WINDOW_START_MIN).slice(0, 5),
          String(data.window_start_max || DEFAULT_WINDOW_START_MAX).slice(0, 5),
        );
        setSettings({
          window_start_min: normalizedWindow.min,
          window_start_max: normalizedWindow.max,
          delay_min_secs: normalized.minSecs,
          delay_max_secs: normalized.maxSecs,
          secondary_contact_delay_min_secs: normalizedSecondary.minSecs,
          secondary_contact_delay_max_secs: normalizedSecondary.maxSecs,
          schedule_days: Array.isArray(data.schedule_days)
            ? data.schedule_days
            : [0, 1, 2, 3, 4, 5, 6],
          is_active: data.is_active ?? true,
        });
        setDraft({
          delayMin: String(Math.round(normalized.minSecs / 60)),
          delayMax: String(Math.round(normalized.maxSecs / 60)),
          secondaryMin: String(Math.round(normalizedSecondary.minSecs / 60)),
          secondaryMax: String(Math.round(normalizedSecondary.maxSecs / 60)),
        });
      }
      setLoading(false);
    })();
  }, [tenantId]);

  const handleSave = async () => {
    // ✅ Normaliza a partir do DRAFT (texto do input), não de `settings` —
    // se o usuário digitou e clicou Salvar direto, sem sair do campo
    // (blur), `settings` ainda teria o valor antigo.
    const normalized = normalizeBillingDelayWindow(
      Number(draft.delayMin) * 60,
      Number(draft.delayMax) * 60,
    );
    const normalizedSecondary = normalizeSecondaryContactDelay(
      Number(draft.secondaryMin) * 60,
      Number(draft.secondaryMax) * 60,
    );
    const normalizedWindow = normalizeWindowStartRange(
      settings.window_start_min,
      settings.window_start_max,
    );
    const nextSettings = {
      ...settings,
      window_start_min: normalizedWindow.min,
      window_start_max: normalizedWindow.max,
      delay_min_secs: normalized.minSecs,
      delay_max_secs: normalized.maxSecs,
      secondary_contact_delay_min_secs: normalizedSecondary.minSecs,
      secondary_contact_delay_max_secs: normalizedSecondary.maxSecs,
    };
    setSettings(nextSettings);
    setDraft({
      delayMin: String(Math.round(normalized.minSecs / 60)),
      delayMax: String(Math.round(normalized.maxSecs / 60)),
      secondaryMin: String(Math.round(normalizedSecondary.minSecs / 60)),
      secondaryMax: String(Math.round(normalizedSecondary.maxSecs / 60)),
    });
    if (nextSettings.delay_max_secs < nextSettings.delay_min_secs) {
      addToast(
        "error",
        "Intervalo inválido",
        "O máximo não pode ser menor que o mínimo.",
      );
      return;
    }
    setSaving(true);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Sessão inválida.");

      const { error } = await supabaseBrowser
        .from("billing_campaign_settings")
        .upsert(
          {
            tenant_id: tid,
            window_start_min: nextSettings.window_start_min,
            window_start_max: nextSettings.window_start_max,
            delay_min_secs: nextSettings.delay_min_secs,
            delay_max_secs: nextSettings.delay_max_secs,
            secondary_contact_delay_min_secs: nextSettings.secondary_contact_delay_min_secs,
            secondary_contact_delay_max_secs: nextSettings.secondary_contact_delay_max_secs,
            schedule_days: nextSettings.schedule_days,
            is_active: nextSettings.is_active,
          },
          { onConflict: "tenant_id" },
        );

      if (error) throw error;
      addToast("success", "Salvo", "Configuração de disparo atualizada.");
      onSaved?.();
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSaving(false);
    }
  };

  // ✅ "Rodar agora" — dispara o enfileirador (billing_enqueue_scheduled) na
  // hora, sem esperar os horários fixos (6h/7h/12h). Pensado pra emergência
  // (ex: automação virou RUNNING fora desses horários e não dá pra esperar
  // o próximo).
  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");

      const res = await fetch("/api/whatsapp/billing-enqueue-now", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao rodar o enfileirador.");

      const created = Number(json?.created ?? 0);
      addToast(
        "success",
        "Enfileirador rodou",
        created > 0
          ? `${created} mensage${created === 1 ? "m" : "ns"} enfileirada${created === 1 ? "" : "s"}.`
          : "Nenhuma mensagem nova — tudo que era elegível hoje já está na fila.",
      );
      onSaved?.();
    } catch (e: any) {
      addToast("error", "Erro ao rodar agora", e.message);
    } finally {
      setRunningNow(false);
    }
  };

  if (loading) return null;

  const activeDays = settings.schedule_days.length;
  const windowStartLabel =
    settings.window_start_min === settings.window_start_max
      ? settings.window_start_min
      : `${settings.window_start_min}–${settings.window_start_max}`;
  const windowLabel = `${windowStartLabel} · ${Math.round(settings.delay_min_secs / 60)}–${Math.round(settings.delay_max_secs / 60)} min`;

  return (
    <div className="px-3 sm:px-0 md:px-4">
      <div className="rounded-2xl border border-border bg-card/95 p-3 shadow-sm sm:p-4">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Janela de disparo compartilhada
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <Clock3 className="h-3 w-3 text-foreground/70" />
                  {windowLabel}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <CalendarDays className="h-3 w-3 text-foreground/70" />
                  {activeDays} dias
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground max-w-3xl">
                Disparo embaralhado entre as regras, respeitando a faixa de 2 a
                30 minutos entre envios. O horário de início também é
                sorteado dentro da faixa configurada — 1 vez por dia, não a
                cada envio.
              </p>
            </div>

            <div className="flex items-center gap-2 self-start lg:shrink-0">
              <button
                onClick={() =>
                  setSettings((s) => ({ ...s, is_active: !s.is_active }))
                }
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] transition-all ${settings.is_active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted text-muted-foreground"}`}
                title={
                  settings.is_active
                    ? "Ativo"
                    : "Desativado — nenhuma automação dispara"
                }
              >
                <span
                  className={`relative h-2.5 w-2.5 rounded-full ${settings.is_active ? "bg-emerald-500" : "bg-muted-foreground"}`}
                />
                {settings.is_active ? "Ativo" : "Inativo"}
              </button>
              <button
                onClick={handleRunNow}
                disabled={runningNow}
                title="Enfileira agora, sem esperar o próximo horário fixo (6h/7h/12h)"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-muted/70 disabled:opacity-50"
              >
                {runningNow ? "Rodando..." : "Rodar agora"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-2">
              <Label>Início (mín.)</Label>
              <FormattedTimeInput
                value={settings.window_start_min}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, window_start_min: e.target.value }))
                }
                className="h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm"
              />
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-2">
              <Label>Início (máx.)</Label>
              <FormattedTimeInput
                value={settings.window_start_max}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, window_start_max: e.target.value }))
                }
                className="h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm"
              />
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-2">
              <Label>Intervalo mín. (min)</Label>
              <Input
                type="number"
                min={2}
                max={30}
                step={1}
                value={draft.delayMin}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, delayMin: e.target.value }))
                }
                onBlur={() => {
                  const normalized = normalizeBillingDelayWindow(
                    Number(draft.delayMin) * 60,
                    settings.delay_max_secs,
                  );
                  setSettings((s) => ({ ...s, delay_min_secs: normalized.minSecs }));
                  setDraft((d) => ({
                    ...d,
                    delayMin: String(Math.round(normalized.minSecs / 60)),
                  }));
                }}
                className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm"
              />
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-2">
              <Label>Intervalo máx. (min)</Label>
              <Input
                type="number"
                min={2}
                max={30}
                step={1}
                value={draft.delayMax}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, delayMax: e.target.value }))
                }
                onBlur={() => {
                  const normalized = normalizeBillingDelayWindow(
                    settings.delay_min_secs,
                    Number(draft.delayMax) * 60,
                  );
                  setSettings((s) => ({ ...s, delay_max_secs: normalized.maxSecs }));
                  setDraft((d) => ({
                    ...d,
                    delayMax: String(Math.round(normalized.maxSecs / 60)),
                  }));
                }}
                className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm"
              />
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-4">
              <Label>Dias da semana</Label>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {DAYS_OF_WEEK.map((d) => {
                  const selected = settings.schedule_days.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          schedule_days: selected
                            ? s.schedule_days.filter((x) => x !== d.id)
                            : [...s.schedule_days, d.id],
                        }))
                      }
                      className={`h-7 min-w-7 rounded-full border px-1.5 text-[10px] font-semibold transition-all ${selected ? "border-emerald-500 bg-emerald-500 text-white shadow-sm" : "border-border bg-muted text-muted-foreground"}`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-2">
              <Label>2º contato mín. (min)</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step={1}
                value={draft.secondaryMin}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, secondaryMin: e.target.value }))
                }
                onBlur={() => {
                  const normalized = normalizeSecondaryContactDelay(
                    Number(draft.secondaryMin) * 60,
                    settings.secondary_contact_delay_max_secs,
                  );
                  setSettings((s) => ({
                    ...s,
                    secondary_contact_delay_min_secs: normalized.minSecs,
                  }));
                  setDraft((d) => ({
                    ...d,
                    secondaryMin: String(Math.round(normalized.minSecs / 60)),
                  }));
                }}
                className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm"
              />
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-2">
              <Label>2º contato máx. (min)</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step={1}
                value={draft.secondaryMax}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, secondaryMax: e.target.value }))
                }
                onBlur={() => {
                  const normalized = normalizeSecondaryContactDelay(
                    settings.secondary_contact_delay_min_secs,
                    Number(draft.secondaryMax) * 60,
                  );
                  setSettings((s) => ({
                    ...s,
                    secondary_contact_delay_max_secs: normalized.maxSecs,
                  }));
                  setDraft((d) => ({
                    ...d,
                    secondaryMax: String(Math.round(normalized.maxSecs / 60)),
                  }));
                }}
                className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm"
              />
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-2.5 xl:col-span-8 flex items-center">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Quando a conta tem WhatsApp principal + secundário, o segundo
                envio espera um tempo sorteado dentro dessa faixa depois do
                primeiro, pra não sair "em cima".
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const tenantId = useTenantId();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [clients, setClients] = useState<ClientLight[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});
  const { confirm } = useConfirm();

  // ✅ MODAIS (Atualizado para suportar Edição e Logs)
  const [wizardState, setWizardState] = useState<{
    show: boolean;
    editingRule: Automation | null;
  }>({ show: false, editingRule: null });
  const [impactModalData, setImpactModalData] = useState<{
    ruleId: string;
    ruleName: string;
    clients: ClientLight[];
    ruleDateField?: string;
  } | null>(null);
  const [logsModalData, setLogsModalData] = useState<{
    ruleId: string;
    ruleName: string;
  } | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Dados auxiliares
  const [auxData, setAuxData] = useState<{
    templates: SelectOption[];
    servers: SelectOption[];
    plans: SelectOption[];
    apps: SelectOption[];
    sessions: SelectOption[]; // ✅
  }>({
    templates: [],
    servers: [],
    plans: [],
    apps: [],
    // ✅ Sessão default some antes do fetch de perfil do WhatsApp resolver
    // (não bloqueia mais o loading — ver loadData) — mantém o seletor com
    // pelo menos essa opção em vez de vazio nesse intervalo.
    sessions: [{ id: "default", label: "Contato principal" }],
  });

  const addToast = (
    type: "success" | "error",
    title: string,
    msg?: string,
    durationMs = 5000,
  ) => {
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    setToasts((p) => [...p, { id, type, title, message: msg, durationMs }]);
  };

  const removeToast = (id: number) =>
    setToasts((p) => p.filter((t) => t.id !== id));

  async function loadData() {
    setLoading(true);
    const tid = tenantId;

    if (!tid) {
      setLoading(false);
      return;
    }

    try {
      // ✅ As 5 consultas ao banco (regras, clientes, templates, servidores,
      // apps) são independentes entre si — Promise.all. O perfil do
      // WhatsApp (sessões 1/2) fica de FORA dessa Promise.all de propósito
      // (achado 24/08/2026): ele faz proxy pra VM com timeout de 12s (ver
      // lib/whatsapp/wa-context.ts), e só é usado pro seletor de sessão
      // dentro do modal de criar/editar regra — não pra exibir a lista de
      // regras. Antes, a lista inteira ficava travada em "carregando" até
      // a VM responder (ou estourar os 12s), mesmo com os dados de
      // verdade já prontos há tempo.
      const [autoRes, clientRes, msgRes, srvRes, appRes] = await Promise.all([
        // 1. Busca Automações (autoRes)
        supabaseBrowser
          .from("billing_automations")
          .select(`*, message_template:message_templates(id, name)`)
          .eq("tenant_id", tid)
          .order("created_at", { ascending: false }),

        // 2. Busca Clientes (clientRes)
        supabaseBrowser
          .from("vw_clients_list_active")
          .select(
            `
            id,
            display_name:client_name,
            whatsapp_username,
            server_id,
            server_name,
            plan_label:plan_name,
            vencimento,
            created_at,
            computed_status,
            apps_names,
            username,
            secondary_display_name,
            secondary_whatsapp_username,
            price_amount
          `,
          )
          .eq("tenant_id", tid),

        // 3. Busca Templates (msgRes)
        supabaseBrowser
          .from("message_templates")
          .select("id, name, category")
          .eq("tenant_id", tid),

        // 4. Busca Servidores (srvRes)
        supabaseBrowser.from("servers").select("id, name").eq("tenant_id", tid),

        // 5. Busca Apps (appRes)
        supabaseBrowser.from("apps").select("id, name").eq("tenant_id", tid),
      ]);

      const autoData = autoRes.data;
      const clientData = clientRes.data;

      // Extrai planos únicos dos clientes carregados
      const uniquePlans = Array.from(
        new Set(
          (clientData || []).map((c: any) => c.plan_label).filter(Boolean),
        ),
      );

      setAuxData((prev) => ({
        ...prev,
        templates:
          msgRes.data?.map((m: any) => ({
            id: m.id,
            label: m.name,
            category: m.category,
          })) || [],
        servers:
          srvRes.data?.map((s: any) => ({ id: s.id, label: s.name })) || [],
        plans:
          uniquePlans.map((p) => ({ id: String(p), label: String(p) })) || [],
        apps: appRes.data?.map((a: any) => ({ id: a.id, label: a.name })) || [],
      }));

      // Casting seguro para incluir os novos campos opcionais se vierem do banco
      setAutomations((autoData as any[]) || []);
      setClients((clientData as ClientLight[]) || []);
    } catch (error: any) {
      addToast("error", "Erro ao carregar", error.message);
    } finally {
      setLoading(false);
    }

    // ✅ Sessões do WhatsApp — fora do try/finally acima de propósito: não
    // deve segurar o loading nem falhar o carregamento da página se a VM
    // estiver lenta/fora do ar (o modal simplesmente mostra só a sessão
    // "default" até isso resolver).
    loadWhatsAppSessionOptions()
      .then((sessions) => {
        setAuxData((prev) => ({ ...prev, sessions }));
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // --- ACTIONS ---
  async function toggleActive(rule: Automation) {
    const tid = tenantId;
    if (!tid) return;

    const nextActive = !rule.is_active;

    // ✅ TRAVA: Não deixa ativar se não tiver template de mensagem
    if (
      nextActive &&
      !rule.message_template_id &&
      !(rule.message_template as any)?.id
    ) {
      addToast(
        "error",
        "Falta a Mensagem",
        "Você precisa editar essa regra e vincular um modelo de mensagem antes de ativá-la.",
      );
      return;
    }

    // ✅ Se estiver DESATIVANDO e estiver executando algo, para antes
    if (!nextActive) {
      const status = rule.execution_status || "IDLE";
      if (status === "RUNNING" || status === "PAUSED") {
        await handleControl(rule, "STOP");
      }
    }

    const { error } = await supabaseBrowser
      .from("billing_automations")
      .update({ is_active: nextActive })
      .eq("id", rule.id)
      .eq("tenant_id", tid);

    if (!error) {
      setAutomations((prev) =>
        prev.map((a) =>
          a.id === rule.id ? { ...a, is_active: nextActive } : a,
        ),
      );
      addToast(
        "success",
        nextActive ? "Ativado" : "Desativado",
        "Status atualizado.",
      );
    } else {
      addToast("error", "Erro", error.message);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Excluir regra?",
      subtitle: "Essa ação remove a regra e o histórico.",
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Cancelar",
    });
    if (!ok) return;
    const tid = tenantId;
    if (!tid) return;

    const { error } = await supabaseBrowser
      .from("billing_automations")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tid);

    if (!error) {
      setAutomations((prev) => prev.filter((a) => a.id !== id));
      addToast("success", "Excluído", "Regra removida.");
    }
  }

  // --- CONTROLE DE EXECUÇÃO ---
  async function handleControl(
    rule: Automation,
    action: "PLAY" | "PAUSE" | "STOP",
  ) {
    const tid = tenantId;
    if (!tid) return;

    // ✅ Segurança: não deixa dar PLAY se a regra estiver desativada ou sem mensagem
    if (action === "PLAY") {
      if (!rule.message_template_id && !(rule.message_template as any)?.id) {
        addToast(
          "error",
          "Falta a Mensagem",
          "Vincule um modelo de mensagem antes de enviar.",
        );
        return;
      }
      if (!rule.is_active) {
        addToast(
          "error",
          "Regra desativada",
          "Ative o toggle para iniciar o envio automático.",
        );
        return;
      }
    }

    // ✅ Segurança: confirmação forte no STOP
    if (action === "STOP") {
      const ok = await confirm({
        title: "Parar agora?",
        subtitle:
          "Isso deve interromper os envios e cancelar a fila pendente desta regra.",
        tone: "rose",
        confirmText: "Parar",
        cancelText: "Voltar",
      });
      if (!ok) return;
    }

    const { error } = await supabaseBrowser.rpc("billing_control_automation", {
      p_tenant_id: tid,
      p_automation_id: rule.id,
      p_action: action,
    });

    if (error) {
      addToast("error", "Erro", error.message);
      return;
    }

    addToast("success", "Status", "Atualizado.");
    await loadData(); // fonte da verdade
  }

  // --- LÓGICA DE FILTRO (IMPACTO) ---

  /** Normaliza o status vindo da view para o padrão do sistema */
  function normalizeClientStatus(
    raw: any,
  ): "ACTIVE" | "OVERDUE" | "TRIAL" | "ARCHIVED" | string {
    const s = String(raw ?? "")
      .trim()
      .toUpperCase();

    if (["ACTIVE", "OVERDUE", "TRIAL", "ARCHIVED"].includes(s)) return s;

    if (s === "ATIVO") return "ACTIVE";
    if (s === "VENCIDO" || s === "ATRASADO" || s === "INADIMPLENTE")
      return "OVERDUE";
    if (s === "TESTE") return "TRIAL";
    if (s === "ARQUIVADO") return "ARCHIVED";

    return s;
  }

  function dayOfWeekInTZ(d: Date = new Date(), tz = BILLING_TZ): number {
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(d);
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[wd] ?? d.getDay();
  }

  function shouldRunToday(rule: Automation): boolean {
    if (!rule.is_automatic) return true;

    const todayDow = dayOfWeekInTZ(new Date(), BILLING_TZ);
    const days = Array.isArray(rule.schedule_days) ? rule.schedule_days : [];
    if (days.length === 0) return true;
    return days.includes(todayDow);
  }

  function normalizeRuleDateField(raw: any): "vencimento" | "created_at" {
    const s = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (s === "vencimento") return "vencimento";
    if (s === "cadastro") return "created_at";
    if (s === "created_at") return "created_at";
    return "created_at";
  }

  const getImpactedClients = (rule: Automation): ClientLight[] => {
    if (!shouldRunToday(rule)) return [];

    // ✅ Hoje exato em São Paulo
    const todaySP = isoDateInSaoPaulo(new Date());

    const ruleStatuses = rule.target_status?.length
      ? rule.target_status.map(normalizeClientStatus)
      : null;

    return clients.filter((client) => {
      // 1) STATUS
      const clientStatus = normalizeClientStatus(client.computed_status);
      if (ruleStatuses?.length) {
        if (!ruleStatuses.includes(clientStatus)) return false;
      }

      // 2) SERVIDOR
      if (rule.target_servers?.length) {
        if (!rule.target_servers.includes(client.server_id)) return false;
      }

      // 3) PLANO
      if (rule.target_plans?.length) {
        const plan = String(client.plan_label ?? "");
        if (!rule.target_plans.includes(plan)) return false;
      }

      // 4) APLICATIVOS
      if (rule.target_apps?.length) {
        const clientApps = client.apps_names || [];
        const hasApp = clientApps.some((app) => rule.target_apps.includes(app));
        if (!hasApp) return false;
      }

      // 5) DATA (Fuso horário garantido SP)
      const field = normalizeRuleDateField(rule.rule_date_field);
      const targetDateStr =
        field === "vencimento" ? client.vencimento : client.created_at;
      if (!targetDateStr) return false;

      // Usando a nova função SP
      const expectedRunDate = getExpectedRunDateSP(
        targetDateStr,
        Number(rule.rule_days_diff),
      );

      return expectedRunDate === todaySP;
    });
  };

  const impactedByRule = useMemo(() => {
    const map = new Map<string, ClientLight[]>();
    for (const r of automations) {
      map.set(r.id, getImpactedClients(r));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automations, clients]);

  const sections = useMemo(() => {
    const grouped = new Map<string, Automation[]>();
    for (const automation of automations) {
      const key = automation.type || "Outros";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(automation);
    }

    return [
      ...TYPES.filter((type) => grouped.has(type)).map((type) => ({
        key: type,
        label: type,
        items: grouped.get(type) || [],
      })),
      ...Array.from(grouped.entries())
        .filter(([type]) => !TYPES.includes(type))
        .map(([type, items]) => ({ key: type, label: type, items })),
    ].filter((section) => section.items.length > 0);
  }, [automations]);

  useEffect(() => {
    setCollapsedSections((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const section of sections) {
        if (!(section.key in next)) {
          next[section.key] = false;
          changed = true;
        }
      }

      for (const key of Object.keys(next)) {
        if (!sections.some((section) => section.key === key)) {
          delete next[key];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [sections]);

  const handleManualRun = async (rule: Automation) => {
    if (!rule.message_template_id && !(rule.message_template as any)?.id) {
      addToast(
        "error",
        "Falta a Mensagem",
        "Edite a regra e vincule um modelo de mensagem antes de enviar.",
      );
      return;
    }
    if (!rule.is_active) {
      addToast(
        "error",
        "Regra desativada",
        "Ative o toggle para usar o envio manual.",
      );
      return;
    }

    const affected = getImpactedClients(rule);
    if (affected.length === 0) {
      addToast("error", "Sem alvos", "Nenhum cliente atende a regra hoje.");
      return;
    }

    const ok = await confirm({
      title: "Enfileirar agora?",
      subtitle: `Deseja enfileirar mensagens para ${affected.length} clientes?`,
      tone: "amber",
      confirmText: "Enfileirar",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    const tid = tenantId;
    if (!tid) return;

    try {
      const templateId =
        rule.message_template_id || (rule.message_template as any)?.id;
      if (!templateId)
        throw new Error(
          "Esta regra não tem um template de mensagem vinculado.",
        );

      const { data: tpl, error: tplErr } = await supabaseBrowser
        .from("message_templates")
        .select("content, image_url") // ✅ AGORA PUXA A IMAGEM TAMBÉM
        .eq("id", templateId)
        .single();

      if (tplErr || !tpl)
        throw new Error("Falha ao carregar o texto do template.");

      // ✅ Mesma estratégia anti-detecção do motor automático: sorteia entre
      // o texto original e as variantes cadastradas (uma por cliente), e usa
      // o intervalo aleatório configurado no card "Início do disparo" — em
      // vez de mandar o texto idêntico pra todo mundo com um intervalo fixo
      // e previsível.
      const [{ data: variantRows }, { data: campaignSettings }] =
        await Promise.all([
          supabaseBrowser
            .from("message_template_variants")
            .select("content")
            .eq("tenant_id", tid)
            .eq("template_id", templateId),
          supabaseBrowser
            .from("billing_campaign_settings")
            .select("delay_min_secs, delay_max_secs")
            .eq("tenant_id", tid)
            .maybeSingle(),
        ]);

      const textPool = [
        tpl.content,
        ...(variantRows || []).map((v: any) => v.content),
      ].filter((c): c is string => !!c && String(c).trim().length > 0);
      const normalized = normalizeBillingDelayWindow(
        campaignSettings?.delay_min_secs ?? MIN_DELAY_SECS,
        campaignSettings?.delay_max_secs ?? MAX_DELAY_SECS,
      );
      const delayMinSecs = normalized.minSecs;
      const delayMaxSecs = normalized.maxSecs;

      let currentSendAt = new Date(); // Começa "Agora"

      const inserts = affected.map((client) => {
        const delaySecs =
          delayMinSecs +
          Math.floor(Math.random() * (delayMaxSecs - delayMinSecs + 1));
        currentSendAt = new Date(currentSendAt.getTime() + delaySecs * 1000);

        const pickedText =
          textPool[Math.floor(Math.random() * textPool.length)];

        return {
          tenant_id: tid,
          client_id: client.id,
          automation_id: rule.id,

          message_template_id: templateId,
          message: pickedText,
          image_url: tpl.image_url || null, // ✅ SALVA A IMAGEM NA FILA (CRON)
          status: "SCHEDULED",
          send_at: currentSendAt.toISOString(),
          whatsapp_session: rule.whatsapp_session || "default",
        };
      }); // 3. Salva tudo no banco de uma vez

      const { error: insErr } = await supabaseBrowser
        .from("client_message_jobs")
        .insert(inserts);

      if (insErr) throw insErr; // 4. Atualiza "Último Envio" na tela

      await supabaseBrowser
        .from("billing_automations")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", rule.id);

      addToast(
        "success",
        "Fila Criada!",
        `${inserts.length} mensagens foram agendadas. O envio ocorrerá gradualmente.`,
      );
      await loadData();
    } catch {
      addToast(
        "error",
        "Erro ao enfileirar",
        "Verifique as configurações e tente novamente.",
      );
    }
  };

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* Topo (padrão admin) */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-medium tracking-tight truncate text-foreground">
              Automação de Cobranças
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <GlobalQueueMonitor addToast={addToast} />
          <button
            onClick={() => setWizardState({ show: true, editingRule: null })}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="text-base md:text-lg leading-none mb-0.5">+</span>
            Nova Regra
          </button>
        </div>
      </div>
      {/* Início do disparo compartilhado (janela única entre as regras) */}
      <CampaignWindowCard addToast={addToast} />
      {/* LISTA AGRUPADA POR TIPO */}
      {loading ? (
        <div className="text-center py-10 text-muted-foreground animate-pulse">
          Carregando automações...
        </div>
      ) : automations.length === 0 ? (
        <div className="mx-3 sm:mx-0 md:mx-4 flex flex-col items-center justify-center py-20 bg-card border border-dashed border-border rounded-2xl">
          <div className="w-16 h-16 bg-transparent border border-border rounded-full flex items-center justify-center mb-4 text-3xl">
            🤖
          </div>
          <h3 className="text-lg font-medium text-foreground/90">
            Nenhuma regra ativa
          </h3>
          <p className="text-sm text-foreground/70 mt-1">
            Crie sua primeira automação de cobrança.
          </p>
        </div>
      ) : (
        <div className="space-y-4 px-3 sm:px-0 md:px-4">
          {sections.map((section) => {
            const isCollapsed = collapsedSections[section.key];
            const activeCount = section.items.filter(
              (item) => item.is_active,
            ).length;

            return (
              <section
                key={section.key}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
              >
                <button
                  onClick={() =>
                    setCollapsedSections((prev) => ({
                      ...prev,
                      [section.key]: !prev[section.key],
                    }))
                  }
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-foreground">
                        {section.label}
                      </h2>
                      <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {section.items.length} regras
                      </span>
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-600">
                        {activeCount} ativas
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isCollapsed
                        ? "Seção compactada"
                        : "Exibindo regras deste grupo"}
                    </p>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
                    {isCollapsed ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="border-t border-border px-3 py-3 sm:px-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {section.items.map((auto) => {
                        const impacted = impactedByRule.get(auto.id) ?? [];
                        const sessionInfo = auxData.sessions.find(
                          (s) => s.id === (auto.whatsapp_session || "default"),
                        );

                        return (
                          <AutomationCard
                            key={auto.id}
                            data={auto}
                            impactCount={impacted.length}
                            sessionLabel={sessionInfo?.label}
                            onToggle={() => toggleActive(auto)}
                            onDelete={() => handleDelete(auto.id)}
                            onEdit={() =>
                              setWizardState({ show: true, editingRule: auto })
                            }
                            onShowImpact={() =>
                              setImpactModalData({
                                ruleId: auto.id,
                                ruleName: auto.name,
                                clients: impacted,
                                ruleDateField: auto.rule_date_field,
                              })
                            }
                            onControl={(action) => handleControl(auto, action)}
                            onShowLogs={() =>
                              setLogsModalData({
                                ruleId: auto.id,
                                ruleName: auto.name,
                              })
                            }
                            onRun={() => handleManualRun(auto)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {/* WIZARD COM EDIÇÃO */}     {" "}
      {wizardState.show && (
        <AutomationWizard
          auxData={auxData}
          editingRule={wizardState.editingRule}
          onClose={() => setWizardState({ show: false, editingRule: null })}
          onSuccess={() => {
            setWizardState({ show: false, editingRule: null });
            loadData();
            addToast("success", "Salvo", "Regra atualizada.");
          }}
          onError={(msg) => addToast("error", "Erro", msg)}
        />
      )}
      {/* MODAL DE IMPACTO (LISTA DE CLIENTES) */}
      {impactModalData && (
        <ImpactListModal
          data={impactModalData}
          onClose={() => setImpactModalData(null)}
        />
      )}
      {logsModalData && (
        <LogsModal
          ruleId={logsModalData.ruleId}
          ruleName={logsModalData.ruleName}
          onClose={() => setLogsModalData(null)}
        />
      )}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

// ============================================================================
// CARD COMPACTO (3 POR LINHA) - CORRIGIDO
// ============================================================================
function AutomationCard({
  data,
  impactCount,
  onToggle,
  onDelete,
  onShowImpact,
  onRun,
  // ✅ Adicionadas as props que faltavam na chamada do componente pai
  onEdit,
  onControl,
  onShowLogs,
  sessionLabel, // ✅ ADICIONE ESTA LINHA AQUI
}: any) {
  const getRuleText = () => {
    const fieldLabel =
      data.rule_date_field === "cadastro" ||
      data.rule_date_field === "created_at"
        ? "cadastro"
        : "vencimento";
    if (data.rule_days_diff === 0) return `No dia do ${fieldLabel}`;
    const dayText = Math.abs(data.rule_days_diff) === 1 ? "dia" : "dias";
    if (data.rule_days_diff > 0)
      return `${data.rule_days_diff} ${dayText} APÓS ${fieldLabel}`;
    return `${Math.abs(data.rule_days_diff)} ${dayText} ANTES ${fieldLabel}`;
  };

  // ✅ Pega o status real do banco (ou assume IDLE se nulo)
  const status = data.execution_status || "IDLE";

  return (
    <div
      className={`bg-card border rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between h-full relative overflow-hidden group ${data.is_active ? "border-t-4 border-t-emerald-500 border-x-border border-b-border" : "border-border opacity-75 grayscale-[0.8] hover:grayscale-0"}`}
    >
      {/* Header: Nome e Toggle */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 pr-2">
          <h3
            className="font-medium text-foreground text-base line-clamp-1"
            title={data.name}
          >
            {data.name}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-transparent text-muted-foreground uppercase border border-border tracking-wider">
              {data.type}
            </span>
            <span
              className={`text-[10px] font-medium ${data.is_automatic ? "text-purple-500" : "text-amber-500"}`}
            >
              {data.is_automatic ? "AUTO" : "MANUAL"}
            </span>
            {/* ✅ VISUAL DO STATUS (Se estiver rodando, mostra aqui) */}
            {status === "RUNNING" && (
              <span className="text-[10px] font-medium text-white bg-emerald-500 px-1.5 py-0.5 rounded animate-pulse">
                EXECUTANDO {data.is_automatic ? "AUTO" : "MANUAL"}
              </span>
            )}

            {status === "PAUSED" && (
              <span className="text-[10px] font-medium text-white bg-amber-500 px-1.5 py-0.5 rounded">
                PAUSADO {data.is_automatic ? "AUTO" : "MANUAL"}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${data.is_active ? "bg-emerald-500" : "bg-muted"}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition ${data.is_active ? "translate-x-4.5" : "translate-x-1"}`}
          />
        </button>
      </div>

      {/* Info do Disparo */}
      <div className="space-y-2 mb-4 bg-transparent p-3 rounded-lg border border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="text-base">📅</span>
          <span className="font-medium">{getRuleText()}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="text-base">
            <MessageCircle className="w-4 h-4" />
          </span>
          <span
            className="truncate max-w-[200px]"
            title={data.message_template?.name}
          >
            {data.message_template?.name || "Sem mensagem"}
          </span>
        </div>
        {data.is_automatic && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="text-base">⏰</span>
            <span>Dentro da janela de disparo do grupo</span>
          </div>
        )}
        {/* ✅ SESSÃO DO WHATSAPP COM STATUS E NÚMERO REAIS */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 mt-1 border-t border-border">
          <span className="text-base">📱</span>
          <span className="truncate" title={sessionLabel}>
            Sessão:{" "}
            <strong className="text-foreground/90">
              {sessionLabel || "Carregando..."}
            </strong>
          </span>
        </div>
      </div>

      {/* Métricas e Botões */}
      <div className="mt-auto">
        <div className="flex justify-between items-end border-t border-border pt-3">
          {/* Botão de Impacto (Clicável) */}
          <div
            onClick={onShowImpact}
            className="cursor-pointer group/impact"
            title="Clique para ver os clientes"
          >
            <div className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider mb-0.5">
              Afetados Hoje
            </div>
            <div className="text-xl font-medium text-foreground group-hover/impact:text-emerald-500 transition-colors flex items-center gap-1">
              {impactCount}
              <span className="text-xs text-muted-foreground font-medium group-hover/impact:text-emerald-500">
                clientes
              </span>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider mb-1">
              Ações
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              {/* =========================
                        1) AUTO: botão vira "Ativar automático" / "Cancelar automático"
                        ========================= */}
              {data.is_automatic && (
                <>
                  {status !== "RUNNING" ? (
                    <button
                      onClick={() => onControl("PLAY")}
                      disabled={!data.is_active}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        data.is_active
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                          : "bg-muted text-muted-foreground border-transparent cursor-not-allowed"
                      }`}
                      title="Ativa a execução automática"
                    >
                      Ativar automático
                    </button>
                  ) : (
                    <button
                      onClick={() => onControl("STOP")}
                      disabled={!data.is_active}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        data.is_active
                          ? "bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20"
                          : "bg-muted text-muted-foreground border-transparent cursor-not-allowed"
                      }`}
                      title="Cancela a execução automática"
                    >
                      Cancelar automático
                    </button>
                  )}
                </>
              )}

              {/* MANUAL */}
              <button
                onClick={onRun}
                disabled={!data.is_active}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  data.is_active
                    ? "bg-sky-500/10 text-sky-500 border-sky-500/20 hover:bg-sky-500/20"
                    : "bg-muted text-muted-foreground border-transparent cursor-not-allowed"
                }`}
                title="Dispara agora"
              >
                Envio Manual
              </button>

              {/* CONTROLES DE PAUSA/STOP */}
              {!data.is_automatic && status === "RUNNING" && (
                <>
                  <button
                    onClick={() => onControl("PAUSE")}
                    className="px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-500 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                  >
                    Pausar
                  </button>
                  <button
                    onClick={() => onControl("STOP")}
                    className="px-3 py-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-xs font-medium hover:bg-rose-500/20 transition-colors"
                  >
                    Parar agora
                  </button>
                </>
              )}

              {!data.is_automatic && status === "PAUSED" && (
                <>
                  <button
                    onClick={() => onControl("PLAY")}
                    disabled={!data.is_active}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      data.is_active
                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                        : "bg-muted text-muted-foreground border-transparent cursor-not-allowed"
                    }`}
                  >
                    Retomar
                  </button>
                  <button
                    onClick={() => onControl("STOP")}
                    className="px-3 py-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-xs font-medium hover:bg-rose-500/20 transition-colors"
                  >
                    Parar agora
                  </button>
                </>
              )}

              {/* SECUNDÁRIOS */}
              <button
                onClick={onEdit}
                className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                title="Editar"
              >
                Editar
              </button>

              <button
                onClick={onShowLogs}
                className="px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-500 text-xs font-medium hover:bg-purple-500/20 transition-colors"
                title="Logs"
              >
                Logs
              </button>

              <button
                onClick={onDelete}
                className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium hover:bg-rose-500/20 transition-colors"
                title="Excluir"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>

        {/* Data Ultimo Envio */}
        <div className="mt-2 text-[9px] text-center text-muted-foreground">
          Último envio: {formatDateTimeSP(data.last_run_at)}
        </div>
      </div>
    </div>
  );
}

