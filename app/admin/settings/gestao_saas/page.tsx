"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { getCurrentTenantId } from "@/lib/tenant";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import SaasCreditsModal from "./SaasCreditsModal";
import SaasRenewModal from "./SaasRenewModal";
import TenantFormModal from "./TenantFormModal";



// ============================================================
// TIPOS
// ============================================================
export type SaasTenant = {
  id: string;
  name: string;
  slug: string;
  tenant_active: boolean;
  created_at: string;
  role: "SUPERADMIN" | "MASTER" | "USER";
  expires_at: string | null;
  license_active: boolean;
  is_trial: boolean;
  credit_balance: number;
  parent_tenant_id: string | null;
  license_status: "ACTIVE" | "TRIAL" | "EXPIRED" | "ARCHIVED" | "INACTIVE";
  responsible_name: string | null;
  contact_email: string | null;
  phone_e164: string | null;
  whatsapp_username: string | null;
  notes: string | null;
  auth_email: string | null;
last_sign_in_at: string | null;
  whatsapp_sessions: number;
  saas_plan_table_id: string | null;
  credits_plan_table_id: string | null;
  auto_whatsapp_session?: string | null;
  alertsCount?: number;
  financial_control_enabled?: boolean;
  active_modules?: string[];
  custom_monthly_price?: number | null; // ✅ NOVO
};

type ScheduledMsg = {
  id: string;
  reseller_id: string;
  send_at: string;
  message: string;
  status?: string | null;
};

type MessageTemplate = { id: string; name: string; content: string };

type Transaction = {
  id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
};

const BILLING_TZ = "America/Sao_Paulo";

function fmtDate(s?: string | null) {
  if (!s) return "--";
  return new Date(s).toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}
function fmtDateTime(s?: string | null) {
  if (!s) return "--";
  return new Date(s).toLocaleString("pt-BR", { timeZone: BILLING_TZ });
}
function daysUntil(s?: string | null): number | null {
  if (!s) return null;
  
  // ✅ Calcula a diferença exata em dias corridos no fuso de São Paulo (ignora horas)
  const target = new Date(s);
  const now = new Date();

  // Força as duas datas para o formato YYYY-MM-DD em SP e joga para o meio-dia (evita bugs de fuso)
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
  const targetDate = new Date(`${fmt.format(target)}T12:00:00Z`);
  const nowDate = new Date(`${fmt.format(now)}T12:00:00Z`);

  return Math.round((targetDate.getTime() - nowDate.getTime()) / 86400000);
}

// ============================================================
// BADGES
// ============================================================
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
    TRIAL:    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400 border-sky-200 dark:border-sky-500/20",
    EXPIRED:  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/20",
    ARCHIVED: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-white/40 border-slate-200 dark:border-white/10",
    INACTIVE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
  };
  const label: Record<string, string> = {
    ACTIVE: "Ativo", TRIAL: "Trial", EXPIRED: "Expirado", ARCHIVED: "Arquivado", INACTIVE: "Inativo",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${map[status] ?? map.INACTIVE}`}>
      {label[status] ?? status}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    SUPERADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200 dark:border-purple-500/20",
    MASTER:     "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
    USER:       "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60 border-slate-200 dark:border-white/10",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border whitespace-nowrap ${map[role] ?? map.USER}`}>
      {role}
    </span>
  );
}

// ============================================================
// ÍCONE WHATSAPP
// ============================================================
function IconWa() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
    </svg>
  );
}

// ============================================================
// BOTÕES DA TABELA
// ============================================================
function ActionBtn({ children, title, tone, onClick }: {
  children: React.ReactNode; title: string;
  tone: "amber" | "green" | "blue" | "slate" | "red" | "purple";
  onClick: (e: React.MouseEvent) => void;
}) {
  const colors = {
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    blue:  "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    slate: "text-slate-600 dark:text-white/60 bg-slate-100 dark:bg-white/10 border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/15",
    red:   "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
    purple: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/20",
  };
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(e); }} title={title} className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}>
      {children}
    </button>
  );
}

// ============================================================
// HELPERS DE SESSÃO WHATSAPP
// ============================================================
function extractWaNumberFromJid(jid?: unknown): string {
  if (typeof jid !== "string") return "";
  const raw = jid.split("@")[0]?.split(":")[0] ?? "";
  return raw.replace(/\D/g, "");
}

function formatBRPhoneFromDigits(digits: string): string {
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) {
    const country = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+${country} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+${country} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+${country} (${ddd}) ${rest}`;
  }
  return `+${digits}`;
}

function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  if (!profile?.connected) return `${sessionName} (não conectado)`;
  const digits = extractWaNumberFromJid(profile?.jid);
  const pretty = formatBRPhoneFromDigits(digits);
  return `${sessionName} • ${pretty || "Conectado"}`;
}

// ============================================================
// PÁGINA PRINCIPAL
// ============================================================
export default function GestaoSaasPage() {
  const [tenants, setTenants] = useState<SaasTenant[]>([]);
  const [myRole, setMyRole] = useState<string>("");
  const [myName, setMyName] = useState<string>(""); // ✅ NOVO: Estado para guardar o seu nome
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos"); // ✅ MUDADO PARA "Todos"
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [archivedFilter, setArchivedFilter] = useState<"Não" | "Sim">("Não"); // ✅ ADICIONADO
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState<SaasTenant | null>(null);
  const [renewTarget, setRenewTarget] = useState<SaasTenant | null>(null);
  const [creditsTarget, setCreditsTarget] = useState<SaasTenant | null>(null);


  // --- MENSAGENS E ALERTAS ---
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);
  
  const [showSendNow, setShowSendNow] = useState<{ open: boolean; resellerId: string | null }>({ open: false, resellerId: null });
  const [messageText, setMessageText] = useState("");
  
  const [showScheduleMsg, setShowScheduleMsg] = useState<{ open: boolean; resellerId: string | null }>({ open: false, resellerId: null });
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  
  const [showNewAlert, setShowNewAlert] = useState<{ open: boolean; targetId: string | null; targetName?: string }>({ open: false, targetId: null });
  const [newAlertText, setNewAlertText] = useState("");
  
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateNowId, setSelectedTemplateNowId] = useState("");
  const [selectedTemplateScheduleId, setSelectedTemplateScheduleId] = useState("");
  const [sendingNow, setSendingNow] = useState(false);
  const sendNowAbortRef = useRef<AbortController | null>(null);
  const [scheduling, setScheduling] = useState(false);
  
  const [showNewTemplate, setShowNewTemplate] = useState<{ open: boolean; target: "now" | "schedule" }>({ open: false, target: "now" });
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  
  // ✅ ESTADOS DA SESSÃO DO WHATSAPP (QUE ESTAVAM FALTANDO)
  const [selectedSessionNow, setSelectedSessionNow] = useState("default");
  const [selectedSessionSchedule, setSelectedSessionSchedule] = useState("default");
  const [sessionOptions, setSessionOptions] = useState<{id: string, label: string}[]>([
    { id: "default", label: "Carregando..." }
  ]);

  async function loadWhatsAppSessions() {
    try {
      const [res1, res2] = await Promise.all([
        fetch("/api/whatsapp/profile", { cache: "no-store" }).catch(() => null),
        fetch("/api/whatsapp/profile2", { cache: "no-store" }).catch(() => null)
      ]);
      const prof1 = res1 && res1.ok ? await res1.json().catch(()=>({})) : {};
      const prof2 = res2 && res2.ok ? await res2.json().catch(()=>({})) : {};

      const name1 = typeof window !== "undefined" ? localStorage.getItem("wa_label_1") || "Contato Principal" : "Contato Principal";
      const name2 = typeof window !== "undefined" ? localStorage.getItem("wa_label_2") || "Contato Secundário" : "Contato Secundário";

      setSessionOptions([
        { id: "default", label: buildWhatsAppSessionLabel(prof1, name1) },
        { id: "session2", label: buildWhatsAppSessionLabel(prof2, name2) }
      ]);
    } catch (e) {}
  }

  const [scheduledMap, setScheduledMap] = useState<Record<string, ScheduledMsg[]>>({});
  const [showScheduledModal, setShowScheduledModal] = useState<{ open: boolean; resellerId: string | null; resellerName?: string }>({ open: false, resellerId: null });
  
const [showAlertList, setShowAlertList] = useState<{ open: boolean; targetId: string | null; targetName?: string }>({ open: false, targetId: null });
  const [tenantAlerts, setTenantAlerts] = useState<any[]>([]);

  const { confirm, ConfirmUI } = useConfirm(); // ✅ INSTANCIADO AQUI

  // Efeitos para carregar conteúdo de templates
  useEffect(() => {
    if (!selectedTemplateNowId) return;
    const t = messageTemplates.find((x) => x.id === selectedTemplateNowId);
    if (t) setMessageText(t.content || "");
  }, [selectedTemplateNowId, messageTemplates]);

  useEffect(() => {
    if (!selectedTemplateScheduleId) return;
    const t = messageTemplates.find((x) => x.id === selectedTemplateScheduleId);
    if (t) setScheduleText(t.content || "");
  }, [selectedTemplateScheduleId, messageTemplates]);

  async function getToken() {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session?.access_token) throw new Error("Sem sessão");
    return session.access_token;
  }

  const addToast = (type: "success" | "error", title: string, msg?: string) => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, type, title, message: msg, durationMs: 5000 }]);
  };
  const removeToast = (id: number) => setToasts(p => p.filter(t => t.id !== id));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      setTenantId(tid);
      
      if (tid) {
        await loadWhatsAppSessions(); // ✅ Carrega as sessões assim que abrir a página!
        
        // ✅ Traz a categoria também
        const { data: tpls } = await supabaseBrowser.from("message_templates").select("id,name,content,category").eq("tenant_id", tid);
        setMessageTemplates(tpls || []);
      }

      const [roleRes, tenantsRes] = await Promise.all([
        supabaseBrowser.rpc("saas_my_role"),
        supabaseBrowser.from("vw_saas_tenants").select("*").order("created_at", { ascending: false }),
      ]);
      setMyRole(roleRes.data ?? "");
      
if (tenantsRes.error) {
        addToast("error", "Erro ao carregar revendas", tenantsRes.error.message);
      } else {
        const fetched = (tenantsRes.data as SaasTenant[]) ?? [];
        
        // ✅ Busca o nome da sua própria conta na lista
        if (tid) {
          const me = fetched.find(t => t.id === tid);
          if (me) setMyName(me.name);
        }

        const ids = fetched.map(t => t.id);

        if (tid && ids.length > 0) {
          // Buscar Alertas Abertos
          const { data: alerts } = await supabaseBrowser.from("client_alerts").select("reseller_id").eq("tenant_id", tid).in("reseller_id", ids).eq("status", "OPEN");
          const alertsMap = new Map<string, number>();
          (alerts || []).forEach(a => {
            const rid = String(a.reseller_id);
            alertsMap.set(rid, (alertsMap.get(rid) || 0) + 1);
          });

          // Buscar Agendamentos Pendentes
          const { data: jobs } = await supabaseBrowser.from("client_message_jobs").select("id,reseller_id,send_at,message,status").eq("tenant_id", tid).in("reseller_id", ids).in("status", ["SCHEDULED", "QUEUED"]).gte("send_at", new Date().toISOString());
          const jobsMap: Record<string, ScheduledMsg[]> = {};
          (jobs || []).forEach(row => {
            const rid = String(row.reseller_id);
            if (!jobsMap[rid]) jobsMap[rid] = [];
            jobsMap[rid].push(row as ScheduledMsg);
          });
          setScheduledMap(jobsMap);

          setTenants(fetched.map(t => ({ ...t, alertsCount: alertsMap.get(t.id) || 0 })));
        } else {
          setTenants(fetched);
        }
      }
    } catch (e: any) {
      addToast("error", "Erro ao carregar revendas", e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // --- API HANDLERS (Alertas e Mensagens) ---
  const handleSaveAlert = async () => {
    if (!tenantId || !showNewAlert.targetId) return;
    if (!newAlertText.trim()) return addToast("error", "Alerta vazio", "Digite um texto para o alerta.");
    try {
      // ✅ Sem invenções de colunas: manda apenas o que a política RLS do banco exige
      const payload = {
        id: crypto.randomUUID(), // ✅ MÁGICA: Gera o ID único direto no navegador!
        tenant_id: tenantId, 
        reseller_id: showNewAlert.targetId, 
        message: newAlertText, 
        status: "OPEN"
      };

      const { error } = await supabaseBrowser.from("client_alerts").insert(payload);
      
      if (error) throw error;
      
      addToast("success", "Alerta criado!");
      setShowNewAlert({ open: false, targetId: null, targetName: undefined });
      setNewAlertText("");
      await loadData();
    } catch (e: any) {
      addToast("error", "Erro ao criar alerta", e?.message);
    }
  };

  const handleOpenAlertList = async (targetId: string, targetName: string) => {
    setTenantAlerts([]);
    setShowAlertList({ open: true, targetId, targetName });
    if (!tenantId) return;
    const { data } = await supabaseBrowser.from("client_alerts").select("*").eq("tenant_id", tenantId).eq("reseller_id", targetId).eq("status", "OPEN").order("created_at", { ascending: false });
    if (data) setTenantAlerts(data);
  };

  const handleDeleteAlert = async (alertId: string) => {
    try {
      await supabaseBrowser.from("client_alerts").delete().eq("id", alertId);
      setTenantAlerts(prev => prev.filter(a => String(a.id) !== String(alertId)));
      await loadData();
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    }
  };

  const handleSendMessage = async () => {
    if (!tenantId || !showSendNow.resellerId || sendingNow) return;
    if (!messageText.trim()) return addToast("error", "Vazio", "Digite a mensagem.");
    try {
      setSendingNow(true);
      const token = await getToken();
      
      const payload: any = {
        tenant_id: tenantId, 
        saas_id: showSendNow.resellerId, // ou showScheduleMsg.resellerId
        message: messageText, // ou scheduleText
        whatsapp_session: selectedSessionNow // ✅ No Agendado coloque: selectedSessionSchedule
      };
      
      if (selectedTemplateNowId) {
        payload.message_template_id = selectedTemplateNowId;
      }

      // ✅ APONTA PARA A ROTA NOVA EXCLUSIVA DE REVENDEDOR
      const res = await fetch("/api/whatsapp/envio_agora", {
        method: "POST", 
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      
      const raw = await res.text();
      let json: any = {};
      try { json = raw ? JSON.parse(raw) : {}; } catch { }
      
      if (!res.ok) throw new Error(json?.error || raw || "Falha ao enviar");
      
      addToast("success", "Mensagem enviada!");
      setShowSendNow({ open: false, resellerId: null });
      setMessageText("");
      setSelectedTemplateNowId("");
    } catch (e: any) {
      addToast("error", "Erro ao enviar", e.message);
    } finally {
      setSendingNow(false);
    }
  };

  const handleScheduleMessage = async () => {
    if (!tenantId || !showScheduleMsg.resellerId || scheduling) return;
    if (!scheduleText.trim() || !scheduleDate) return addToast("error", "Erro", "Preencha a data e a mensagem.");
    try {
      setScheduling(true);
      const token = await getToken();
      
      const payload: any = {
        tenant_id: tenantId, 
        saas_id: showScheduleMsg.resellerId, // ✅ Ajustado para saas_id
        message: scheduleText, 
        send_at: scheduleDate, 
        whatsapp_session: "default"
      };
      
      if (selectedTemplateScheduleId) {
        payload.message_template_id = selectedTemplateScheduleId;
      }

      // ✅ APONTA PARA A ROTA ORIGINAL (HÍBRIDA)
      const res = await fetch("/api/whatsapp/envio_agendado", {
        method: "POST", 
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      
      const raw = await res.text();
      let json: any = {};
      try { json = raw ? JSON.parse(raw) : {}; } catch { }
      
      if (!res.ok) throw new Error(json?.error || raw || "Falha ao agendar");
      
      addToast("success", "Mensagem agendada!");
      setShowScheduleMsg({ open: false, resellerId: null });
      setScheduleText(""); 
      setScheduleDate("");
      setSelectedTemplateScheduleId("");
      await loadData();
    } catch (e: any) {
      addToast("error", "Erro ao agendar", e.message);
    } finally {
      setScheduling(false);
    }
  };

  const handleSaveNewTemplate = async () => {
    if (!tenantId || !newTemplateName.trim() || !newTemplateContent.trim()) return addToast("error", "Erro", "Preencha tudo.");
    try {
      setSavingTemplate(true);
      const { data, error } = await supabaseBrowser.from("message_templates").insert({ tenant_id: tenantId, name: newTemplateName, content: newTemplateContent }).select("id").single();
      if (error) throw error;
      const newId = String((data as any)?.id || "");
      const { data: tpls } = await supabaseBrowser.from("message_templates").select("id,name,content").eq("tenant_id", tenantId);
      setMessageTemplates(tpls || []);
      if (showNewTemplate.target === "now") { setSelectedTemplateNowId(newId); setMessageText(newTemplateContent); }
      else { setSelectedTemplateScheduleId(newId); setScheduleText(newTemplateContent); }
      addToast("success", "Template salvo!");
      setShowNewTemplate({ open: false, target: "now" });
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    } finally {
      setSavingTemplate(false);
    }
  };

  function closeAllPopups() { setMsgMenuForId(null); }

  const handleDelete = async (t: SaasTenant) => {
    const ok = await confirm({
      title: "Excluir permanentemente?",
      subtitle: "Essa ação NÃO pode ser desfeita. Todos os dados serão perdidos.",
      tone: "rose",
      icon: "⚠️",
      details: [`Revenda: ${t.name}`, "Ação: Deletar registro"],
      confirmText: "Excluir Definitivamente",
      cancelText: "Voltar",
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.rpc("saas_delete_tenant", { p_tenant_id: t.id });
      if (error) throw error;
      addToast("success", "Deletado", `${t.name} foi removido permanentemente.`);
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao deletar", e.message);
    }
  };

  const handleArchive = async (t: SaasTenant) => {
    const ok = await confirm({
      title: "Arquivar Revenda",
      subtitle: "O acesso ao painel será suspenso e ela irá para a lixeira.",
      tone: "amber",
      icon: "🗑️",
      details: [`Revenda: ${t.name}`, "Destino: Lixeira"],
      confirmText: "Arquivar",
      cancelText: "Voltar",
    });
    if (!ok) return;

    const { error } = await supabaseBrowser.rpc("saas_archive_tenant", { p_tenant_id: t.id });
    if (error) addToast("error", "Erro", error.message);
    else { addToast("success", "Arquivado", `${t.name} foi arquivado.`); loadData(); }
  };

  const handleRestore = async (t: SaasTenant) => {
    const ok = await confirm({
      title: "Restaurar Revenda",
      subtitle: "Ela voltará para a lista principal como Inativa.",
      tone: "emerald",
      icon: "♻️",
      details: [`Revenda: ${t.name}`, "Destino: Lista Ativa"],
      confirmText: "Restaurar",
      cancelText: "Voltar",
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.rpc("saas_restore_tenant", { p_tenant_id: t.id });
      if (error) throw error;
      addToast("success", "Restaurado", `${t.name} foi restaurado com sucesso.`); 
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao restaurar", e.message);
    }
  };

  // ADICIONAR após handleRestore:

  const handleAddSession = async (t: SaasTenant) => {
    const credEstimate = t.expires_at
      ? Math.max(0, Math.round(
          (new Date(t.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30) * 2
        ) / 2)
      : 0;

    const ok = await confirm({
      title: "Adicionar 2ª Sessão WhatsApp",
      subtitle: `Será descontado ~${credEstimate} crédito(s) proporcional ao tempo restante.`,
      tone: "amber",
      icon: "📱",
      details: [
        `Revenda: ${t.name}`,
        `Sessões atuais: ${t.whatsapp_sessions}/2`,
        `Saldo disponível: ${t.credit_balance} créditos`,
        "Renovações futuras custarão 2 créditos/mês",
      ],
      confirmText: "Confirmar e Descontar",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.rpc("saas_add_whatsapp_session", {
        p_tenant_id: t.id,
      });
      if (error) throw error;
      addToast("success", "2ª sessão ativada!", `${t.name} agora tem 2 sessões WhatsApp.`);
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao adicionar sessão", e.message);
    }
  };

  const handleRemoveSession = async (t: SaasTenant) => {
    const ok = await confirm({
      title: "Remover 2ª Sessão WhatsApp",
      subtitle: "A sessão será removida sem reembolso. Próximas renovações custarão 1 crédito/mês.",
      tone: "rose",
      icon: "📵",
      details: [`Revenda: ${t.name}`, "Sem reembolso de créditos"],
      confirmText: "Remover Sessão",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.rpc("saas_remove_whatsapp_session", {
        p_tenant_id: t.id,
      });
      if (error) throw error;
      
      addToast("success", "Sessão removida.", `${t.name} voltou para 1 sessão.`);
      loadData();

      // ✅ O ATIRADOR DE ELITE: Manda um sinal pro backend derrubar a VM do cliente imediatamente
      fetch("/api/saas/force-wa-disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_tenant_id: t.id, session_number: 2 })
      }).catch(() => {});

    } catch (e: any) {
      addToast("error", "Erro ao remover sessão", e.message);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return tenants.filter(t => {
      if (archivedFilter === "Sim") {
        if (t.license_status !== "ARCHIVED") return false;
      } else {
        if (t.license_status === "ARCHIVED") return false;
      }
      if (roleFilter !== "Todos" && t.role !== roleFilter) return false;
      if (statusFilter !== "Todos" && t.license_status !== statusFilter) return false;
      if (q) {
        const hay = [t.name, t.slug, t.responsible_name, t.auth_email, t.contact_email, t.whatsapp_username, t.phone_e164, t.role]
          .filter(Boolean).join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tenants, search, roleFilter, statusFilter, archivedFilter]);

  // ✅ Stats: Remove o seu próprio usuário e os SUPERADMINS das estatísticas
const directTenants = useMemo(() =>
  tenants.filter(t => t.parent_tenant_id === tenantId && t.role !== "SUPERADMIN"),
[tenants, tenantId]);

const stats = {
  total:   directTenants.filter(t => t.license_status !== "ARCHIVED").length,
  active:  directTenants.filter(t => t.license_status === "ACTIVE").length,
  trial:   directTenants.filter(t => t.license_status === "TRIAL").length,
  expired: directTenants.filter(t => t.license_status === "EXPIRED").length,
};

  const canManage = myRole.toUpperCase() === "SUPERADMIN" || myRole.toUpperCase() === "MASTER";

  // ✅ Remove o SEU PRÓPRIO usuário logado de aparecer na tabela!
const sortedTenants = useMemo(() => {
    const diretos = filtered.filter(t => t.parent_tenant_id === tenantId);
    diretos.sort((a, b) => a.name.localeCompare(b.name));
    return diretos;
  }, [filtered, tenantId]);

  // Contador de rede por tenant (calculado do array completo)
  const networkCount = useMemo(() => {
    const map: Record<string, number> = {};
    tenants.forEach(t => {
      if (t.parent_tenant_id) {
        map[t.parent_tenant_id] = (map[t.parent_tenant_id] || 0) + 1;
      }
    });
    return map;
  }, [tenants]);

  // ✅ LOADING INICIAL PARA NÃO PISCAR A TELA
  if (loading && myRole === "") {
    return <div className="p-12 text-center text-slate-400 animate-pulse">Carregando Gestão SaaS...</div>;
  }

  // ✅ TELA DE BLOQUEIO PARA USERS COMUNS
  if (myRole.toUpperCase() === "USER") {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight mb-2">
          Acesso Restrito
        </h1>
        <p className="text-slate-500 dark:text-white/60 max-w-md mx-auto">
          O módulo de <strong>Gestão SaaS</strong> está disponível apenas para contas com perfil Master ou Administrador.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Gestão SaaS</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Minha Rede
          </p>
        </div>
        
        {/* Ações Direita (Lixeira + Novo) */}
        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setArchivedFilter(archivedFilter === "Não" ? "Sim" : "Não");
            }}
            className={`hidden md:inline-flex h-9 md:h-10 px-3 rounded-lg text-xs font-bold border transition-colors items-center justify-center ${
              archivedFilter === "Sim"
                ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10"
            }`}
          >
            {archivedFilter === "Sim" ? "Ocultar Lixeira" : "Ver Lixeira"}
          </button>

          {canManage && (
            <button
              onClick={() => setShowNew(true)}
              className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
            >
              <span className="text-base leading-none">+</span> Novo Revendedor
            </button>
          )}
        </div>
      </div>
      
      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 sm:px-0">
        {[
          { label: "Total",     value: stats.total,   color: "text-slate-700 dark:text-white" },
          { label: "Ativos",    value: stats.active,  color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Trial",     value: stats.trial,   color: "text-sky-600 dark:text-sky-400" },
          { label: "Expirados", value: stats.expired, color: "text-rose-600 dark:text-rose-400" },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40 mb-1">{s.label}</div>
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

{/* --- BARRA DE FILTROS COMPLETA --- */}
      <div className="px-3 sm:px-0">
        <div className="md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 md:sticky md:top-4 z-20 mb-6">
          
          <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider mb-2">
          Filtros Rápidos
        </div>

        {/* MOBILE: Pesquisa + Botão de Painel */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar revenda..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500">
                <IconX />
              </button>
            )}
          </div>
          <button
            onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
            className={`h-10 px-3 rounded-lg border font-bold text-sm transition-colors flex items-center gap-2 ${
              (roleFilter !== "Todos" || statusFilter !== "Todos" || archivedFilter === "Sim")
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10"
            }`}
          >
            <IconFilter />
            <span className="hidden sm:inline">Filtros</span>
          </button>
        </div>

        {/* DESKTOP: Linha Única */}
        <div className="hidden md:flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar revenda, contato, whatsapp..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500">
                <IconX />
              </button>
            )}
          </div>
          <div className="w-[190px]">
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50">
              <option value="Todos">Role (Todos)</option>
              <option value="SUPERADMIN">Superadmin</option>
              <option value="MASTER">Master</option>
              <option value="USER">User</option>
            </select>
          </div>
          <div className="w-[190px]">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50">
              <option value="Todos">Status (Todos)</option>
              <option value="ACTIVE">Ativo</option>
              <option value="TRIAL">Trial</option>
              <option value="EXPIRED">Expirado</option>
            </select>
          </div>
          <button onClick={() => { setSearch(""); setRoleFilter("Todos"); setStatusFilter("Todos"); setArchivedFilter("Não"); }}
            className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 transition-colors flex items-center gap-1.5">
            <IconX /> Limpar
          </button>
        </div>

        {/* PAINEL MOBILE */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-2">
            
            {/* ✅ Lixeira no Mobile */}
            <button
              onClick={() => setArchivedFilter((cur) => (cur === "Não" ? "Sim" : "Não"))}
              className={`w-full h-10 px-3 rounded-lg text-sm font-bold border transition-colors flex items-center justify-between ${
                archivedFilter === "Sim"
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                  : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70"
              }`}
            >
              <span className="flex items-center gap-2">
                <IconTrash size={16} />
                Filtrar Lixeira
              </span>
              <span className="text-xs opacity-80">
                {archivedFilter === "Sim" ? "ON" : "OFF"}
              </span>
            </button>

            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
              className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50">
              <option value="Todos">Role (Todos)</option>
              <option value="SUPERADMIN">Superadmin</option>
              <option value="MASTER">Master</option>
              <option value="USER">User</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50">
              <option value="Todos">Status (Todos)</option>
              <option value="ACTIVE">Ativo</option>
              <option value="TRIAL">Trial</option>
              <option value="EXPIRED">Expirado</option>
            </select>
            <button onClick={() => { setSearch(""); setRoleFilter("Todos"); setStatusFilter("Todos"); setArchivedFilter("Não"); setMobileFiltersOpen(false); }}
              className="w-full h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5">
              <IconX /> Limpar
            </button>
          </div>
        )}
      

        {/* PAINEL MOBILE */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-2">
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
              className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50">
              <option value="Todos">Role (Todos)</option>
              <option value="SUPERADMIN">Superadmin</option>
              <option value="MASTER">Master</option>
              <option value="USER">User</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50">
              <option value="Todos">Status (Todos)</option>
              <option value="ACTIVE">Ativo</option>
              <option value="TRIAL">Trial</option>
              <option value="EXPIRED">Expirado</option>
              <option value="ARCHIVED">Arquivado</option>
            </select>
            <button onClick={() => { setSearch(""); setRoleFilter("Todos"); setStatusFilter("Todos"); setMobileFiltersOpen(false); }}
              className="w-full h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5">
              <IconX /> Limpar
            </button>
          </div>
        )}
        </div>
      </div>

{/* LISTA */}
      <div className="w-full bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-800 dark:text-white">
              Revendedores
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold">
  {sortedTenants.length}
</span>
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-400 dark:text-white/40 animate-pulse">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-slate-400 dark:text-white/40">Nenhum revenda encontrado.</div>
          ) : (
            <div className="overflow-x-auto">
              {/* min-w-[700px] força o scroll no mobile sem esmagar as colunas */}
              <table className="w-full text-sm text-left min-w-[700px]">
                <thead className="bg-slate-50 dark:bg-white/5 text-xs uppercase tracking-wider text-slate-500 dark:text-white/40 font-bold border-b border-slate-100 dark:border-white/5">
                  <tr>
                    <th className="px-4 py-3">Cliente / Revenda</th>
                    <th className="px-4 py-3">Perfil</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Validade</th>
                    <th className="px-4 py-3">Valor</th> {/* ✅ NOVA COLUNA DE VALOR */}
                    <th className="px-4 py-3 text-center">Créditos</th>
                    <th className="px-4 py-3 text-center">Sessões WA</th>
                    <th className="px-4 py-3 text-center">Módulos</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {sortedTenants.map(t => (
                      <TenantRow
                        key={t.id} t={t} canManage={canManage}
                        networkCount={networkCount[t.id] || 0}
                        onEdit={() => setEditTarget(t)}
                        onRenew={() => setRenewTarget(t)}
                        onCredits={() => setCreditsTarget(t)}
                        onArchive={() => handleArchive(t)}
                        onDelete={() => handleDelete(t)}
                        onRestore={() => handleRestore(t)}
                        onAddSession={() => handleAddSession(t)}
                        onRemoveSession={() => handleRemoveSession(t)}
                        // NOVAS PROPRIEDADES:
                        scheduledMap={scheduledMap}
                        msgMenuForId={msgMenuForId}
                        setMsgMenuForId={setMsgMenuForId}
                        onMessageNow={() => { setMsgMenuForId(null); setMessageText(""); setShowSendNow({ open: true, resellerId: t.id }); }}
                        onMessageSchedule={() => { setMsgMenuForId(null); setScheduleText(""); setScheduleDate(""); setShowScheduleMsg({ open: true, resellerId: t.id }); }}
                        onOpenScheduled={() => setShowScheduledModal({ open: true, resellerId: t.id, resellerName: t.name })}
                        onNewAlert={() => { setNewAlertText(""); setShowNewAlert({ open: true, targetId: t.id, targetName: t.name }); }}
                        onOpenAlerts={() => handleOpenAlertList(t.id, t.name)}
                      />
                    ))}
                  </tbody>
              </table>
              {/* ✅ Espaço fixo depois da última revenda (para popups/menus não serem cortados) */}
              <div className="h-24 md:h-20" />
            </div>
          )}
      </div>

      {/* MODAIS */}
      {showNew && (
        <TenantFormModal
          mode="new" myRole={myRole} parentTenantId={tenantId}
          sessionOptions={sessionOptions} // ✅ NOVO: Passando as sessões
          onClose={() => setShowNew(false)}
          onSuccess={() => { setShowNew(false); loadData(); addToast("success", "Revenda criada!"); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}
      {editTarget && (
        <TenantFormModal
          mode="edit" tenant={editTarget} myRole={myRole} parentTenantId={tenantId}
          sessionOptions={sessionOptions} // ✅ NOVO: Passando as sessões
          onClose={() => setEditTarget(null)}
          onSuccess={() => { setEditTarget(null); loadData(); addToast("success", "Perfil atualizado!"); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}
      {renewTarget && (
        <SaasRenewModal
          tenantId={renewTarget.id}
          tenantName={renewTarget.name}
          saasPlanTableId={renewTarget.saas_plan_table_id ?? null}
          currentExpiry={renewTarget.expires_at}
          whatsappSessions={renewTarget.whatsapp_sessions}
          customMonthlyPrice={renewTarget.custom_monthly_price} // ✅ ADICIONA ESTA LINHA
          financialControlEnabled={renewTarget.financial_control_enabled}
          isSuperadmin={myRole.toUpperCase() === "SUPERADMIN"}
          onClose={() => setRenewTarget(null)}
          onSuccess={() => { setRenewTarget(null); loadData(); addToast("success", "Licença renovada!"); }}
          onError={m => addToast("error", "Erro", m)}
          onToast={addToast}
        />
      )}
      {creditsTarget && (
        <SaasCreditsModal
          tenantId={creditsTarget.id}
          tenantName={creditsTarget.name}
          creditsPlanTableId={creditsTarget.credits_plan_table_id ?? null}
          currentBalance={creditsTarget.credit_balance}
          isTrial={creditsTarget.is_trial}
          financialControlEnabled={creditsTarget.financial_control_enabled} // ✅ NOVO
          onClose={() => setCreditsTarget(null)}
          onSuccess={() => { setCreditsTarget(null); loadData(); addToast("success", "Créditos enviados!"); }}
          onError={m => addToast("error", "Erro", m)}
          onToast={addToast}
        />
      )}


      {/* --- MODAL DE ENVIO DE MENSAGEM --- */}
      {showSendNow.open && (
        <Modal title="Enviar Mensagem Rápida" onClose={() => {
          setShowSendNow({ open: false, resellerId: null });
          setSelectedTemplateNowId("");
          setMessageText("");
          setSelectedSessionNow("default"); // ✅ Reseta ao fechar
        }}>
          <div className="space-y-4">
            <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 p-3 rounded-lg flex items-center gap-3">
               <span className="text-xl">💬</span>
               <div className="text-sm text-sky-900 dark:text-sky-200">
                 Esta mensagem será enviada <strong>imediatamente</strong> via WhatsApp.
               </div>
            </div>

            {/* ✅ Select da Sessão WhatsApp */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
                Sessão de Envio
              </label>
              <select
                value={selectedSessionNow}
                onChange={(e) => setSelectedSessionNow(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-sm font-medium text-slate-800 dark:text-white outline-none focus:border-sky-500 transition-colors"
              >
                {sessionOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
                Mensagem pronta (opcional)
              </label>
              <select
                value={selectedTemplateNowId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedTemplateNowId(id);
                  if (id) {
                    const tpl = messageTemplates.find((t) => t.id === id);
                    setMessageText(tpl?.content ?? "");
                  } else {
                    setMessageText("");
                  }
                }}
                className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-sky-500 transition-colors text-sm"
              >
                <option value="">Selecionar...</option>
                {messageTemplates
                  // Filtra apenas SaaS (pela nova categoria ou pelo nome, caso não tenha salvo ainda)
                  .filter((t: any) => t.category === "Revenda SaaS" || String(t.name).toUpperCase().includes("SAAS"))
                  .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <textarea
              value={messageText}
              disabled={!!selectedTemplateNowId}
              onChange={(e) => {
                if (selectedTemplateNowId) setSelectedTemplateNowId("");
                setMessageText(e.target.value);
              }}
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-4 text-slate-800 dark:text-white outline-none focus:border-sky-500 transition-colors min-h-[120px] text-sm resize-none disabled:opacity-70"
              placeholder="Olá, gostaria de informar que..."
              autoFocus
            />

            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={() => setShowSendNow({ open: false, resellerId: null })} 
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 text-sm font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendMessage}
                disabled={sendingNow}
                className="px-6 py-2 rounded-lg bg-sky-600 text-white font-bold hover:bg-sky-500 shadow-lg shadow-sky-900/20 flex items-center gap-2 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconSend /> {sendingNow ? "Enviando..." : "Enviar Agora"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* --- MODAL DE AGENDAMENTO DE MENSAGEM --- */}
      {showScheduleMsg.open && (
        <Modal title="Agendar Mensagem" onClose={() => {
          setShowScheduleMsg({ open: false, resellerId: null });
          setSelectedTemplateScheduleId("");
          setScheduleText("");
          setScheduleDate("");
          setSelectedSessionSchedule("default"); // ✅ Reseta ao fechar
        }}>
          <div className="space-y-5">
            <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20 p-3 rounded-lg flex items-center gap-3">
               <span className="text-xl">📅</span>
               <div className="text-sm text-purple-900 dark:text-purple-200">
                 Programe avisos ou cobranças para o futuro.
               </div>
            </div>

            {/* ✅ Select da Sessão WhatsApp */}
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
                Sessão de Envio
              </label>
              <select
                value={selectedSessionSchedule}
                onChange={(e) => setSelectedSessionSchedule(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-sm font-medium text-slate-800 dark:text-white outline-none focus:border-purple-500 transition-colors"
              >
                {sessionOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Data e Hora do Envio</label>
              <input
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-purple-500 transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Conteúdo da Mensagem</label>
              <div>
                <select
                  value={selectedTemplateScheduleId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedTemplateScheduleId(id);
                    if (id) {
                      const tpl = messageTemplates.find((t) => t.id === id);
                      setScheduleText(tpl?.content ?? "");
                    } else {
                      setScheduleText("");
                    }
                  }}
                  className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-purple-500 transition-colors text-sm mb-3"
                >
                  <option value="">Selecionar mensagem pronta (opcional)...</option>
                  {messageTemplates
                    .filter((t: any) => t.category === "Revenda SaaS" || String(t.name).toUpperCase().includes("SAAS"))
                    .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <textarea
                value={scheduleText}
                disabled={!!selectedTemplateScheduleId}
                onChange={(e) => {
                  if (selectedTemplateScheduleId) setSelectedTemplateScheduleId("");
                  setScheduleText(e.target.value);
                }}
                className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-4 text-slate-800 dark:text-white outline-none focus:border-purple-500 transition-colors min-h-[120px] text-sm resize-none disabled:opacity-70"
                placeholder="Ex: Olá, seu plano vence amanhã..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={() => setShowScheduleMsg({ open: false, resellerId: null })} 
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 text-sm font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleScheduleMessage}
                disabled={scheduling}
                className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 shadow-lg shadow-purple-900/20 flex items-center gap-2 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconClock /> {scheduling ? "Agendando..." : "Confirmar Agendamento"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showNewAlert.open && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-white">Novo Alerta: {showNewAlert.targetName}</h3>
            <textarea value={newAlertText} onChange={e => setNewAlertText(e.target.value)} className="w-full p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 text-sm min-h-[100px]" placeholder="Motivo do alerta..." />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowNewAlert({ open: false, targetId: null })} className="font-bold text-sm text-slate-500">Cancelar</button>
              <button onClick={handleSaveAlert} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-sm">Salvar Alerta</button>
            </div>
          </div>
        </div>
      )}

      {showAlertList.open && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Alertas de {showAlertList.targetName}</h3>
            {tenantAlerts.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum alerta aberto.</p>
            ) : (
              tenantAlerts.map(a => (
                <div key={a.id} className="flex justify-between items-start p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 rounded-lg">
                  <span className="text-sm text-slate-700 dark:text-white">{a.message}</span>
                  <button onClick={() => handleDeleteAlert(a.id)} className="text-xs text-rose-500 font-bold hover:underline">Excluir</button>
                </div>
              ))
            )}
            <button onClick={() => setShowAlertList({ open: false, targetId: null })} className="w-full mt-4 py-2 border rounded-lg font-bold text-slate-600">Fechar</button>
          </div>
        </div>
      )}

      {showScheduledModal.open && showScheduledModal.resellerId && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Mensagens Agendadas</h3>
            {(scheduledMap[showScheduledModal.resellerId] || []).length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma mensagem na fila.</p>
            ) : (
              (scheduledMap[showScheduledModal.resellerId] || []).map(s => (
                <div key={s.id} className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 rounded-lg mb-2">
                  <div className="text-xs font-bold text-purple-600 mb-1">{new Date(s.send_at).toLocaleString("pt-BR")}</div>
                  <div className="text-sm text-slate-700 dark:text-white">{s.message}</div>
                </div>
              ))
            )}
            <button onClick={() => setShowScheduledModal({ open: false, resellerId: null })} className="w-full py-2 border rounded-lg font-bold text-slate-600">Fechar</button>
          </div>
        </div>
      )}

      {showNewTemplate.open && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 rounded-xl shadow-2xl p-6 space-y-4">
            <h3 className="font-bold">Salvar novo Template</h3>
            <input value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} className="w-full h-10 px-3 bg-slate-50 border rounded-lg text-sm" placeholder="Nome (Ex: Cobrança)" />
            <textarea value={newTemplateContent} onChange={e => setNewTemplateContent(e.target.value)} className="w-full p-3 bg-slate-50 border rounded-lg text-sm min-h-[100px]" placeholder="Conteúdo..." />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowNewTemplate({ open: false, target: "now" })} className="text-sm font-bold text-slate-500">Cancelar</button>
              <button onClick={handleSaveNewTemplate} disabled={savingTemplate} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg text-sm">{savingTemplate ? "Salvando..." : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}

      {ConfirmUI} {/* ✅ MODAL BONITO INSERIDO AQUI */}

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

// ============================================================
// LINHA DESKTOP
// ============================================================
function TenantRow({ 
  t, canManage, networkCount, onEdit, onRenew, onCredits, onArchive, onDelete, onRestore, onAddSession, onRemoveSession,
  scheduledMap, msgMenuForId, setMsgMenuForId, onMessageNow, onMessageSchedule, onOpenScheduled, onNewAlert, onOpenAlerts
}: {
  t: SaasTenant; canManage: boolean; networkCount: number;
  onEdit: () => void; onRenew: () => void; onCredits: () => void;
  onArchive: () => void; onDelete: () => void; onRestore: () => void;
  onAddSession: () => void; onRemoveSession: () => void;
  scheduledMap: Record<string, ScheduledMsg[]>;
  msgMenuForId: string | null; setMsgMenuForId: React.Dispatch<React.SetStateAction<string | null>>;
  onMessageNow: () => void; onMessageSchedule: () => void; onOpenScheduled: () => void;
  onNewAlert: () => void; onOpenAlerts: () => void;
}) {
  const isSuperadmin = t.role === "SUPERADMIN";
  const days = daysUntil(t.expires_at);
  const scheduledCount = scheduledMap[t.id]?.length || 0;
  
  // ✅ LOGICA DE MÓDULOS
  const mods = t.active_modules || [];
  const isOnlyFinance = mods.length === 1 && mods.includes("financeiro");
  const hasSaas = mods.includes("saas");
  const hasIptv = mods.includes("iptv");

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
      <td className="px-4 py-3">
        <div className="flex flex-col max-w-[180px] sm:max-w-none">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="font-semibold truncate">
              {/* ✅ MUDANÇA: O link agora aparece para qualquer conta SaaS (MASTER ou USER) */}
              <a href={`/admin/settings/gestao_saas/${t.id}`} className="text-emerald-600 dark:text-emerald-400 hover:underline transition-colors" onClick={e => e.stopPropagation()}>
                {t.name}
              </a>
              {t.responsible_name && t.responsible_name !== t.name && (
                <span className="text-slate-400 dark:text-white/30 font-normal text-xs ml-1">/ {t.responsible_name}</span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {networkCount > 0 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50 border border-slate-200 dark:border-white/10 whitespace-nowrap">
                  {networkCount} na rede
                </span>
              )}
              {(t.alertsCount ?? 0) > 0 && (
                <button type="button" onClick={onOpenAlerts} title={`${t.alertsCount} alerta(s)`} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-600 border border-amber-200 text-[10px] font-bold hover:bg-amber-200 transition-colors animate-pulse">
                  🔔 {t.alertsCount}
                </button>
              )}
              {scheduledCount > 0 && (
                <button type="button" onClick={onOpenScheduled} title={`${scheduledCount} agendada(s)`} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold hover:bg-purple-200 transition-colors animate-pulse">
                  🗓️ {scheduledCount}
                </button>
              )}
            </div>
          </div>
          
          {t.whatsapp_username ? (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-500/80 truncate mt-0.5">@{t.whatsapp_username}</span>
          ) : t.phone_e164 ? (
            <span className="text-xs font-medium text-slate-500 dark:text-white/60 truncate mt-0.5">{t.phone_e164}</span>
          ) : null}
          <div className="text-[10px] font-mono text-slate-400 dark:text-white/30 mt-0.5 truncate">
            {t.auth_email || t.contact_email || "—"}
          </div>
        </div>
      </td>
      <td className="px-4 py-3"><RoleBadge role={t.role} /></td>
      <td className="px-4 py-3"><StatusBadge status={t.license_status} /></td>
      
      {/* VALIDADE */}
      <td className="px-4 py-3">
        {isSuperadmin ? (
          <span className="text-xs font-bold text-purple-500">∞ Permanente</span>
        ) : t.expires_at ? (
          <span className="text-xs font-medium text-slate-700 dark:text-white">{fmtDate(t.expires_at)}</span>
        ) : <span className="text-slate-400 text-xs">—</span>}
      </td>

      {/* ✅ VALOR (Nova Coluna Separada) */}
      <td className="px-4 py-3">
        {isSuperadmin ? (
          <span className="text-slate-400 text-xs">—</span>
        ) : t.custom_monthly_price !== null ? (
          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400" title="Preço Acordado (Override)">
            R$ {Number(t.custom_monthly_price).toFixed(2).replace(".", ",")}
          </span>
        ) : (
          <span className="text-[10px] italic text-slate-400" title="Usa o preço padrão da tabela">Tabela</span>
        )}
      </td>
      
      {/* CRÉDITOS */}
      <td className="px-4 py-3 text-center">
        {isSuperadmin ? (
          <span className="text-xs font-bold text-purple-500">∞</span>
        ) : isOnlyFinance || (!hasIptv && !hasSaas) ? (
          <span className="text-xs font-bold text-slate-300 dark:text-white/20">N/A</span>
        ) : (
          <span className={`text-sm font-bold ${t.credit_balance > 0 ? "text-slate-700 dark:text-white" : "text-slate-400 dark:text-white/30"}`}>
            {Number(t.credit_balance).toFixed(1).replace(".0", "")}
          </span>
        )}
      </td>

      {/* SESSÕES WA (Sem botões, apenas visualização) */}
      <td className="px-4 py-3 text-center">
        {isSuperadmin ? (
          <span className="text-xs font-bold text-purple-500">∞</span>
        ) : isOnlyFinance ? (
          <span className="text-xs font-bold text-slate-300 dark:text-white/20">N/A</span>
        ) : (
          <div className="flex flex-col items-center justify-center gap-0.5">
            <div className="flex items-center gap-1.5">
              {canManage && t.whatsapp_sessions >= 2 && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveSession(); }}
                  title="Remover 2ª sessão"
                  className="w-4 h-4 rounded-full bg-rose-500 hover:bg-rose-400 text-white flex items-center justify-center font-bold text-xs leading-none shadow transition-all hover:scale-110">
                  −
                </button>
              )}
              <span className="text-xs font-bold text-slate-700 dark:text-white">{t.whatsapp_sessions}/2</span>
              {canManage && t.whatsapp_sessions < 2 && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onAddSession(); }}
                  title="Adicionar 2ª sessão"
                  className="w-4 h-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center font-bold text-xs leading-none shadow transition-all hover:scale-110">
                  +
                </button>
              )}
            </div>
            {t.is_trial && <span className="text-[9px] text-sky-400 font-bold uppercase">trial</span>}
          </div>
        )}
      </td>

      {/* ✅ NOVA CÉLULA: MÓDULOS (Estilo Dashboard) */}
      <td className="px-4 py-3 text-center">
        <div className="flex flex-wrap justify-center items-center mx-auto gap-1.5 max-w-[220px]">
          {hasIptv && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold shadow-sm bg-sky-500 border-sky-500 text-white shadow-sky-900/20" title="Módulo IPTV Ativo">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/>
                <polyline points="17 2 12 7 7 2"/>
              </svg>
              IPTV
            </span>
          )}
          {hasSaas && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold shadow-sm bg-violet-500 border-violet-500 text-white shadow-violet-900/20" title="Módulo SaaS Ativo">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              SaaS
            </span>
          )}
          {mods.includes("financeiro") && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold shadow-sm bg-emerald-500 border-emerald-500 text-white shadow-emerald-900/20" title="Módulo Financeiro Ativo">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              Financeiro
            </span>
          )}
        </div>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 transition-opacity relative">
          
          <div className="relative">
            <ActionBtn title="Mensagem" tone="blue" onClick={(e) => { e.stopPropagation(); setMsgMenuForId((cur) => (cur === t.id ? null : t.id)); }}>
              <IconChat />
            </ActionBtn>
            {msgMenuForId === t.id && (
              <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] z-50 shadow-2xl overflow-hidden p-1">
                <button onClick={onMessageNow} className="w-full px-4 py-2.5 flex items-center gap-3 text-slate-600 dark:text-white/60 hover:bg-emerald-500/10 hover:text-emerald-600 transition-all text-left text-sm font-bold rounded-lg"><IconSend /> Enviar agora</button>
                <button onClick={onMessageSchedule} className="w-full px-4 py-2.5 flex items-center gap-3 text-slate-600 dark:text-white/60 hover:bg-emerald-500/10 hover:text-emerald-600 transition-all text-left text-sm font-bold rounded-lg"><IconClock /> Programar</button>
              </div>
            )}
          </div>

          <ActionBtn title="Editar perfil" tone="amber" onClick={onEdit}><IconEdit /></ActionBtn>
          <ActionBtn title="Novo alerta" tone="purple" onClick={onNewAlert}><IconBell /></ActionBtn>

          {!isSuperadmin && canManage && (
            <>
              <ActionBtn title="Renovar licença" tone="green" onClick={onRenew}><IconMoney /></ActionBtn>
              {t.role !== "USER" && !isOnlyFinance && (
                <ActionBtn title="Enviar créditos" tone="blue" onClick={onCredits}><IconCoins /></ActionBtn>
              )}
              <ActionBtn 
                title={t.license_status === "ARCHIVED" ? "Restaurar" : "Arquivar"} 
                tone={t.license_status === "ARCHIVED" ? "green" : "red"} 
                onClick={t.license_status === "ARCHIVED" ? onRestore : onArchive}
              >
                {t.license_status === "ARCHIVED" ? <IconRestore /> : <IconTrash />}
              </ActionBtn>
              {t.license_status === "ARCHIVED" && (
                <ActionBtn title="Deletar permanentemente" tone="red" onClick={onDelete}><IconTrash /></ActionBtn>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}


// ============================================================
// MODAL: HISTÓRICO
// ============================================================
function HistoryModal({ tenant, onClose }: { tenant: SaasTenant; onClose: () => void }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabaseBrowser
      .from("saas_credit_transactions")
      .select("id, type, amount, description, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setTransactions((data as Transaction[]) ?? []); setLoading(false); });
  }, [tenant.id]);

const typeStyle: Record<string, string> = {
    purchase: "text-sky-600 dark:text-sky-400",
    consume:  "text-rose-600 dark:text-rose-400",
    grant:    "text-emerald-600 dark:text-emerald-400",
    refund:   "text-purple-600 dark:text-purple-400",
  };
  const typeLabel: Record<string, string> = {
    purchase: "Compra",
    consume:  "Consumo",
    grant:    "Recebido",
    refund:   "Reembolso",
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[80dvh]">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-between items-center shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white">Histórico de Créditos</h3>
            <p className="text-xs text-slate-400">{tenant.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><IconX /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-slate-400 animate-pulse">Carregando...</div>
          ) : transactions.length === 0 ? (
            <div className="py-10 text-center text-slate-400">Nenhuma transação.</div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-400 sticky top-0 border-b border-slate-100 dark:border-white/5">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Valor</th>
                  <th className="px-4 py-3">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {transactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono">{fmtDateTime(tx.created_at)}</td>
                    <span className={`text-xs font-bold ${typeStyle[tx.type] ?? "text-slate-500"}`}>
  {typeLabel[tx.type] ?? tx.type}
</span>
                    <td className={`px-4 py-3 font-bold text-sm ${typeStyle[tx.type] ?? "text-slate-500"}`}>{tx.amount > 0 ? "+" : ""}{tx.amount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-white/50">{tx.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end shrink-0">
          <button onClick={onClose} className="px-5 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white font-bold text-sm hover:bg-slate-200 dark:hover:bg-white/20 transition">Fechar</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// ÍCONES
// ============================================================
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>; }
function IconEdit({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconRefresh({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function IconCoins({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>; }
function IconClock({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconTrash({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
function IconChat() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>; }
function IconSend() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>; }
function IconBell() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>; }
function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 bg-black/70 backdrop-blur-sm grid place-items-center z-[99999] p-4 animate-in fade-in duration-200">
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
          <div className="font-bold text-slate-800 dark:text-white tracking-tight">{title}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors"><IconX /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
function IconFilter() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 3H2l8 9v7l4 2v-9l8-9Z" />
    </svg>
  );
}
function IconRestore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

function IconMoney() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }