"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import NovoCliente, { ClientData } from "./novo_cliente";
import RecargaCliente from "./recarga_cliente";
import { useConfirm } from "@/app/admin/HookuseConfirm";

import ToastNotifications, { ToastMessage } from "../ToastNotifications";
import Link from "next/link";
import { useSearchParams } from "next/navigation"; // <--- NOVO

// Helper para calcular diferença de dias (Fuso SP)
function getDiffDays(isoDateTarget: string) {
  if (!isoDateTarget || isoDateTarget === "9999-12-31") return 9999;
  
  // Data de hoje em SP (yyyy-mm-dd)
  const today = isoDateInSaoPaulo();
  
  // Convertendo para Date (fixando meio-dia para evitar problemas de fuso na subtração)
  const d1 = new Date(`${today}T12:00:00`);
  const d2 = new Date(`${isoDateTarget}T12:00:00`);
  
  const diffTime = d2.getTime() - d1.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Helper para texto colorido abaixo do status
function getSubStatusInfo(diff: number, status: ClientStatus) {
  if (status === "Arquivado" || status === "Teste") return null;
  if (diff > 2) return null; // Futuro distante não mostra nada

  if (diff < -2) return { text: `Venceu há ${Math.abs(diff)} dias`, color: "text-rose-500" };
  if (diff === -2) return { text: "Venceu há 2 dias", color: "text-rose-500" };
  if (diff === -1) return { text: "Venceu Ontem", color: "text-rose-500" };
  if (diff === 0) return { text: "Vence Hoje", color: "text-amber-500" };
  if (diff === 1) return { text: "Vence Amanhã", color: "text-emerald-500" };
  if (diff === 2) return { text: "Vence em 2 dias", color: "text-emerald-500" };
  
  return null;
}



// --- TIPOS ---
type ClientStatus = "Ativo" | "Vencido" | "Teste" | "Arquivado";

type SortKey =
  | "name"
  | "due"
  | "status"
  | "server"
  | "technology"
  | "screens"
  | "plan"
  | "value"
  | "alerts"
  | "apps"; // ✅ Adicionado
type SortDir = "asc" | "desc";

/**
 * Linha REAL da view vw_clients_list_*
 * Baseado na "Verdade Absoluta" do banco valiada anteriormente.
 */
type VwClientRow = {
  id: string;
  tenant_id: string;

  client_name: string | null;
  username: string | null;
  server_password?: string | null; // CORRIGIDO: Nome real da coluna na View

  vencimento: string | null; // Timestamptz ou Date
  computed_status: "ACTIVE" | "OVERDUE" | "TRIAL" | "ARCHIVED" | string;
  client_is_archived: boolean | null;

  screens: number | null;

  plan_name: string | null;
  price_amount: number | null;
  price_currency: string | null;

  server_id: string | null;
  server_name: string | null;
  
  technology: string | null; // ✅ NOVO CAMPO

  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_extra: string[] | null;
  whatsapp_opt_in: boolean | null;
  dont_message_until: string | null; // whatsapp_snooze_until mapeado na view

  apps_names: string[] | null; // View retorna array de texto
  alerts_open: number | null;

  notes: string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

type ScheduledMsg = {
  id: string;
  client_id: string;
  send_at: string;      // timestamptz
  message: string;
  status?: string | null;
};


// Dados processados para a Tabela
type ClientRow = {
  id: string;
  name: string;
  username: string;

  // Datas
  dueISODate: string;
  dueLabelDate: string;
  dueTime: string;

  // Plano e Valor
  planPeriod: string;
  rawPlanName: string;
  valueCents: number;
  valueLabel: string;

  status: ClientStatus;
  server: string;
  technology: string; // ✅ NOVO CAMPO
  screens: number;

  archived: boolean;
  alertsCount: number;
  apps: string[]; // ✅ Novo campo para a lista de apps

  // --- DADOS PARA O MODAL DE EDIÇÃO ---
  server_id: string;
  technology_edit: string; // ✅ Para passar pro modal
  whatsapp: string;
  whatsapp_username?: string;
  server_password?: string; // CORRIGIDO
  price_amount?: number;
  whatsapp_extra?: string[];
  expires_at?: string; // Data YYYY-MM-DD para o input
  rawVencimento?: string | null; // ✅ NOVO: Timestamp original completo
  whatsapp_opt_in?: boolean;
  notes?: string;
  price_currency?: string;
  dont_message_until?: string;
};

// --- HELPERS ---



function isoDateInSaoPaulo(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // YYYY-MM-DD
}

function addDaysIsoInSaoPaulo(iso: string, days: number) {
  // usa meio-dia -03:00 pra evitar “virada” por timezone
  const base = new Date(`${iso}T12:00:00-03:00`);
  base.setDate(base.getDate() + days);
  return isoDateInSaoPaulo(base);
}

function saoPauloDateTimeToIso(local: string): string {
  // local vem como: YYYY-MM-DDTHH:mm
  if (!local) throw new Error("Data/hora inválida.");

  // ✅ NÃO fixa -03:00 (evita bug se SP mudar offset no futuro)
  // Em vez disso, manda SEM timezone e deixa o BACK interpretar como SP.
  //
  // O back já tem normalizeSendAtToUtcISOString() que:
  // - se vier com TZ => usa
  // - se vier sem TZ => interpreta como São Paulo e converte pra UTC
  //
  // Então aqui devolvemos apenas o "local" padronizado com segundos.
  const normalized = `${local}:00`; // "YYYY-MM-DDTHH:mm:00"
  return normalized;
}




function compareText(a: string, b: string) {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}
function compareNumber(a: number, b: number) {
  return a - b;
}
function statusRank(s: ClientStatus) {
  if (s === "Vencido") return 4;
  if (s === "Teste") return 3;
  if (s === "Arquivado") return 2;
  return 1; // Ativo
}


function extractPeriod(planName: string) {
  const p = (planName || "").trim();
  if (!p || p === "—") return "—";
  if (p.toLowerCase().includes("personalizado")) return "Mensal";
  if (p.includes("-")) {
    const parts = p.split("-");
    return parts[parts.length - 1].trim();
  }
  return p;
}

function mapStatus(computed: string): ClientStatus {
  const statusMap: Record<string, ClientStatus> = {
    ACTIVE: "Ativo",
    OVERDUE: "Vencido",
    TRIAL: "Teste",
    ARCHIVED: "Arquivado",
  };
  return statusMap[computed] || "Ativo";
}

function formatDue(rawDue: string | null) {
  if (!rawDue) {
    return { dueISODate: "9999-12-31", dueLabelDate: "—", dueTime: "—" };
  }
  // A view retorna timestamptz, cortamos para pegar a data YYYY-MM-DD
const dt = new Date(rawDue);
const isoDate = isoDateInSaoPaulo(dt);

  
  if (Number.isNaN(dt.getTime())) {
    return { dueISODate: "9999-12-31", dueLabelDate: "—", dueTime: "—" };
  }
  
  return { 
    dueISODate: isoDate, 
dueLabelDate: dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
dueTime: dt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })

  };
}

function formatMoney(amount: number | null, currency: string | null) {
  if (!amount || amount <= 0) return { value: 0, label: "—" };
  const cur = currency || "BRL";
  return {
    value: amount,
    label: new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(amount),
  };
}



export default function ClientePage() {
  const searchParams = useSearchParams(); // <--- Hook do Next.js
  // --- ESTADOS ---
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [sendingNow, setSendingNow] = useState(false);
  const sendNowAbortRef = useRef<AbortController | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

// --- ADICIONAR ESTE useEffect ---
// Captura o clique vindo do Dashboard
  useEffect(() => {
    const filterParam = searchParams.get("filter");
    if (filterParam) {
      
      // 1. Filtros de STATUS (Ativos ou Vencidos vindo dos Cards)
      if (filterParam === "ativos") {
        setStatusFilter("Ativo");
        setDueFilter("Todos"); // Garante limpar filtro de data
        return;
      }
      if (filterParam === "vencidos") {
        setStatusFilter("Vencido");
        setDueFilter("Todos"); // Garante limpar filtro de data
        return;
      }

      // 2. Filtros de DATA (VencimentoCard)
      const map: Record<string, string> = {
        "venceu_ontem": "Venceu Ontem",
        "venceu_2_dias": "Venceu há 2 dias",
        "vence_hoje": "Hoje", // Ajuste para bater com o <option>
        "vence_amanha": "Vence Amanhã",
        "vence_2_dias": "Vence em 2 dias",
        "mes_atual": "Mês Atual",
        // removemos "vencidos" daqui pois agora é status
      };
      if (map[filterParam]) {
        setDueFilter(map[filterParam]);
      }
    }
  }, [searchParams]);

  // Modais
  const [showFormModal, setShowFormModal] = useState(false);
type AppsIndex = {
  byId: Record<string, any>;
  byName: Record<string, any>; // chave normalizada
};

const [appsIndex, setAppsIndex] = useState<AppsIndex>({ byId: {}, byName: {} });

function normAppKey(v: any): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// modal “insano”
type ClientAppModalState = {
  open: boolean;
  clientId: string;
  clientName: string;
  appName: string;
  app: any; // AppData do banco (quando existir)
};

const [appModal, setAppModal] = useState<ClientAppModalState | null>(null);
const [appValues, setAppValues] = useState<Record<string, string>>({});
const [appLoading, setAppLoading] = useState(false);
const [appSaving, setAppSaving] = useState(false); // ✅ ADD (mesmo que você não salve ainda)




  const [clientToEdit, setClientToEdit] = useState<ClientData | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"Todos" | ClientStatus>("Todos");
  const [archivedFilter, setArchivedFilter] = useState<"Todos" | "Não" | "Sim">("Não");
  const [serverFilter, setServerFilter] = useState("Todos");
  const [planFilter, setPlanFilter] = useState("Todos");
  const [dueFilter, setDueFilter] = useState("Todos");

// ✅ Mobile: menu de filtros
const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);


const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isDefaultSort, setIsDefaultSort] = useState(true); // <--- ADICIONAR ISSO

  // Ações
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);
  const [showRenew, setShowRenew] = useState<{ open: boolean; clientId: string | null; clientName?: string }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });

  // ✅ NOVO: Estado para o aviso de alerta antes da renovação
  const [showRenewWarning, setShowRenewWarning] = useState<{ open: boolean; clientId: string | null; clientName: string }>({
    open: false,
    clientId: null,
    clientName: "",
  });

  // ✅ NOVO: Agendamentos por cliente (para badge e modal)
  const [scheduledMap, setScheduledMap] = useState<Record<string, ScheduledMsg[]>>({});
  const [showScheduledModal, setShowScheduledModal] = useState<{ open: boolean; clientId: string | null; clientName?: string }>({
  open: false,
  clientId: null,
  clientName: undefined,
  });

  
  
  const [showNewAlert, setShowNewAlert] = useState<{ open: boolean; clientId: string | null; clientName?: string }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });
  const [newAlertText, setNewAlertText] = useState("");
  const [showAlertList, setShowAlertList] = useState<{ open: boolean; clientId: string | null; clientName?: string }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });
  const [clientAlerts, setClientAlerts] = useState<unknown[]>([]);

  // Mensagem (Mantido conforme original)
  const [showSendNow, setShowSendNow] = useState<{ open: boolean; clientId: string | null }>({ open: false, clientId: null });
  const [messageText, setMessageText] = useState("");

  const [showScheduleMsg, setShowScheduleMsg] = useState<{ open: boolean; clientId: string | null }>({ open: false, clientId: null });
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  const [scheduling, setScheduling] = useState(false);

  // ✅ Templates (mensagens prontas)
  type MessageTemplate = { id: string; name: string; content: string };
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateNowId, setSelectedTemplateNowId] = useState<string>("");       // modal enviar agora
  const [selectedTemplateScheduleId, setSelectedTemplateScheduleId] = useState<string>(""); // modal agendar
  const { confirm, ConfirmUI } = useConfirm();


  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toastTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

function addToast(type: "success" | "error", title: string, message?: string) {
  const id = Date.now();

  setToasts((prev) => [...prev, { id, type, title, message }]);

  // garante 5s exatos e evita timer duplicado
  if (toastTimersRef.current[id]) clearTimeout(toastTimersRef.current[id]);

  toastTimersRef.current[id] = setTimeout(() => {
    removeToast(id);
  }, 5000);
}

function removeToast(id: number) {
  if (toastTimersRef.current[id]) {
    clearTimeout(toastTimersRef.current[id]);
    delete toastTimersRef.current[id];
  }
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

useEffect(() => {
  return () => {
    // cleanup geral ao desmontar a página
    for (const idStr of Object.keys(toastTimersRef.current)) {
      const id = Number(idStr);
      clearTimeout(toastTimersRef.current[id]);
    }
    toastTimersRef.current = {};
  };
}, []);


  async function getToken() {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session?.access_token) throw new Error("Sem sessão");
    return session.access_token;
  }

  async function loadScheduledForClients(tid: string, clientIds: string[]) {
  // ✅ Se não tem clientes visíveis, limpa
  if (!clientIds.length) {
    setScheduledMap({});
    return;
  }

  /**
   * ✅ TROQUE AQUI:
   * - SCHEDULE_TABLE: nome real da tabela (achado no SQL)
   * - colunas: ajuste conforme o schema real
   */
    const { data, error } = await supabaseBrowser
    .from("client_message_jobs")
    .select("id, client_id, send_at, message, status")
    .eq("tenant_id", tid)
    .in("client_id", clientIds)
    .in("status", ["SCHEDULED", "QUEUED"]) // só pendentes
    .order("send_at", { ascending: true })
    .gte("send_at", new Date().toISOString());



  if (error) {
    console.error("Erro ao carregar agendamentos:", error);
    setScheduledMap({});
    return;
  }

  const map: Record<string, ScheduledMsg[]> = {};
  for (const row of (data as any[]) || []) {
    const cid = String(row.client_id);
    if (!map[cid]) map[cid] = [];
    map[cid].push({
      id: String(row.id),
      client_id: cid,
      send_at: String(row.send_at),
      message: String(row.message ?? ""),
      status: row.status ?? null,
    });
  }

  setScheduledMap(map);
}


  async function loadMessageTemplates(tid: string) {
    // ✅ Ajuste APENAS se sua tabela tiver outro nome/colunas
    const { data, error } = await supabaseBrowser
      .from("message_templates")
      .select("id,name,content")
      .eq("tenant_id", tid)
      .order("name", { ascending: true });

    if (error) {
      console.error("Erro ao carregar templates:", error);
      setMessageTemplates([]);
      return;
    }

    const mapped = ((data as any[]) || []).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "Sem nome"),
      content: String(r.content ?? ""),
    })) as MessageTemplate[];

    setMessageTemplates(mapped);
  }


  // --- CARREGAMENTO ---
async function loadData() {
  if (loadingRef.current) return;

  loadingRef.current = true;
  setLoading(true);

  try {
    const tid = await getCurrentTenantId();
    setTenantId(tid);

    if (tid) {
      await loadMessageTemplates(tid);
    }

    const { data: appsData } = await supabaseBrowser
  .from("apps")
  .select("id,name,info_url,fields_config,is_active,partner_server_id,cost_type") // ✅ só o que usa aqui
  .eq("tenant_id", tid);

if (appsData) {
  const byId: Record<string, any> = {};
  const byName: Record<string, any> = {};

  for (const a of appsData as any[]) {
    if (a?.id) byId[String(a.id)] = a;
    byName[normAppKey(a?.name)] = a;
  }

  setAppsIndex({ byId, byName });
} else {
  setAppsIndex({ byId: {}, byName: {} });
}

    if (!tid) {
      setRows([]);
      return;
    }

    const viewName = archivedFilter === "Sim" ? "vw_clients_list_archived" : "vw_clients_list_active";

    const { data, error } = await supabaseBrowser
      .from(viewName)
      .select("*")
      .eq("tenant_id", tid)
      .neq("computed_status", "TRIAL")
      .order("vencimento", { ascending: true });

    if (error) {
      console.error(error);
      addToast("error", "Erro ao carregar clientes", error.message);
      setRows([]);
      return;
    }

    const typed = (data || []) as VwClientRow[];

    const mapped: ClientRow[] = typed.map((r) => {
      const due = formatDue(r.vencimento);
      const money = formatMoney(r.price_amount, r.price_currency);

      return {
        id: String(r.id),
        name: String(r.client_name ?? "Sem Nome"),
        username: String(r.username ?? "—"),

        dueISODate: due.dueISODate,
        dueLabelDate: due.dueLabelDate,
        dueTime: due.dueTime,

        planPeriod: extractPeriod(String(r.plan_name ?? "—")),
        rawPlanName: String(r.plan_name ?? "—"),

        valueCents: Math.round(money.value * 100),
        valueLabel: money.label,

        status: mapStatus(String(r.computed_status)),
        server: String(r.server_name ?? r.server_id ?? "—"),
        technology: String(r.technology || "—"),
        screens: Number(r.screens || 1),

        archived: Boolean(r.client_is_archived),
        alertsCount: Number(r.alerts_open || 0),
        apps: r.apps_names || [],

        server_id: String(r.server_id ?? ""),
        technology_edit: String(r.technology || "IPTV"),
        whatsapp: String(r.whatsapp_e164 ?? ""),
        whatsapp_username: r.whatsapp_username ?? undefined,
        server_password: r.server_password ?? undefined,
        price_amount: r.price_amount ?? undefined,
        whatsapp_extra: r.whatsapp_extra ?? undefined,

        expires_at: r.vencimento ? r.vencimento.split("T")[0] : undefined,
        rawVencimento: r.vencimento,

        whatsapp_opt_in: typeof r.whatsapp_opt_in === "boolean" ? r.whatsapp_opt_in : undefined,
        price_currency: r.price_currency ?? undefined,
        dont_message_until: r.dont_message_until ?? undefined,
        notes: r.notes ?? "",
      };
    });

    setRows(mapped);

    await loadScheduledForClients(tid, mapped.map((m) => m.id));
  } finally {
    loadingRef.current = false;
    setLoading(false);
  }
}

function normalizeValue(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function copyToClipboard(value?: string | null) {
  const v = String(value ?? "").trim();
  if (!v) return;

  try {
    navigator.clipboard.writeText(v);
    addToast("success", "Copiado", "Valor copiado para a área de transferência.");
  } catch (e) {
    console.error(e);
    addToast("error", "Falha ao copiar", "Não foi possível copiar este valor.");
  }
}


/**
 * Estratégia:
 * - field_values no banco deve usar o field.id como chave.
 * - MAS: se no passado você salvou usando label, fazemos fallback.
 */
function readFieldValue(fieldValues: Record<string, any> | null | undefined, field: any): string {
  const fv = fieldValues || {};
  const byId = fv[field.id];
  if (byId !== undefined) return normalizeValue(byId);

  const byLabel = fv[field.label];
  if (byLabel !== undefined) return normalizeValue(byLabel);

  return "";
}

function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function openAppConfigModal(clientId: string, clientName: string, appNameOrId: string) {
  if (!tenantId) return;

  const key = String(appNameOrId ?? "").trim();

  // ✅ tenta resolver por ID (caso a view venha com id ou você mude no futuro)
  const byId = isUuidLike(key) ? appsIndex.byId[key] : null;

  // ✅ resolve por nome normalizado (caso comum hoje)
  const byName = appsIndex.byName[normAppKey(key)];

  const app = byId || byName || { name: key || "App", fields_config: [], info_url: null, id: null };

  setAppModal({
    open: true,
    clientId,
    clientName,
    appName: String(app?.name ?? key),
    app,
  });

  setAppValues({});
  setAppLoading(true);

  try {
    // ✅ se não tem app_id real, não dá pra buscar values
    if (!app?.id) {
      setAppValues({});
      return;
    }

    const { data, error } = await supabaseBrowser
      .from("client_apps")
      .select("field_values")
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .eq("app_id", String(app.id))
      .maybeSingle();

    if (error) throw error;

    const fieldValues = (data as any)?.field_values || {};

    const next: Record<string, string> = {};
    const fields = Array.isArray(app.fields_config) ? app.fields_config : [];

    for (const f of fields) {
      next[String(f.id)] = readFieldValue(fieldValues, f);
    }

    setAppValues(next);
  } catch (e: any) {
    console.error(e);
    addToast("error", "Erro ao carregar app", e?.message || "Erro desconhecido");
  } finally {
    setAppLoading(false);
  }
}



  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedFilter]);

  useEffect(() => {
  if (loading) return;

  try {
    const key = "clients_list_toasts";
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return;

    const arr = JSON.parse(raw) as { type: "success" | "error"; title: string; message?: string }[];
    window.sessionStorage.removeItem(key);

    // ✅ dispara todos os toasts pendentes
    for (const t of arr) {
      addToast(t.type, t.title, t.message);
    }
  } catch {
    // ignora
  }
}, [loading]); // quando terminar o loadData (loading=false), mostra o toast


  // --- FILTROS ---
  const uniqueServers = useMemo(() => Array.from(new Set(rows.map((r) => r.server).filter((s) => s !== "—"))).sort(), [rows]);
  const uniqueplano = useMemo(() => Array.from(new Set(rows.map((r) => r.planPeriod).filter((p) => p !== "—"))).sort(), [rows]);

  const filtered = useMemo(() => {
  const q = search.trim().toLowerCase();

  const today = isoDateInSaoPaulo();
  const end3 = addDaysIsoInSaoPaulo(today, 3);

  return rows.filter((r) => {
    if (statusFilter !== "Todos" && r.status !== statusFilter) return false;
    if (serverFilter !== "Todos" && r.server !== serverFilter) return false;
    if (planFilter !== "Todos" && r.planPeriod !== planFilter) return false;

    if (dueFilter !== "Todos") {
        const diff = getDiffDays(r.dueISODate);

        switch(dueFilter) {
          case "Venceu há 2 dias": if (diff !== -2) return false; break;
          case "Venceu Ontem": if (diff !== -1) return false; break;
          case "Hoje": if (diff !== 0) return false; break;
          case "Vence Amanhã": if (diff !== 1) return false; break;
          case "Vence em 2 dias": if (diff !== 2) return false; break;
          
            
          case "Mês Atual":
            // Compara se o prefixo YYYY-MM é igual
            const currentMonth = isoDateInSaoPaulo().slice(0, 7);
            if (!r.dueISODate.startsWith(currentMonth)) return false;
            break;
          
        }
      }

    if (q) {
      const hay = [r.name, r.username, r.server, r.planPeriod, r.valueLabel, r.status]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}, [rows, search, statusFilter, serverFilter, planFilter, dueFilter]);


  useEffect(() => {
  setPage(1);
}, [search, statusFilter, serverFilter, planFilter, dueFilter, archivedFilter]);


  // --- ORDENAÇÃO ---
const sorted = useMemo(() => {
  const list = [...filtered];

  // 🧠 ORDENAÇÃO
  // Regra Padrão (só na entrada): Prioriza quem vence de -2 dias em diante
  if (isDefaultSort && sortKey === "due" && sortDir === "asc") {
    list.sort((a, b) => {
      const diffA = getDiffDays(a.dueISODate);
      const diffB = getDiffDays(b.dueISODate);

      // Regra: Lista principal = >= -2 dias
      const isMainListA = diffA >= -2;
      const isMainListB = diffB >= -2;

      if (isMainListA && !isMainListB) return -1;
      if (!isMainListA && isMainListB) return 1;

      // Desempate por data
      if (a.dueISODate !== b.dueISODate) {
        return a.dueISODate.localeCompare(b.dueISODate);
      }
      return a.dueTime.localeCompare(b.dueTime);
    });
    return list;
  }

  // 🔁 ORDENAÇÃO MANUAL (Pura)
  // Se o usuário clicou, cai aqui direto e ordena data por data sem agrupar
  list.sort((a, b) => {
    let cmp = 0;

    switch (sortKey) {
      case "name":
        cmp = compareText(a.name, b.name);
        break;
      case "due":
        cmp = compareText(`${a.dueISODate} ${a.dueTime}`, `${b.dueISODate} ${b.dueTime}`);
        break;
      case "status":
        cmp = compareNumber(statusRank(a.status), statusRank(b.status));
        break;
      case "server":
        cmp = compareText(a.server, b.server);
        break;
      case "technology": // ✅ Adicionado
        cmp = compareText(a.technology, b.technology);
        break;
      case "screens":
        cmp = compareNumber(a.screens, b.screens);
        break;
      case "plan":
        cmp = compareText(a.planPeriod, b.planPeriod);
        break;
      case "value":
        cmp = compareNumber(a.valueCents, b.valueCents);
        break;
      case "alerts":
        cmp = compareNumber(a.alertsCount, b.alertsCount);
        break;
      case "apps": // ✅ Ordena alfabeticamente pelos nomes dos apps
        const appsA = (a.apps || []).join(", ");
        const appsB = (b.apps || []).join(", ");
        cmp = compareText(appsA, appsB);
        break;
    }

    if (cmp === 0) {
      cmp = compareText(`${a.dueISODate} ${a.dueTime}`, `${b.dueISODate} ${b.dueTime}`);
    }

    return sortDir === "asc" ? cmp : -cmp;
  });

  return list;
}, [filtered, sortKey, sortDir]);


  const totalPages = useMemo(() => {
  const n = Math.ceil(sorted.length / pageSize);
  return Math.max(1, n);
}, [sorted.length, pageSize]);

const safePage = useMemo(() => {
  return Math.min(Math.max(1, page), totalPages);
}, [page, totalPages]);

useEffect(() => {
  if (page !== safePage) setPage(safePage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [safePage]);

const visible = useMemo(() => {
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return sorted.slice(start, end);
}, [sorted, safePage, pageSize]);


  useEffect(() => {
  const el = selectAllRef.current;
  if (!el) return;

  const total = visible.length;
  const sel = visible.filter((r) => selectedIds.has(r.id)).length;

  el.indeterminate = sel > 0 && sel < total;
}, [selectedIds, visible]);

function toggleSelected(id: string, checked: boolean) {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });
}

function setAllVisible(checked: boolean) {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    for (const r of visible) {
      if (checked) next.add(r.id);
      else next.delete(r.id);
    }
    return next;
  });
}



function toggleSort(nextKey: SortKey) {
    setIsDefaultSort(false); // ✅ Usuário clicou, desliga a regra automática
    if (sortKey === nextKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(nextKey);
      setSortDir("asc");
    }
  }

  // --- ACTIONS HANDLERS ---

// ✅ controle de qual aba abrir no modal global (NovoCliente)
type EditTab = "dados" | "pagamento" | "apps";

const [editInitialTab, setEditInitialTab] = useState<EditTab>("dados");

// ✅ abre o modal de edição pelo id (útil pro popup de apps)
function openEditById(clientId: string, initialTab: EditTab = "dados") {
  const r = rows.find((x) => x.id === clientId);
  if (!r) {
    addToast("error", "Cliente não encontrado", "Não foi possível abrir edição deste cliente.");
    return;
  }

  // ✅ define aba
  setEditInitialTab(initialTab);

  // ✅ reaproveita a abertura normal
  handleOpenEdit(r, initialTab);
}

const handleOpenEdit = (r: ClientRow, initialTab: EditTab = "dados") => {
  // ✅ define qual aba abrir
  setEditInitialTab(initialTab);

  const payload: ClientData = {
    id: r.id,
    client_name: r.name,
    username: r.username,
    server_id: r.server_id,
    screens: r.screens,
    technology: r.technology_edit,

    whatsapp_e164: r.whatsapp,
    whatsapp_username: r.whatsapp_username,
    whatsapp_extra: r.whatsapp_extra,

    whatsapp_opt_in: r.whatsapp_opt_in,
    dont_message_until: r.dont_message_until,

    server_password: r.server_password,

    plan_name: r.rawPlanName,
    price_amount: r.price_amount,
    price_currency: r.price_currency,

    // ✅ Timestamp original completo (UTC) pro modal converter certo
    vencimento: r.rawVencimento || undefined,

    notes: r.notes,
  };

  setClientToEdit(payload);

  // ✅ abre no próximo tick para garantir montagem correta
  setTimeout(() => setShowFormModal(true), 0);
};


  // ✅ ARQUIVAR / RESTAURAR OTIMIZADO
  const handleArchiveToggle = async (r: ClientRow) => {
    if (!tenantId) return;

    const goingToArchive = !r.archived;
const ok = await confirm({
  title: goingToArchive ? "Arquivar cliente" : "Restaurar cliente",
  subtitle: goingToArchive
    ? "O cliente irá para a Lixeira (pode ser restaurado depois)."
    : "O cliente voltará para a lista ativa.",
  tone: goingToArchive ? "amber" : "emerald",
  icon: goingToArchive ? "🗑️" : "↩️",
  details: [
    `Cliente: ${r.name}`,
    goingToArchive ? "Destino: Lixeira" : "Destino: Ativos",
  ],
  confirmText: goingToArchive ? "Arquivar" : "Restaurar",
  cancelText: "Voltar",
});

if (!ok) return;


    try {
      // Simplificado: update_client usa COALESCE, então só passamos o que muda
      const { error } = await supabaseBrowser.rpc("update_client", {
        p_tenant_id: tenantId,
        p_client_id: r.id,
        p_is_archived: goingToArchive,
        // Todos os outros campos são omitidos e o banco mantém o valor atual
      });

      if (error) throw error;

      addToast("success", goingToArchive ? "Cliente arquivado" : "Cliente restaurado");
      loadData();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Erro desconhecido";
      console.error(e);
      addToast("error", "Falha ao atualizar cliente", msg);
    }
  };

    const handleDeleteForever = async (r: ClientRow) => {
    if (!tenantId) return;

    if (!r.archived) {
      addToast("error", "Ação bloqueada", "Só é possível excluir definitivamente pela Lixeira.");
      return;
    }

const ok = await confirm({
  title: "Excluir definitivamente",
  subtitle: "Essa ação NÃO pode ser desfeita.",
  tone: "rose",
  icon: "⚠️",
  details: [
    `Cliente: ${r.name}`,
    "Ação: excluir para sempre",
  ],
  confirmText: "Excluir",
  cancelText: "Voltar",
});

if (!ok) return;


    try {
      const { error } = await supabaseBrowser.rpc("delete_client_forever", {
        p_tenant_id: tenantId,
        p_client_id: r.id,
      });

      if (error) throw error;

      addToast("success", "Excluído", "Cliente removido definitivamente.");
      loadData();
    } catch (e: any) {
      console.error(e);
      addToast("error", "Falha ao excluir", e?.message || "Erro desconhecido");
    }
  };


  // ... (Funções de Alerta e Mensagem mantidas iguais pois são APIs externas por enquanto) ...
  const handleSaveAlert = async () => {
    if (!newAlertText.trim() || !showNewAlert.clientId || !tenantId) return;
    
    try {
      const { error } = await supabaseBrowser
        .from("client_alerts") // ⚠️ Confirme o nome da tabela
        .insert({
          tenant_id: tenantId,
          client_id: showNewAlert.clientId,
          message: newAlertText,
          status: "OPEN", // Define como aberto
          // created_by: userId (Se tiver esse campo e quiser salvar quem criou)
        });

      if (error) throw error;

      addToast("success", "Alerta criado", "O alerta foi salvo com sucesso.");
      
      // Fecha modal e limpa
      setShowNewAlert({ open: false, clientId: null });
      setNewAlertText("");
      
      // Recarrega a lista principal para atualizar o contador
      loadData(); 
    } catch (error: any) {
      console.error("Erro ao salvar alerta:", error);
      addToast("error", "Erro ao criar alerta", error.message);
    }
  };

  const handleDeleteAlert = async (alertId: string) => {
    if (!tenantId) return;
      const alertObj = (clientAlerts as any[]).find((a) => String(a.id) === String(alertId));

  const ok = await confirm({
    title: "Remover alerta",
    subtitle: "Este alerta será removido e não poderá ser recuperado.",
    tone: "rose",
    icon: "⚠️",
    details: [
      `Cliente: ${showAlertList.clientName ?? "—"}`,
      alertObj?.message ? `Alerta: ${String(alertObj.message).slice(0, 140)}${String(alertObj.message).length > 140 ? "..." : ""}` : "Alerta: —",
    ],
    confirmText: "Remover",
    cancelText: "Voltar",
  });

  if (!ok) return;

    
    // Pergunta: Você quer deletar ou apenas marcar como resolvido?
    // Opção A: Deletar permanentemente
    try {
      const { error } = await supabaseBrowser
        .from("client_alerts")
        .delete()
        .eq("id", alertId);

      if (error) throw error;

      // Remove da lista visualmente na hora (sem precisar recarregar tudo)
      setClientAlerts((prev) => (prev as any[]).filter((a) => a.id !== alertId));
      
      // Atualiza a contagem na tabela principal
      loadData();
      
    } catch (error: any) {
      console.error("Erro ao excluir alerta:", error);
      addToast("error", "Erro ao excluir", error.message);
    }
  };

const handleOpenAlertList = async (clientId: string, clientName: string) => {
    // Limpa lista anterior e abre modal
    setClientAlerts([]); 
    setShowAlertList({ open: true, clientId, clientName });

    try {
      if (!tenantId) return;

      // Busca direta no banco
      const { data, error } = await supabaseBrowser
        .from("client_alerts") // ⚠️ Confirme se o nome é esse mesmo
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("client_id", clientId)
        // Se quiser ver histórico, remova a linha abaixo
        .eq("status", "OPEN") 
        .order("created_at", { ascending: false });

      if (error) throw error;

      setClientAlerts(data || []);
    } catch (error: any) {
      console.error("Erro ao buscar alertas:", error);
      addToast("error", "Erro ao carregar alertas", error.message);
    }
  };

  const handleSendMessage = async () => {
  if (!tenantId || !showSendNow.clientId) return;
  if (sendingNow) return; // ✅ trava double click

  const msg = (messageText || "").trim();
  if (!msg) {
    addToast("error", "Mensagem vazia", "Digite uma mensagem antes de enviar.");
    return;
  }

  try {
  setSendingNow(true);

  // ✅ aborta tentativa anterior (se existiu)
  if (sendNowAbortRef.current) {
    try { sendNowAbortRef.current.abort(); } catch {}
  }

  const controller = new AbortController();
  sendNowAbortRef.current = controller;

  const token = await getToken();

const res = await fetch("/api/whatsapp/envio_agora", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  cache: "no-store",
  signal: controller.signal,
  body: JSON.stringify({
    tenant_id: tenantId,
    client_id: showSendNow.clientId,
    message: msg,
    whatsapp_session: "default", // pode manter, o back ignora
  }),
});


    const raw = await res.text();
    let json: any = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch {}

    if (!res.ok) throw new Error(json?.error || raw || "Falha ao enviar");

    addToast("success", "Enviado", "Mensagem enviada imediatamente via WhatsApp.");

    setShowSendNow({ open: false, clientId: null });
    setMessageText("");
  } catch (e: any) {
    // Abort é ok silencioso
    if (e?.name !== "AbortError") {
      console.error("Erro ao enviar mensagem:", e);
      addToast("error", "Erro ao enviar mensagem", e?.message || "Falha desconhecida");
    }
} finally {
  setSendingNow(false);
  // ✅ limpa ref (opcional mas bom)
  sendNowAbortRef.current = null;
}

};


  const handleScheduleMessage = async () => {
  if (!tenantId || !showScheduleMsg.clientId) return;
  if (scheduling) return; // ✅ trava double click

  const msg = (scheduleText || "").trim();
  if (!msg) {
    addToast("error", "Mensagem vazia", "Digite uma mensagem antes de agendar.");
    return;
  }

  if (!scheduleDate) {
    addToast("error", "Data obrigatória", "Selecione data e hora do envio.");
    return;
  }

    try {
    setScheduling(true);

    // ✅ SEMPRE interpretar o input como São Paulo e converter para UTC (timestamptz)
    const sendAtIso = saoPauloDateTimeToIso(scheduleDate);

// ✅ impedir agendar no passado (comparação numérica, robusta)
// - se sendAtIso vier sem TZ (ex: "YYYY-MM-DDTHH:mm:00"),
//   o Date() vai interpretar no timezone do browser.
//   Então, para esta validação local, a gente converte usando -03:00
//   APENAS para checar "futuro" no client (sem afetar o payload pro back).
const check = new Date(`${scheduleDate}:00-03:00`).getTime();
const now = Date.now();

if (!Number.isFinite(check) || check <= now) {
  addToast("error", "Data inválida", "Escolha uma data/hora no futuro.");
  return;
}


    const token = await getToken();


const res = await fetch("/api/whatsapp/envio_programado", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  cache: "no-store",
  body: JSON.stringify({
    tenant_id: tenantId,
    client_id: showScheduleMsg.clientId,
    message: msg,
    send_at: sendAtIso,
    whatsapp_session: "default",
  }),
});


    const raw = await res.text();
    let json: any = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch {}

    if (!res.ok) throw new Error(json?.error || raw || "Falha ao agendar");

    addToast("success", "Agendado", "Mensagem programada com sucesso.");

    setShowScheduleMsg({ open: false, clientId: null });
    setScheduleText("");
    setScheduleDate("");

    await loadScheduledForClients(tenantId, rows.map((x) => x.id));
  } catch (e: any) {
    console.error("Erro ao agendar:", e);
    addToast("error", "Erro ao agendar", e?.message || "Falha desconhecida");
  } finally {
    setScheduling(false);
  }
};





  function closeAllPopups() {
    setMsgMenuForId(null);
  }

  // ✅ Lógica de Interceptação da Renovação
  const handleClickRenew = (r: ClientRow) => {
  // Fecha menus se estiverem abertos
  setMsgMenuForId(null);

  if (r.alertsCount > 0) {
    // Tem alerta? Abre o aviso primeiro
    setShowRenewWarning({ open: true, clientId: r.id, clientName: r.name });
  } else {
    // Sem alerta? Abre renovação direto (comportamento original)
    setShowRenew({ open: true, clientId: r.id, clientName: r.name });
  }
};


  
  return (
<div
  className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors"

  onClick={() => closeAllPopups()}
>


      {/* Topo */}
<div className="flex items-center justify-between gap-2 pb-0 mb-2">

  {/* Título (esquerda) */}
  <div className="min-w-0 text-left">
    <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
      Gestão de Clientes 
    </h1>
  </div>

  {/* Ações (direita) */}
  <div className="flex items-center gap-2 justify-end shrink-0">

    {/* ✅ no mobile, o botão de lixeira sai daqui (vai pro filtro) */}
    <button
      onClick={(e) => {
        e.stopPropagation();
        setArchivedFilter(archivedFilter === "Não" ? "Sim" : "Não");
      }}
      className={`hidden md:inline-flex h-10 px-3 rounded-lg text-xs font-bold border transition-colors items-center justify-center ${
        archivedFilter === "Sim"
          ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
          : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60"
      }`}
    >
      {archivedFilter === "Sim" ? "Ocultar Lixeira" : "Ver Lixeira"}
    </button>

<button
  onClick={(e) => {
    e.stopPropagation();
    setClientToEdit(null);
    setEditInitialTab("dados"); // ✅ add
    setShowFormModal(true);
  }}
  className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
>
  <span>+</span> Novo Cliente
</button>


  </div>
</div>



      {/* --- BARRA DE FILTROS COMPLETA --- */}
<div
  className="p-0 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20"
  onClick={(e) => e.stopPropagation()}
>


        <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider mb-2">
  Filtros Rápidos
</div>


        {/* ✅ MOBILE (somente): pesquisa + botão abrir painel */}
<div className="md:hidden flex items-center gap-2">
  <div className="flex-1 relative">
    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Pesquisar..."
      className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
    />
    {search && (
      <button
        onClick={() => setSearch("")}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"
      >
        <IconX />
      </button>
    )}
  </div>

<button
  onClick={() => setMobileFiltersOpen((v) => !v)}
  className={`h-10 px-3 rounded-lg border font-bold text-sm transition-colors ${
    (statusFilter !== "Todos" ||
      serverFilter !== "Todos" ||
      planFilter !== "Todos" ||
      dueFilter !== "Todos" ||
      archivedFilter === "Sim")
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10"
  }`}
  title="Filtros"
>
  Filtros
</button>

</div>

{/* ✅ DESKTOP (somente): tudo na mesma linha */}
<div className="hidden md:flex items-center gap-2">
  <div className="flex-1 relative">
    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Pesquisar..."
      className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
    />
    {search && (
      <button
        onClick={() => setSearch("")}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"
      >
        <IconX />
      </button>
    )}
  </div>

  <div className="w-[190px]">
    <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "Todos" | ClientStatus)}>
      <option value="Todos">Status (Todos)</option>
      <option value="Ativo">Ativo</option>
      <option value="Vencido">Vencido</option>
    </Select>
  </div>

  <div className="w-[220px]">
    <Select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
      <option value="Todos">Servidor (Todos)</option>
      {uniqueServers.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </Select>
  </div>

  <div className="w-[190px]">
    <Select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
      <option value="Todos">Plano (Todos)</option>
      {uniqueplano.map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </Select>
  </div>

<div className="w-[210px]">
    <Select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)}>
      <option value="Todos">Vencimento (Todos)</option>
      <option value="Venceu há 2 dias">Venceu há 2 dias</option>
      <option value="Venceu Ontem">Venceu Ontem</option>
      <option value="Hoje">Hoje</option>
      <option value="Vence Amanhã">Vence Amanhã</option>
      <option value="Vence em 2 dias">Vence em 2 dias</option>
      <option value="Mês Atual">Mês Atual</option>
    </Select>
  </div>

  <button
    onClick={() => {
      setSearch("");
      setStatusFilter("Todos");
      setServerFilter("Todos");
      setPlanFilter("Todos");
      setDueFilter("Todos");
      setArchivedFilter("Não");
    }}
    className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
  >
    <IconX /> Limpar
  </button>
</div>



{/* ✅ Painel de filtros no mobile */}
{mobileFiltersOpen && (
  <div className="md:hidden mt-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-2">

    {/* ✅ Filtrar Lixeira (opção dentro do painel) */}
    <button
      onClick={(e) => {
        e.stopPropagation();
        setArchivedFilter((cur) => (cur === "Não" ? "Sim" : "Não"));
      }}
      className={`w-full h-10 px-3 rounded-lg text-sm font-bold border transition-colors flex items-center justify-between ${
        archivedFilter === "Sim"
          ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
          : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70"
      }`}
      title="Filtrar Lixeira"
    >
      <span className="flex items-center gap-2">
        <IconTrash />
        Filtrar Lixeira
      </span>
      <span className="text-xs opacity-80">
        {archivedFilter === "Sim" ? "ON" : "OFF"}
      </span>
    </button>

    {/* ✅ Status */}
    <Select
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value as "Todos" | ClientStatus)}
    >
      <option value="Todos">Status (Todos)</option>
      <option value="Ativo">Ativo</option>
      <option value="Vencido">Vencido</option>
    </Select>

    {/* ✅ Servidor */}
    <Select
      value={serverFilter}
      onChange={(e) => setServerFilter(e.target.value)}
    >
      <option value="Todos">Servidor (Todos)</option>
      {uniqueServers.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </Select>

    {/* ✅ Plano */}
    <Select
      value={planFilter}
      onChange={(e) => setPlanFilter(e.target.value)}
    >
      <option value="Todos">Plano (Todos)</option>
      {uniqueplano.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </Select>

    {/* ✅ Vencimento */}
    <Select
      value={dueFilter}
      onChange={(e) => setDueFilter(e.target.value)}
    >
      <option value="Todos">Vencimento (Todos)</option>
      <option value="Venceu há 2 dias">Venceu há 2 dias</option>
      <option value="Venceu Ontem">Venceu Ontem</option>
      <option value="Hoje">Hoje</option>
      <option value="Vence Amanhã">Vence Amanhã</option>
      <option value="Vence em 2 dias">Vence em 2 dias</option>
      <option value="Mês Atual">Mês Atual</option>
    </Select>

    {/* ✅ Limpar */}
    <button
      onClick={() => {
        setSearch("");
        setStatusFilter("Todos");
        setServerFilter("Todos");
        setPlanFilter("Todos");
        setDueFilter("Todos");
        setArchivedFilter("Não");
        setMobileFiltersOpen(false);
      }}
      className="w-full h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
    >
      <IconX /> Limpar
    </button>
  </div>
)}




      </div>

      {loading && (
        <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5">
          Carregando dados...
        </div>
      )}

      {!loading && (
        <div
  className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0"
  onClick={(e) => e.stopPropagation()}
>

          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
  <div className="text-sm font-bold text-slate-700 dark:text-white whitespace-nowrap">
    Lista de Clientes{" "}
    <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">{filtered.length}</span>
  </div>

  <div className="flex items-center justify-end gap-3 text-xs text-slate-500 dark:text-white/50 shrink-0">
    
    {/* --- 📱 VERSÃO MOBILE: Dropdown de Páginas --- */}
    <div className="md:hidden">
      <select
        value={safePage}
        onChange={(e) => setPage(Number(e.target.value))}
        className="h-8 pl-3 pr-8 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg font-bold text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 appearance-none relative z-10"
        style={{
           // Seta customizada via CSS inline para garantir visual limpo
           backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
           backgroundPosition: `right 0.5rem center`,
           backgroundRepeat: `no-repeat`,
           backgroundSize: `1.5em 1.5em`
        }}
      >
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => (
          <option key={pNum} value={pNum}>
            Página {pNum}
          </option>
        ))}
      </select>
    </div>

    {/* --- 💻 VERSÃO DESKTOP: Botões Originais --- */}
    <div className="hidden md:flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span>Mostrar</span>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="bg-transparent border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 outline-none text-slate-700 dark:text-white cursor-pointer hover:border-emerald-500/50 transition-colors"
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={safePage <= 1}
          className="h-8 w-8 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-white/10 transition flex items-center justify-center"
          title="Página anterior"
        >
          ←
        </button>

        <span className="min-w-[90px] text-center whitespace-nowrap">
          Página <span className="font-bold text-slate-700 dark:text-white">{safePage}</span> / {totalPages}
        </span>

        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={safePage >= totalPages}
          className="h-8 w-8 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-white/10 transition flex items-center justify-center"
          title="Próxima página"
        >
          →
        </button>
      </div>
    </div>
  </div>
</div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[250px]">

              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/40">
                  <Th width={40}>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={visible.length > 0 && visible.every((r) => selectedIds.has(r.id))}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setAllVisible(e.target.checked)}
                    className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5"
                  />


                  </Th>
                  <ThSort label="Cliente" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  <ThSort label="Vencimento" active={sortKey === "due"} dir={sortDir} onClick={() => toggleSort("due")} />
                  <Th align="center"><SortClick label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} /></Th>
                  <Th align="center"><SortClick label="Servidor" active={sortKey === "server"} dir={sortDir} onClick={() => toggleSort("server")} /></Th>
                  <Th align="center"><SortClick label="Tecnologia" active={sortKey === "technology"} dir={sortDir} onClick={() => toggleSort("technology")} /></Th>
                  <Th align="center"><SortClick label="Telas" active={sortKey === "screens"} dir={sortDir} onClick={() => toggleSort("screens")} /></Th>
                  <Th align="center"><SortClick label="Plano" active={sortKey === "plan"} dir={sortDir} onClick={() => toggleSort("plan")} /></Th>
                  <Th align="center"><SortClick label="Valor" active={sortKey === "value"} dir={sortDir} onClick={() => toggleSort("value")} /></Th>
                  <Th align="center"><SortClick label="Aplicativos" active={sortKey === "apps"} dir={sortDir} onClick={() => toggleSort("apps")} /></Th>
                  <Th align="right">Ações</Th>  
                </tr>
              </thead>

              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.map((r) => {
                  const isExpired = r.status === "Vencido";
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors group ${
                        selectedIds.has(r.id)
                          ? "bg-emerald-50/70 dark:bg-emerald-500/10"
                          : "hover:bg-slate-50 dark:hover:bg-white/5"
                      }`}
                    >

                                          <Td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggleSelected(r.id, e.target.checked)}
                      className="rounded border-slate-300 dark:border-white/20 bg-slate-100 dark:bg-white/5"
                    />


                      </Td>

                      <Td>
  <div className="flex flex-col max-w-[180px] sm:max-w-none"> {/* Limite opcional no mobile se quiser truncar nomes gigantes */}
    
    {/* Alterado: Adicionado whitespace-nowrap para impedir que ícones quebrem a linha */}
    <div className="flex items-center gap-2 whitespace-nowrap">
      <Link href={`/admin/cliente/${r.id}`} className="font-semibold text-slate-700 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors hover:underline decoration-emerald-500/30 underline-offset-2 cursor-pointer truncate">
        {r.name}
      </Link>
      
      {/* Adicionado shrink-0 para garantir que os ícones nunca sejam esmagados */}
      <div className="flex items-center gap-1 shrink-0">
        {r.alertsCount > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleOpenAlertList(r.id, r.name);
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-600 border border-amber-200 text-[10px] font-bold hover:bg-amber-200 transition-colors animate-pulse"
            title="Ver alertas pendentes"
          >
            🔔 {r.alertsCount}
          </button>
        )}

{(scheduledMap[r.id]?.length || 0) > 0 && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      setShowScheduledModal({ open: true, clientId: r.id, clientName: r.name });
    }}
    // Alterado: Adicionado 'animate-pulse' no final das classes
    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold hover:bg-purple-200 transition-colors animate-pulse"
    title="Ver mensagens programadas"
  >
    🗓️ {scheduledMap[r.id].length}
  </button>
)}
      </div>
    </div>
    
    {/* Alterado: Username agora com font-medium e cor mais forte (slate-500 ao invés de 400) */}
    <span className="text-xs font-medium text-slate-500 dark:text-white/60 truncate">{r.username}</span>
  </div>
</Td>

<Td>
  <div className="flex flex-col">
    {/* ✅ Cor fixa padrão (sem vermelho) */}
    <span className="font-mono font-medium text-slate-600 dark:text-white/80">
      {r.dueLabelDate}
    </span>
    
    <span className="text-xs font-medium text-slate-500 dark:text-white/60">
      {r.dueTime}
    </span>
  </div>
</Td>

<Td align="center">
  {(() => {
    const diff = getDiffDays(r.dueISODate);
    
    // ✅ CORREÇÃO: Força o tipo 'string' para aceitar qualquer texto
    let label: string = r.status; 

    if (r.status !== "Arquivado" && r.status !== "Teste") {
        if (diff === -1) label = "Venceu Ontem";
        else if (diff === -2) label = "Venceu há 2 dias";
        else if (diff < -2) label = `Venceu há ${Math.abs(diff)} dias`;
        else if (diff === 0) label = "Vence Hoje";
        else if (diff === 1) label = "Vence Amanhã";
        else if (diff === 2) label = "Vence em 2 dias";
        else if (diff > 2) label = `Vence em ${Math.abs(diff)} dias`;
    
      }

    // Lógica de Cor
    let colorTone: "green" | "red" | "amber" | "blue" = "blue";
    
    if (r.status === "Vencido") colorTone = "red";
    else if (r.status === "Ativo") {
        if (diff === 0) colorTone = "amber";
        else if (diff > 0) colorTone = "green"; 
        else colorTone = "green";
    } else {
        colorTone = "blue";
    }

    return (
      <StatusBadge 
        status={r.status} 
        customLabel={label} 
        customTone={colorTone} 
      />
    );
  })()}
</Td>

                      <Td>
                        <span className="text-slate-600 dark:text-white/70">{r.server}</span>
                      </Td>

                      <Td>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 uppercase">
                          {r.technology}
                        </span>
                      </Td>

                      <Td>
                        <span className="text-slate-600 dark:text-white/70 pl-2">{r.screens}</span>
                      </Td>

                      <Td>
                        <span className="text-slate-600 dark:text-white/80">{r.planPeriod}</span>
                      </Td>

                      <Td>
                        <span className="font-medium text-slate-700 dark:text-white/90">{r.valueLabel}</span>
                      </Td>

                      <Td>
                        {/* ✅ Lista de Aplicativos */}
                        <div className="flex flex-wrap gap-1 max-w-[180px]">
                          {r.apps && r.apps.length > 0 ? (
                            r.apps.map((app, i) => (
                          <button
                          key={i}
                          onClick={(e) => {
                            e.stopPropagation();
                            openAppConfigModal(r.id, r.name, app);
                          }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10 truncate hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition"
                        >
                          {app}
                        </button>


                            ))
                          ) : (
                            <span className="text-slate-300 dark:text-white/10 text-xs">—</span>
                          )}
                        </div>
                      </Td>

                      <Td align="right">
                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 relative">
                          <div className="relative">
                            <IconActionBtn title="Mensagem" tone="blue" onClick={(e) => { e.stopPropagation(); setMsgMenuForId((cur) => (cur === r.id ? null : r.id)); }}>
                              <IconChat />
                            </IconActionBtn>

                            {msgMenuForId === r.id && (
                              <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f141a] z-50 shadow-2xl overflow-hidden">
                                <MenuItem
                              icon={<IconSend />}
                              label="Enviar agora"
                              onClick={() => {
                                setMsgMenuForId(null);
                                setSelectedTemplateNowId("");
                                setMessageText("");
                                setShowSendNow({ open: true, clientId: r.id });
                              }}
                            />

                            <MenuItem
                              icon={<IconClock />}
                              label="Programar"
                              onClick={() => {
                                setMsgMenuForId(null);
                                setSelectedTemplateScheduleId("");
                                setScheduleText("");
                                setScheduleDate("");
                                setShowScheduleMsg({ open: true, clientId: r.id });
                              }}
                            />

                              </div>
                            )}
                          </div>

                          <IconActionBtn title="Renovar" tone="green" onClick={(e) => { e.stopPropagation(); handleClickRenew(r); }}>
                            <IconMoney />
                          </IconActionBtn>

                          <IconActionBtn title="Editar" tone="amber" onClick={(e) => { e.stopPropagation(); handleOpenEdit(r, "dados"); }}>
                            <IconEdit />
                          </IconActionBtn>


                          <IconActionBtn title="Novo alerta" tone="purple" onClick={(e) => { e.stopPropagation(); setNewAlertText(""); setShowNewAlert({ open: true, clientId: r.id, clientName: r.name }); }}>
                            <IconBell />
                          </IconActionBtn>

                          <IconActionBtn
                            title={r.archived ? "Restaurar" : "Arquivar"}
                            tone={r.archived ? "green" : "red"}
                            onClick={(e) => { e.stopPropagation(); handleArchiveToggle(r); }}
                          >
                            {r.archived ? <IconRestore /> : <IconTrash />}
                          </IconActionBtn>

                          {/* ✅ Excluir definitivo (somente quando estiver VISUALIZANDO a Lixeira) */}
                          {archivedFilter === "Sim" && r.archived && (
                            <IconActionBtn
                              title="Excluir definitivamente"
                              tone="red"
                              onClick={(e) => { e.stopPropagation(); handleDeleteForever(r); }}
                            >
                              <IconTrash />
                            </IconActionBtn>
                          )}



                        </div>
                      </Td>
                    </tr>
                  );
                })}

                {visible.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-8 text-center text-slate-400 dark:text-white/40 italic">
                        Nenhum cliente encontrado.
                      </td>
                    </tr>
                  )}

              </tbody>

            </table>
             {/* ✅ espaço fixo depois do último cliente (para popups/menus não serem cortados) */}
              <div className="h-24 md:h-20" />
          </div>
        </div>
      )}

      {/* --- MODAIS --- */}
      {showFormModal && (
<NovoCliente
  key={clientToEdit?.id ?? "new"}
  clientToEdit={clientToEdit}
  initialTab={editInitialTab} // ✅ agora sim (Passo C)
  onClose={() => setShowFormModal(false)}
  onSuccess={() => {
    setShowFormModal(false);
    loadData();
  }}
/>


      )}

{/* ✅ MODAL DE AVISO DE ALERTA (INTERCEPTADOR) */}
      {showRenewWarning.open && (
        <Modal title="⚠️ Cliente com Alertas" onClose={() => setShowRenewWarning({ open: false, clientId: null, clientName: "" })}>
          <div className="space-y-6">
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 rounded-lg flex gap-3">
                <span className="text-2xl">📢</span>
                <div>
                  <p className="text-slate-700 dark:text-white/90 text-sm font-medium">
                    O cliente <strong className="text-amber-700 dark:text-amber-400">{showRenewWarning.clientName}</strong> possui pendências/alertas em aberto.
                  </p>
                  <p className="text-slate-500 dark:text-white/60 text-xs mt-1">
                    Recomendamos verificar os alertas antes de realizar a renovação para evitar problemas.
                  </p>
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  const { clientId, clientName } = showRenewWarning;
                  setShowRenewWarning({ open: false, clientId: null, clientName: "" });
                  // Abre a lista de alertas para checar
                  if (clientId) handleOpenAlertList(clientId, clientName);
                }}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-xs uppercase"
              >
                Ver Alertas
              </button>

              <button
                onClick={() => {
                  const { clientId, clientName } = showRenewWarning;
                  setShowRenewWarning({ open: false, clientId: null, clientName: "" });
                  // Ignora e abre a renovação
                  setShowRenew({ open: true, clientId, clientName });
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-colors text-xs uppercase shadow-lg shadow-emerald-900/20"
              >
                Ignorar e Renovar
              </button>
            </div>
          </div>
        </Modal>
      )}


      {showRenew.open && showRenew.clientId && (
      <RecargaCliente
  key={showRenew.clientId}  // ✅ força reset interno quando troca cliente
  clientId={showRenew.clientId}
  clientName={showRenew.clientName || "Cliente"}
  onClose={() => setShowRenew({ open: false, clientId: null, clientName: undefined })}
  onSuccess={() => {
  // ✅ 1) fecha o modal primeiro
  setShowRenew({ open: false, clientId: null, clientName: undefined });

  // ✅ 2) só depois recarrega (garante unmount antes de ligar loading)
  setTimeout(async () => {
    await loadData();

    // ✅ toasts após refresh
    setTimeout(() => {
      addToast("success", "Cliente atualizado", "Cadastro atualizado com sucesso.");
      addToast("success", "Cliente renovado", "Renovação registrada com sucesso.");
    }, 150);
  }, 0);
}}

      />
    )}


{showNewAlert.open && (
        <Modal title="Criar Novo Alerta" onClose={() => setShowNewAlert({ open: false, clientId: null })}>
          <div className="space-y-4">
            <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20 p-3 rounded-lg flex items-center gap-3">
               <span className="text-xl">🔔</span>
               <div className="text-sm text-purple-900 dark:text-purple-200">
                 Adicionando alerta para <strong>{showNewAlert.clientName}</strong>
               </div>
            </div>

            <textarea
              value={newAlertText}
              onChange={(e) => setNewAlertText(e.target.value)}
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-4 text-slate-800 dark:text-white outline-none focus:border-purple-500 transition-colors min-h-[120px] text-sm resize-none"
              placeholder="Descreva o alerta ou pendência deste cliente..."
              autoFocus
            />

            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={() => setShowNewAlert({ open: false, clientId: null })} 
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 text-sm font-bold transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveAlert}
                className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 shadow-lg shadow-purple-900/20 text-sm transition-all" 
              >
                Salvar Alerta
              </button>
            </div>
          </div>
        </Modal>
      )}

{showScheduledModal.open && showScheduledModal.clientId && (
  <ScheduledMessagesModal
  tenantId={tenantId!}
  clientId={showScheduledModal.clientId}
  clientName={showScheduledModal.clientName || "Cliente"}
  items={scheduledMap[showScheduledModal.clientId] || []}
  onClose={() => setShowScheduledModal({ open: false, clientId: null, clientName: undefined })}
  onDeleted={async () => {
    if (tenantId) await loadScheduledForClients(tenantId, rows.map((x) => x.id));
  }}
  addToast={addToast}
/>

)}


{showAlertList.open && (
        <Modal title={`Alertas: ${showAlertList.clientName}`} onClose={() => setShowAlertList({ open: false, clientId: null })}>
          <div className="space-y-4">
            
            <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
              {(clientAlerts as { id: string; message?: string }[]).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/30 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl">
                   <span className="text-2xl mb-2">✅</span>
                   <p className="text-sm">Nenhum alerta pendente.</p>
                </div>
              ) : (
                (clientAlerts as { id: string; message?: string }[]).map((alert) => (
                  <div key={alert.id} className="group p-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm hover:border-rose-200 dark:hover:border-rose-500/30 transition-all flex justify-between items-start gap-4">
                    <div className="flex gap-3">
                        <span className="text-rose-500 mt-0.5">⚠️</span>
                        <p className="text-sm text-slate-700 dark:text-white/90 whitespace-pre-wrap leading-relaxed">{alert.message || ""}</p>
                    </div>
                    <button 
                      onClick={() => handleDeleteAlert(alert.id)} 
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                      title="Resolver / Excluir"
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end border-t border-slate-100 dark:border-white/5 pt-4">
              <button 
                onClick={() => setShowAlertList({ open: false, clientId: null })} 
                className="px-6 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white font-bold hover:bg-slate-200 dark:hover:bg-white/20 transition-colors text-sm"
              >
                Fechar Lista
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* --- MODAL DE ENVIO DE MENSAGEM --- */}
{showSendNow.open && (
        <Modal title="Enviar Mensagem Rápida" onClose={() => {
  setShowSendNow({ open: false, clientId: null });
  setSelectedTemplateNowId("");
  setMessageText("");
}}
>
          <div className="space-y-4">
            <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 p-3 rounded-lg flex items-center gap-3">
               <span className="text-xl">💬</span>
               <div className="text-sm text-sky-900 dark:text-sky-200">
                 Esta mensagem será enviada <strong>imediatamente</strong> via WhatsApp.
               </div>
            </div>

            {/* ✅ Select de template (opcional) */}
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
    {messageTemplates.map((t) => (
      <option key={t.id} value={t.id}>
        {t.name}
      </option>
    ))}
  </select>
</div>

<textarea
  value={messageText}
  disabled={!!selectedTemplateNowId}
  onChange={(e) => {
    // digitou manual = limpa template
    if (selectedTemplateNowId) setSelectedTemplateNowId("");
    setMessageText(e.target.value);
  }}
  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl p-4 text-slate-800 dark:text-white outline-none focus:border-sky-500 transition-colors min-h-[120px] text-sm resize-none disabled:opacity-70"
  placeholder="Olá, gostaria de informar que..."
  autoFocus
/>


            <div className="flex justify-end gap-3 pt-2">
              <button 
                onClick={() => setShowSendNow({ open: false, clientId: null })} 
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
  setShowScheduleMsg({ open: false, clientId: null });
  setSelectedTemplateScheduleId("");
  setScheduleText("");
  setScheduleDate("");
}}
>
          <div className="space-y-5">
            <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20 p-3 rounded-lg flex items-center gap-3">
               <span className="text-xl">📅</span>
               <div className="text-sm text-purple-900 dark:text-purple-200">
                 Programe avisos ou cobranças para o futuro.
               </div>
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
{/* ✅ Select de template (opcional) */}
<div>
  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
    Mensagem pronta (opcional)
  </label>

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
    className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-purple-500 transition-colors text-sm"
  >
    <option value="">Selecionar...</option>
    {messageTemplates.map((t) => (
      <option key={t.id} value={t.id}>
        {t.name}
      </option>
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
                onClick={() => setShowScheduleMsg({ open: false, clientId: null })} 
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

{appModal?.open && (
  <Modal
    title={`Aplicativo: ${appModal.app?.name || appModal.appName}`}
    onClose={() => setAppModal(null)}
  >
    <div className="space-y-4 text-sm">
      {/* Header / Cliente */}
      <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50">
          Cliente
        </div>
        <div className="mt-1 font-bold text-slate-800 dark:text-white truncate">
          {appModal.clientName}
        </div>
      </div>

      {/* URL de configuração */}
      <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50">
          URL de configuração (global)
        </div>

        {appModal.app?.info_url ? (
          <div className="mt-2 flex items-center gap-2">
            <a
              href={appModal.app.info_url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 text-emerald-600 dark:text-emerald-400 font-bold hover:underline truncate"
              title={appModal.app.info_url}
            >
              🔗 {appModal.app.info_url}
            </a>

            <button
              onClick={() => {
                try {
                  navigator.clipboard.writeText(String(appModal.app.info_url));
                  addToast("success", "Copiado", "URL copiada para a área de transferência.");
                } catch {}
              }}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/10 text-slate-600 dark:text-white/70 font-bold text-xs hover:bg-slate-100 dark:hover:bg-white/15 transition"
              title="Copiar URL"
            >
              Copiar
            </button>
          </div>
        ) : (
          <div className="mt-2 text-slate-400 dark:text-white/30 italic">
            Nenhuma URL cadastrada para este app.
          </div>
        )}
      </div>

      {/* Campos do app */}
      <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50">
            Campos do aplicativo
          </div>

          {appLoading && (
            <span className="text-[10px] font-bold text-slate-400 dark:text-white/30 animate-pulse">
              Carregando...
            </span>
          )}
        </div>

        {(!Array.isArray(appModal.app?.fields_config) || appModal.app.fields_config.length === 0) ? (
          <div className="mt-2 text-slate-400 dark:text-white/30 italic">
            Este app não tem campos personalizados.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {appModal.app.fields_config.map((f: any) => {
              const fid = String(f.id);

              const inputType =
                f.type === "date" ? "date" : f.type === "link" ? "url" : "text";

              return (
                <div key={fid} className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                    {f.label}
                  </label>

                  <div className="flex items-center gap-2">
  <input
    type={inputType}
    value={appValues[fid] ?? ""}
    onChange={(e) => {
      const v = e.target.value;
      setAppValues((prev) => ({ ...prev, [fid]: v }));
    }}
    className="flex-1 h-11 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors text-sm"
    placeholder={f.placeholder || ""}
    disabled={appLoading || appSaving}
  />

  {/* ✅ Copiar só em campos livres (não-date) */}
  {f.type !== "date" && (
    <button
      type="button"
      onClick={() => copyToClipboard(appValues[fid])}
      disabled={appLoading || appSaving}
      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/10 text-slate-600 dark:text-white/70 font-bold text-xs hover:bg-slate-100 dark:hover:bg-white/15 transition disabled:opacity-50 disabled:cursor-not-allowed"
      title="Copiar valor"
    >
      Copiar
    </button>
  )}
</div>


                  {/* extra: se for link, mostra botão abrir */}
                  {f.type === "link" && (appValues[fid] || "").trim() && (
                    <div className="flex justify-end">
                      <a
                        href={(appValues[fid] || "").trim()}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        Abrir link →
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
  <button
    onClick={() => setAppModal(null)}
    className="h-10 px-4 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 font-bold text-xs hover:bg-slate-50 dark:hover:bg-white/10 transition"
  >
    Fechar
  </button>

  <button
    onClick={() => {
      if (!appModal?.clientId) return;
      setAppModal(null);
      // ✅ abre edição do cliente (aba apps via initialTab, ver ajuste no NovoCliente)
      openEditById(appModal.clientId, "apps");

    }}
    className="h-10 px-5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg shadow-amber-900/20 transition"
    title="Abrir edição completa do cliente"
  >
    Editar Cliente
  </button>
</div>

    </div>
  </Modal>
)}

{ConfirmUI}
      <div className="relative z-[999999]">
  <ToastNotifications toasts={toasts} removeToast={removeToast} />
</div>


      <style jsx global>{`
        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-calendar-picker-indicator {
          opacity: 0;
          display: none;
        }
      `}</style>
    </div>
  );
}

// --- SUB-COMPONENTES VISUAIS (TEMA LIGHT/DARK) ---

function Select({
  children,
  value,
  onChange,
}: {
  children: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
    >
      {children}
    </select>
  );
}

const ALIGN_CLASS: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function Th({ children, width, align = "left" }: { children: React.ReactNode; width?: number; align?: "left" | "right" | "center" }) {
  return (
    <th className={`px-4 py-3 ${ALIGN_CLASS[align]}`} style={{ width }}>
      {children}
    </th>
  );
}

function ThSort({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th onClick={onClick} className="px-4 py-3 cursor-pointer select-none group hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors text-left">
      <div className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? "opacity-100 text-emerald-600 dark:text-emerald-500" : "opacity-40 group-hover:opacity-70"}`}>
          {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
        </span>
      </div>
    </th>
  );
}

// ✅ Componente auxiliar para cabeçalhos centralizados clicáveis (já que ThSort é fixo a esquerda)
function SortClick({ label, onClick, active, dir }: { label: string; onClick: () => void; active: boolean; dir: SortDir }) {
  return (
    // ✅ Alterado para 'flex w-full justify-center' para garantir o centro absoluto na célula
    <div onClick={onClick} className="flex w-full justify-center items-center gap-1.5 cursor-pointer select-none hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors py-1">
      <span className="font-bold uppercase text-xs tracking-wide">{label}</span>
      <span className={`transition-opacity flex items-center ${active ? "opacity-100 text-emerald-600 dark:text-emerald-500" : "opacity-30"}`}>
        {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
      </span>
    </div>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  // Define classes explícitas
  let alignClass = "text-left";
  if (align === "right") alignClass = "text-right";
  if (align === "center") alignClass = "text-center";

  return <td className={`px-4 py-3 ${alignClass} align-middle`}>{children}</td>;
}

function ScheduledMessagesModal({
  tenantId,
  clientId,
  clientName,
  items,
  onClose,
  onDeleted,
  addToast,
}: {
  tenantId: string;
  clientId: string;
  clientName: string;
  items: ScheduledMsg[];
  onClose: () => void;
  onDeleted: () => void;
  addToast: (type: "success" | "error", title: string, message?: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // ✅ Instância correta do hook DENTRO deste componente
  const { confirm, ConfirmUI } = useConfirm(); 

  async function handleDelete(scheduleId: string) {
    const it = items.find((x) => x.id === scheduleId);

    // ✅ Agora o confirm funciona pois o ConfirmUI está no return abaixo
    const ok = await confirm({
      title: "Cancelar agendamento",
      subtitle: "Tem certeza que deseja remover esta mensagem da fila?",
      tone: "rose",
      icon: "🗑️", // Icone ajustado para lixeira
      details: [
        `Cliente: ${clientName}`,
        it?.send_at
          ? `Envio programado: ${new Date(it.send_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          : "Envio em: —",
        it?.message ? `Mensagem: "${it.message.slice(0, 50)}${it.message.length > 50 ? "..." : ""}"` : ""
      ],
      confirmText: "Sim, Excluir",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      setDeletingId(scheduleId);

      const { error } = await supabaseBrowser.rpc("client_message_cancel", {
        p_tenant_id: tenantId,
        p_job_id: scheduleId,
      });

      if (error) throw error;

      addToast("success", "Agendamento cancelado", "A mensagem foi removida da fila de envios.");
      await onDeleted();
      // Não fecha o modal (onClose) para permitir excluir outros se quiser
    } catch (e: any) {
      console.error(e);
      addToast("error", "Erro ao excluir", e?.message || "Erro desconhecido");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Modal title={`Mensagens Programadas • ${clientName}`} onClose={onClose}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/30 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl">
             <span className="text-2xl mb-2">🗓️</span>
             <p className="text-sm">Nenhum agendamento encontrado.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {items.map((it) => (
              <div
                key={it.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 transition hover:border-purple-200 dark:hover:border-purple-500/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider bg-white dark:bg-white/10 px-2 py-0.5 rounded border border-slate-100 dark:border-white/5">
                        {new Date(it.send_at).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                          day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
                        })}
                      </div>

                      {it.status && (
                        <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 text-[9px] font-bold uppercase tracking-wider">
                          {it.status}
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-slate-700 dark:text-white/90 whitespace-pre-wrap break-words leading-relaxed border-l-2 border-slate-200 dark:border-white/10 pl-3">
                      {it.message}
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(it.id)}
                    disabled={deletingId === it.id}
                    className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                    title="Excluir agendamento"
                  >
                    {deletingId === it.id ? (
                      <span className="animate-spin">⏳</span>
                    ) : (
                      <IconTrash />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ✅ OBRIGATÓRIO: Renderiza o componente visual do ConfirmDialog */}
      {ConfirmUI}
    </>
  );
}


function StatusBadge({ 
  status, 
  customLabel, 
  customTone 
}: { 
  status: string; 
  customLabel?: string; 
  customTone?: "green" | "red" | "amber" | "blue" 
}) {
  
  // Define a cor base
  let color = "sky"; // Default (Teste/Arquivado)
  
  if (customTone) {
     // Se veio forçado da tabela (ex: Hoje = amber)
     if (customTone === "green") color = "emerald";
     if (customTone === "red") color = "rose";
     if (customTone === "amber") color = "amber"; // ou yellow
     if (customTone === "blue") color = "sky";
  } else {
     // Fallback para status original se não vier customTone
     if (status === "Ativo") color = "emerald";
     if (status === "Vencido") color = "rose";
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border bg-${color}-100 dark:bg-${color}-500/10 text-${color}-700 dark:text-${color}-500 border-${color}-200 dark:border-${color}-500/20 whitespace-nowrap`}>
      {customLabel || status}
    </span>
  );
}

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void;
}) {
  const colors = {
    blue: "text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    purple: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/20",
    red: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
  };
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(e); }} title={title} className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}>
      {children}
    </button>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full px-4 py-2 flex items-center gap-3 text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-emerald-600 dark:hover:text-white transition-colors text-left text-sm font-medium">
      <span className="opacity-70">{icon}</span>
      {label}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.60)", display: "grid", placeItems: "center", zIndex: 99999, padding: 16 }}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#0f141a] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="font-bold text-slate-800 dark:text-white">{title}</div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white">
            <IconX />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// --- ICONES ---
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconSortUp() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>; }
function IconSortDown() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>; }
function IconChat() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>; }
function IconSend() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>; }
function IconMoney() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconBell() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }
function IconRestore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
