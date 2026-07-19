"use client";
// app/admin/cliente/page.tsx
import {
  EyeOff,
  Eye,
  Loader2,
  X,
  ChevronUp,
  ChevronDown,
  MessageCircle,
  Send,
  Clock,
  CreditCard,
  Pencil,
  Bell,
  RefreshCcw,
  Timer,
  Trash2,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";

import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import FormattedDateInput from "@/components/ui/FormattedDateInput";
import NovoCliente, { ClientData } from "./novo_cliente";
import RecargaCliente from "./recarga_cliente";
import { useConfirm } from "@/hooks/useConfirm";

import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { getIntegrationHandler } from "@/lib/integrations"; // ✅ NOVO: Traz o cérebro das integrações
import Pagination from "@/components/ui/Pagination";
import { isoDateInSaoPaulo } from "@/lib/date-br";

if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
  window.console.log = () => {};
  window.console.warn = () => {};
  window.console.error = () => {};
}

// --- HELPERS WHATSAPP ---
// ✅ Só o nome do contato (Principal/Secundário) — sem o número, que não
// cabia nos campos pequenos dos seletores de sessão.
function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  return profile?.connected ? sessionName : `${sessionName} (não conectado)`;
}

// Helper para calcular diferença de dias (Fuso SP)
const APP_FIELD_LABELS: Record<string, string> = {
  date: "Vencimento",
  mac: "Device ID (MAC)",
  device_key: "Device Key",
  email: "E-mail",
  password: "Senha",
  url: "URL",
  obs: "Obs",
};

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

  if (diff < -2)
    return { text: `Venceu há ${Math.abs(diff)} dias`, color: "text-rose-500" };
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
  // ✅ ADICIONADO: ID da tabela para persistência correta na edição
  plan_table_id?: string | null;
  price_amount: number | null;
  price_currency: string | null;

  server_id: string | null;
  server_name: string | null;

  technology: string | null; // ✅ NOVO CAMPO

  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  secondary_display_name?: string | null;
  secondary_name_prefix?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;
  dont_message_until: string | null; // whatsapp_snooze_until mapeado na view

  apps_names: string[] | null; // View retorna array de texto
  alerts_open: number | null;
  apps_data: Array<{
    name: string;
    integration_type: string;
    expire_date: string | null;
  }> | null;

  notes: string | null;
  m3u_url?: string | null;
  name_prefix?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

type ScheduledMsg = {
  id: string;
  client_id: string;
  send_at: string; // timestamptz
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
  appsData: Array<{
    name: string;
    integration_type: string;
    expire_date: string | null;
  }> | null;

  // --- DADOS PARA O MODAL DE EDIÇÃO ---
  server_id: string;
  // ✅ ADICIONADO: Guarda o ID da tabela
  plan_table_id?: string;
  technology_edit: string; // ✅ Para passar pro modal
  whatsapp: string;
  whatsapp_username?: string;
  server_password?: string; // CORRIGIDO
  price_amount?: number;
  m3u_url?: string;
  name_prefix?: string;
  secondary_display_name?: string;
  secondary_name_prefix?: string;
  secondary_phone_e164?: string;
  secondary_whatsapp_username?: string;
  expires_at?: string; // Data YYYY-MM-DD para o input
  rawVencimento?: string | null; // ✅ NOVO: Timestamp original completo
  whatsapp_opt_in?: boolean;
  notes?: string;
  price_currency?: string;
  dont_message_until?: string;
};

// --- HELPERS ---

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

  // ✅ PARA
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    dueISODate: isoDate,
    dueLabelDate: `${get("day")}/${get("month")}/${get("year")}`,
    dueTime: `${get("hour")}:${get("minute")}`,
  };
}

function formatMoney(amount: number | null, currency: string | null) {
  if (!amount || amount <= 0) return { value: 0, label: "—" };
  const cur = currency || "BRL";
  return {
    value: amount,
    label: new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: cur,
    }).format(amount),
  };
}

function ClientePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const entidadeLabel = "Cliente";
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
        setDueFilter("Todos");
        return;
      }
      if (filterParam === "vencidos") {
        setStatusFilter("Vencido");
        setDueFilter("Todos");
        return;
      }

      // 2. Filtros de DATA
      const map: Record<string, string> = {
        venceu_ontem: "Venceu Ontem",
        venceu_2_dias: "Venceu há 2 dias",
        vence_hoje: "Hoje",
        vence_amanha: "Vence Amanhã",
        vence_2_dias: "Vence em 2 dias",
        mes_atual: "Mês Atual",
      };
      if (map[filterParam]) {
        setDueFilter(map[filterParam]);
      }
    } else {
      // ✅ RESET TOTAL (Quando clica no menu Clientes ou limpa a URL)
      // Isso funciona como um "Refresh" da regra de negócio da tela
      setSearch("");
      setStatusFilter("Todos");
      setServerFilter("Todos");
      setPlanFilter("Todos");
      setDueFilter("Todos");
      setAppFilter("Todos"); // ✅ CORREÇÃO: Faltou aqui
      setArchivedFilter("Não");

      // Reseta ordenação para o padrão inteligente
      setSortKey("due");
      setSortDir("asc");
      setIsDefaultSort(true);
    }
  }, [searchParams]);

  // Modais
  const [showFormModal, setShowFormModal] = useState(false);
  type AppsIndex = {
    byId: Record<string, any>;
    byName: Record<string, any>; // chave normalizada
  };

  const [appsIndex, setAppsIndex] = useState<AppsIndex>({
    byId: {},
    byName: {},
  });
  const [appIntegrations, setAppIntegrations] = useState<any[]>([]); // ✅ NOVO: Guarda as URLs dos Apps da extensão

  function normAppKey(v: any): string {
    return String(v ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  const [clientToEdit, setClientToEdit] = useState<ClientData | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"Todos" | ClientStatus>(
    "Todos",
  );
  const [archivedFilter, setArchivedFilter] = useState<"Todos" | "Não" | "Sim">(
    "Não",
  );
  const [serverFilter, setServerFilter] = useState("Todos");
  const [planFilter, setPlanFilter] = useState("Todos");
  const [dueFilter, setDueFilter] = useState("Todos");

  const [appFilter, setAppFilter] = useState("Todos"); // ✅ Filtro Único: Vencimento ou Nome

  // ✅ Mobile: menu de filtros
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [valuesHidden, setValuesHidden] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [isDefaultSort, setIsDefaultSort] = useState(true); // <--- ADICIONAR ISSO

  // Ações
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);

  // ✅ NOVO: Controla os botões de loading
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const [showRenew, setShowRenew] = useState<{
    open: boolean;
    clientId: string | null;
    clientName?: string;
  }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });

  // ✅ NOVO: Estado para o aviso de alerta antes da renovação
  const [showRenewWarning, setShowRenewWarning] = useState<{
    open: boolean;
    clientId: string | null;
    clientName: string;
  }>({
    open: false,
    clientId: null,
    clientName: "",
  });

  // ✅ NOVO: Agendamentos por cliente (para badge e modal)
  const [scheduledMap, setScheduledMap] = useState<
    Record<string, ScheduledMsg[]>
  >({});
  const [showScheduledModal, setShowScheduledModal] = useState<{
    open: boolean;
    clientId: string | null;
    clientName?: string;
  }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });

  const [showNewAlert, setShowNewAlert] = useState<{
    open: boolean;
    clientId: string | null;
    clientName?: string;
  }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });
  const [newAlertText, setNewAlertText] = useState("");
  // ✅ Pendências financeiras: null = tela de escolha (3 opções) ainda não decidida
  const [newAlertKind, setNewAlertKind] = useState<
    "note" | "app_charge" | "generic_charge" | null
  >(null);
  const [newAlertAmount, setNewAlertAmount] = useState("");
  const [newAlertCurrency, setNewAlertCurrency] = useState("BRL");
  const [newAlertClientAppId, setNewAlertClientAppId] = useState("");
  const [newAlertActivationDate, setNewAlertActivationDate] = useState("");
  const [clientAppsForAlert, setClientAppsForAlert] = useState<
    {
      id: string;
      appName: string;
      costType: string | null;
      licensePrice: number | null;
    }[]
  >([]);
  const [loadingClientAppsForAlert, setLoadingClientAppsForAlert] =
    useState(false);
  // ✅ null = criando um alerta novo; preenchido = editando um já existente
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);

  const [showAlertList, setShowAlertList] = useState<{
    open: boolean;
    clientId: string | null;
    clientName?: string;
  }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });
  const [clientAlerts, setClientAlerts] = useState<unknown[]>([]);
  // ✅ Toggle visual (👎 pendente / 👍 pago) antes de confirmar com "Salvar" —
  // não grava no banco até o clique em Salvar.
  const [toggledPaidIds, setToggledPaidIds] = useState<Set<string>>(
    new Set(),
  );

  // Mensagem (Mantido conforme original)
  const [showSendNow, setShowSendNow] = useState<{
    open: boolean;
    clientId: string | null;
  }>({ open: false, clientId: null });
  const [messageText, setMessageText] = useState("");
  const [selectedSessionNow, setSelectedSessionNow] = useState("default"); // ✅ NOVO

  const [showScheduleMsg, setShowScheduleMsg] = useState<{
    open: boolean;
    clientId: string | null;
  }>({ open: false, clientId: null });
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [selectedSessionSchedule, setSelectedSessionSchedule] =
    useState("default"); // ✅ NOVO

  // ✅ NOVO: Opções de sessão dinâmicas (Busca os telefones reais da VM)
  const [sessionOptions, setSessionOptions] = useState<
    { id: string; label: string }[]
  >([{ id: "default", label: "Carregando..." }]);

  async function loadWhatsAppSessions() {
    try {
      const [res1, res2] = await Promise.all([
        fetch("/api/whatsapp/profile", { cache: "no-store" }).catch(() => null),
        fetch("/api/whatsapp/profile2", { cache: "no-store" }).catch(
          () => null,
        ),
      ]);

      const prof1 = res1 && res1.ok ? await res1.json().catch(() => ({})) : {};
      const prof2 = res2 && res2.ok ? await res2.json().catch(() => ({})) : {};

      const name1 =
        typeof window !== "undefined"
          ? localStorage.getItem("wa_label_1") || "Contato Principal"
          : "Contato Principal";
      const name2 =
        typeof window !== "undefined"
          ? localStorage.getItem("wa_label_2") || "Contato Secundário"
          : "Contato Secundário";

      const options = [
        { id: "default", label: buildWhatsAppSessionLabel(prof1, name1) },
      ]; // ✅ TRAVA: Só adiciona a sessão 2 no select se ela estiver conectada e disponível

      if (prof2 && prof2.connected) {
        options.push({
          id: "session2",
          label: buildWhatsAppSessionLabel(prof2, name2),
        });
      }

      setSessionOptions(options);
    } catch {}
  }

  // ✅ Templates (mensagens prontas)
  type MessageTemplate = {
    id: string;
    name: string;
    content: string;
    image_url?: string | null;
    category?: string | null;
  }; // ✅ Busca a Categoria
const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>(
    [],
  );
  // ✅ NOVO: controla se já buscamos, pra não repetir toda vez que o modal abre
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [whatsappSessionsLoaded, setWhatsappSessionsLoaded] = useState(false);
  const [selectedTemplateNowId, setSelectedTemplateNowId] =
    useState<string>(""); // modal enviar agora
  const [selectedTemplateScheduleId, setSelectedTemplateScheduleId] =
    useState<string>(""); // modal agendar
  const { confirm, ConfirmUI } = useConfirm();

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toastTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>(
    {},
  );

  // ✅ Adicionado o tipo "warning" para suportar os avisos de timeout da extensão
  function addToast(
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) {
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
    const {
      data: { session },
    } = await supabaseBrowser.auth.getSession();
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
      addToast(
        "error",
        "Falha de conexão",
        "Não foi possível carregar a lista de clientes.",
      );
      setRows([]);
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
    const { data, error } = await supabaseBrowser
      .from("message_templates")
      .select("id,name,content,image_url,category") // ✅ Busca category
      .eq("tenant_id", tid)
      .order("name", { ascending: true });

    if (error) {
      setMessageTemplates([]);
      return;
    }

    const mapped = ((data as any[]) || []).map((r) => {
      return {
        id: String(r.id),
        name: String(r.name ?? "Sem nome"),
        content: String(r.content ?? ""),
        image_url: r.image_url || null,
        category: r.category || "Geral",
      };
    }) as MessageTemplate[];

    setMessageTemplates(mapped);
  }

  // ✅ NOVO: só busca templates e sessões de WhatsApp na primeira vez que um
  // dos modais de mensagem é aberto — nunca mais no carregamento da página
  async function ensureMessagingDataLoaded() {
    if (!tenantId) return;
    const tasks: Promise<any>[] = [];

    if (!templatesLoaded) {
      tasks.push(
        loadMessageTemplates(tenantId).then(() => setTemplatesLoaded(true)),
      );
    }
    if (!whatsappSessionsLoaded) {
      tasks.push(
        loadWhatsAppSessions().then(() => setWhatsappSessionsLoaded(true)),
      );
    }
    if (tasks.length) await Promise.all(tasks);
  }

  // --- CARREGAMENTO ---
  async function loadData() {
    if (loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);

    try {
      const tid = await getCurrentTenantId();
      setTenantId(tid);

      if (!tid) {
        setRows([]);
        return;
      }

      const viewName =
        archivedFilter === "Sim"
          ? "vw_clients_list_archived"
          : "vw_clients_list_active";

      // ✅ SÓ isso é essencial pra tabela aparecer. Templates e WhatsApp saíram
      // completamente daqui — só carregam quando você abre o modal de mensagem.
      const { data, error } = await supabaseBrowser
        .from(viewName)
        .select("*")
        .eq("tenant_id", tid)
        .neq("computed_status", "TRIAL")
        .order("vencimento", { ascending: true });

      if (error) {
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
          appsData:
            (r.apps_data as Array<{
              name: string;
              integration_type: string;
              expire_date: string | null;
            }> | null) || null,

          server_id: String(r.server_id ?? ""),
          plan_table_id: r.plan_table_id ?? undefined,
          technology_edit: String(r.technology || "IPTV"),
          whatsapp: String(r.whatsapp_e164 ?? ""),
          whatsapp_username: r.whatsapp_username ?? undefined,
          server_password: r.server_password ?? undefined,
          price_amount: r.price_amount ?? undefined,
          m3u_url: r.m3u_url ?? undefined,
          name_prefix: r.name_prefix ?? undefined,

          secondary_display_name:
            (r as any).secondary_display_name ?? undefined,
          secondary_name_prefix: (r as any).secondary_name_prefix ?? undefined,
          secondary_phone_e164: (r as any).secondary_phone_e164 ?? undefined,
          secondary_whatsapp_username:
            (r as any).secondary_whatsapp_username ?? undefined,

          expires_at: r.vencimento ? r.vencimento.split("T")[0] : undefined,
          rawVencimento: r.vencimento,

          whatsapp_opt_in:
            typeof r.whatsapp_opt_in === "boolean"
              ? r.whatsapp_opt_in
              : undefined,
          price_currency: r.price_currency ?? undefined,
          dont_message_until: r.dont_message_until ?? undefined,
          notes: r.notes ?? "",
        };
      });

      // ✅ A tabela já pode aparecer aqui — tudo abaixo roda em segundo plano,
      // sem bloquear, e atualiza sozinho (sem precisar de refresh)
      setRows(mapped);
      setLoading(false);
      loadingRef.current = false;

      supabaseBrowser
        .from("apps")
        .select("*")
        .eq("is_active", true)
        .then(({ data: appsData }) => {
          if (appsData && appsData.length > 0) {
            const byId: Record<string, any> = {};
            const byName: Record<string, any> = {};
            for (const a of appsData) {
              if (a?.id) byId[String(a.id)] = a;
              byName[normAppKey(a?.name)] = a;
            }
            setAppsIndex({ byId, byName });
          }
        });

      supabaseBrowser
        .from("app_integrations")
        .select("app_name, api_url, pin")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .then(({ data: appInts }) => {
          if (appInts) setAppIntegrations(appInts);
        });

      loadScheduledForClients(
        tid,
        mapped.map((m) => m.id),
      );
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
      addToast(
        "success",
        "Copiado",
        "Valor copiado para a área de transferência.",
      );
    } catch {
      addToast(
        "error",
        "Falha ao copiar",
        "Não foi possível copiar este valor.",
      );
    }
  }

  /**
   * Estratégia:
   * - field_values no banco deve usar o field.id como chave.
   * - MAS: se no passado você salvou usando label, fazemos fallback.
   */
  function readFieldValue(
    fieldValues: Record<string, any> | null | undefined,
    field: any,
  ): string {
    const fv = fieldValues || {};
    const byId = fv[field.id];
    if (byId !== undefined) return normalizeValue(byId);

    const byLabel = fv[field.label];
    if (byLabel !== undefined) return normalizeValue(byLabel);

    return "";
  }

  function isUuidLike(v: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      v,
    );
  }

  // ✅ Helpers de URL que faltavam nesta página
  function isLikelyUrl(v: string) {
    const s = String(v || "").trim();
    if (!s) return false;
    return /^https?:\/\/\S+/i.test(s) || /^www\.\S+/i.test(s);
  }

  function toOpenableUrl(v: string) {
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (/^www\./i.test(s)) return `https://${s}`;
    return s;
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

      const arr = JSON.parse(raw) as {
        type: "success" | "error";
        title: string;
        message?: string;
      }[];
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
  const uniqueServers = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.server).filter((s) => s !== "—")),
      ).sort(),
    [rows],
  );
  const uniqueplano = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.planPeriod).filter((p) => p !== "—")),
      ).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    // ✅ Normaliza a busca: remove espaços, joga pra minúsculo e arranca todos os acentos
    const q = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const today = isoDateInSaoPaulo();
    const end3 = addDaysIsoInSaoPaulo(today, 3);

    return rows.filter((r) => {
      if (statusFilter !== "Todos" && r.status !== statusFilter) return false;
      if (serverFilter !== "Todos" && r.server !== serverFilter) return false;
      if (planFilter !== "Todos" && r.planPeriod !== planFilter) return false;

      // ✅ Filtro Único de Aplicativos (Vencimento ou Nome do App)
      if (appFilter !== "Todos") {
        if (appFilter === "15_dias" || appFilter === "30_dias") {
          const minExpiry =
            r.appsData
              ?.filter((a) => a.expire_date)
              .map((a) => a.expire_date!)
              .sort()[0] ?? null;
          if (!minExpiry) return false;
          const diff = getDiffDays(minExpiry);
          if (appFilter === "15_dias" && diff > 15) return false;
          if (appFilter === "30_dias" && diff > 30) return false;
        } else {
          if (!r.apps?.includes(appFilter)) return false;
        }
      }

      if (dueFilter !== "Todos") {
        const diff = getDiffDays(r.dueISODate);

        switch (dueFilter) {
          case "Venceu há 2 dias":
            if (diff !== -2) return false;
            break;
          case "Venceu Ontem":
            if (diff !== -1) return false;
            break;
          case "Hoje":
            if (diff !== 0) return false;
            break;
          case "Vence Amanhã":
            if (diff !== 1) return false;
            break;
          case "Vence em 2 dias":
            if (diff !== 2) return false;
            break;
          case "Mês Atual":
            const currentMonth = isoDateInSaoPaulo().slice(0, 7);
            if (!r.dueISODate.startsWith(currentMonth)) return false;
            break;
        }
      }

      if (q) {
        // ✅ Normaliza o "palheiro" (dados do cliente): joga pra minúsculo e arranca acentos
        const hay = [
          r.name,
          r.username,
          r.secondary_display_name ?? "",
          r.server,
          r.planPeriod,
          r.valueLabel,
          r.status,
          r.whatsapp_username ?? "",
          r.secondary_whatsapp_username ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    rows,
    search,
    statusFilter,
    serverFilter,
    planFilter,
    dueFilter,
    appFilter,
  ]); // ✅ BUG CORRIGIDO: AppFilter adicionado nas dependências

  useEffect(() => {
    setPage(1);
  }, [
    search,
    statusFilter,
    serverFilter,
    planFilter,
    dueFilter,
    archivedFilter,
  ]);

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
          cmp = compareText(
            `${a.dueISODate} ${a.dueTime}`,
            `${b.dueISODate} ${b.dueTime}`,
          );
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
        cmp = compareText(
          `${a.dueISODate} ${a.dueTime}`,
          `${b.dueISODate} ${b.dueTime}`,
        );
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
      addToast(
        "error",
        "Cliente não encontrado",
        "Não foi possível abrir edição deste cliente.",
      );
      return;
    }

    // ✅ define aba
    setEditInitialTab(initialTab);

    // ✅ reaproveita a abertura normal
    handleOpenEdit(r, initialTab);
  }

  const handleOpenEdit = (r: ClientRow, initialTab: EditTab = "dados") => {
    setEditingId(r.id); // ✅ Liga o loading giratório

    // ✅ define qual aba abrir
    setEditInitialTab(initialTab);

    // ✅ A view já traz tudo fresco (plan_table_id, price_currency, m3u_url,
    // name_prefix) — sem chamada extra ao abrir o modal.
    const payload: ClientData = {
      id: r.id,
      client_name: r.name,
      name_prefix: r.name_prefix,
      username: r.username,
      server_id: r.server_id,
      screens: r.screens,
      technology: r.technology_edit,

      whatsapp_e164: r.whatsapp,
      whatsapp_username: r.whatsapp_username,
      whatsapp_opt_in: r.whatsapp_opt_in,

      secondary_display_name: r.secondary_display_name,
      secondary_name_prefix: r.secondary_name_prefix,
      secondary_phone_e164: r.secondary_phone_e164,
      secondary_whatsapp_username: r.secondary_whatsapp_username,
      dont_message_until: r.dont_message_until,

      server_password: r.server_password,

      plan_name: r.rawPlanName,
      plan_table_id: r.plan_table_id,
      price_amount: r.price_amount,
      price_currency: r.price_currency,

      // ✅ Timestamp original completo (UTC) pro modal converter certo
      vencimento: r.rawVencimento || undefined,
      m3u_url: r.m3u_url ?? "",

      notes: r.notes,
    };

    setClientToEdit(payload);

    // ✅ abre no próximo tick para garantir montagem correta
    setTimeout(() => {
      setShowFormModal(true);

      // ✅ Segura o botão girando por mais 1.5 segundos enquanto o modal é desenhado na tela
      setTimeout(() => {
        setEditingId(null);
      }, 3000);
    }, 10);
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

      addToast(
        "success",
        goingToArchive ? "Cliente arquivado" : "Cliente restaurado",
      );
      loadData();
    } catch {
      addToast(
        "error",
        "Ação não permitida",
        "Não foi possível alterar o estado do cliente.",
      );
    }
  };

  const handleDeleteForever = async (r: ClientRow) => {
    if (!tenantId) return;

    if (!r.archived) {
      addToast(
        "error",
        "Ação bloqueada",
        "Só é possível excluir definitivamente pela Lixeira.",
      );
      return;
    }

    const ok = await confirm({
      title: "Excluir definitivamente",
      subtitle: "Essa ação NÃO pode ser desfeita.",
      tone: "rose",
      icon: "⚠️",
      details: [`Cliente: ${r.name}`, "Ação: excluir para sempre"],
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
    } catch {
      addToast(
        "error",
        "Ação não permitida",
        "Não foi possível excluir o cliente.",
      );
    }
  };

  // ✅ Mensagem padrão da pendência de app — pré-preenchida na observação
  // (editável) assim que app e/ou data mudam, já que 99% dos casos é isso.
  function buildAppChargeMessage(appName: string, activationDateISO: string) {
    if (!appName) return "";
    const datePart = activationDateISO
      ? new Date(`${activationDateISO}T12:00:00`).toLocaleDateString("pt-BR")
      : "";
    return datePart
      ? `Ativação do aplicativo ${appName} realizada no dia ${datePart}`
      : `Ativação do aplicativo ${appName}`;
  }

  // ✅ Busca os apps do cliente (nome + custo) pra popular o seletor da
  // pendência de aplicativo — só carrega quando essa opção é escolhida.
  const loadClientAppsForAlert = async (clientId: string) => {
    setLoadingClientAppsForAlert(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("client_apps")
        .select("id, apps(name, cost_type, license_price)")
        .eq("client_id", clientId);

      if (error) throw error;

      const mapped = ((data as any[]) || []).map((r) => ({
        id: String(r.id),
        appName: String(r.apps?.name ?? "App"),
        costType: r.apps?.cost_type ?? null,
        licensePrice:
          r.apps?.license_price != null
            ? Number(r.apps.license_price)
            : null,
      }));
      setClientAppsForAlert(mapped);
    } catch (error: any) {
      addToast("error", "Erro ao carregar apps", error.message);
      setClientAppsForAlert([]);
    } finally {
      setLoadingClientAppsForAlert(false);
    }
  };

  function resetNewAlertForm() {
    setShowNewAlert({ open: false, clientId: null, clientName: undefined });
    setNewAlertKind(null);
    setNewAlertText("");
    setNewAlertAmount("");
    setNewAlertCurrency("BRL");
    setNewAlertClientAppId("");
    setNewAlertActivationDate("");
    setClientAppsForAlert([]);
    setEditingAlertId(null);
  }

  // ✅ Abre o mesmo modal já preenchido com os dados do alerta, pulando a
  // tela de escolha (já sabemos o tipo pelos campos que existem).
  const openEditAlert = (alert: any, clientId: string, clientName: string) => {
    const kind: "note" | "app_charge" | "generic_charge" =
      alert.amount == null
        ? "note"
        : alert.client_app_id
          ? "app_charge"
          : "generic_charge";

    setEditingAlertId(String(alert.id));
    setNewAlertKind(kind);
    setNewAlertText(alert.message || "");
    setNewAlertAmount(alert.amount != null ? String(alert.amount) : "");
    setNewAlertCurrency(alert.currency || "BRL");
    setNewAlertClientAppId(alert.client_app_id || "");
    setNewAlertActivationDate(alert.activation_date || "");
    setShowNewAlert({ open: true, clientId, clientName });

    if (kind === "app_charge") loadClientAppsForAlert(clientId);
  };

  const handleSaveAlert = async () => {
    if (!showNewAlert.clientId || !tenantId || !newAlertKind) return;

    const payload: Record<string, any> = {
      tenant_id: tenantId,
      client_id: showNewAlert.clientId,
      status: "OPEN",
    };

    if (newAlertKind === "note") {
      if (!newAlertText.trim()) return;
      payload.message = newAlertText.trim();
    } else {
      // app_charge ou generic_charge: exige valor válido
      const amount = Number(newAlertAmount.replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) {
        addToast("error", "Valor inválido", "Informe um valor maior que zero.");
        return;
      }
      payload.amount = amount;
      payload.currency = newAlertCurrency || "BRL";

      if (newAlertKind === "app_charge") {
        if (!newAlertClientAppId) {
          addToast("error", "Selecione um app", "Escolha qual app gerou a pendência.");
          return;
        }
        const app = clientAppsForAlert.find(
          (a) => a.id === newAlertClientAppId,
        );
        payload.client_app_id = newAlertClientAppId;
        payload.message =
          newAlertText.trim() ||
          buildAppChargeMessage(app?.appName ?? "", newAlertActivationDate);
        if (newAlertActivationDate) {
          payload.activation_date = newAlertActivationDate;
        }
      } else {
        if (!newAlertText.trim()) {
          addToast("error", "Descreva a pendência", "Digite do que se trata.");
          return;
        }
        payload.message = newAlertText.trim();
      }
    }

    try {
      const { error } = editingAlertId
        ? await supabaseBrowser
            .from("client_alerts")
            .update(payload)
            .eq("id", editingAlertId)
        : await supabaseBrowser.from("client_alerts").insert(payload);

      if (error) throw error;

      addToast(
        "success",
        editingAlertId ? "Alerta atualizado" : "Alerta criado",
        "O alerta foi salvo com sucesso.",
      );
      const clientIdForRefresh = showNewAlert.clientId;
      const clientNameForRefresh = showNewAlert.clientName;
      resetNewAlertForm();
      loadData();
      // ✅ Se a lista de alertas estava aberta atrás (editando por lá), atualiza ela também
      if (showAlertList.open && clientIdForRefresh) {
        handleOpenAlertList(clientIdForRefresh, clientNameForRefresh || "");
      }
    } catch (error: any) {
      addToast(
        "error",
        editingAlertId ? "Erro ao atualizar alerta" : "Erro ao criar alerta",
        error.message,
      );
    }
  };

  const handleDeleteAlert = async (alertId: string) => {
    if (!tenantId) return;
    const alertObj = (clientAlerts as any[]).find(
      (a) => String(a.id) === String(alertId),
    );

    const ok = await confirm({
      title: "Remover alerta",
      subtitle: "Este alerta será removido e não poderá ser recuperado.",
      tone: "rose",
      icon: "⚠️",
      details: [
        `Cliente: ${showAlertList.clientName ?? "—"}`,
        alertObj?.message
          ? `Alerta: ${String(alertObj.message).slice(0, 140)}${String(alertObj.message).length > 140 ? "..." : ""}`
          : "Alerta: —",
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
      setClientAlerts((prev) =>
        (prev as any[]).filter((a) => a.id !== alertId),
      );

      // Atualiza a contagem na tabela principal
      loadData();
    } catch (error: any) {
      addToast("error", "Erro ao excluir", error.message);
    }
  };

  // ✅ Fecha o alerta como quitado (mantém o registro, só muda status) —
  // diferente de handleDeleteAlert, que apaga de vez.
  const handleSettleAlert = async (alertId: string) => {
    if (!tenantId) return;

    try {
      const { error } = await supabaseBrowser
        .from("client_alerts")
        .update({ status: "CLOSED", closed_at: new Date().toISOString() })
        .eq("id", alertId);

      if (error) throw error;

      setClientAlerts((prev) =>
        (prev as any[]).filter((a) => a.id !== alertId),
      );
      addToast("success", "Marcado como pago", "A pendência foi quitada.");
      loadData();
    } catch (error: any) {
      addToast("error", "Erro ao quitar", error.message);
    }
  };

  const handleOpenAlertList = async (clientId: string, clientName: string) => {
    // Limpa lista anterior e abre modal
    setClientAlerts([]);
    setToggledPaidIds(new Set());
    setShowAlertList({ open: true, clientId, clientName });

    try {
      if (!tenantId) return;

      // Busca direta no banco (com nome do app, se a pendência for vinculada)
      const { data, error } = await supabaseBrowser
        .from("client_alerts")
        .select("*, client_apps(apps(name))")
        .eq("tenant_id", tenantId)
        .eq("client_id", clientId)
        // Se quiser ver histórico, remova a linha abaixo
        .eq("status", "OPEN")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setClientAlerts(data || []);
    } catch (error: any) {
      addToast("error", "Erro ao carregar alertas", error.message);
    }
  };

  const handleSendMessage = async () => {
    if (!tenantId || !showSendNow.clientId) return;
    if (sendingNow) return; // ✅ trava double click

    const msg = (messageText || "").trim();
    if (!msg) {
      addToast(
        "error",
        "Mensagem vazia",
        "Digite uma mensagem antes de enviar.",
      );
      return;
    }

    try {
      setSendingNow(true);

      // ✅ aborta tentativa anterior (se existiu)
      if (sendNowAbortRef.current) {
        try {
          sendNowAbortRef.current.abort();
        } catch {}
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
          whatsapp_session: selectedSessionNow, // ✅ AGORA USA A SESSÃO ESCOLHIDA
          message_template_id: selectedTemplateNowId,
        }),
      });

      const raw = await res.text();
      let json: any = {};
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {}

      if (!res.ok) throw new Error(json?.error || raw || "Falha ao enviar");

      addToast(
        "success",
        "Enviado",
        "Mensagem enviada imediatamente via WhatsApp.",
      );

      setShowSendNow({ open: false, clientId: null });
      setMessageText("");
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        addToast(
          "error",
          "Falha no Envio",
          "O servidor recusou o envio da mensagem.",
        );
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
      addToast(
        "error",
        "Mensagem vazia",
        "Digite uma mensagem antes de agendar.",
      );
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
          whatsapp_session: selectedSessionSchedule, // ✅ AGORA USA A SESSÃO ESCOLHIDA
          message_template_id: selectedTemplateScheduleId,
        }),
      });

      const raw = await res.text();
      let json: any = {};
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {}

      if (!res.ok) throw new Error(json?.error || raw || "Falha ao agendar");

      addToast("success", "Agendado", "Mensagem programada com sucesso.");

      setShowScheduleMsg({ open: false, clientId: null });
      setScheduleText("");
      setScheduleDate("");

      await loadScheduledForClients(
        tenantId,
        rows.map((x) => x.id),
      );
    } catch {
      addToast(
        "error",
        "Falha no Agendamento",
        "Não foi possível registrar a mensagem na fila.",
      );
    } finally {
      setScheduling(false);
    }
  };

  function closeAllPopups() {
    setMsgMenuForId(null);
  }

  // ✅ Lógica de Interceptação da Renovação
  const handleClickRenew = async (r: ClientRow) => {
    // ✅ Trocou para async
    // Fecha menus se estiverem abertos
    setMsgMenuForId(null);

    setRenewingId(r.id); // ✅ Liga o loading giratório
    await new Promise((resolve) => setTimeout(resolve, 50)); // ✅ Dá fôlego pro React girar o ícone

    if (r.alertsCount > 0) {
      // Tem alerta? Abre o aviso primeiro
      setShowRenewWarning({ open: true, clientId: r.id, clientName: r.name });
    } else {
      // Sem alerta? Abre renovação direto (comportamento original)
      setShowRenew({ open: true, clientId: r.id, clientName: r.name });
    }

    // ✅ Segura o botão girando por mais 1.5 segundos enquanto o modal é desenhado na tela
    setTimeout(() => {
      setRenewingId(null);
    }, 3000);
  };

  return (
    <div
      className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors"
      onClick={closeAllPopups}
    >
      {/* Topo */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        {/* Título (esquerda) */}
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              Gestão de {entidadeLabel}s
            </h1>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setValuesHidden((v) => !v);
              }}
              title={valuesHidden ? "Exibir valores" : "Ocultar valores"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all text-xs font-medium shadow-sm select-none"
            >
              {valuesHidden ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              <span className="hidden sm:inline text-[11px] tracking-wide">
                {valuesHidden ? "Exibir" : "Ocultar"}
              </span>
            </button>
          </div>
        </div>

        {/* Ações (direita) */}
        <div className="flex items-center gap-2 justify-end shrink-0">
          {/* ✅ no mobile, o botão de lixeira sai daqui (vai pro filtro) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setArchivedFilter(archivedFilter === "Não" ? "Sim" : "Não");
            }}
            className={`hidden md:inline-flex h-10 px-3 rounded-lg text-xs font-medium border transition-colors items-center justify-center ${
              archivedFilter === "Sim"
                ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                : "bg-muted border-border text-muted-foreground"
            }`}
          >
            {archivedFilter === "Sim" ? "Ocultar Lixeira" : "Ver Lixeira"}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setClientToEdit(null);
              setEditInitialTab("dados");
              setShowFormModal(true);
            }}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
          >
            <span>+</span> Novo {entidadeLabel}
          </button>
        </div>
      </div>

      {/* --- BARRA DE FILTROS COMPLETA --- */}
      <div
        className="px-3 md:p-4 bg-transparent md:bg-card border-0 md:border md:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20"
        onClick={(e) => e.stopPropagation()}
      >
<div className="hidden md:block text-xs font-medium uppercase text-muted-foreground tracking-wider mb-2">
          Filtros Rápidos
        </div>

        {/* ✅ MOBILE (somente): pesquisa + botão abrir painel */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar..."
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
              >
                <IconX />
              </button>
            )}
          </div>

          <button
            onClick={() => setMobileFiltersOpen((v) => !v)}
className={`h-10 px-3 rounded-lg border font-medium text-sm transition-colors ${
              statusFilter !== "Todos" ||
              serverFilter !== "Todos" ||
              planFilter !== "Todos" ||
              dueFilter !== "Todos" ||
              archivedFilter === "Sim"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
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
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
              >
                <IconX />
              </button>
            )}
          </div>

          <div className="w-[180px]">
            <Select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "Todos" | ClientStatus)
              }
            >
              <option value="Todos">Status (Todos)</option>
              <option value="Ativo">Ativo</option>
              <option value="Vencido">Vencido</option>
            </Select>
          </div>

          <div className="w-[180px]">
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
          </div>

          <div className="w-[180px]">
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
          </div>

          <div className="w-[180px]">
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
          </div>

          {/* ✅ Select Único de Aplicativos e Vencimentos */}
          <div className="w-[190px]">
            <Select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
            >
              <option value="Todos">Aplicativos (Todos)</option>
              <option value="15_dias">Vencendo em 15 dias</option>
              <option value="30_dias">Vencendo em 30 dias</option>
              <optgroup label="Filtrar por nome">
                {Object.values(appsIndex.byId)
                  .filter((app) =>
                    // Mostra apenas se algum cliente da lista possui este aplicativo (comparando o nome)
                    rows.some((r) => r.apps && r.apps.includes(app.name)),
                  )
                  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                  .map((app) => {
                    // Verifica se tem integração para adicionar o indicador visual
                    const temIntegracao =
                      app.integration_type &&
                      app.integration_type !== "SEM_INTEGRACAO";
                    const intLabel =
                      app.integration_type === "GERENCIAAPP"
                        ? "GerenciaApp"
                        : app.integration_type === "DUPLECAST"
                          ? "DupleCast"
                          : app.integration_type === "IBOSOL"
                            ? "IBO Sol"
                            : app.integration_type === "IBOPRO"
                              ? "IBO Pro"
                              : app.integration_type;
                    const label = temIntegracao
                      ? `⚡ ${app.name} (${intLabel})`
                      : app.name;

                    return (
                      <option key={app.id} value={app.name}>
                        {label}
                      </option>
                    );
                  })}
              </optgroup>
            </Select>
          </div>

          <button
            onClick={() => {
              // Limpa filtros
              setSearch("");
              setStatusFilter("Todos");
              setServerFilter("Todos");
              setPlanFilter("Todos");
              setDueFilter("Todos");
              setAppFilter("Todos");
              setArchivedFilter("Não");

              // ✅ RESETA ORDENAÇÃO
              setSortKey("due");
              setSortDir("asc");
              setIsDefaultSort(true);
            }}
            className="h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <IconX /> Limpar
          </button>
        </div>

        {/* ✅ Painel de filtros no mobile */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-3 p-3 rounded-xl border border-border bg-transparent space-y-2">
            {/* ✅ Filtrar Lixeira (opção dentro do painel) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setArchivedFilter((cur) => (cur === "Não" ? "Sim" : "Não"));
              }}
className={`w-full h-10 px-3 rounded-lg text-sm font-medium border transition-colors flex items-center justify-between ${
                archivedFilter === "Sim"
                  ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                  : "bg-muted border-border text-muted-foreground"
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
              onChange={(e) =>
                setStatusFilter(e.target.value as "Todos" | ClientStatus)
              }
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

            {/* ✅ Filtro Único de Aplicativos no Mobile */}
            <Select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
            >
              <option value="Todos">Aplicativos (Todos)</option>
              <option value="15_dias">Vencendo em 15 dias</option>
              <option value="30_dias">Vencendo em 30 dias</option>
              <optgroup label="Filtrar por nome">
                {Object.values(appsIndex.byId)
                  .filter((app) =>
                    rows.some((r) => r.apps && r.apps.includes(app.name)),
                  )
                  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                  .map((app) => {
                    const temIntegracao =
                      app.integration_type &&
                      app.integration_type !== "SEM_INTEGRACAO";
                    const intLabel =
                      app.integration_type === "GERENCIAAPP"
                        ? "GerenciaApp"
                        : app.integration_type === "DUPLECAST"
                          ? "DupleCast"
                          : app.integration_type === "IBOSOL"
                            ? "IBO Sol"
                            : app.integration_type === "IBOPRO"
                              ? "IBO Pro"
                              : app.integration_type;
                    const label = temIntegracao
                      ? `⚡ ${app.name} (${intLabel})`
                      : app.name;
                    return (
                      <option key={app.id} value={app.name}>
                        {label}
                      </option>
                    );
                  })}
              </optgroup>
            </Select>

            {/* ✅ Limpar */}
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("Todos");
                setServerFilter("Todos");
                setPlanFilter("Todos");
                setDueFilter("Todos");
                setAppFilter("Todos");
                setArchivedFilter("Não");

                // ✅ RESETA ORDENAÇÃO
                setSortKey("due");
                setSortDir("asc");
                setIsDefaultSort(true);

                setMobileFiltersOpen(false);
              }}
              className="w-full h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
            >
              <IconX /> Limpar
            </button>
          </div>
        )}
      </div>

      {loading && (
<div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-none sm:rounded-xl border border-border">
          Carregando dados...
        </div>
      )}

      {!loading && (
        <div
          className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-border bg-transparent">
            <div className="text-sm font-medium tracking-tight text-foreground whitespace-nowrap">
              Lista de Clientes
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium">
                {filtered.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[250px]">
              <thead>
<tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
                  <Th width={40}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={
                        visible.length > 0 &&
                        visible.every((r) => selectedIds.has(r.id))
                      }
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setAllVisible(e.target.checked)}
                      className="rounded border-border bg-transparent"
                    />
                  </Th>
                  <ThSort
                    label="Cliente"
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                  />
                  <ThSort
                    label="Vencimento"
                    active={sortKey === "due"}
                    dir={sortDir}
                    onClick={() => toggleSort("due")}
                  />
                  <Th align="center">
                    <SortClick
                      label="Status"
                      active={sortKey === "status"}
                      dir={sortDir}
                      onClick={() => toggleSort("status")}
                    />
                  </Th>
                  <Th align="center">
                    <SortClick
                      label="Servidor"
                      active={sortKey === "server"}
                      dir={sortDir}
                      onClick={() => toggleSort("server")}
                    />
                  </Th>
                  <Th align="center">
                    <SortClick
                      label="Tecnologia"
                      active={sortKey === "technology"}
                      dir={sortDir}
                      onClick={() => toggleSort("technology")}
                    />
                  </Th>
                  <Th align="center">
                    <SortClick
                      label="Telas"
                      active={sortKey === "screens"}
                      dir={sortDir}
                      onClick={() => toggleSort("screens")}
                    />
                  </Th>
                  <Th align="center">
                    <SortClick
                      label="Plano"
                      active={sortKey === "plan"}
                      dir={sortDir}
                      onClick={() => toggleSort("plan")}
                    />
                  </Th>
                  <Th align="center">
                    <SortClick
                      label="Valor"
                      active={sortKey === "value"}
                      dir={sortDir}
                      onClick={() => toggleSort("value")}
                    />
                  </Th>
                  <Th align="center">
                    <SortClick
                      label="Aplicativos"
                      active={sortKey === "apps"}
                      dir={sortDir}
                      onClick={() => toggleSort("apps")}
                    />
                  </Th>
                  <Th align="center">Ações</Th>
                </tr>
              </thead>

              <tbody className="text-sm divide-y divide-border">
                {visible.map((r) => {
                  const isExpired = r.status === "Vencido";
                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors group ${
                        selectedIds.has(r.id)
                          ? "bg-emerald-500/10"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <Td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            toggleSelected(r.id, e.target.checked)
                          }
                          className="rounded border-border bg-transparent"
                        />
                      </Td>

                      <Td>
                        <div className="flex flex-col max-w-[180px] sm:max-w-none">
                          {" "}
                          {/* Limite opcional no mobile se quiser truncar nomes gigantes */}
                          {/* Alterado: Adicionado whitespace-nowrap para impedir que ícones quebrem a linha */}
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <Link
                              href={`/admin/cliente/${r.id}`}
                              className="font-semibold text-foreground/90 group-hover:text-emerald-400 transition-colors hover:underline decoration-emerald-500/30 underline-offset-2 cursor-pointer truncate"
                            >
                              {r.name.split(" ")[0]}
                              {r.secondary_display_name ? (
                                <span className="text-muted-foreground/60 font-medium">
                                  {" "}
                                  / {r.secondary_display_name.split(" ")[0]}
                                </span>
                              ) : null}
                            </Link>

                            {/* Adicionado shrink-0 para garantir que os ícones nunca sejam esmagados */}
                            <div className="flex items-center gap-1 shrink-0">
                              {r.alertsCount > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenAlertList(r.id, r.name);
                                  }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-500 border border-amber-500/20 text-[10px] font-medium hover:bg-amber-500/30 transition-colors animate-pulse"
                                  title="Ver alertas pendentes"
                                >
                                  🔔 {r.alertsCount}
                                </button>
                              )}

                              {(scheduledMap[r.id]?.length || 0) > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowScheduledModal({
                                      open: true,
                                      clientId: r.id,
                                      clientName: r.name,
                                    });
                                  }}
                                  // Alterado: Adicionado 'animate-pulse' no final das classes
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-500 border border-purple-500/30 text-[10px] font-medium hover:bg-purple-500/30 transition-colors animate-pulse"
                                  title="Ver mensagens programadas"
                                >
                                  🗓️ {scheduledMap[r.id].length}
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Alterado: Username agora com font-medium e cor mais forte (slate-500 ao invés de 400) */}
                          <span
                            className={`text-xs font-medium text-muted-foreground truncate transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                          >
                            {r.username}
                          </span>
                          {r.whatsapp_username && (
                            <span
                              className={`text-xs font-medium text-emerald-500/80 truncate transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                            >
                              @{r.whatsapp_username}
                            </span>
                          )}
{r.secondary_whatsapp_username && (
                            <span
                              className={`text-xs font-medium text-muted-foreground/60 truncate transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                            >
                              @{r.secondary_whatsapp_username}
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground/90">
                            {r.dueLabelDate}
                          </span>

                          <span className="text-xs font-medium text-muted-foreground">
                            {r.dueTime}
                          </span>
                        </div>
                      </Td>

                      <Td align="center">
                        {(() => {
                          const diff = getDiffDays(r.dueISODate);
                          let label: string = r.status;

                          // 1. A sua regra exata de cálculo de dias
                          let textDiff = "";
                          if (diff < -2)
                            textDiff = `Venceu há ${Math.abs(diff)} dias`;
                          else if (diff === -2) textDiff = "Venceu há 2 dias";
                          else if (diff === -1) textDiff = "Venceu Ontem";
                          else if (diff === 0) textDiff = "Vence Hoje";
                          else if (diff === 1) textDiff = "Vence Amanhã";
                          else if (diff === 2) textDiff = "Vence em 2 dias";
                          else if (diff > 2)
                            textDiff = `Vence em ${Math.abs(diff)} dias`;

                          // 2. Aplicação do texto
                          if (r.status === "Arquivado") {
                            // Ex: Lixeira (Venceu há 36 dias)
                            label = textDiff
                              ? `Lixeira (${textDiff})`
                              : "Lixeira";
                          } else if (r.status !== "Teste") {
                            label = textDiff || label;
                          }

                          // 3. Lógica de Cor
                          let colorTone: "green" | "red" | "amber" | "blue" =
                            "blue";

                          if (r.status === "Vencido") {
                            colorTone = "red";
                          } else if (r.status === "Ativo") {
                            if (diff === 0) colorTone = "amber";
                            else colorTone = "green";
                          } else if (r.status === "Arquivado") {
                            colorTone = "red"; // Mantém vermelho para alerta de exclusão
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

                      <Td align="center">
                        <span className="text-muted-foreground">
                          {r.server}
                        </span>
                      </Td>

                      <Td align="center">
                        {(() => {
                          const tech = r.technology || "";
                          const t = tech.toUpperCase();
                          const colors = t === "IPTV" 
                            ? "bg-sky-500/10 text-sky-500 border-sky-500/20" 
                            : t === "P2P" 
                            ? "bg-rose-500/10 text-rose-500 border-rose-500/20" 
                            : "bg-muted text-muted-foreground border-border";
                          return (
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium tracking-tight shadow-sm uppercase ${colors}`}>
                              {r.technology || "—"}
                            </span>
                          );
                        })()}
                      </Td>

                      <Td align="center">
                        <span className="text-muted-foreground">
                          {r.screens}
                        </span>
                      </Td>

                      <Td align="center">
                        <span className="text-muted-foreground">
                          {r.planPeriod}
                        </span>
                      </Td>

                      <Td align="center">
                        <span
                          className={`font-medium text-foreground/90 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                        >
                          {r.valueLabel}
                        </span>
                      </Td>

                      <Td align="center">
                        <div className="flex flex-wrap gap-1 justify-center max-w-[200px] sm:max-w-[400px] mx-auto">
                          {r.apps && r.apps.length > 0 ? (
                            r.apps.map((app, i) => {
                              const catApp = appsIndex.byName[
                                normAppKey(app)
                              ] as any;

                              // ✅ Vencimento: busca a primeira instância deste app com data
                              // Para clientes com o mesmo app múltiplas vezes, usa a N-ésima ocorrência correta
                              const prevCount = r.apps
                                .slice(0, i)
                                .filter((n) => n === app).length;
                              let matchCount = 0;
                              const matchedData =
                                r.appsData?.find((a) => {
                                  if (a.name !== app) return false;
                                  if (matchCount === prevCount) return true;
                                  matchCount++;
                                  return false;
                                }) ?? null;
                              const appExpiry =
                                matchedData?.expire_date ?? null;
                              const appDiffDays = appExpiry
                                ? getDiffDays(appExpiry)
                                : null;
                              const appIsExpiring =
                                appDiffDays !== null && appDiffDays <= 30;

                              return (
                                <button
                                  key={`${app}-${i}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditById(r.id, "apps");
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-[10px] font-medium tracking-tight shadow-sm hover:bg-emerald-500/20 active:scale-95 transition-all max-w-[170px] truncate"
                                  title={`Configurar aplicativo: ${app}`}
                                >
                                  <span className="truncate flex-1 min-w-0 text-left">
                                    {app}
                                  </span>

                                  {/* Ícone da Integração (Azul) */}
                                  {catApp?.integration_type &&
                                    catApp.integration_type !==
                                      "SEM_INTEGRACAO" && (
                                      <span
                                        className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded bg-sky-500/20 border border-sky-500/30 text-sky-400"
                                        title={
                                          catApp.integration_type ===
                                          "GERENCIAAPP"
                                            ? "GerenciaApp"
                                            : catApp.integration_type ===
                                                "DUPLECAST"
                                              ? "Duplecast"
                                              : catApp.integration_type ===
                                                  "IBOSOL"
                                                ? "Ibo Sol"
                                                : catApp.integration_type ===
                                                    "IBOPRO"
                                                  ? "Ibo Pro"
                                                  : catApp.integration_type
                                        }
                                      >
                                        <svg
                                          width="8"
                                          height="8"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2.5"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                                          />
                                        </svg>
                                      </span>
                                    )}

                                  {/* ✅ Ícone de Vencimento do App (Rose) */}
                                  {appIsExpiring && (
                                    <span
                                      className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded bg-rose-500/20 border border-rose-500/20 text-rose-400 animate-pulse"
                                      title={
                                        appDiffDays! < 0
                                          ? "Vencido no painel"
                                          : `App vence em ${appDiffDays} dias`
                                      }
                                    >
                                      <Clock className="w-4 h-4" />
                                    </span>
                                  )}
                                </button>
                              );
                            })
                         ) : (
                            <span className="text-muted-foreground/60 text-xs italic">
                              —
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td align="right">
                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 relative">
                          <div className="relative">
                            <IconActionBtn
                              title="Mensagem"
                              tone="blue"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMsgMenuForId((cur) =>
                                  cur === r.id ? null : r.id,
                                );
                              }}
                            >
                              <IconChat />
                            </IconActionBtn>

                            {msgMenuForId === r.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card z-50 shadow-2xl overflow-hidden"
                              >
                                <MenuItem
                                  icon={<IconSend />}
                                  label="Enviar agora"
                                  onClick={() => {
                                    setMsgMenuForId(null);
                                    setSelectedTemplateNowId("");
                                    setMessageText("");
                                    setShowSendNow({
                                      open: true,
                                      clientId: r.id,
                                    });
                                    ensureMessagingDataLoaded(); // ✅ NOVO
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
                                    setShowScheduleMsg({
                                      open: true,
                                      clientId: r.id,
                                    });
                                    ensureMessagingDataLoaded(); // ✅ NOVO
                                  }}
                                />
                              </div>
                            )}
                          </div>

                          <IconActionBtn
                            title="Renovar"
                            tone="green"
                            loading={renewingId === r.id} // ✅ Adicionado loading
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClickRenew(r);
                            }}
                          >
                            <IconMoney />
                          </IconActionBtn>

                          <IconActionBtn
                            title="Editar"
                            tone="amber"
                            loading={editingId === r.id} // ✅ Adicionado loading
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(r, "dados");
                            }}
                          >
                            <IconEdit />
                          </IconActionBtn>

                          <IconActionBtn
                            title="Novo alerta"
                            tone="purple"
                            onClick={(e) => {
                              e.stopPropagation();
                              resetNewAlertForm();
                              setShowNewAlert({
                                open: true,
                                clientId: r.id,
                                clientName: r.name,
                              });
                            }}
                          >
                            <IconBell />
                          </IconActionBtn>

                          <IconActionBtn
                            title={r.archived ? "Restaurar" : "Arquivar"}
                            tone={r.archived ? "green" : "red"}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchiveToggle(r);
                            }}
                          >
                            {r.archived ? <IconRestore /> : <IconTrash />}
                          </IconActionBtn>

                          {/* ✅ Excluir definitivo (somente quando estiver VISUALIZANDO a Lixeira) */}
                          {archivedFilter === "Sim" && r.archived && (
                            <IconActionBtn
                              title="Excluir definitivamente"
                              tone="red"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteForever(r);
                              }}
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
                    <td
                      colSpan={11}
className="p-8 text-center text-muted-foreground italic"
                    >
                      Nenhum cliente encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* ✅ espaço fixo depois do último cliente (para popups/menus não serem cortados) */}
            <div className="h-24 md:h-20" />
          </div>

          {/* --- RODAPÉ: Paginação --- */}
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            pageSizeOptions={[50, 100, 200]}
          />
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
        <Modal
          title="⚠️ Cliente com Alertas"
          onClose={() =>
            setShowRenewWarning({ open: false, clientId: null, clientName: "" })
          }
        >
          <div className="space-y-6">
            <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg flex gap-3">
              <span className="text-2xl">📢</span>
              <div>
<p className="text-foreground/90 text-sm font-medium">
                  O cliente{" "}
                  <strong className="text-amber-400">
                    {showRenewWarning.clientName}
                  </strong>{" "}
                  possui pendências/alertas em aberto.
                </p>
                <p className="text-foreground/70 text-xs mt-1">
                  Recomendamos verificar os alertas antes de realizar a
                  renovação para evitar problemas.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  const { clientId, clientName } = showRenewWarning;
                  setShowRenewWarning({
                    open: false,
                    clientId: null,
                    clientName: "",
                  });
                  // Abre a lista de alertas para checar
                  if (clientId) handleOpenAlertList(clientId, clientName);
                }}
                className="px-4 py-2 rounded-lg border border-border text-foreground/90 font-medium hover:bg-muted transition-colors text-xs uppercase"
              >
                Ver Alertas
              </button>

              <button
                onClick={() => {
                  const { clientId, clientName } = showRenewWarning;
                  setShowRenewWarning({
                    open: false,
                    clientId: null,
                    clientName: "",
                  });
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
          key={showRenew.clientId} // ✅ força reset interno quando troca cliente
          clientId={showRenew.clientId}
          clientName={showRenew.clientName || "Cliente"}
          onClose={() =>
            setShowRenew({ open: false, clientId: null, clientName: undefined })
          }
          onSuccess={() => {
            // ✅ 1) fecha o modal primeiro
            setShowRenew({
              open: false,
              clientId: null,
              clientName: undefined,
            });

            // ✅ 2) só depois recarrega os dados da tabela
            setTimeout(async () => {
              await loadData();
            }, 0);
          }}
        />
      )}

      {showNewAlert.open && (
        <Modal
          title={editingAlertId ? "Editar Alerta" : "Novo Alerta"}
          onClose={resetNewAlertForm}
        >
          <div className="space-y-4">
            <div className="bg-purple-500/10 border border-purple-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">🔔</span>
              <div className="text-sm text-foreground/90">
                {editingAlertId
                  ? "Editando alerta de"
                  : newAlertKind
                    ? "Para"
                    : "Adicionando alerta para"}{" "}
                <strong>{showNewAlert.clientName}</strong>
              </div>
            </div>

            {newAlertKind === null && (
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setNewAlertKind("app_charge");
                    // ✅ Normalmente cadastra na hora que ativa o app
                    setNewAlertActivationDate(isoDateInSaoPaulo());
                    if (showNewAlert.clientId)
                      loadClientAppsForAlert(showNewAlert.clientId);
                  }}
                  className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xl">📱</span>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      Pendência de aplicativo
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ativou um app e o cliente ainda não pagou por ele.
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setNewAlertKind("generic_charge")}
                  className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xl">💰</span>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      Pendência qualquer
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Outro valor em aberto (ex: pagou a menos numa
                      renovação).
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setNewAlertKind("note")}
                  className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xl">📝</span>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      Alerta normal
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Só um lembrete/observação, sem valor.
                    </div>
                  </div>
                </button>
              </div>
            )}

            {newAlertKind === "app_charge" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Aplicativo
                  </label>
                  <select
                    value={newAlertClientAppId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setNewAlertClientAppId(id);
                      const app = clientAppsForAlert.find((a) => a.id === id);
                      if (app?.licensePrice != null) {
                        setNewAlertAmount(String(app.licensePrice));
                      }
                      setNewAlertText(
                        buildAppChargeMessage(
                          app?.appName ?? "",
                          newAlertActivationDate,
                        ),
                      );
                    }}
                    disabled={loadingClientAppsForAlert}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                  >
                    <option value="">
                      {loadingClientAppsForAlert
                        ? "Carregando..."
                        : "Selecionar..."}
                    </option>
                    {clientAppsForAlert.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.appName}
                        {a.costType === "paid" ? "" : " (não pago)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Valor
                    </label>
                    <input
                      value={newAlertAmount}
                      onChange={(e) => setNewAlertAmount(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Moeda
                    </label>
                    <select
                      value={newAlertCurrency}
                      onChange={(e) => setNewAlertCurrency(e.target.value)}
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    >
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Data de ativação (opcional)
                  </label>
                  <input
                    type="date"
                    value={newAlertActivationDate}
                    onChange={(e) => {
                      const date = e.target.value;
                      setNewAlertActivationDate(date);
                      const app = clientAppsForAlert.find(
                        (a) => a.id === newAlertClientAppId,
                      );
                      if (app) {
                        setNewAlertText(
                          buildAppChargeMessage(app.appName, date),
                        );
                      }
                    }}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Observação
                  </label>
                  <textarea
                    value={newAlertText}
                    onChange={(e) => setNewAlertText(e.target.value)}
                    className="w-full bg-transparent border border-border rounded-xl p-3 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[70px] text-sm resize-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Corrige se estiver errado.
                  </p>
                </div>
              </div>
            )}

            {newAlertKind === "generic_charge" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Descrição da pendência
                  </label>
                  <textarea
                    value={newAlertText}
                    onChange={(e) => setNewAlertText(e.target.value)}
                    className="w-full bg-transparent border border-border rounded-xl p-3 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[90px] text-sm resize-none"
                    placeholder="Ex: pagou R$20 a menos na última renovação"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Valor
                    </label>
                    <input
                      value={newAlertAmount}
                      onChange={(e) => setNewAlertAmount(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Moeda
                    </label>
                    <select
                      value={newAlertCurrency}
                      onChange={(e) => setNewAlertCurrency(e.target.value)}
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    >
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {newAlertKind === "note" && (
              <textarea
                value={newAlertText}
                onChange={(e) => setNewAlertText(e.target.value)}
                className="w-full bg-transparent border border-border rounded-xl p-4 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[120px] text-sm resize-none"
                placeholder="Descreva o alerta deste cliente..."
                autoFocus
              />
            )}

            {newAlertKind !== null && (
              <div className="flex justify-between gap-3 pt-2">
                <button
                  onClick={() => setNewAlertKind(null)}
                  className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
                >
                  ← Voltar
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={resetNewAlertForm}
                    className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveAlert}
                    className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 shadow-lg shadow-purple-900/20 text-sm transition-all"
                  >
                    {editingAlertId ? "Atualizar" : "Salvar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {showScheduledModal.open && showScheduledModal.clientId && (
        <ScheduledMessagesModal
          tenantId={tenantId!}
          clientId={showScheduledModal.clientId}
          clientName={showScheduledModal.clientName || "Cliente"}
          items={scheduledMap[showScheduledModal.clientId] || []}
          onClose={() =>
            setShowScheduledModal({
              open: false,
              clientId: null,
              clientName: undefined,
            })
          }
          onDeleted={async () => {
            if (tenantId)
              await loadScheduledForClients(
                tenantId,
                rows.map((x) => x.id),
              );
          }}
          addToast={addToast}
        />
      )}

      {showAlertList.open && (
        <Modal
          title={`Alertas: ${showAlertList.clientName}`}
          onClose={() => setShowAlertList({ open: false, clientId: null })}
        >
          <div className="space-y-4">
            <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
              {(clientAlerts as any[]).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/60 border-2 border-dashed border-border rounded-xl">
                  <span className="text-2xl mb-2">✅</span>
                  <p className="text-sm">Nenhum alerta pendente.</p>
                </div>
              ) : (
                (clientAlerts as any[]).map((alert) => {
                  const hasAmount = alert.amount != null;
                  const appName = alert.client_apps?.apps?.name as
                    | string
                    | undefined;
                  const isToggledPaid = toggledPaidIds.has(String(alert.id));

                  return (
                    <div
                      key={alert.id}
                      className="group p-4 bg-muted/50 border border-border rounded-xl shadow-sm hover:border-rose-500/20 transition-all flex justify-between items-center gap-4"
                    >
                      <div className="flex gap-3">
                        <span className="text-rose-500 mt-0.5">
                          {hasAmount ? "💰" : "⚠️"}
                        </span>
                        <div>
                          {hasAmount && (
                            <div className="text-sm font-bold text-foreground mb-0.5">
                              {
                                formatMoney(
                                  Number(alert.amount),
                                  alert.currency || "BRL",
                                ).label
                              }
                              {appName && (
                                <span className="ml-1.5 font-normal text-xs text-muted-foreground">
                                  · {appName}
                                </span>
                              )}
                            </div>
                          )}
                          <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                            {alert.message || ""}
                          </p>
                          {alert.activation_date && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              Ativado em{" "}
                              {new Date(
                                `${alert.activation_date}T12:00:00`,
                              ).toLocaleDateString("pt-BR")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasAmount && (
                          <IconActionBtn
                            title={
                              isToggledPaid
                                ? "Pago (clique em Salvar pra confirmar)"
                                : "Marcar como pago"
                            }
                            tone={isToggledPaid ? "green" : "blue"}
                            onClick={() =>
                              setToggledPaidIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(String(alert.id)))
                                  next.delete(String(alert.id));
                                else next.add(String(alert.id));
                                return next;
                              })
                            }
                          >
                            {isToggledPaid ? (
                              <IconThumbsUp />
                            ) : (
                              <IconThumbsDown />
                            )}
                          </IconActionBtn>
                        )}
                        {isToggledPaid ? (
                          <button
                            onClick={() => {
                              handleSettleAlert(alert.id);
                              setToggledPaidIds((prev) => {
                                const next = new Set(prev);
                                next.delete(String(alert.id));
                                return next;
                              });
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-colors"
                          >
                            Salvar
                          </button>
                        ) : (
                          <>
                            <IconActionBtn
                              title="Editar"
                              tone="amber"
                              onClick={() =>
                                openEditAlert(
                                  alert,
                                  showAlertList.clientId || "",
                                  showAlertList.clientName || "",
                                )
                              }
                            >
                              <IconEdit />
                            </IconActionBtn>
                            <IconActionBtn
                              title="Excluir"
                              tone="red"
                              onClick={() => handleDeleteAlert(alert.id)}
                            >
                              <IconTrash />
                            </IconActionBtn>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end border-t border-border pt-4">
              <button
                onClick={() =>
                  setShowAlertList({ open: false, clientId: null })
                }
                className="px-6 py-2 rounded-lg bg-transparent text-foreground/90 font-medium hover:bg-muted transition-colors text-sm"
              >
                Fechar Lista
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* --- MODAL DE ENVIO DE MENSAGEM --- */}
      {showSendNow.open && (
        <Modal
          title="Enviar Mensagem Rápida"
          onClose={() => {
            setShowSendNow({ open: false, clientId: null });
            setSelectedTemplateNowId("");
            setMessageText("");
            setSelectedSessionNow("default"); // ✅ Reseta a sessão ao fechar
          }}
        >
          <div className="space-y-4">
            <div className="bg-sky-500/10 border border-sky-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">
                <MessageCircle className="w-4 h-4" />
              </span>
              <div className="text-sm text-foreground/90">
                Esta mensagem será enviada <strong>imediatamente</strong> via
                WhatsApp.
              </div>
            </div>

            {/* ✅ Select da Sessão WhatsApp */}
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Sessão WhatsApp
              </label>
              <select
                value={selectedSessionNow}
                onChange={(e) => setSelectedSessionNow(e.target.value)}
                className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none focus:border-sky-500 transition-colors text-sm font-medium"
              >
                {sessionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* ✅ Select de template (opcional) */}
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
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
                className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none focus:border-sky-500 transition-colors text-sm"
              >
                <option value="">Selecionar...</option>
                {Object.entries(
                  messageTemplates
                    // ✅ Filtros removidos: Você vê todas as categorias agora.
                    .reduce(
                      (acc, t) => {
                        const cat = t.category || "Geral";
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(t);
                        return acc;
                      },
                      {} as Record<string, typeof messageTemplates>,
                    ),
                ).map(([catName, tmpls]) => (
                  // 3. Renderiza o separador visual
                  <optgroup key={catName} label={`— ${catName} —`}>
                    {tmpls.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* ✅ PREVIEW DA IMAGEM DO TEMPLATE (ENVIO AGORA) */}
            {(() => {
              const tpl = messageTemplates.find(
                (t) => t.id === selectedTemplateNowId,
              );
              if (!tpl?.image_url) return null;
              return (
                <div className="mb-2 animate-in fade-in zoom-in-95 duration-200">
                  <span className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Imagem Anexada
                  </span>
                  <div className="w-24 h-24 rounded-lg overflow-hidden border border-border shadow-sm relative bg-transparent">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={tpl.image_url}
                      alt="Anexo do template"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              );
            })()}

            <textarea
              value={messageText}
              disabled={!!selectedTemplateNowId}
              onChange={(e) => {
                // digitou manual = limpa template
                if (selectedTemplateNowId) setSelectedTemplateNowId("");
                setMessageText(e.target.value);
              }}
              className="w-full bg-transparent border border-border rounded-xl p-4 text-foreground outline-none focus:border-sky-500 transition-colors min-h-[120px] text-sm resize-none disabled:opacity-70"
              placeholder="Olá, gostaria de informar que..."
              autoFocus
            />

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowSendNow({ open: false, clientId: null })}
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
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
        <Modal
          title="Agendar Mensagem"
          onClose={() => {
            setShowScheduleMsg({ open: false, clientId: null });
            setSelectedTemplateScheduleId("");
            setScheduleText("");
            setScheduleDate("");
            setSelectedSessionSchedule("default"); // ✅ Reseta a sessão ao fechar
          }}
        >
          <div className="space-y-5">
            <div className="bg-purple-500/10 border border-purple-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">📅</span>
              <div className="text-sm text-foreground/90">
                Programe avisos ou cobranças para o futuro.
              </div>
            </div>

            {/* ✅ Select da Sessão WhatsApp */}
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Sessão WhatsApp
              </label>
              <select
                value={selectedSessionSchedule}
                onChange={(e) => setSelectedSessionSchedule(e.target.value)}
                className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none focus:border-purple-500 transition-colors text-sm font-medium"
              >
                {sessionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Data e Hora do Envio
              </label>
              <FormattedDateInput
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="h-11 rounded-xl focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Conteúdo da Mensagem
              </label>
              {/* ✅ Select de template (opcional) */}
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
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
                  className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none focus:border-purple-500 transition-colors text-sm mb-3"
                >
                  <option value="">
                    Selecionar mensagem pronta (opcional)...
                  </option>
                  {Object.entries(
                    messageTemplates

                      // 2. Agrupa por categoria
                      .reduce(
                        (acc, t) => {
                          const cat = t.category || "Geral";
                          if (!acc[cat]) acc[cat] = [];
                          acc[cat].push(t);
                          return acc;
                        },
                        {} as Record<string, typeof messageTemplates>,
                      ),
                  ).map(([catName, tmpls]) => (
                    // 3. Renderiza o separador visual
                    <optgroup key={catName} label={`— ${catName} —`}>
                      {tmpls.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* ✅ PREVIEW DA IMAGEM DO TEMPLATE (AGENDAMENTO) */}
              {(() => {
                const tpl = messageTemplates.find(
                  (t) => t.id === selectedTemplateScheduleId,
                );
                if (!tpl?.image_url) return null;
                return (
                  <div className="mb-2 animate-in fade-in zoom-in-95 duration-200">
                    <span className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Imagem Anexada
                    </span>
                    <div className="w-24 h-24 rounded-lg overflow-hidden border border-border shadow-sm relative bg-transparent">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={tpl.image_url}
                        alt="Anexo do template"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                );
              })()}

              <textarea
                value={scheduleText}
                disabled={!!selectedTemplateScheduleId}
                onChange={(e) => {
                  if (selectedTemplateScheduleId)
                    setSelectedTemplateScheduleId("");
                  setScheduleText(e.target.value);
                }}
                className="w-full bg-transparent border border-border rounded-xl p-4 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[120px] text-sm resize-none disabled:opacity-70"
                placeholder="Ex: Olá, seu plano vence amanhã..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() =>
                  setShowScheduleMsg({ open: false, clientId: null })
                }
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleScheduleMessage}
                disabled={scheduling}
                className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 shadow-lg shadow-purple-900/20 flex items-center gap-2 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconClock />{" "}
                {scheduling ? "Agendando..." : "Confirmar Agendamento"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {ConfirmUI}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

export default function ClientePage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-muted-foreground animate-pulse">
          Carregando...
        </div>
      }
    >
      <ClientePageContent />
    </Suspense>
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
      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
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

function Th({
  children,
  width,
  align = "left",
}: {
  children: React.ReactNode;
  width?: number;
  align?: "left" | "right" | "center";
}) {
  return (
    <th className={`px-3 py-2 ${ALIGN_CLASS[align]}`} style={{ width }}>
      {children}
    </th>
  );
}

function ThSort({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="px-3 py-2 cursor-pointer select-none group hover:text-emerald-500 transition-colors text-left"
    >
      <div className="flex items-center gap-1">
        {label}
        <span
          className={`transition-opacity ${active ? "opacity-100 text-emerald-500" : "opacity-40 group-hover:opacity-70"}`}
        >
          {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
        </span>
      </div>
    </th>
  );
}

// ✅ Componente auxiliar para cabeçalhos centralizados clicáveis (já que ThSort é fixo a esquerda)
function SortClick({
  label,
  onClick,
  active,
  dir,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    // ✅ Alterado: 'justify-center' puro e gap menor para garantir alinhamento visual com a coluna
    <div
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1 cursor-pointer select-none hover:text-emerald-500 transition-colors"
    >
      <span className="font-medium uppercase text-xs tracking-wide">{label}</span>
      {/* Ícone condicional para não empurrar o texto quando inativo (opcional, mas ajuda na centralização visual exata) */}
      <span
        className={`transition-opacity flex items-center ${active ? "opacity-100 text-emerald-400" : "opacity-30"}`}
      >
        {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
      </span>
    </div>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  let alignClass = "text-left";
  if (align === "right") alignClass = "text-right";
  if (align === "center") alignClass = "text-center";

  return <td className={`px-3 py-2 ${alignClass} align-middle`}>{children}</td>;
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
  addToast: (
    type: "success" | "error",
    title: string,
    message?: string,
  ) => void;
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
        it?.message
          ? `Mensagem: "${it.message.slice(0, 50)}${it.message.length > 50 ? "..." : ""}"`
          : "",
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

      addToast(
        "success",
        "Agendamento cancelado",
        "A mensagem foi removida da fila de envios.",
      );
      await onDeleted();
      // Não fecha o modal (onClose) para permitir excluir outros se quiser
    } catch (e: any) {
      addToast("error", "Erro ao excluir", e?.message || "Erro desconhecido");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Modal title={`Mensagens Programadas • ${clientName}`} onClose={onClose}>
        {items.length === 0 ? (
<div className="flex flex-col items-center justify-center py-8 text-muted-foreground/60 border-2 border-dashed border-border rounded-xl">
            <span className="text-2xl mb-2">🗓️</span>
            <p className="text-sm">Nenhum agendamento encontrado.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {items.map((it) => (
              <div
                key={it.id}
                className="p-4 rounded-xl border border-border bg-muted/30 transition hover:border-purple-500/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted px-2 py-0.5 rounded border border-border">
                        // ✅ PARA — extrai via formatToParts (mesma lógica)
                        {(() => {
                          const dt = new Date(it.send_at);
                          const parts = new Intl.DateTimeFormat("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          }).formatToParts(dt);
                          const get = (type: string) =>
                            parts.find((p) => p.type === type)?.value ?? "";
                          return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}`;
                        })()}
                      </div>

                      {it.status && (
<span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-500 text-[9px] font-medium uppercase tracking-wider">
                          {it.status}
                        </span>
                      )}
                    </div>

<div className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed border-l-2 border-border pl-3">
                      {it.message}
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(it.id)}
                    disabled={deletingId === it.id}
                    className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Excluir agendamento"
                  >
                    {deletingId === it.id ? (
                      <span className="animate-spin">
                        <Timer className="w-4 h-4" />
                      </span>
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
  customTone,
}: {
  status: string;
  customLabel?: string;
  customTone?: "green" | "red" | "amber" | "blue";
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

  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    sky: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium uppercase tracking-tight shadow-sm whitespace-nowrap ${colorMap[color] ?? colorMap.sky}`}
    >
      {customLabel || status}
    </span>
  );
}

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
  loading = false,
}: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void;
  loading?: boolean;
}) {
  const colors = {
    blue: "text-sky-500 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20",
    green: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber: "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    purple: "text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  };
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!loading) onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]} ${loading ? "opacity-70 cursor-wait" : ""}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : children}
    </button>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full px-4 py-2.5 flex items-center gap-3 text-muted-foreground hover:bg-muted hover:text-emerald-500 transition-all text-left text-sm font-medium tracking-tight rounded-lg"
    >
      <span className="opacity-70 group-hover:scale-110 transition-transform">
        {icon}
      </span>
      {label}
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center p-4 z-[99999]"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-transparent">
          <div className="font-medium text-foreground">
            {title}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconX />
          </button>
        
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// --- ICONES ---
function IconX() {
  return <X className="w-4 h-4" />;
}
function IconSortUp() {
  return <ChevronUp className="w-3 h-3" />;
}
function IconSortDown() {
  return <ChevronDown className="w-3 h-3" />;
}
function IconChat() {
  return <MessageCircle className="w-4 h-4" />;
}
function IconSend() {
  return <Send className="w-4 h-4" />;
}
function IconClock() {
  return <Clock className="w-4 h-4" />;
}
function IconMoney() {
  return <CreditCard className="w-4 h-4" />;
}
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconBell() {
  return <Bell className="w-4 h-4" />;
}
function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
function IconThumbsUp() {
  return <ThumbsUp className="w-4 h-4" />;
}
function IconThumbsDown() {
  return <ThumbsDown className="w-4 h-4" />;
}
function IconRestore() {
  return <RefreshCcw className="w-4 h-4" />;
}
