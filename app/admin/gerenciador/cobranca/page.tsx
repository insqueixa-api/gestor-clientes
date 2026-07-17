"use client";
// app/admin/gerenciador/cobranca/page.tsx
import { MessageCircle, X } from "lucide-react";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, {
  ToastMessage,
} from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import FormattedTimeInput from "@/app/admin/FormattedTimeInput";

// --- TIPOS ---
type Automation = {
  id: string;
  name: string;
  is_active: boolean;
  is_automatic: boolean;
  type: string;
  schedule_time: string;
  schedule_days: number[];

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

// Tipo simplificado de cliente para cálculo de impacto
type ClientLight = {
  id: string;
  display_name: string;
  whatsapp_username: string;
  server_id: string;
  plan_label: string;
  vencimento: string | null;
  created_at: string;
  computed_status: string;
  server_name?: string;
  apps_names?: string[];

  // ✅ Novos campos do Banco
  username?: string;
  secondary_display_name?: string;
  secondary_whatsapp_username?: string;
  price_amount?: number;
};


type SelectOption = { id: string; label: string };

const TYPES = [
  "Vencimento",
  "Pós-Venda",
  "Manutenção",
  "Divulgação",
  "Boas Vindas",
  "Outros",
];
const CLIENT_STATUS = [
  { id: "ACTIVE", label: "Ativo" },
  { id: "OVERDUE", label: "Vencido" },
  { id: "TRIAL", label: "Teste" },
  { id: "ARCHIVED", label: "Arquivado" },
];
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
const BILLING_TZ = "America/Sao_Paulo";

function formatDateTimeSP(input?: string | null): string {
  if (!input) return "Nunca";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "Nunca";
  return d.toLocaleString("pt-BR", { timeZone: BILLING_TZ });
}

function formatDateSP(input?: string | null): string {
  if (!input) return "--";
  let d = new Date(input);
  if (isNaN(d.getTime())) return "--";

  // ✅ Blindagem contra shift de timezone em datas YYYY-MM-DD
  if (input.length === 10 && input.includes("-")) {
    d = new Date(`${input}T12:00:00-03:00`);
  }
  return d.toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}

// ✅ NOVO: Função para ler a hora que já vem do banco
function formatTimeSP(input?: string | null): string {
  if (!input) return "";
  let d = new Date(input);
  if (isNaN(d.getTime())) return "";
  // Se veio apenas a data YYYY-MM-DD, não temos hora exata
  if (input.length === 10 && input.includes("-")) return "";

  return d.toLocaleTimeString("pt-BR", {
    timeZone: BILLING_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isoDateInSaoPaulo(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // YYYY-MM-DD
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

// =====================
// HELPERS WHATSAPP (UI)
// =====================

function extractWaNumberFromJid(jid?: unknown): string {
  if (typeof jid !== "string") return "";

  // Ex: "5521992347771:9@s.whatsapp.net"
  // 1) remove domínio -> "5521992347771:9"
  // 2) remove device id -> "5521992347771"
  const raw = jid.split("@")[0]?.split(":")[0] ?? "";
  return raw.replace(/\D/g, "");
}

function formatBRPhoneFromDigits(digits: string): string {
  // Esperado BR: 55 + DDD(2) + número(8/9)
  if (!digits) return "";

  if (digits.startsWith("55") && digits.length >= 12) {
    const country = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4); // 8 ou 9 dígitos

    // 9 dígitos: 99999-9999 | 8 dígitos: 9999-9999
    if (rest.length === 9) {
      return `+${country} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    if (rest.length === 8) {
      return `+${country} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }

    // fallback se vier estranho
    return `+${country} (${ddd}) ${rest}`;
  }

  // fallback internacional
  return `+${digits}`;
}

function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  if (!profile?.connected) return `${sessionName} (Desconectado)`;
  const digits = extractWaNumberFromJid(profile?.jid);
  const pretty = formatBRPhoneFromDigits(digits);

  // ✅ Formatação limpa: Nome da Sessão  |  Número
  return pretty ? `${sessionName}  |  ${pretty}` : `${sessionName} (Conectado)`;
}

// ============================================================================
// ✅ MONITOR GLOBAL DE FILA (CORRIGIDO: SEM JOIN QUEBRADO)
// ============================================================================
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
  const [loading, setLoading] = useState(false);
  const [queueData, setQueueData] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // 1. Polling: Busca a fila (Simplificado para não falhar)
  useEffect(() => {
    const fetchQueue = async () => {
      const tid = await getCurrentTenantId();
      if (!tid) return;

      // ✅ BLINDAGEM: garante que o usuário logado pertence ao tenant
      {
        const { data: u } = await supabaseBrowser.auth.getUser();
        const userId = u?.user?.id;

        if (!userId) {
          addToast("error", "Sessão inválida", "Faça login novamente.");
          return;
        }

        const { data: mem, error: memErr } = await supabaseBrowser
          .from("tenant_members")
          .select("tenant_id")
          .eq("tenant_id", tid)
          .eq("user_id", userId)
          .maybeSingle();

        if (memErr || !mem) {
          addToast(
            "error",
            "Acesso negado",
            "Você não tem permissão neste tenant.",
          );
          return;
        }
      }

      const statuses = ["SCHEDULED", "QUEUED", "PAUSED", "SENDING"];

      const { data, error } = await supabaseBrowser
        .from("vw_client_message_jobs_queue_details")
        .select(
          "id,status,when_sp,when_ts_utc,origem,client_id,client_name,whatsapp_username,automation_id,template_name,message_preview,message_full,whatsapp_session,error_message",
        )
        .eq("tenant_id", tid)
        .in("status", statuses)
        .order("when_ts_utc", { ascending: true });

      if (error) {
        setQueueData([]);
        return;
      }

      const rows = (data ?? []) as any[];

      console.log("[QueueMonitor] OK", {
        tenant_id: tid,
        count: rows.length,
        first: rows[0] ?? null,
      });

      setQueueData(rows);
      setLastUpdate(new Date());
    };

    fetchQueue();
    const interval = setInterval(fetchQueue, 30000); // 30s (cron roda a cada 1 min)
    return () => clearInterval(interval);
  }, []);

  // 2. Ação: PAUSAR TUDO
  const handleGlobalPause = async () => {
    setLoading(true);
    const tid = await getCurrentTenantId();
    if (!tid) {
      setLoading(false);
      return;
    }

    await supabaseBrowser
      .from("client_message_jobs")
      .update({ status: "PAUSED" })
      .eq("tenant_id", tid)
      .in("status", ["SCHEDULED", "QUEUED", "SENDING"]);

    setLoading(false);
  };

  // 3. Ação: RETOMAR TUDO
  const handleGlobalResume = async () => {
    setLoading(true);
    const tid = await getCurrentTenantId();
    if (!tid) return;

    // ✅ Segurança extra: garante que só afeta o tenant
    await supabaseBrowser
      .from("client_message_jobs")
      .update({ status: "QUEUED" })
      .eq("tenant_id", tid)
      .eq("status", "PAUSED");

    setLoading(false);
  };

  // 4. Ação: CANCELAR TUDO
  const handleNukeQueue = async () => {
    if (queueData.length === 0) return;

    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      if (!tid) return;

      // ✅ Segurança: Atualiza APENAS os jobs filtrados no cache local (queueData) que pertencem a este tenant
      const jobIdsToCancel = queueData.map((j) => j.id).filter(Boolean);

      if (jobIdsToCancel.length === 0) {
        setShowModal(false);
        return;
      }

      const { error } = await supabaseBrowser
        .from("client_message_jobs")
        .update({
          status: "CANCELLED",
          error_message: "Cancelado via Monitor Global",
        })
        .eq("tenant_id", tid)
        .in("id", jobIdsToCancel); // ✅ Proteção Ativa

      if (error) {
        return;
      }

      setShowModal(false);
    } finally {
      setLoading(false);
    }
  };

  if (queueData.length === 0) return null;

  const activeCount = queueData.filter((j) =>
    ["SCHEDULED", "QUEUED", "SENDING"].includes(j.status),
  ).length;
  const pausedCount = queueData.filter((j) => j.status === "PAUSED").length;
  const isGlobalPaused = activeCount === 0 && pausedCount > 0;

  return (
    <>
      {/* 🟢 BARRA DE MONITORAMENTO */}
      <div
        onClick={() => setShowModal(true)}
        className={`mb-4 border rounded-xl p-3 flex items-center justify-between cursor-pointer hover:shadow-md transition-all
    ${isGlobalPaused ? "bg-amber-500/20 border-amber-500/30" : "bg-emerald-500/10 border-emerald-500/20"}`}
      >
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-5 h-5">
            {isGlobalPaused ? (
              <div className="w-2.5 h-2.5 bg-amber-500 rounded-full shadow-sm"></div>
            ) : (
              <>
                <div className="absolute w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping opacity-75"></div>
                <div className="relative w-2.5 h-2.5 bg-emerald-500 rounded-full"></div>
              </>
            )}
          </div>
          <div>
            <h3
              className={`font-medium text-xs uppercase tracking-wide ${isGlobalPaused ? "text-amber-500" : "text-emerald-500"}`}
            >
              {isGlobalPaused ? "⏸️ PAUSADA" : "🚀 ENVIANDO"}
            </h3>
            <p
              className={`text-[10px] mt-0.5 ${isGlobalPaused ? "text-amber-500" : "text-emerald-500"}`}
            >
              {queueData.length} na fila
            </p>
          </div>
        </div>
        <button className="px-3 py-1.5 bg-foreground text-background rounded-lg text-xs font-medium uppercase hover:bg-foreground/90 transition-colors">
          Abrir
        </button>
      </div>

      {/* 🔴 MODAL RAIO-X */}
      {showModal &&
        createPortal(
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-6xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex justify-between items-center bg-muted/40">
                <h3 className="font-medium text-lg text-foreground">
                  Gerenciador de Fila
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-muted-foreground font-medium text-xs uppercase sticky top-0">
                    <tr>
                      <th className="p-4">Quando</th>
                      <th className="p-4">Origem</th>
                      <th className="p-4">Cliente</th>
                      <th className="p-4">WhatsApp</th>
                      <th className="p-4">Mensagem</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">ID</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-border">
                    {queueData.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-muted/30 align-top"
                      >
                        {/* QUANDO */}
                        <td className="p-4 text-muted-foreground whitespace-nowrap">
                          {job.when_sp || "--"}
                        </td>

                        {/* ORIGEM */}
                        <td className="p-4 font-medium text-foreground whitespace-nowrap">
                          {job.origem === "AUTOMACAO"
                            ? "Automação"
                            : "Envio Manual"}
                        </td>

                        {/* CLIENTE */}
                        <td className="p-4 font-medium text-foreground">
                          {job.client_name || (
                            <span className="text-muted-foreground font-medium">
                              (cliente não encontrado)
                            </span>
                          )}
                        </td>

{/* WHATSAPP */}
                        <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">
                          {job.whatsapp_username || "--"}
                        </td>

                        {/* MENSAGEM */}
                        <td className="p-4">
                          {job.template_name ? (
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">
                                {job.template_name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                Template
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">
                                Personalizada
                              </span>
                              <span className="text-[11px] text-muted-foreground/70 line-clamp-2">
                                {job.message_preview || "--"}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* STATUS */}
                        <td className="p-4 whitespace-nowrap">
                          <span
                            className={`gap-1 px-2 py-1 rounded-lg text-xs font-medium tracking-tight shadow-sm ${job.status === "PAUSED" ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"}`}
                          >
                            {job.status}
                          </span>
                        </td>

                        {/* ID */}
                        <td className="p-4 text-right text-xs text-muted-foreground/70 whitespace-nowrap">
                          {job.id.slice(0, 8)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-3 border-t border-border flex gap-2 justify-end bg-muted/40 flex-wrap">
                {activeCount > 0 ? (
                  <button
                    onClick={handleGlobalPause}
                    disabled={loading}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg font-medium text-xs hover:bg-amber-600"
                  >
                    ⏸️ PAUSAR TUDO
                  </button>
                ) : (
                  <button
                    onClick={handleGlobalResume}
                    disabled={loading || pausedCount === 0}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium text-xs hover:bg-emerald-700 disabled:opacity-50"
                  >
                    ▶️ RETOMAR
                  </button>
                )}
                <button
                  onClick={handleNukeQueue}
                  disabled={loading}
                  className="px-4 py-2 bg-rose-600 text-white rounded-lg font-medium text-xs hover:bg-rose-700"
                >
                  🚨 CANCELAR TUDO
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default function BillingPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [clients, setClients] = useState<ClientLight[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isMasterOrAdmin, setIsMasterOrAdmin] = useState(false);
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
  }>({ templates: [], servers: [], plans: [], apps: [], sessions: [] });

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
    const tid = await getCurrentTenantId();

    if (!tid) {
      setLoading(false);
      return;
    }

    try {
      const [
        autoRes,
        clientRes,
        msgRes,
        srvRes,
        appRes,
        waProfRes,
        waProfRes2,
      ] = await Promise.all([
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

        // 6. Busca Perfil WhatsApp Sessão 1 (waProfRes)
        fetch("/api/whatsapp/profile", { cache: "no-store" }).then(
          async (r) => {
            const j = await r.json().catch(() => ({}) as any);
            return { ok: r.ok, json: j };
          },
        ),

        // 7. Busca Perfil WhatsApp Sessão 2 (waProfRes2)
        fetch("/api/whatsapp/profile2", { cache: "no-store" }).then(
          async (r) => {
            const j = await r.json().catch(() => ({}) as any);
            return { ok: r.ok, json: j };
          },
        ),
      ]);

      // ✅ Como você é o dono, liberamos acesso total
      setIsMasterOrAdmin(true);

      const autoData = autoRes.data;
      const clientData = clientRes.data;

      const sessions: SelectOption[] = (() => {
        const result: SelectOption[] = [];

        // ✅ Busca os nomes que o usuário personalizou no front-end
        const name1 =
          typeof window !== "undefined"
            ? localStorage.getItem("wa_label_1") || "Contato principal"
            : "Contato principal";
        const name2 =
          typeof window !== "undefined"
            ? localStorage.getItem("wa_label_2") || "Contato Secundário"
            : "Contato Secundário";

        // Sessão 1: sempre exibe (é a principal)
        result.push({
          id: "default",
          label: buildWhatsAppSessionLabel(
            waProfRes?.ok ? waProfRes.json : null,
            name1,
          ),
        });

        // ✅ TRAVA: Só exibe a opção de envio pela sessão 2 se ela estiver conectada
        if (waProfRes2?.ok && waProfRes2.json?.connected) {
          result.push({
            id: "session2",
            label: buildWhatsAppSessionLabel(waProfRes2.json, name2),
          });
        }

        return result;
      })();

      // Extrai planos únicos dos clientes carregados
      const uniquePlans = Array.from(
        new Set(
          (clientData || []).map((c: any) => c.plan_label).filter(Boolean),
        ),
      );

      setAuxData({
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
        sessions, // ✅
      });

      // Casting seguro para incluir os novos campos opcionais se vierem do banco
      setAutomations((autoData as any[]) || []);
      setClients((clientData as ClientLight[]) || []);
    } catch (error: any) {
      addToast("error", "Erro ao carregar", error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // --- ACTIONS ---
  async function toggleActive(rule: Automation) {
    const tid = await getCurrentTenantId();
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
    const tid = await getCurrentTenantId();
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
    const tid = await getCurrentTenantId();
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

    const tid = await getCurrentTenantId();
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
        throw new Error("Falha ao carregar o texto do template."); // ======================================================
      // ✅ LÓGICA DE AGENDAMENTO (ESCADINHA DE HORÁRIOS)
      // ======================================================

      let currentSendAt = new Date(); // Começa "Agora"

      const inserts = affected.map((client) => {
        // ✅ Intervalo fixo (mesma lógica do cron automático), sem sorteio
const delaySecs = Math.max(rule.delay_min || 20, 15); // piso de segurança de 15s
        // Isso cria datas futuras: T+15s, T+35s, T+50s...
        currentSendAt = new Date(currentSendAt.getTime() + delaySecs * 1000);

        return {
          tenant_id: tid,
          client_id: client.id,
          automation_id: rule.id,

          message_template_id: templateId,
          message: tpl.content,
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
      // ✅ Segurança: Log limpo
      if (process.env.NODE_ENV !== "production")
        console.error("Falha ao criar fila manual.");
      addToast(
        "error",
        "Erro ao enfileirar",
        "Verifique as configurações e tente novamente.",
      );
    }
  };

  const filtered = automations.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* Monitor da fila (com padding padrão e SEM z alto) */}
      <div className="px-3 sm:px-0 md:px-4">
        <GlobalQueueMonitor addToast={addToast} />
      </div>
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
          <button
            onClick={() => setWizardState({ show: true, editingRule: null })}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="text-base md:text-lg leading-none mb-0.5">+</span>
            Nova Regra
          </button>
        </div>
      </div>
      {/* Barra de busca (padrão admin: sticky no desktop) */}
      <div className="p-0 px-3 sm:px-0 md:px-4">
<div className="p-0 md:p-4 bg-transparent md:bg-card border-0 md:border md:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm md:sticky md:top-4 z-20">
          <div className="hidden md:block text-xs font-medium uppercase text-foreground/80 tracking-wider mb-3">
            Busca
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar regra..."
                className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                🔍
              </span>
            </div>

{search.trim() && (
              <button
                onClick={() => setSearch("")}
                className="hidden md:inline-flex h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-sm font-medium hover:bg-rose-500/20 transition-colors"
              >
                Limpar
              </button>
            
            )}
          </div>
        </div>
      </div>
      {/* LISTA (GRID 3 COLUNAS) */}
      {loading ? (
        <div className="text-center py-10 text-muted-foreground animate-pulse">
          Carregando automações...
        </div>
      ) : filtered.length === 0 ? (
<div className="flex flex-col items-center justify-center py-20 bg-card border border-dashed border-border rounded-2xl">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filtered.map((auto) => {
            const impacted = impactedByRule.get(auto.id) ?? [];
            // ✅ BUSCA O LABEL COMPLETO QUE A API JÁ GEROU (NOME | NÚMERO)
            const sessionInfo = auxData.sessions.find(
              (s) => s.id === (auto.whatsapp_session || "default"),
            );

            return (
              <AutomationCard
                key={auto.id}
                data={auto}
                impactCount={impacted.length}
                sessionLabel={sessionInfo?.label} // ✅ ENVIA O TEXTO COMPLETO PRO FILHO
                onToggle={() => toggleActive(auto)}
                onDelete={() => handleDelete(auto.id)}
                onEdit={() => setWizardState({ show: true, editingRule: auto })}
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
                  setLogsModalData({ ruleId: auto.id, ruleName: auto.name })
                }
                onRun={() => handleManualRun(auto)}
              />
            );
          })}
        </div>
      )}
      {/* WIZARD COM EDIÇÃO */}     {" "}
      {wizardState.show && (
        <AutomationWizard
          auxData={auxData}
          editingRule={wizardState.editingRule}
          isMasterOrAdmin={isMasterOrAdmin}
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
            <span>
              Envio às <strong>{data.schedule_time?.slice(0, 5)}</strong>
            </span>
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

// ============================================================================
// MODAL DE IMPACTO (LISTA DE CLIENTES)
// ============================================================================
function ImpactListModal({
  data,
  onClose,
}: {
  data: {
    ruleId: string;
    ruleName: string;
    clients: ClientLight[];
    ruleDateField?: string;
  };
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;

  // Descobre se a regra usa vencimento ou data de criação
  const isCadastro =
    data.ruleDateField === "cadastro" || data.ruleDateField === "created_at";

  // ✅ Status de envio (mais recente) desta regra, por cliente
  const [sendStatusMap, setSendStatusMap] = useState<
    Record<string, { status: string; error_message: string | null }>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function loadSendStatus() {
      const tid = await getCurrentTenantId();
      if (!tid) return;

      const clientIds = data.clients.map((c) => c.id).filter(Boolean);
      if (clientIds.length === 0) return;

      const { data: jobs, error } = await supabaseBrowser
        .from("client_message_jobs")
        .select("client_id, status, error_message, send_at")
        .eq("tenant_id", tid)
        .eq("automation_id", data.ruleId)
        .in("client_id", clientIds)
        .order("send_at", { ascending: false });

      if (error || !jobs || cancelled) return;

      // Mantém apenas o job mais recente de cada cliente (jobs já vêm ordenados desc)
      const map: Record<string, { status: string; error_message: string | null }> = {};
      for (const j of jobs as any[]) {
        if (!j.client_id || map[j.client_id]) continue;
        map[j.client_id] = { status: j.status, error_message: j.error_message };
      }

      if (!cancelled) setSendStatusMap(map);
    }

    loadSendStatus();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ruleId]);

  function renderSendStatus(clientId: string) {
    const info = sendStatusMap[clientId];
    if (!info)
      return (
        <span className="text-[10px] text-muted-foreground/60 font-medium">
          Ainda não enviado
        </span>
      );

    if (info.status === "SENT")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          ✅ Enviado
        </span>
      );
    if (info.status === "FAILED")
      return (
        <div className="flex flex-col gap-0.5">
          <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-rose-500/10 text-rose-500 border border-rose-500/20 w-fit">
            ❌ Falhou
          </span>
          {info.error_message && (
            <span
              className="text-[9px] text-rose-500/80 max-w-[160px] truncate"
              title={info.error_message}
            >
              {info.error_message}
            </span>
          )}
        </div>
      );
    if (info.status === "CANCELLED")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-muted text-muted-foreground border border-border">
          Resolvido
        </span>
      );
    // SCHEDULED / QUEUED / SENDING
    return (
      <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-sky-500/10 text-sky-500 border border-sky-500/20">
        ⏳ Na fila
      </span>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent">
          <div>
            <h3 className="text-lg font-medium text-foreground">
              Clientes Afetados Hoje
            </h3>
            <p className="text-xs text-foreground/70">
              Regra: <strong>{data.ruleName}</strong> • Total:{" "}
              <strong>{data.clients.length}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-auto p-2 custom-scrollbar">
          {data.clients.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground italic">
              Nenhum cliente atende a esta regra hoje.
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead className="bg-muted/40 sticky top-0 z-10 text-xs uppercase text-muted-foreground font-medium">
                <tr>
                  <th className="p-3">Cliente / Contato</th>
                  <th className="p-3">Acesso / Servidor</th>
                  <th className="p-3 whitespace-nowrap">
                    {isCadastro ? "Data Cadastro" : "Vencimento"}
                  </th>
                  <th className="p-3">Plano</th>
                  <th className="p-3">Envio</th>
                </tr>
              </thead>
<tbody className="text-sm text-foreground/80 divide-y divide-border">
                {data.clients.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-muted/30 transition-colors align-top"
                  >
                    {/* COLUNA 1: CLIENTES E WHATSAPP */}
                    <td className="p-3">
                      {/* Principal */}
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          {c.display_name}
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium uppercase">
                            Titular
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          📞 {c.whatsapp_username || "--"}
                        </span>
                      </div>

                      {/* Secundário (só aparece se tiver) */}
                      {c.secondary_display_name && (
                        <div className="flex flex-col mt-2.5 pt-2 border-t border-border">
                          <span className="font-medium text-foreground/90 text-xs flex items-center gap-1.5">
                            {c.secondary_display_name}
                            <span className="text-[9px] bg-sky-500/10 text-sky-500 px-1.5 py-0.5 rounded font-medium uppercase">
                              Secundário
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            📞 {c.secondary_whatsapp_username || "--"}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* COLUNA 2: SERVIDOR E LOGIN */}
                    <td className="p-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground text-sm">
                          {c.username || (
                            <span className="text-muted-foreground italic font-medium">
                              Sem usuário
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {c.server_name || "--"}
                        </span>
                      </div>
                    </td>

                    {/* COLUNA 3: DATA (Dinâmica dependendo da regra) */}
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex items-start gap-2">
                        <span className="text-base mt-0.5">
                          {isCadastro ? "📝" : "📅"}
                        </span>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground leading-tight">
                            {formatDateSP(
                              isCadastro ? c.created_at : c.vencimento,
                            )}
                          </span>
                          {formatTimeSP(
                            isCadastro ? c.created_at : c.vencimento,
                          ) && (
                            <span className="text-xs text-muted-foreground mt-0.5">
                              ⏰{" "}
                              {formatTimeSP(
                                isCadastro ? c.created_at : c.vencimento,
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* COLUNA 4: PLANO E VALOR */}
                    <td className="p-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className="px-2 py-0.5 rounded bg-transparent border border-border text-xs font-medium text-foreground/90">
                          {c.plan_label || "Sem plano"}
                        </span>
                        {c.price_amount > 0 && (
                          <span className="text-xs font-medium text-emerald-500 pl-1">
                            {new Intl.NumberFormat("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            }).format(c.price_amount)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* COLUNA 5: STATUS DE ENVIO */}
                    <td className="p-3">{renderSendStatus(c.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

<div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg bg-foreground text-background font-medium text-xs uppercase hover:bg-foreground/90 transition-colors shadow-md"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================
// WIZARD DE CRIAÇÃO (MANTIDO E OTIMIZADO)
// ============================================================================
function AutomationWizard({
  auxData,
  editingRule,
  isMasterOrAdmin,
  onClose,
  onSuccess,
  onError,
}: {
  auxData: any;
  editingRule?: any;
  isMasterOrAdmin?: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  // ✅ PROTEÇÃO SSR
  if (typeof document === "undefined") return null;

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    type: "Vencimento",
    message_template_id: "",
    whatsapp_session: "default",
    delay_min: 15,
    
    is_active: true,

    status: ["ACTIVE"],
    servers: [] as string[],
    plans: [] as string[],
    apps: [] as string[],

    rule_date_field: "vencimento",
    rule_days_diff: -3,

    is_automatic: true,
    schedule_time: "10:00",
    schedule_days: [1, 2, 3, 4, 5],
  });

  // ✅ EFEITO PARA PREENCHER DADOS NA EDIÇÃO
  useEffect(() => {
    if (editingRule) {
      setForm({
        name: editingRule.name,
        type: editingRule.type,
        // Tenta pegar o ID direto ou do objeto aninhado se vier do join
        message_template_id:
          editingRule.message_template_id ||
          editingRule.message_template?.id ||
          "",
        whatsapp_session: editingRule.whatsapp_session || "default",
        delay_min: editingRule.delay_min || 15,
        is_active: editingRule.is_active,
        is_automatic: editingRule.is_automatic,
        status: editingRule.target_status || [],
        servers: editingRule.target_servers || [],
        plans: editingRule.target_plans || [],
        apps: editingRule.target_apps || [],
        rule_date_field:
          (editingRule.rule_date_field === "cadastro"
            ? "created_at"
            : editingRule.rule_date_field) || "vencimento",

        rule_days_diff: editingRule.rule_days_diff,
        schedule_time: editingRule.schedule_time || "10:00",
        schedule_days: editingRule.schedule_days || [1, 2, 3, 4, 5],
      });
    }
  }, [editingRule]);

  const handleSave = async () => {
    if (!form.name) {
      setStep(1);
      setTimeout(() => onError("Preencha o Nome da Automação."), 200);
      return;
    }

    setSaving(true);
    try {
      const tid = await getCurrentTenantId();
      if (!tid) throw new Error("Sessão inválida.");

      // ✅ BLINDAGEM: garante membership antes de salvar regra
      {
        const { data: u } = await supabaseBrowser.auth.getUser();
        const userId = u?.user?.id;
        if (!userId) throw new Error("Sessão inválida.");

        const { data: mem, error: memErr } = await supabaseBrowser
          .from("tenant_members")
          .select("tenant_id")
          .eq("tenant_id", tid)
          .eq("user_id", userId)
          .maybeSingle();

        if (memErr || !mem) throw new Error("Forbidden");
      }

      const payload = {
        tenant_id: tid,
        name: form.name,
        type: form.type,
        // ✅ Força a desativar se não tiver mensagem vinculada
        is_active: form.message_template_id ? form.is_active : false,
        is_automatic: form.is_automatic,

        message_template_id: form.message_template_id,
        whatsapp_session: form.whatsapp_session,
        delay_min: form.delay_min,
        
        target_status: form.status,
        target_servers: form.servers,
        target_plans: form.plans,
        target_apps: form.apps,

        rule_date_field:
          form.rule_date_field === "cadastro"
            ? "created_at"
            : form.rule_date_field,

        rule_days_diff: form.rule_days_diff,

        schedule_time: form.schedule_time,
        schedule_days: form.schedule_days,
      };

      let error;
      if (editingRule?.id) {
        const { error: updErr } = await supabaseBrowser
          .from("billing_automations")
          .update(payload)
          .eq("id", editingRule.id)
          .eq("tenant_id", tid);
        error = updErr;
      } else {
        const { error: insErr } = await supabaseBrowser
          .from("billing_automations")
          .insert(payload);
        error = insErr;
      }

      if (error) throw error;

      if (error) throw error;
      onSuccess();
    } catch (e: any) {
      onError(e.message || "Erro ao salvar no banco.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-border bg-transparent">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-medium text-foreground">
              {editingRule
                ? `Editar: ${editingRule.name}`
                : step === 1
                  ? "1. Configuração Básica"
                  : step === 2
                    ? "2. Quem vai receber?"
                    : "3. Quando enviar?"}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
<div className="h-1.5 w-full bg-muted rounded-full overflow-hidden flex">
            <div
              className={`h-full bg-emerald-500 transition-all duration-300 ${step === 1 ? "w-1/3" : step === 2 ? "w-2/3" : "w-full"}`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {step === 1 && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                                                      <Label>Tipo</Label>
                  <Select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                                                           {" "}
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                                                       {" "}
                  </Select>
                                                 {" "}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <Label>Mensagem</Label>
                  <Select
                    value={form.message_template_id}
                    onChange={(e) =>
                      setForm({ ...form, message_template_id: e.target.value })
                    }
                  >
                    <option value="">Selecione...</option>
                    {auxData.templates
                      .filter((t: any) => {
                        // ✅ Removemos restrições. Oculta apenas as de Teste.
                        if (String(t.label).toLowerCase().startsWith("teste"))
                          return false;
                        return true;
                      })
                      .map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                  </Select>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Label>Sessão WhatsApp</Label>
                  <Select
                    value={form.whatsapp_session}
                    onChange={(e) =>
                      setForm({ ...form, whatsapp_session: e.target.value })
                    }
                  >
                    {(auxData.sessions?.length
                      ? auxData.sessions
                      : [{ id: "default", label: "Principal" }]
                    ).map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <Label>Segurança (Intervalo entre envios)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Aguardar</span>
                  <Input
                    type="number"
                    value={form.delay_min}
                    onChange={(e) =>
                      setForm({ ...form, delay_min: Number(e.target.value) })
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    segundos entre cada envio
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <Label>Regra de Disparo</Label>
                <div className="flex flex-wrap items-center gap-3 mt-2 bg-transparent p-3 rounded-xl border border-border">
                  <span className="text-sm font-medium text-foreground/80">
                    Enviar
                  </span>
                  <div className="flex items-center shadow-sm rounded-lg overflow-hidden">
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          rule_days_diff: -Math.abs(form.rule_days_diff || 1),
                        })
                      }
                      className={`px-3 py-1.5 border text-xs font-medium transition-colors ${form.rule_days_diff < 0 ? "bg-rose-500/10 text-rose-500 border-rose-500/30" : "bg-muted border-border text-muted-foreground hover:bg-muted/80"}`}
                    >
                      Antes
                    </button>
                    <button
                      onClick={() => setForm({ ...form, rule_days_diff: 0 })}
                      className={`px-3 py-1.5 border-y text-xs font-medium transition-colors ${form.rule_days_diff === 0 ? "bg-sky-500/10 text-sky-500 border-sky-500/30" : "bg-muted border-transparent text-muted-foreground hover:bg-muted/80"}`}
                    >
                      No Dia
                    </button>
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          rule_days_diff: Math.abs(form.rule_days_diff || 1),
                        })
                      }
                      className={`px-3 py-1.5 border text-xs font-medium transition-colors ${form.rule_days_diff > 0 ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" : "bg-muted border-border text-muted-foreground hover:bg-muted/80"}`}
                    >
                      Depois
                    </button>
                  </div>
                  {form.rule_days_diff !== 0 && (
                    <input
                      type="number"
                      className="w-16 h-8 text-center rounded-lg border border-border bg-transparent text-sm font-medium focus:border-emerald-500/50 outline-none transition-colors"
                      value={Math.abs(form.rule_days_diff)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          rule_days_diff:
                            Number(e.target.value) *
                            (form.rule_days_diff < 0 ? -1 : 1),
                        })
                      }
                    />
                  )}
                  <span className="text-sm font-medium text-foreground/80">
                    {form.rule_days_diff !== 0 ? "dias do" : "do"}
                  </span>
                  <select
                    className="h-8 px-2 rounded-lg border border-border bg-transparent text-sm font-medium focus:border-emerald-500/50 outline-none transition-colors"
                    value={form.rule_date_field}
                    onChange={(e) =>
                      setForm({ ...form, rule_date_field: e.target.value })
                    }
                  >
                    <option value="vencimento">Vencimento</option>
                    <option value="created_at">Cadastro</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
                                         {" "}
              <p className="text-sm text-foreground/70 mb-4">
                Selecione quem receberá esta mensagem. Deixe vazio para "Todos".
              </p>
                                         {" "}
              <MultiSelectDropdown
                label="Status do Cliente"
                options={CLIENT_STATUS}
                selected={form.status}
                onChange={(v: any) => setForm({ ...form, status: v })}
              />
                                         {" "}
              <MultiSelectDropdown
                label="Servidores"
                options={auxData.servers}
                selected={form.servers}
                onChange={(v: any) => setForm({ ...form, servers: v })}
              />
                                         {" "}
              <MultiSelectDropdown
                label="Planos"
                options={auxData.plans}
                selected={form.plans}
                onChange={(v: any) => setForm({ ...form, plans: v })}
              />
                                         {" "}
              <MultiSelectDropdown
                label="Aplicativos"
                options={auxData.apps}
                selected={form.apps}
                onChange={(v: any) => setForm({ ...form, apps: v })}
              />
                                     {" "}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 py-4">
              <div className="flex flex-col items-center gap-4">
                <span className="text-sm font-medium text-muted-foreground/70 uppercase tracking-widest">
                  Modo de Operação
                </span>
                <div className="flex items-center gap-4 bg-transparent border border-border p-1 rounded-xl">
                  <button
                    onClick={() => setForm({ ...form, is_automatic: false })}
                    className={`px-6 py-3 rounded-lg text-sm font-medium transition-all ${!form.is_automatic ? "bg-muted shadow-md text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => setForm({ ...form, is_automatic: true })}
                    className={`px-6 py-3 rounded-lg text-sm font-medium transition-all ${form.is_automatic ? "bg-muted shadow-md text-emerald-500" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Automático
                  </button>
                </div>
              </div>
              {form.is_automatic && (
                <div className="bg-transparent p-6 rounded-2xl border border-border space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div>
                    <Label>Horário do Disparo (Brasília)</Label>
                    <div className="flex justify-center mt-2">
                      <FormattedTimeInput
                        value={form.schedule_time}
                        onChange={(e) =>
                          setForm({ ...form, schedule_time: e.target.value })
                        }
                        className="text-3xl font-medium text-center w-32 border-emerald-500"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Dias da Semana</Label>
                    <div className="flex justify-center gap-2 mt-3">
                      {DAYS_OF_WEEK.map((d) => {
                        const selected = form.schedule_days.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            onClick={() => {
                              const current = form.schedule_days;
                              setForm({
                                ...form,
                                schedule_days: current.includes(d.id)
                                  ? current.filter((x) => x !== d.id)
                                  : [...current, d.id],
                              });
                            }}
                            className={`w-10 h-10 rounded-full font-medium text-xs transition-all border ${selected ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/30" : "bg-muted border-border text-muted-foreground"}`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-between items-center">
          {step === 1 && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:bg-muted text-xs font-medium uppercase transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => setStep(2)}
                className="px-6 py-2.5 bg-emerald-600 text-white hover:bg-emerald-500 font-medium rounded-xl shadow-lg shadow-emerald-900/20 transition-all text-xs uppercase"
              >
                Próximo: Filtros →
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:bg-muted text-xs font-medium uppercase transition-colors"
              >
                ← Voltar
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-6 py-2.5 bg-emerald-600 text-white hover:bg-emerald-500 font-medium rounded-xl shadow-lg shadow-emerald-900/20 transition-all text-xs uppercase"
              >
                Próximo: Automação →
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:bg-muted text-xs font-medium uppercase transition-colors"
              >
                ← Voltar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-8 py-2.5 bg-emerald-600 text-white font-medium rounded-xl shadow-lg shadow-emerald-900/20 hover:bg-emerald-500 transition-all text-xs uppercase disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Confirmar e Criar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
      {children}
    </label>
  );
}
function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 px-3 bg-card border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500 transition-colors ${className}`}
    />
  );
}
function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-10 px-3 bg-card border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500 transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

// ✅ MULTI-SELECT DROPDOWN SIMPLIFICADO E BLINDADO
function MultiSelectDropdown({ label, options, selected, onChange }: any) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<any>(null); // ✅ any para evitar erro de tipo

  useEffect(() => {
    // ✅ Proteção SSR para não quebrar no servidor
    if (typeof document === "undefined") return;

    function handleClickOutside(event: any) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x: any) => x !== id));
    else onChange([...selected, id]);
  };

  const getLabel = () => {
    if (selected.length === 0) return "Todos (Sem filtro)";
    if (selected.length === 1)
      return (
        options.find((o: any) => o.id === selected[0])?.label || selected[0]
      );
    return `${selected.length} selecionados`;
  };

  return (
    <div className="relative" ref={containerRef}>
      <Label>{label}</Label>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full h-10 px-3 text-left rounded-lg border text-sm flex justify-between items-center transition-all ${open ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-border bg-card text-foreground/90"}`}
      >
        <span
          className={
            selected.length === 0 ? "text-muted-foreground italic" : "font-medium"
          }
        >
          {getLabel()}
        </span>
        <span className="text-xs text-muted-foreground">▼</span>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col">
          <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
            {options.map((opt: any) => (
              <div
                key={opt.id}
                onClick={() => toggleOption(opt.id)}
                className="px-3 py-2 hover:bg-muted cursor-pointer flex items-center gap-3 transition-colors rounded-lg"
              >
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selected.includes(opt.id) ? "bg-emerald-500 border-emerald-500" : "border-border"}`}
                >
                  {selected.includes(opt.id) && (
                    <span className="text-[10px] text-white">✓</span>
                  )}
                </div>
                <span className="text-sm text-foreground/90">
                  {opt.label}
                </span>
              </div>
            ))}
          </div>
          {/* ✅ BOTÃO CONCLUIR */}
          <div className="p-2 border-t border-border bg-transparent">
            <button
              onClick={() => setOpen(false)}
              className="w-full py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-xs uppercase transition-colors"
            >
              Concluir
            </button>
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selected.map((id: string) => {
            const label = options.find((o: any) => o.id === id)?.label || id;
            return (
              <span
                key={id}
                className="inline-flex items-center px-2 py-1 rounded bg-transparent border border-border text-xs font-medium text-muted-foreground"
              >
                {label}
                <button
                  onClick={() => toggleOption(id)}
                  className="ml-1.5 text-muted-foreground hover:text-rose-500 text-[10px]"
                >
                  ✕
                </button>
              </span>
            );
          })}
          <button
            onClick={() => onChange([])}
            className="text-[10px] text-rose-500 hover:underline underline-offset-2 ml-1"
          >
            Limpar
          </button>
        </div>
      )}
    </div>
  );
}
// ============================================================================
// MODAL DE LOGS (HISTÓRICO) — lê de vw_client_message_jobs_queue_details
// com reenvio e cancelamento de falhas
// ============================================================================

type JobLogRow = {
  id: string;
  status: string;
  when_sp: string | null;
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

function LogsModal({
  ruleId,
  ruleName,
  onClose,
}: {
  ruleId: string;
  ruleName: string;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;

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
    const tid = await getCurrentTenantId();
    if (!tid) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabaseBrowser
      .from("vw_client_message_jobs_queue_details")
      .select(
        "id, status, when_sp, when_ts_utc, client_id, client_name, whatsapp_username, template_name, message_preview, error_message, whatsapp_session",
      )
      .eq("tenant_id", tid)
      .eq("automation_id", ruleId)
      .in("status", ["FAILED", "SENT", "CANCELLED"])
      .order("when_ts_utc", { ascending: false })
      .limit(100);

    if (error) {
      setLogs([]);
      setSelected(new Set());
      setLoading(false);
      return;
    }

    const rows = (data as JobLogRow[]) || [];

    // ✅ Enriquece com login (server_username) e nome do servidor, igual à Auditoria
    try {
      const clientIds = [
        ...new Set(rows.map((r) => r.client_id).filter(Boolean)),
      ] as string[];

      if (clientIds.length > 0) {
        const { data: clientsData } = await supabaseBrowser
          .from("clients")
          .select("id, server_username, server_id")
          .eq("tenant_id", tid)
          .in("id", clientIds);

        const clientsMap: Record<string, any> = {};
        (clientsData || []).forEach((c: any) => {
          clientsMap[c.id] = c;
        });

        // Mapa server_id -> name
        const { data: serversData } = await supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tid);

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
    } catch (e) {
      console.error("Falha ao resolver notificação de automação:", e);
    }
  };

  // Reenfileira: cria NOVOS jobs SCHEDULED (escadinha) e marca os antigos como CANCELLED
  const requeueIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setWorking(true);
    try {
      const tid = await getCurrentTenantId();
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
    } catch (e: any) {
      if (process.env.NODE_ENV !== "production")
        console.error("requeue falhou:", e?.message);
    } finally {
      setWorking(false);
    }
  };

  // Marca como recebido (cliente já recebeu apesar do erro): vira CANCELLED, sem reenviar
  const cancelIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setWorking(true);
    try {
      const tid = await getCurrentTenantId();
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
    } catch (e: any) {
      if (process.env.NODE_ENV !== "production")
        console.error("cancel falhou:", e?.message);
    } finally {
      setWorking(false);
    }
  };

  const selectedArr = Array.from(selected);

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent">
          <div>
            <h3 className="text-lg font-medium text-foreground">Logs de Envio</h3>
            <p className="text-xs text-foreground/70">
              Regra: <strong>{ruleName}</strong>
              {failedRows.length > 0 && (
                <span className="ml-2 text-rose-500 font-medium">
                  • {failedRows.length} falha(s)
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {loading ? (
            <div className="text-center py-10 text-muted-foreground">Carregando...</div>
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
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-between items-center gap-2 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => requeueIds(selectedArr)}
              disabled={working || selectedArr.length === 0}
              className="px-4 py-2 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20 font-medium text-xs uppercase hover:bg-sky-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              Reenviar selecionados ({selectedArr.length})
            </button>
            <button
              onClick={() => requeueIds(failedRows.map((r) => r.id))}
              disabled={working || failedRows.length === 0}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-900/20"
            >
              Reenviar todas as falhas ({failedRows.length})
            </button>
            <button
              onClick={() => cancelIds(selectedArr)}
              disabled={working || selectedArr.length === 0}
              className="px-4 py-2 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20 font-medium text-xs uppercase hover:bg-rose-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              title="Cliente já recebeu — remove da lista de falhas sem reenviar"
            >
              Limpar selecionados
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg border border-border bg-muted text-foreground/80 font-medium text-xs uppercase hover:bg-muted/80 hover:text-foreground transition-colors shadow-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
