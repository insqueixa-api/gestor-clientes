"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { getCurrentTenantId } from "@/lib/tenant";

// ============================================================
// HELPERS DE TELEFONE (igual ao ResellerFormModal)
// ============================================================
const COUNTRIES = [
  { name: "Brasil",         code: "55"  },
  { name: "Portugal",       code: "351" },
  { name: "Estados Unidos", code: "1"   },
  { name: "Reino Unido",    code: "44"  },
  { name: "Espanha",        code: "34"  },
  { name: "Alemanha",       code: "49"  },
  { name: "França",         code: "33"  },
  { name: "Itália",         code: "39"  },
  { name: "Irlanda",        code: "353" },
  { name: "México",         code: "52"  },
  { name: "Argentina",      code: "54"  },
  { name: "Colômbia",       code: "57"  },
  { name: "Chile",          code: "56"  },
];

function splitE164(e164: string) {
  const digits = (e164 || "").replace(/\D+/g, "");
  const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  const country = sorted.find(c => digits.startsWith(c.code));
  if (!country) return { countryName: "🌍", countryCode: digits.slice(0, 2), localNumber: digits.slice(2) };
  return { countryName: country.name, countryCode: country.code, localNumber: digits.slice(country.code.length) };
}

function formatLocalNumber(num: string) {
  if (!num) return "";
  if (num.length === 10) return num.replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3");
  if (num.length === 11) return num.replace(/(\d{2})(\d{5})(\d{4})/, "$1 $2 $3");
  return num;
}

function applyPhoneNormalization(rawInput: string) {
  const digits = (rawInput || "").replace(/\D+/g, "");
  if (!digits) return { countryLabel: "—", e164: "", nationalDigits: "", formattedNational: "" };

  const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  const hasKnownDDI = sorted.some(c => digits.startsWith(c.code));
  const userTypedPlus = (rawInput || "").trim().startsWith("+");

  let e164 = "";
  if (userTypedPlus || hasKnownDDI) {
    e164 = `+${digits}`;
  } else if (!hasKnownDDI && (digits.length === 10 || digits.length === 11)) {
    e164 = `+55${digits}`;
  } else {
    e164 = `+${digits}`;
  }

  const info = splitE164(e164);
  const formattedNational = formatLocalNumber(info.localNumber || "");
  const countryLabel = `${info.countryName} (+${info.countryCode})`;
  return { countryLabel, e164, nationalDigits: info.localNumber || "", formattedNational };
}

// ============================================================
// TIPOS
// ============================================================
type SaasTenant = {
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
  alertsCount?: number; // ✅ ADICIONADO PARA O CONTADOR DE ALERTAS
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
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
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
// COMPONENTES AUXILIARES
// ============================================================
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight uppercase">{children}</label>;
}

function FieldInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40 whitespace-nowrap">{children}</span>
      <div className="flex-1 h-px bg-slate-100 dark:bg-white/5" />
    </div>
  );
}

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
// PÁGINA PRINCIPAL
// ============================================================
export default function GestaoSaasPage() {
  const [tenants, setTenants] = useState<SaasTenant[]>([]);
  const [myRole, setMyRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false); // NOVO ESTADO
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState<SaasTenant | null>(null);
  const [renewTarget, setRenewTarget] = useState<SaasTenant | null>(null);
  const [creditsTarget, setCreditsTarget] = useState<SaasTenant | null>(null);
const [historyTarget, setHistoryTarget] = useState<SaasTenant | null>(null);

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
  
  const [scheduledMap, setScheduledMap] = useState<Record<string, ScheduledMsg[]>>({});
  const [showScheduledModal, setShowScheduledModal] = useState<{ open: boolean; resellerId: string | null; resellerName?: string }>({ open: false, resellerId: null });
  
  const [showAlertList, setShowAlertList] = useState<{ open: boolean; targetId: string | null; targetName?: string }>({ open: false, targetId: null });
  const [tenantAlerts, setTenantAlerts] = useState<any[]>([]);

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
        const { data: tpls } = await supabaseBrowser.from("message_templates").select("id,name,content").eq("tenant_id", tid);
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
      const { error } = await supabaseBrowser.from("client_alerts").insert({
        tenant_id: tenantId, reseller_id: showNewAlert.targetId, message: newAlertText, status: "OPEN"
      });
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
      const res = await fetch("/api/whatsapp/envio_agora", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, reseller_id: showSendNow.resellerId, message: messageText, whatsapp_session: "default", message_template_id: selectedTemplateNowId }),
      });
      if (!res.ok) throw new Error("Falha ao enviar");
      addToast("success", "Mensagem enviada!");
      setShowSendNow({ open: false, resellerId: null });
      setMessageText("");
    } catch (e: any) {
      addToast("error", "Erro", e.message);
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
      const res = await fetch("/api/whatsapp/envio_agendado", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, reseller_id: showScheduleMsg.resellerId, message: scheduleText, send_at: scheduleDate, whatsapp_session: "default", message_template_id: selectedTemplateScheduleId }),
      });
      if (!res.ok) throw new Error("Falha ao agendar");
      addToast("success", "Mensagem agendada!");
      setShowScheduleMsg({ open: false, resellerId: null });
      setScheduleText(""); setScheduleDate("");
      await loadData();
    } catch (e: any) {
      addToast("error", "Erro", e.message);
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

  const handleArchive = async (t: SaasTenant) => {
    if (!confirm(`Arquivar "${t.name}"? O acesso será suspenso.`)) return;
    const { error } = await supabaseBrowser.rpc("saas_archive_tenant", { p_tenant_id: t.id });
    if (error) addToast("error", "Erro", error.message);
    else { addToast("success", "Arquivado", `${t.name} foi arquivado.`); loadData(); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return tenants.filter(t => {
      if (roleFilter !== "Todos" && t.role !== roleFilter) return false;
      if (statusFilter !== "Todos" && t.license_status !== statusFilter) return false;
      if (q) {
        const hay = [t.name, t.slug, t.responsible_name, t.auth_email, t.contact_email, t.whatsapp_username, t.phone_e164, t.role]
          .filter(Boolean).join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tenants, search, roleFilter, statusFilter]);

  // Stats: não conta o superadmin nos números
  const nonSuperTenants = tenants.filter(t => t.role !== "SUPERADMIN");
  const stats = {
    total:    nonSuperTenants.length,
    active:   nonSuperTenants.filter(t => t.license_status === "ACTIVE").length,
    trial:    nonSuperTenants.filter(t => t.license_status === "TRIAL").length,
    expired:  nonSuperTenants.filter(t => t.license_status === "EXPIRED").length,
  };

  const canManage = myRole.toUpperCase() === "SUPERADMIN" || myRole.toUpperCase() === "MASTER";

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Gestão SaaS</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Rede de revendas ·{" "}
            <span className="font-bold text-slate-500 dark:text-white/50 lowercase">{myRole || "carregando..."}</span>
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowNew(true)}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
          >
            <span className="text-base leading-none">+</span> Novo Revenda
          </button>
        )}
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
      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 md:sticky md:top-4 z-20 mb-6">
        
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
            className={`h-10 px-3 rounded-lg border font-bold text-sm transition-colors ${
              (roleFilter !== "Todos" || statusFilter !== "Todos")
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-50"
            }`}
          >
            Filtros
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
              <option value="ARCHIVED">Arquivado</option>
            </select>
          </div>
          <button onClick={() => { setSearch(""); setRoleFilter("Todos"); setStatusFilter("Todos"); }}
            className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 transition-colors flex items-center gap-1.5">
            <IconX /> Limpar
          </button>
        </div>

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

      {/* LISTA */}
      <div className="px-3 sm:px-0">
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-hidden sm:mx-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-800 dark:text-white">
              Revendedores
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold">
                {filtered.length}
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
                    <th className="px-4 py-3">Revenda / Contato</th>
                    <th className="px-4 py-3">Perfil</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Validade</th>
                    <th className="px-4 py-3">Créditos</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {filtered.map(t => (
                      <TenantRow
                        key={t.id} t={t} canManage={canManage}
                        onEdit={() => setEditTarget(t)}
                        onRenew={() => setRenewTarget(t)}
                        onCredits={() => setCreditsTarget(t)}
                        onHistory={() => setHistoryTarget(t)}
                        onArchive={() => handleArchive(t)}
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
            </div>
          )}
        </div>
      </div>

      {/* MODAIS */}
      {showNew && (
        <TenantFormModal
          mode="new" myRole={myRole}
          onClose={() => setShowNew(false)}
          onSuccess={() => { setShowNew(false); loadData(); addToast("success", "Revenda criada!"); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}
      {editTarget && (
        <TenantFormModal
          mode="edit" tenant={editTarget} myRole={myRole}
          onClose={() => setEditTarget(null)}
          onSuccess={() => { setEditTarget(null); loadData(); addToast("success", "Perfil atualizado!"); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}
      {renewTarget && (
        <RenewModal tenant={renewTarget} myRole={myRole}
          onClose={() => setRenewTarget(null)}
          onSuccess={() => { setRenewTarget(null); loadData(); addToast("success", "Licença renovada!"); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}
      {creditsTarget && (
        <CreditsModal tenant={creditsTarget}
          onClose={() => setCreditsTarget(null)}
          onSuccess={() => { setCreditsTarget(null); loadData(); addToast("success", "Créditos enviados!"); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}
      {historyTarget && (
        <HistoryModal tenant={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}

      {showSendNow.open && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-white">Enviar Mensagem Agora</h3>
            <div className="flex gap-2">
              <select value={selectedTemplateNowId} onChange={(e) => setSelectedTemplateNowId(e.target.value)} className="flex-1 h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm">
                <option value="">Selecionar mensagem...</option>
                {messageTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button onClick={() => setShowNewTemplate({ open: true, target: "now" })} className="px-3 rounded-lg border text-xs font-bold text-slate-600 hover:bg-slate-50">+ Template</button>
            </div>
            <textarea value={messageText} onChange={e => setMessageText(e.target.value)} className="w-full min-h-[120px] p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-sm" placeholder="Sua mensagem..." />
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowSendNow({ open: false, resellerId: null })} className="px-4 py-2 font-bold text-sm text-slate-500">Cancelar</button>
              <button onClick={handleSendMessage} disabled={sendingNow} className="px-6 py-2 bg-sky-600 text-white font-bold rounded-lg text-sm">{sendingNow ? "Enviando..." : "Enviar"}</button>
            </div>
          </div>
        </div>
      )}

      {showScheduleMsg.open && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-slate-800 dark:text-white">Agendar Mensagem</h3>
            <div className="flex gap-2">
              <select value={selectedTemplateScheduleId} onChange={(e) => setSelectedTemplateScheduleId(e.target.value)} className="flex-1 h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm">
                <option value="">Selecionar mensagem...</option>
                {messageTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button onClick={() => setShowNewTemplate({ open: true, target: "schedule" })} className="px-3 rounded-lg border text-xs font-bold text-slate-600 hover:bg-slate-50">+ Template</button>
            </div>
            <input type="datetime-local" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 rounded-lg text-sm" />
            <textarea value={scheduleText} onChange={e => setScheduleText(e.target.value)} className="w-full min-h-[120px] p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 text-sm" placeholder="Mensagem agendada..." />
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowScheduleMsg({ open: false, resellerId: null })} className="px-4 py-2 font-bold text-sm text-slate-500">Cancelar</button>
              <button onClick={handleScheduleMessage} disabled={scheduling} className="px-6 py-2 bg-purple-600 text-white font-bold rounded-lg text-sm">{scheduling ? "Agendando..." : "Agendar"}</button>
            </div>
          </div>
        </div>
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
  t, canManage, onEdit, onRenew, onCredits, onHistory, onArchive,
  scheduledMap, msgMenuForId, setMsgMenuForId, onMessageNow, onMessageSchedule, onOpenScheduled, onNewAlert, onOpenAlerts
}: {
  t: SaasTenant; canManage: boolean;
  onEdit: () => void; onRenew: () => void; onCredits: () => void;
  onHistory: () => void; onArchive: () => void;
  scheduledMap: Record<string, ScheduledMsg[]>;
  msgMenuForId: string | null; setMsgMenuForId: React.Dispatch<React.SetStateAction<string | null>>;
  onMessageNow: () => void; onMessageSchedule: () => void; onOpenScheduled: () => void;
  onNewAlert: () => void; onOpenAlerts: () => void;
}) {
  const isSuperadmin = t.role === "SUPERADMIN";
  const days = daysUntil(t.expires_at);
  const scheduledCount = scheduledMap[t.id]?.length || 0;

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
      <td className="px-4 py-3">
        <div className="flex flex-col max-w-[180px] sm:max-w-none">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="font-semibold text-slate-700 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate">
              {t.name}
              {t.responsible_name && t.responsible_name !== t.name && (
                <span className="text-slate-400 dark:text-white/30 font-normal"> / {t.responsible_name}</span>
              )}
            </div>

            {/* Badges de Notificação */}
            <div className="flex items-center gap-1 shrink-0">
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
      <td className="px-4 py-3">
        {isSuperadmin ? (
          <span className="text-xs font-bold text-purple-500">∞ Permanente</span>
        ) : t.expires_at ? (
          <div className="flex flex-col">
            <span className="text-xs font-medium text-slate-700 dark:text-white">{fmtDate(t.expires_at)}</span>
            {days !== null && (
              <span className={`text-[10px] font-bold ${days < 0 ? "text-rose-500" : days <= 7 ? "text-amber-500" : "text-slate-400"}`}>
                {days < 0 ? `Expirou há ${Math.abs(days)}d` : days === 0 ? "Expira hoje" : `${days}d restantes`}
              </span>
            )}
          </div>
        ) : <span className="text-slate-400 text-xs">—</span>}
      </td>
      <td className="px-4 py-3">
        {isSuperadmin ? (
          <span className="text-xs font-bold text-purple-500">∞</span>
        ) : (
          <span className={`text-sm font-bold ${t.credit_balance > 0 ? "text-slate-700 dark:text-white" : "text-slate-400 dark:text-white/30"}`}>
            {t.credit_balance}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 transition-opacity relative">
          
          {/* Botões do WhatsApp */}
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
          
          {/* Novo Botão de Alerta */}
          <ActionBtn title="Novo alerta" tone="purple" onClick={onNewAlert}><IconBell /></ActionBtn>

          {!isSuperadmin && canManage && (
            <>
              <ActionBtn title="Renovar licença" tone="green" onClick={onRenew}><IconRefresh /></ActionBtn>
              <ActionBtn title="Enviar créditos" tone="blue" onClick={onCredits}><IconCoins /></ActionBtn>
              <ActionBtn title="Histórico" tone="slate" onClick={onHistory}><IconClock /></ActionBtn>
              {t.license_status !== "ARCHIVED" && (
                <ActionBtn title="Arquivar" tone="red" onClick={onArchive}><IconTrash /></ActionBtn>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ============================================================
// MODAL: NOVO TENANT / EDITAR PERFIL
// (com validação de telefone igual ao ResellerFormModal)
// ============================================================
function TenantFormModal({ mode, tenant, myRole, onClose, onSuccess, onError }: {
  mode: "new" | "edit";
  tenant?: SaasTenant;
  myRole: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Conta
  const [name, setName] = useState(tenant?.name ?? "");
  const [email, setEmail] = useState(tenant?.contact_email ?? tenant?.auth_email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"MASTER" | "USER">("MASTER");
  const [trialDays, setTrialDays] = useState(7);
  const [creditsInitial, setCreditsInitial] = useState(0);

  // Contato
  const [responsibleName, setResponsibleName] = useState(tenant?.responsible_name ?? "");
  const [notes, setNotes] = useState(tenant?.notes ?? "");

  // Telefone (igual ao ResellerFormModal)
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [phoneE164, setPhoneE164] = useState(tenant?.phone_e164 ?? "");
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);

  // WhatsApp username
  const [waUsername, setWaUsername] = useState(tenant?.whatsapp_username ?? "");
  type WaValidation = { loading: boolean; exists: boolean; jid?: string } | null;
  const [waValidation, setWaValidation] = useState<WaValidation>(null);
  const waTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pré-preenche telefone no modo edit
  useEffect(() => {
    if (tenant?.phone_e164) {
      const info = splitE164(tenant.phone_e164);
      setPhoneDisplay(formatLocalNumber(info.localNumber));
      setPhoneE164(tenant.phone_e164);
      setPhoneConfirmed(true);
    }
  }, [tenant?.phone_e164]);

  async function validateWa(username: string) {
    const digits = username.replace(/\D/g, "");
    if (digits.length < 8) { setWaValidation(null); return; }
    setWaValidation({ loading: true, exists: false });
    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));
      setWaValidation({ loading: false, exists: !!json.exists, jid: json.jid });
      if (json.exists && json.jid) {
        const jidDigits = String(json.jid).split("@")[0].replace(/\D/g, "");
        if (jidDigits) {
          const inferred = applyPhoneNormalization(jidDigits);
          setPhoneE164(inferred.e164);
          setPhoneDisplay(inferred.formattedNational);
          setPhoneConfirmed(true);
        }
      }
    } catch {
      setWaValidation({ loading: false, exists: false });
    }
  }

  function handlePhoneValidate() {
    const rawDigits = phoneDisplay.replace(/\D+/g, "");
    if (rawDigits.length < 8) { setPhoneConfirmed(false); return; }
    const inferred = applyPhoneNormalization(rawDigits);
    setPhoneE164(inferred.e164);
    setPhoneDisplay(inferred.formattedNational || inferred.nationalDigits || phoneDisplay);
    setPhoneConfirmed(true);
    // Auto-preenche username com os dígitos do telefone se estiver vazio
    const finalUser = waUsername.trim() || inferred.e164.replace(/\D+/g, "");
    if (!waUsername.trim()) setWaUsername(finalUser);
    void validateWa(finalUser);
  }

  const phoneCountryInfo = splitE164(phoneE164);

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push("Nome é obrigatório.");
    if (mode === "new" && !email.trim()) out.push("E-mail é obrigatório.");
    if (mode === "new" && password.length < 8) out.push("Senha deve ter pelo menos 8 caracteres.");
    return out;
  }, [name, email, password, mode]);

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    if (errors.length > 0) return;
    setSaving(true);
    try {
      if (mode === "new") {
        const res = await fetch("/api/saas/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            role,
            trial_days: trialDays,
            credits_initial: creditsInitial,
            responsible_name: responsibleName.trim() || name.trim(),
            phone_e164: phoneE164 || null,
            whatsapp_username: waUsername.trim() || null,
            notes: notes.trim() || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.hint || data.error || "Falha ao criar revenda.");
      } else {
        const { error } = await supabaseBrowser.rpc("saas_update_profile", {
          p_tenant_id:         tenant!.id,
          p_responsible_name:  responsibleName.trim() || null,
          p_email:             email.trim() || null,
          p_phone_e164:        phoneE164 || null,
          p_whatsapp_username: waUsername.trim() || null,
          p_notes:             notes.trim() || null,
        });
        if (error) throw new Error(error.message);
      }
      onSuccess();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden">
      <div className="w-full max-w-2xl max-h-[90dvh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 shrink-0">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">
            {mode === "new" ? "Novo Revenda" : `Editar: ${tenant?.name}`}
          </h2>
        </div>

        {/* BODY */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5" style={{ WebkitOverflowScrolling: "touch" }}>

          {submitAttempted && errors.length > 0 && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-medium">
              <ul className="list-disc pl-4 space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          {/* Seção: Conta (somente no novo) */}
          {mode === "new" && (
            <>
              <SectionTitle>Dados da Conta</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <FieldLabel>Nome do Revenda *</FieldLabel>
                  <FieldInput value={name} onChange={e => setName(e.target.value)} placeholder="Ex: João Revendas" autoFocus />
                </div>
                <div>
                  <FieldLabel>E-mail *</FieldLabel>
                  <FieldInput type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="joao@email.com" />
                </div>
                <div>
                  <FieldLabel>Senha *</FieldLabel>
                  <FieldInput type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mín. 8 caracteres" />
                </div>
              </div>
              <div>
                <FieldLabel>Papel (Perfil)</FieldLabel>
                <div className="flex gap-2 mt-1">
                  {(["MASTER", "USER"] as const).map(r => (
                    <button key={r} onClick={() => setRole(r)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-all ${
                        role === r
                          ? r === "MASTER" ? "bg-amber-500 border-amber-500 text-white" : "bg-slate-700 dark:bg-slate-600 border-slate-700 text-white"
                          : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50"
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Teste (dias)</FieldLabel>
                  <FieldInput type="number" min={0} value={trialDays} onChange={e => setTrialDays(Number(e.target.value))} />
                  <p className="text-[10px] text-slate-400 mt-1">0 = sem trial</p>
                </div>
                <div>
                  <FieldLabel>Créditos Iniciais</FieldLabel>
                  <FieldInput type="number" min={0} value={creditsInitial} onChange={e => setCreditsInitial(Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          

          {/* Seção: WhatsApp / Telefone */}
          <SectionTitle>Contato WhatsApp</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Telefone com botão de confirmar (igual ao ResellerFormModal) */}
            <div>
              <FieldLabel>Telefone principal</FieldLabel>
              <div className="flex gap-2">
                <div className="h-10 px-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-[11px] text-slate-500 dark:text-white/40 whitespace-nowrap font-medium min-w-[110px] shrink-0">
                  {phoneE164
                    ? `${phoneCountryInfo.countryName} (+${phoneCountryInfo.countryCode})`
                    : "— país"}
                </div>
                <div className="relative flex-1">
                  <FieldInput
                    value={phoneDisplay}
                    onChange={e => { setPhoneDisplay(e.target.value); setPhoneConfirmed(false); }}
                    placeholder="21 99999-9999"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={handlePhoneValidate}
                    title="Confirmar número"
                    className={`absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded flex items-center justify-center text-base transition-colors ${
                      phoneConfirmed
                        ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                        : "text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
                    }`}
                  >
                    ✓
                  </button>
                </div>
              </div>
              {phoneE164 && phoneConfirmed && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-1">✓ {phoneE164}</p>
              )}
            </div>

            {/* WhatsApp Username */}
            <div>
              <FieldLabel>WhatsApp Username</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">@</span>
                <FieldInput
                  value={waUsername}
                  onChange={e => {
                    const v = e.target.value.replace("@", "");
                    setWaUsername(v);
                    setWaValidation(null);
                    if (waTimerRef.current) clearTimeout(waTimerRef.current);
                    waTimerRef.current = setTimeout(() => void validateWa(v), 800);
                  }}
                  placeholder="usuario"
                  className="pl-7 pr-10"
                />
                {waUsername && (
                  <a
                    href={`https://wa.me/${waUsername.replace(/\D/g, "")}`}
                    target="_blank" rel="noopener noreferrer"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-400 transition-colors"
                    title="Abrir no WhatsApp"
                  >
                    <IconWa />
                  </a>
                )}
              </div>
              {waValidation && (
                <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-bold ${
                  waValidation.loading ? "text-slate-400" : waValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
                }`}>
                  {waValidation.loading ? (
                    <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Validando...</>
                  ) : waValidation.exists ? <>✅ WhatsApp ativo</> : <>❌ Não encontrado</>}
                </div>
              )}
            </div>
          </div>

          {/* Notas */}
          <SectionTitle>Observações</SectionTitle>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-colors"
            placeholder="Notas internas sobre este tenant..."
          />
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 shrink-0 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-sm font-semibold hover:bg-slate-100 dark:hover:bg-white/5 transition">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-6 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition shadow-lg shadow-emerald-900/20 disabled:opacity-50">
            {saving ? "Salvando..." : mode === "new" ? "Criar Revendedor" : "Salvar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: RENOVAR
// ============================================================
function RenewModal({ tenant, myRole, onClose, onSuccess, onError }: {
  tenant: SaasTenant; myRole: string;
  onClose: () => void; onSuccess: () => void; onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(30);
  const creditsNeeded = Math.ceil(days / 30);
  const isSuperadmin = myRole === "SUPERADMIN";

  const handleRenew = async () => {
    setSaving(true);
    const { error } = await supabaseBrowser.rpc("saas_renew_license", {
      p_tenant_id: tenant.id, p_days: days, p_description: `Renovação de ${days} dias`,
    });
    setSaving(false);
    if (error) onError(error.message); else onSuccess();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-between items-center">
          <h3 className="font-bold text-base text-slate-800 dark:text-white">Renovar Licença</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><IconX /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-center">
            <div className="font-bold text-slate-800 dark:text-white">{tenant.name}</div>
            <div className="text-xs text-slate-400 mt-0.5">Validade atual: {tenant.expires_at ? fmtDate(tenant.expires_at) : "sem data"}</div>
          </div>
          <div>
            <FieldLabel>Período</FieldLabel>
            <div className="grid grid-cols-4 gap-2 mt-1 mb-2">
              {[7, 15, 30, 60].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${days === d ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50"}`}>
                  {d}d
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[90, 180, 365].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${days === d ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50"}`}>
                  {d}d
                </button>
              ))}
              <FieldInput type="number" min={1} value={days} onChange={e => setDays(Number(e.target.value))} className="text-center text-xs" />
            </div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg p-3 text-center">
            {isSuperadmin ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-bold text-sm">Renovação gratuita (Superadmin)</span>
            ) : (
              <>
                <div className="text-xs text-slate-400 mb-1">Créditos necessários</div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{creditsNeeded}</div>
                <div className="text-xs text-slate-400">para {days} dias</div>
              </>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
          <button onClick={onClose} className="text-slate-500 dark:text-white/50 font-bold text-xs uppercase">Cancelar</button>
          <button onClick={handleRenew} disabled={saving}
            className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-lg text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50">
            {saving ? "Renovando..." : `Renovar ${days}d`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: CRÉDITOS
// ============================================================
function CreditsModal({ tenant, onClose, onSuccess, onError }: {
  tenant: SaasTenant; onClose: () => void; onSuccess: () => void; onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(10);
  const [description, setDescription] = useState("Recarga de créditos");

  const handleTransfer = async () => {
    if (amount <= 0) { onError("Valor deve ser maior que zero."); return; }
    setSaving(true);
    const { error } = await supabaseBrowser.rpc("saas_transfer_credits", {
      p_to_tenant_id: tenant.id, p_amount: amount, p_description: description,
    });
    setSaving(false);
    if (error) onError(error.message); else onSuccess();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-between items-center">
          <h3 className="font-bold text-base text-slate-800 dark:text-white">Enviar Créditos</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><IconX /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-center">
            <div className="font-bold text-slate-800 dark:text-white">{tenant.name}</div>
            <div className="text-xs text-slate-400 mt-0.5">Saldo atual: <strong>{tenant.credit_balance}</strong></div>
          </div>
          <div>
            <FieldLabel>Quantidade</FieldLabel>
            <div className="grid grid-cols-4 gap-2 mt-1 mb-2">
              {[5, 10, 30, 50].map(v => (
                <button key={v} onClick={() => setAmount(v)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${amount === v ? "bg-sky-500 border-sky-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50"}`}>
                  {v}
                </button>
              ))}
            </div>
            <FieldInput type="number" min={1} value={amount} onChange={e => setAmount(Number(e.target.value))} className="text-center" />
          </div>
          <div>
            <FieldLabel>Descrição</FieldLabel>
            <FieldInput value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-400 mb-1">Saldo após envio</div>
            <div className="text-2xl font-bold text-sky-600 dark:text-sky-400">{tenant.credit_balance + amount}</div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
          <button onClick={onClose} className="text-slate-500 dark:text-white/50 font-bold text-xs uppercase">Cancelar</button>
          <button onClick={handleTransfer} disabled={saving}
            className="px-5 py-2.5 bg-sky-600 text-white font-bold rounded-lg text-xs uppercase hover:bg-sky-500 transition disabled:opacity-50">
            {saving ? "Enviando..." : `Enviar ${amount} créditos`}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
    CREDIT: "text-emerald-600 dark:text-emerald-400",
    DEBIT:  "text-rose-600 dark:text-rose-400",
    GRANT:  "text-purple-600 dark:text-purple-400",
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
                    <td className="px-4 py-3"><span className={`text-xs font-bold uppercase ${typeStyle[tx.type] ?? "text-slate-500"}`}>{tx.type}</span></td>
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