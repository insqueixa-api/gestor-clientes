"use client";
// app/admin/teste/page.tsx
import {
  Loader2,
  X,
  ChevronUp,
  ChevronDown,
  MessageCircle,
  Send,
  Clock,
  Pencil,
  RefreshCcw,
  EyeOff,
  Eye,
  Trash2,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import FormattedDateInput from "@/app/admin/FormattedDateInput";
import { getIntegrationHandler } from "@/lib/integrations";

// ✅ Modal ÚNICO (criar/editar teste vem do mesmo modal do cliente)
import NovoCliente, { type ClientData } from "../cliente/novo_cliente";

// ✅ Modal de confirmação / conversão (o mesmo da renovação)
import RecargaCliente from "../cliente/recarga_cliente";

import ToastNotifications, { ToastMessage } from "../ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm"; // ✅ Hook adicionado

// --- HELPERS WHATSAPP ---
// ✅ Só o nome do contato (Principal/Secundário) — sem o número, que não
// cabia nos campos pequenos dos seletores de sessão.
function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  return profile?.connected ? sessionName : `${sessionName} (não conectado)`;
}

const APP_FIELD_LABELS: Record<string, string> = {
  date: "Vencimento",
  mac: "Device ID (MAC)",
  device_key: "Device Key",
  email: "E-mail",
  password: "Senha",
  url: "URL",
  obs: "Obs",
};

// --- TIPOS ---
type TrialStatus = "Ativo" | "Vencido" | "Arquivado";
type SortKey = "name" | "due" | "status" | "server";
type SortDir = "asc" | "desc";

type VwClientRow = {
  id: string;
  tenant_id: string;
  client_name: string | null;
  username: string | null;
  server_password?: string | null;
  m3u_url?: string | null;
  vencimento: string | null;
  computed_status: "ACTIVE" | "OVERDUE" | "TRIAL" | "ARCHIVED" | string;
  client_is_archived: boolean | null;
  server_id: string | null;
  server_name: string | null;
  technology: string | null;
  price_amount: number | null;
  price_currency: string | null;
  plan_name: string | null;
  plan_table_id?: string | null; // ✅ ADICIONADO
  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  dont_message_until: string | null;
  secondary_display_name?: string | null;
  secondary_name_prefix?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;
  name_prefix?: string | null;
  apps_names: string[] | null;
  notes: string | null;
  converted_client_id?: string | null;
};

type TrialRow = {
  id: string;
  name: string;
  username: string;
  dueISODate: string;
  dueLabelDate: string;
  dueTime: string;
  status: TrialStatus;
  server: string;
  technology: string;
  apps_names: string[];
  archived: boolean;
  server_id: string;
  whatsapp: string;
  whatsapp_username?: string;
  whatsapp_opt_in?: boolean;
  dont_message_until?: string;
  secondary_display_name?: string;
  secondary_name_prefix?: string;
  name_prefix?: string;
  secondary_phone_e164?: string;
  secondary_whatsapp_username?: string;
  server_password?: string;
  m3u_url?: string;
  price_amount?: number;
  price_currency?: string;
  plan_name?: string;
  plan_table_id?: string; // ✅ ADICIONADO
  vencimento?: string;
  notes?: string;
  converted: boolean;
};

// --- HELPERS ---
function compareText(a: string, b: string) {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}
function compareNumber(a: number, b: number) {
  return a - b;
}
function statusRank(s: TrialStatus) {
  if (s === "Vencido") return 3;
  if (s === "Arquivado") return 2;
  return 1;
}

function mapStatus(
  computed: string,
  archived: boolean,
  vencimento: string | null,
): TrialStatus {
  if (archived) return "Arquivado";
  if (vencimento) {
    const t = new Date(vencimento).getTime();
    if (!Number.isNaN(t) && Date.now() > t) return "Vencido";
  }
  const map: Record<string, TrialStatus> = {
    TRIAL: "Ativo",
    OVERDUE: "Vencido",
    ARCHIVED: "Arquivado",
  };
  return map[computed] || "Ativo";
}

function isoDateInSaoPaulo(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getDiffDays(isoDateTarget: string) {
  if (!isoDateTarget || isoDateTarget === "9999-12-31") return 9999;
  const today = isoDateInSaoPaulo();
  const d1 = new Date(`${today}T12:00:00`);
  const d2 = new Date(`${isoDateTarget}T12:00:00`);
  return Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDue(rawDue: string | null) {
  if (!rawDue) {
    return { dueISODate: "0000-01-01", dueLabelDate: "—", dueTime: "—" };
  }
  const dt = new Date(rawDue);
  if (Number.isNaN(dt.getTime())) {
    return { dueISODate: "0000-01-01", dueLabelDate: "—", dueTime: "—" };
  }
  const isoDate = isoDateInSaoPaulo(dt);
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

function queueTrialsListToast(toast: {
  type: "success" | "error";
  title: string;
  message?: string;
}) {
  try {
    if (typeof window === "undefined") return;
    const key = "trials_list_toasts";
    const raw = window.sessionStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    arr.push({ ...toast, ts: Date.now() });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

// =====================
// Apps (índice + modal)
// =====================

type AppField = {
  id: string;
  label: string;
  type: "text" | "date" | "link";
  placeholder?: string;
};

type AppData = {
  id: string;
  name: string;
  info_url: string | null;
  is_active: boolean;
  fields_config: AppField[];
  partner_server_id?: string | null;
  cost_type?: "paid" | "free" | "partnership";
  integration_type?: string | null;
};

type AppsIndex = {
  byId: Record<string, AppData>;
  byName: Record<string, AppData>;
};

function normKey(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

function safeString(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return String(v);
  } catch {
    return "";
  }
}

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

function copyText(text: string) {
  try {
    if (!text) return;
    navigator.clipboard?.writeText(text);
  } catch {}
}

export default function TrialsPage() {
  // --- ESTADOS ---
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Modais
  const [showFormModal, setShowFormModal] = useState(false);
  const [trialToEdit, setTrialToEdit] = useState<ClientData | null>(null);
  const { confirm, ConfirmUI } = useConfirm(); // ✅ Hook adicionado
  const [showPapaTestes, setShowPapaTestes] = useState(false);
  const [valuesHidden, setValuesHidden] = useState(false);

  // ✅ Controle de qual aba abrir no modal de edição
  type EditTab = "dados" | "pagamento" | "apps";
  const [editInitialTab, setEditInitialTab] = useState<EditTab>("dados");

  // ✅ Função para abrir o modal direto por ID
  function openEditById(clientId: string, initialTab: EditTab = "dados") {
    const r = rows.find((x) => x.id === clientId);
    if (!r) {
      addToast(
        "error",
        "Teste não encontrado",
        "Não foi possível abrir edição deste teste.",
      );
      return;
    }
    handleOpenEdit(r, initialTab);
  }

  // modal de conversão
  const [showConvert, setShowConvert] = useState<{
    open: boolean;
    clientId: string | null;
    clientName?: string;
  }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });

  // Filtros
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("search") || "";
  });
  const [showCount, setShowCount] = useState(100);
  const [archivedFilter, setArchivedFilter] = useState<"Não" | "Sim">("Não");
  const [serverFilter, setServerFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState<"Todos" | TrialStatus>(
    "Todos",
  );
  const [appFilter, setAppFilter] = useState("Todos"); // ✅ Adicionado estado do filtro de apps

  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // =====================
  // Apps (chips + modal)
  // =====================
  const [appsIndex, setAppsIndex] = useState<AppsIndex>({
    byId: {},
    byName: {},
  });
  const [appsLoading, setAppsLoading] = useState(false);
  const [appIntegrations, setAppIntegrations] = useState<any[]>([]);

  // Mensagem
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);

  // ✅ NOVO: Controla os botões de loading
  const [editingId, setEditingId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const [showSendNow, setShowSendNow] = useState<{
    open: boolean;
    trialId: string | null;
  }>({ open: false, trialId: null });
  const [messageText, setMessageText] = useState("");
  const [showScheduleMsg, setShowScheduleMsg] = useState<{
    open: boolean;
    trialId: string | null;
  }>({ open: false, trialId: null });
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleText, setScheduleText] = useState("");

  type ScheduledMsg = {
    id: string;
    client_id: string;
    send_at: string;
    message: string;
    status?: string | null;
  };
  type MessageTemplate = {
    id: string;
    name: string;
    content: string;
    image_url?: string | null;
    category?: string | null;
  };

  const [scheduledMap, setScheduledMap] = useState<
    Record<string, ScheduledMsg[]>
  >({});
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>(
    [],
  );
  const [selectedTemplateNowId, setSelectedTemplateNowId] =
    useState<string>("");
  const [selectedTemplateScheduleId, setSelectedTemplateScheduleId] =
    useState<string>("");

  const [showScheduledModal, setShowScheduledModal] = useState<{
    open: boolean;
    trialId: string | null;
    trialName?: string;
  }>({
    open: false,
    trialId: null,
    trialName: undefined,
  });

  const [scheduling, setScheduling] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);

  const [selectedSessionNow, setSelectedSessionNow] = useState("default");
  const [selectedSessionSchedule, setSelectedSessionSchedule] =
    useState("default");
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
      ]; // ✅ TRAVA: Só exibe a opção de envio pela sessão 2 se ela estiver conectada

      if (prof2 && prof2.connected) {
        options.push({
          id: "session2",
          label: buildWhatsAppSessionLabel(prof2, name2),
        });
      }

      setSessionOptions(options);
    } catch {}
  }

  async function handleSendMessageNow() {
    if (!tenantId || !showSendNow.trialId) return;
    if (sendingNow) return;

    const msg = (messageText || "").trim();
    if (!msg)
      return addToast(
        "error",
        "Mensagem vazia",
        "Digite uma mensagem antes de enviar.",
      );

    try {
      setSendingNow(true);
      const { data: session } = await supabaseBrowser.auth.getSession();
      const token = session.session?.access_token;

      const res = await fetch("/api/whatsapp/envio_agora", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          tenant_id: tenantId,
          client_id: showSendNow.trialId,
          message: msg,
          whatsapp_session: selectedSessionNow,
          message_template_id: selectedTemplateNowId,
        }),
      });

      if (!res.ok) throw new Error("Falha ao enviar");

      addToast("success", "Enviado", "Mensagem enviada com sucesso.");
      setShowSendNow({ open: false, trialId: null });
      setMessageText("");
      setSelectedTemplateNowId("");
      setSelectedSessionNow("default");
    } catch {
      addToast(
        "error",
        "Falha no Envio",
        "O servidor recusou o envio da mensagem.",
      );
    } finally {
      setSendingNow(false);
    }
  }

  async function handleScheduleMessageAction() {
    if (!tenantId || !showScheduleMsg.trialId) return;
    if (scheduling) return;

    const msg = (scheduleText || "").trim();
    if (!msg)
      return addToast(
        "error",
        "Mensagem vazia",
        "Digite uma mensagem antes de agendar.",
      );
    if (!scheduleDate)
      return addToast("error", "Data obrigatória", "Selecione data e hora.");

    try {
      setScheduling(true);
      const sendAtIso = `${scheduleDate}:00`;
      const check = new Date(`${scheduleDate}:00-03:00`).getTime();
      if (!Number.isFinite(check) || check <= Date.now()) {
        addToast("error", "Data inválida", "Escolha uma data/hora no futuro.");
        return;
      }

      const { data: session } = await supabaseBrowser.auth.getSession();
      const token = session.session?.access_token;

      const res = await fetch("/api/whatsapp/envio_programado", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        body: JSON.stringify({
          tenant_id: tenantId,
          client_id: showScheduleMsg.trialId,
          message: msg,
          send_at: sendAtIso,
          whatsapp_session: selectedSessionSchedule,
          message_template_id: selectedTemplateScheduleId,
        }),
      });

      if (!res.ok) throw new Error("Falha ao agendar");

      addToast("success", "Agendado", "Mensagem programada com sucesso.");
      setShowScheduleMsg({ open: false, trialId: null });
      setScheduleText("");
      setScheduleDate("");
      setSelectedTemplateScheduleId("");
      setSelectedSessionSchedule("default");
      await loadScheduledForClients(
        tenantId,
        rows.map((r) => r.id),
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
  }

  function closeAllPopups() {
    setMsgMenuForId(null);
  }

  async function loadScheduledForClients(tid: string, clientIds: string[]) {
    if (!clientIds.length) {
      setScheduledMap({});
      return;
    }

    const { data, error } = await supabaseBrowser
      .from("client_message_jobs")
      .select("id, client_id, send_at, message, status")
      .eq("tenant_id", tid)
      .in("client_id", clientIds)
      .in("status", ["SCHEDULED", "QUEUED"])
      .order("send_at", { ascending: true })
      .gte("send_at", new Date().toISOString());

    if (error) {
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

  async function loadAppsIndex(tid: string) {
    setAppsLoading(true);
    try {
      const r = await supabaseBrowser
        .from("apps")
        .select(
          "id, name, info_url, is_active, fields_config, partner_server_id, cost_type, integration_type",
        )
        .eq("tenant_id", tid)
        .order("name", { ascending: true });

      if (r.error) throw r.error;

      const byId: Record<string, AppData> = {};
      const byName: Record<string, AppData> = {};

      (r.data || []).forEach((a: any) => {
        const app: AppData = {
          id: String(a.id),
          name: String(a.name),
          info_url: a.info_url ?? null,
          is_active: Boolean(a.is_active),
          fields_config: Array.isArray(a.fields_config) ? a.fields_config : [],
          partner_server_id: a.partner_server_id ?? null,
          cost_type: a.cost_type ?? undefined,
          integration_type: a.integration_type ?? null,
        };
        byId[app.id] = app;
        byName[normKey(app.name)] = app;
      });

      setAppsIndex({ byId, byName });

      // ✅ Busca as integrações configuradas dos Apps
      const { data: appInts } = await supabaseBrowser
        .from("app_integrations")
        .select("app_name, api_url, pin") // ✅ Trocado para 'pin'
        .eq("tenant_id", tid)
        .eq("is_active", true);
      if (appInts) setAppIntegrations(appInts);
    } catch {
      setAppsIndex({ byId: {}, byName: {} });
    } finally {
      setAppsLoading(false);
    }
  }

  async function loadMessageTemplates(tid: string) {
    const { data, error } = await supabaseBrowser
      .from("message_templates")
      .select("id,name,content,image_url,category")
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

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) {
    const id = Date.now() + Math.floor(Math.random() * 100000);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // --- CARREGAMENTO ---
  async function loadData() {
    setLoading(true);

    const tid = await getCurrentTenantId();
    setTenantId(tid);

    if (!tid) {
      setRows([]);
      setLoading(false);
      return;
    }

    const viewName =
      archivedFilter === "Sim"
        ? "vw_trials_list_archived"
        : "vw_trials_list_active";

    const { data, error } = await supabaseBrowser
      .from(viewName)
      .select("*")
      .eq("tenant_id", tid)
      .order("vencimento", { ascending: false, nullsFirst: false });

    if (error) {
      addToast("error", "Erro ao carregar testes", error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const typed = (data || []) as VwClientRow[];

    const ids = typed.map((r) => String(r.id)).filter(Boolean);

    let notesMap: Record<string, string> = {};
    let prefixMap: Record<string, string> = {};

    try {
      if (ids.length > 0) {
        const { data: cData, error: cErr } = await supabaseBrowser
          .from("clients")
          .select("id, notes, name_prefix")
          .eq("tenant_id", tid)
          .in("id", ids);

        if (!cErr && cData) {
          for (const row of (cData as any[]) || []) {
            const id = String(row.id);

            // Notes
            const n = row.notes;
            notesMap[id] = typeof n === "string" ? n : "";

            // Name Prefix
            const pref = row.name_prefix;
            prefixMap[id] = typeof pref === "string" ? pref : "";
          }
        } else if (cErr) {
        }
      }
    } catch {}

    const mapped: TrialRow[] = typed.map((r) => {
      const due = formatDue(r.vencimento);
      const archived = Boolean(r.client_is_archived);

      const status = mapStatus(
        String(r.computed_status),
        archived,
        r.vencimento,
      );

      const converted = Boolean((r as any).converted_client_id);

      const id = String(r.id);

      return {
        id,
        name: String(r.client_name ?? "Sem Nome"),
        username: String(r.username ?? "—"),

        dueISODate: due.dueISODate,
        dueLabelDate: due.dueLabelDate,
        dueTime: due.dueTime,

        status,
        server: String(r.server_name ?? r.server_id ?? "—"),

        technology: String((r as any).technology ?? "—"),
        apps_names: Array.isArray((r as any).apps_names)
          ? ((r as any).apps_names as string[]).filter(Boolean)
          : [],

        archived,

        server_id: String(r.server_id ?? ""),
        whatsapp: String(r.whatsapp_e164 ?? ""),
        whatsapp_username: r.whatsapp_username ?? undefined,
        whatsapp_opt_in:
          typeof r.whatsapp_opt_in === "boolean"
            ? r.whatsapp_opt_in
            : undefined,
        name_prefix: prefixMap[id] ?? (r as any).name_prefix ?? undefined,
        dont_message_until: r.dont_message_until ?? undefined,
        secondary_display_name: r.secondary_display_name ?? undefined,
        secondary_name_prefix: r.secondary_name_prefix ?? undefined,
        secondary_phone_e164: r.secondary_phone_e164 ?? undefined,
        secondary_whatsapp_username: r.secondary_whatsapp_username ?? undefined,
        server_password: (r.server_password ?? undefined) as any,
        m3u_url: r.m3u_url || undefined,
        price_amount: r.price_amount ?? undefined,
        price_currency: r.price_currency ?? undefined,
        plan_name: r.plan_name ?? undefined,
        plan_table_id: r.plan_table_id ?? undefined, // ✅ ADICIONADO
        vencimento: r.vencimento ?? undefined,

        notes: (notesMap[id] ?? r.notes ?? "") as any,

        converted,
      };
    });

    setRows(mapped);

    if (tid) {
      await loadMessageTemplates(tid);
      await loadScheduledForClients(
        tid,
        mapped.map((m) => m.id),
      );
      await loadWhatsAppSessions();
    }

    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await loadData();

      const tid = await getCurrentTenantId();
      if (tid) await loadAppsIndex(tid);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedFilter]);

  // ✅ toasts pós-refresh
  useEffect(() => {
    if (loading) return;

    try {
      const key = "trials_list_toasts";
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;

      const arr = JSON.parse(raw) as {
        type: "success" | "error";
        title: string;
        message?: string;
      }[];
      window.sessionStorage.removeItem(key);

      for (const t of arr) addToast(t.type, t.title, t.message);
    } catch {
      // ignora
    }
  }, [loading]);

  // --- FILTROS ---
  const uniqueServers = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.server).filter((s) => s !== "—")),
      ).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "Todos" && r.status !== statusFilter) return false;
      if (serverFilter !== "Todos" && r.server !== serverFilter) return false;

      // ✅ Aplica o filtro de Aplicativos usando a propriedade "apps_names"
      if (appFilter !== "Todos") {
        if (!r.apps_names?.includes(appFilter)) return false;
      }

      if (q) {
        const hay = [r.name, r.username, r.server, r.status]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [rows, search, statusFilter, serverFilter, appFilter]); // ✅ appFilter adicionado nas dependências

  // --- ORDENAÇÃO ---
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;

      const getTimestamp = (isoD: string, timeT: string) => {
        const d = new Date(`${isoD}T${timeT || "00:00"}:00`);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };

      switch (sortKey) {
        case "name":
          cmp = compareText(a.name, b.name);
          break;
        case "due":
          cmp = compareNumber(
            getTimestamp(a.dueISODate, a.dueTime),
            getTimestamp(b.dueISODate, b.dueTime),
          );
          break;
        case "status":
          cmp = compareNumber(statusRank(a.status), statusRank(b.status));
          break;
        case "server":
          cmp = compareText(a.server, b.server);
          break;
      }

      if (cmp === 0) {
        cmp = compareNumber(
          getTimestamp(a.dueISODate, a.dueTime),
          getTimestamp(b.dueISODate, b.dueTime),
        );
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const visible = useMemo(
    () => sorted.slice(0, showCount),
    [sorted, showCount],
  );

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(nextKey);
      setSortDir("asc");
    }
  }

  // --- ACTIONS ---
  const handleOpenEdit = (r: TrialRow, initialTab: EditTab = "dados") => {
    setEditingId(r.id); // ✅ Liga o loading giratório
    setEditInitialTab(initialTab); // ✅ Salva a aba desejada
    const payload: ClientData = {
      id: r.id,
      client_name: r.name,
      name_prefix: r.name_prefix,
      username: r.username,
      server_id: r.server_id,
      screens: 1,
      technology: r.technology,

      whatsapp_e164: r.whatsapp,
      whatsapp_username: r.whatsapp_username,
      whatsapp_opt_in: r.whatsapp_opt_in,
      dont_message_until: r.dont_message_until,
      secondary_display_name: r.secondary_display_name,
      secondary_name_prefix: r.secondary_name_prefix,
      secondary_phone_e164: r.secondary_phone_e164,
      secondary_whatsapp_username: r.secondary_whatsapp_username,

      server_password: r.server_password,
      m3u_url: r.m3u_url,
      price_amount: r.price_amount,
      price_currency: r.price_currency,
      plan_name: r.plan_name,
      plan_table_id: r.plan_table_id, // ✅ ADICIONADO

      vencimento: r.vencimento,
      notes: r.notes ?? "",
    } as any;

    setTrialToEdit(payload);
    setTimeout(() => {
      setShowFormModal(true);

      // ✅ Segura o botão girando por 3 segundos (3000ms)
      setTimeout(() => {
        setEditingId(null);
      }, 3000);
    }, 10);
  };

  const handleDeleteForever = async (r: TrialRow) => {
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
      details: [`Teste: ${r.name}`, "Ação: excluir para sempre"],
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

      addToast("success", "Excluído", "Teste removido definitivamente.");
      loadData();
    } catch (e: any) {
      addToast("error", "Falha ao excluir", e?.message || "Erro desconhecido");
    }
  };

  const handleArchiveToggle = async (r: TrialRow) => {
    if (!tenantId) return;

    const goingToArchive = !r.archived;

    const ok = await confirm({
      title: goingToArchive ? "Arquivar teste" : "Restaurar teste",
      subtitle: goingToArchive
        ? "O teste irá para a Lixeira (pode ser restaurado depois)."
        : "O teste voltará para a lista ativa.",
      tone: goingToArchive ? "amber" : "emerald",
      icon: goingToArchive ? "🗑️" : "↩️",
      details: [
        `Teste: ${r.name}`,
        goingToArchive ? "Destino: Lixeira" : "Destino: Ativos",
      ],
      confirmText: goingToArchive ? "Arquivar" : "Restaurar",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.rpc("update_client", {
        p_tenant_id: tenantId,
        p_client_id: r.id,
        p_is_archived: goingToArchive,
      });

      if (error) throw error;

      queueTrialsListToast({
        type: "success",
        title: goingToArchive ? "Teste arquivado" : "Teste restaurado",
      });

      await loadData();
    } catch (e: any) {
      queueTrialsListToast({
        type: "error",
        title: "Falha ao atualizar teste",
        message: e?.message || "Erro desconhecido",
      });
      await loadData();
    }
  };

  const handleConvert = async (r: TrialRow) => {
    // ✅ Trocou para async
    if (r.archived) return;

    setConvertingId(r.id); // ✅ Liga o loading giratório
    await new Promise((resolve) => setTimeout(resolve, 50)); // ✅ Dá fôlego pro React girar o ícone

    setShowConvert({
      open: true,
      clientId: r.id,
      clientName: r.name,
    });

    // ✅ Segura o botão girando por 3 segundos
    setTimeout(() => {
      setConvertingId(null);
    }, 3000);
  };

  return (
    <div
      className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors"
      onClick={closeAllPopups}
    >
      {/* Topo (Padronizado) */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
<h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              Gestão de Testes
            </h1>
            <button
              onClick={(e) => { e.stopPropagation(); setValuesHidden(v => !v); }}
              title={valuesHidden ? "Exibir valores" : "Ocultar valores"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground/90 hover:border-foreground/20 transition-all text-xs font-medium shadow-sm select-none"
            >
              {valuesHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span className="hidden sm:inline text-[11px] tracking-wide">
                {valuesHidden ? "Exibir" : "Ocultar"}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowPapaTestes(true);
            }}
            className="hidden md:inline-flex h-10 px-3 rounded-lg text-xs font-medium border transition-colors items-center justify-center gap-1.5 bg-muted border-border text-muted-foreground hover:bg-violet-500/10 hover:text-violet-500 hover:border-violet-500/30"
          >
            🕵️ Papa Testes
          </button>

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
              setTrialToEdit(null);
              setShowFormModal(true);
            }}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
          >
            <span>+</span> Novo Teste
          </button>
        </div>
      </div>

      {/* Barra de Filtros (Padronizada) */}
      <div
        className="p-0 px-3 sm:px-0 md:p-4 bg-transparent md:bg-card border-0 md:border md:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden md:block text-xs font-medium uppercase text-muted-foreground tracking-wider mb-2">
          Filtros Rápidos
        </div>

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
                title="Limpar pesquisa"
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
              archivedFilter === "Sim"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title="Filtros"
          >
            Filtros
          </button>
        </div>

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
                title="Limpar pesquisa"
              >
                <IconX />
              </button>
            )}
          </div>

          <div className="w-[190px]">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="Todos">Status (Todos)</option>
              <option value="Ativo">Ativo</option>
              <option value="Vencido">Vencido</option>
              <option value="Arquivado">Arquivado</option>
            </Select>
          </div>

          <div className="w-[220px]">
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

          {/* ✅ Select de Aplicativos Desktop */}
          <div className="w-[190px]">
            <Select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
            >
              <option value="Todos">Aplicativos (Todos)</option>
              <optgroup label="Filtrar por nome">
                {Object.values(appsIndex.byId)
                  .filter((app: any) =>
                    rows.some(
                      (r) => r.apps_names && r.apps_names.includes(app.name),
                    ),
                  )
                  .sort((a: any, b: any) =>
                    String(a.name).localeCompare(String(b.name)),
                  )
                  .map((app: any) => {
                    const temIntegracao =
                      app.integration_type &&
                      app.integration_type !== "SEM_INTEGRACAO";
                    const nomeIntegracao =
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
                      ? `⚡ ${app.name} (${nomeIntegracao})`
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
              setSearch("");
              setStatusFilter("Todos");
              setServerFilter("Todos");
              setAppFilter("Todos"); // ✅ Resetando o novo filtro
              setArchivedFilter("Não");
            }}
            className="h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <IconX /> Limpar
          </button>
        </div>

        {mobileFiltersOpen && (
          <div className="md:hidden mt-3 p-3 rounded-xl border border-border bg-transparent space-y-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setArchivedFilter((cur) => (cur === "Não" ? "Sim" : "Não"));
                setMobileFiltersOpen(false);
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

            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="Todos">Status (Todos)</option>
              <option value="Ativo">Ativo</option>
              <option value="Vencido">Vencido</option>
              <option value="Arquivado">Arquivado</option>
            </Select>

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

            {/* ✅ Select de Aplicativos Mobile */}
            <Select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
            >
              <option value="Todos">Aplicativos (Todos)</option>
              <optgroup label="Filtrar por nome">
                {Object.values(appsIndex.byId)
                  .filter((app: any) =>
                    rows.some(
                      (r) => r.apps_names && r.apps_names.includes(app.name),
                    ),
                  )
                  .sort((a: any, b: any) =>
                    String(a.name).localeCompare(String(b.name)),
                  )
                  .map((app: any) => {
                    const temIntegracao =
                      app.integration_type &&
                      app.integration_type !== "SEM_INTEGRACAO";
                    const nomeIntegracao =
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
                      ? `⚡ ${app.name} (${nomeIntegracao})`
                      : app.name;
                    return (
                      <option key={app.id} value={app.name}>
                        {label}
                      </option>
                    );
                  })}
              </optgroup>
            </Select>

            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("Todos");
                setServerFilter("Todos");
                setAppFilter("Todos"); // ✅ Resetando o novo filtro
                setArchivedFilter("Não");
                setMobileFiltersOpen(false);
              }}
              className="h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
          >
              <IconX /> Limpar
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando dados...
        </div>
      )}

      {!loading && (
        <div
          className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-transparent">
<div className="text-sm font-medium text-foreground/90 whitespace-nowrap">
              Lista de Testes{" "}
              <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-xs">
                {filtered.length}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground shrink-0">
              <div className="flex items-center gap-2">
                <span>Mostrar</span>
                <select
                  value={showCount}
                  onChange={(e) => setShowCount(Number(e.target.value))}
                  className="bg-transparent border border-border rounded px-1 py-0.5 outline-none text-foreground/90 cursor-pointer hover:border-emerald-500/50 transition-colors"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[980px]">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
                  <ThSort
                    label="Teste"
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
                  <ThSort
                    label="Status"
                    active={sortKey === "status"}
                    dir={sortDir}
                    onClick={() => toggleSort("status")}
                  />
                  <Th>Convertido</Th>
                  <ThSort
                    label="Servidor"
                    active={sortKey === "server"}
                    dir={sortDir}
                    onClick={() => toggleSort("server")}
                  />

                  <Th>Tecnologia</Th>
                  <Th>Apps</Th>

                  <Th align="right">Ações</Th>
                </tr>
              </thead>

              <tbody className="text-sm divide-y divide-border">
                {visible.map((r) => {
                  const isExpired = r.status === "Vencido";

                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-muted/30 transition-colors group"
                    >
                      <Td>
                        <div className="flex flex-col max-w-[180px] sm:max-w-none">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span
  className="font-semibold text-foreground/90 truncate"
  title={r.name}
>
  {r.name.split(" ")[0]}
  {r.secondary_display_name && (
    <span className="text-muted-foreground font-medium">
      {" / "}
      {r.secondary_display_name.split(" ")[0]}
    </span>
  )}
</span>

                            <div className="flex items-center gap-1 shrink-0">
                              {(scheduledMap[r.id]?.length || 0) > 0 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowScheduledModal({
                                      open: true,
                                      trialId: r.id,
                                      trialName: r.name,
                                    });
                                  }}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-500 border border-purple-500/30 text-[10px] font-medium hover:bg-purple-500/20 transition-colors animate-pulse"
                                  title="Ver mensagens programadas"
                                >
                                  🗓️ {scheduledMap[r.id].length}
                                </button>
                              )}
                            </div>
                          </div>

                          <span className={`text-xs font-medium text-muted-foreground truncate transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}>
                            {r.username}
                          </span>
                          {r.whatsapp_username && (
                            <span className={`text-xs font-medium text-emerald-500 truncate transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}>
                              @{r.whatsapp_username}
                            </span>
                          )}
                          {r.secondary_whatsapp_username && (
                            <span className={`text-xs font-medium text-muted-foreground truncate transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}>
                              @{r.secondary_whatsapp_username}
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td>
                        <div className="flex flex-col">
                          <span
                            className={`font-medium ${isExpired ? "text-rose-500" : "text-muted-foreground"}`}
                          >
                            {r.dueLabelDate}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground/70">
                            {r.dueTime}
                          </span>
                        </div>
                      </Td>

                      <Td>
                        {(() => {
                          const diff = getDiffDays(r.dueISODate);
                          let label = r.status as string;
                          let tone: "green" | "red" | "amber" | "blue" = "blue";

                          if (r.status === "Arquivado") {
                            label =
                              diff < 0
                                ? `Lixeira (Venceu há ${Math.abs(diff)}d)`
                                : "Lixeira";
                            tone = "red";
                          } else if (r.status === "Vencido") {
                            if (diff === -1) label = "Venceu Ontem";
                            else if (diff === -2) label = "Venceu há 2 dias";
                            else if (diff < -2)
                              label = `Venceu há ${Math.abs(diff)} dias`;
                            tone = "red";
                          } else {
                            if (diff === 0) {
                              label = "Vence Hoje";
                              tone = "amber";
                            } else if (diff === 1) {
                              label = "Vence Amanhã";
                              tone = "green";
                            } else if (diff === 2) {
                              label = "Vence em 2 dias";
                              tone = "green";
                            } else {
                              tone = "green";
                            }
                          }

                          const colors = {
                            green:
                              "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
                            red: "bg-rose-500/10 text-rose-500 border-rose-500/20",
                            amber:
                              "bg-amber-500/10 text-amber-500 border-amber-500/20",
                            blue: "bg-sky-500/10 text-sky-500 border-sky-500/30",
                          };

                          return (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium tracking-tight shadow-sm uppercase whitespace-nowrap ${colors[tone]}`}
                            >
                              {label}
                            </span>
                          );
                        })()}
                      </Td>

                      <Td>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium tracking-tight shadow-sm uppercase ${
                            r.converted
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : "bg-transparent text-muted-foreground border-border"
                          }`}
                          title={
                            r.converted
                              ? "Teste convertido em cliente"
                              : "Ainda não convertido"
                          }
                        >
                          {r.converted ? "SIM" : "NÃO"}
                        </span>
                      </Td>

                      <Td>
                        <span className="text-muted-foreground">
                          {r.server}
                        </span>
                      </Td>

                      <Td>
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

                      {/* ✅ Apps */}
                      <Td>
                        {r.apps_names.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[300px]">
                            {r.apps_names.map((appName, idx) => {
                              const name = String(appName || "").trim();
                              return (
                                <button
                                  key={`${r.id}-${name}-${idx}`}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditById(r.id, "apps");
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 text-[10px] font-medium tracking-tight shadow-sm hover:bg-emerald-500/20 active:scale-95 transition-all"
                                  title="Configurar aplicativo"
                                >
                                  {name || "App"}
                                  {(() => {
                                    const catApp = appsIndex.byName[
                                      normKey(name)
                                    ] as any;
                                    if (!catApp?.integration_type) return null;
                                    return (
                                      <span
                                        className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded bg-sky-500/10 border border-sky-500/30 text-sky-500"
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
                                    );
                                  })()}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">
                            —
                          </span>
                        )}
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
                                    setMessageText("");
                                    setShowSendNow({
                                      open: true,
                                      trialId: r.id,
                                    });
                                  }}
                                />
                                <MenuItem
                                  icon={<IconClock />}
                                  label="Programar"
                                  onClick={() => {
                                    setMsgMenuForId(null);
                                    setScheduleText("");
                                    setScheduleDate("");
                                    setShowScheduleMsg({
                                      open: true,
                                      trialId: r.id,
                                    });
                                  }}
                                />
                              </div>
                            )}
                          </div>

                          {!r.archived && (
                            <IconActionBtn
                              title={
                                r.converted ? "Já convertido" : "Criar cliente"
                              }
                              tone="green"
                              disabled={r.converted}
                              loading={convertingId === r.id} // ✅ Adicionado loading
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!r.converted) handleConvert(r);
                              }}
                            >
                              <IconUserPlus />
                            </IconActionBtn>
                          )}

                          <IconActionBtn
                            title="Editar"
                            tone="amber"
                            loading={editingId === r.id} // ✅ Adicionado loading
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(r);
                            }}
                          >
                            <IconEdit />
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
                      colSpan={8}
                      className="p-8 text-center text-muted-foreground italic"
                    >
                      Nenhum teste encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="h-24 md:h-20" />
          </div>
        </div>
      )}

      {/* --- MODAL NOVO/EDITAR (NovoCliente) --- */}
      {showFormModal && (
        <NovoCliente
          key={trialToEdit?.id ?? "new-trial"}
          clientToEdit={trialToEdit}
          mode="trial"
          initialTab={editInitialTab} // ✅ Repassa a aba escolhida para o modal!
          onClose={() => {
            setShowFormModal(false);
            setTrialToEdit(null);
          }}
          onSuccess={() => {
            setShowFormModal(false);
            setTrialToEdit(null);
            loadData();
          }}
        />
      )}

      {/* --- MODAL CONVERTER (RecargaCliente) --- */}
      {showConvert.open && showConvert.clientId && (
        <RecargaCliente
          clientId={showConvert.clientId}
          clientName={showConvert.clientName || "Teste"}
          allowConvertWithoutPayment
          toastKey="trials_list_toasts"
          onClose={() =>
            setShowConvert({
              open: false,
              clientId: null,
              clientName: undefined,
            })
          }
          onSuccess={() => {
            setShowConvert({
              open: false,
              clientId: null,
              clientName: undefined,
            });
            queueTrialsListToast({
              type: "success",
              title: "Conversão iniciada",
              message: "Cliente criado com sucesso!",
            });
            loadData();
          }}
        />
      )}

      {showScheduledModal.open && showScheduledModal.trialId && (
        <Modal
          title={`Agendadas: ${showScheduledModal.trialName || "Teste"}`}
          onClose={() =>
            setShowScheduledModal({
              open: false,
              trialId: null,
              trialName: undefined,
            })
          }
        >
          <div className="space-y-3">
            {(
              (scheduledMap[showScheduledModal.trialId] || []) as ScheduledMsg[]
            ).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                Nenhuma mensagem agendada.
              </div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {(scheduledMap[showScheduledModal.trialId] || []).map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-xl border border-border bg-transparent"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-extrabold text-muted-foreground flex items-center gap-2">
                        <IconClock />
                        <span>
                          {new Date(s.send_at).toLocaleString("pt-BR")}
                        </span>
                      </div>

                      <button
                        onClick={async () => {
                          if (!tenantId) return;

                          const { error } = await supabaseBrowser.rpc(
                            "client_message_cancel",
                            {
                              p_tenant_id: tenantId,
                              p_job_id: s.id,
                            },
                          );

                          if (error) {
                            addToast(
                              "error",
                              "Falha ao cancelar",
                              error.message,
                            );
                            return;
                          }

                          addToast(
                            "success",
                            "Removido",
                            "Agendamento cancelado.",
                          );
                          await loadScheduledForClients(
                            tenantId,
                            rows.map((r) => r.id),
                          );
                        }}
                        className="text-[10px] text-rose-500 font-medium hover:underline"
                      >
                        Excluir
                      </button>
                    </div>

<div className="text-sm text-foreground/80 whitespace-pre-wrap">
                      {s.message}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 flex justify-end">
              <button
                onClick={() =>
                  setShowScheduledModal({
                    open: false,
                    trialId: null,
                    trialName: undefined,
                  })
                }
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted font-semibold text-sm transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* --- MODAL DE ENVIO DE MENSAGEM --- */}

      {showSendNow.open && (
        <Modal
          title="Enviar Mensagem Agora"
          onClose={() => {
            setShowSendNow({ open: false, trialId: null });
            setSelectedTemplateNowId("");
            setMessageText("");
            setSelectedSessionNow("default");
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Sessão de Envio
              </label>
              <select
                value={selectedSessionNow}
                onChange={(e) => setSelectedSessionNow(e.target.value)}
                className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm font-medium text-foreground outline-none focus:border-sky-500 transition-colors"
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
                  messageTemplates.reduce(
                    (acc, t) => {
                      const cat = t.category || "Geral";
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(t);
                      return acc;
                    },
                    {} as Record<string, typeof messageTemplates>,
                  ),
                ).map(([catName, tmpls]) => (
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

            {(() => {
              const tpl = messageTemplates.find(
                (t) => t.id === selectedTemplateNowId,
              );
              if (!tpl?.image_url) return null;
              return (
                <div className="animate-in fade-in zoom-in-95 duration-200">
                  <span className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Imagem Anexada
                  </span>
                  <div className="w-24 h-24 rounded-lg overflow-hidden border border-border shadow-sm relative bg-transparent">
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
                if (selectedTemplateNowId) setSelectedTemplateNowId("");
                setMessageText(e.target.value);
              }}
              className="w-full bg-transparent border border-border rounded-lg p-3 text-foreground outline-none min-h-[120px]"
              placeholder="Digite a mensagem para enviar agora..."
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSendNow({ open: false, trialId: null })}
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendMessageNow}
                disabled={sendingNow}
                className="px-4 py-2 rounded-lg bg-sky-600 text-white font-bold hover:bg-sky-500 flex items-center gap-2 text-sm shadow-lg shadow-sky-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconSend /> {sendingNow ? "Enviando..." : "Enviar"}
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
            setShowScheduleMsg({ open: false, trialId: null });
            setSelectedTemplateScheduleId("");
            setScheduleText("");
            setScheduleDate("");
            setSelectedSessionSchedule("default");
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Sessão de Envio
              </label>
              <select
                value={selectedSessionSchedule}
                onChange={(e) => setSelectedSessionSchedule(e.target.value)}
                className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm font-medium text-foreground outline-none focus:border-purple-500 transition-colors"
              >
                {sessionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase">
                Data e Hora do Envio
              </label>
              <FormattedDateInput
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
            </div>

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
                className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none focus:border-emerald-500/50 transition-colors"
              >
                <option value="">Selecionar...</option>
                {Object.entries(
                  messageTemplates.reduce(
                    (acc, t) => {
                      const cat = t.category || "Geral";
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(t);
                      return acc;
                    },
                    {} as Record<string, typeof messageTemplates>,
                  ),
                ).map(([catName, tmpls]) => (
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

            {(() => {
              const tpl = messageTemplates.find(
                (t) => t.id === selectedTemplateScheduleId,
              );
              if (!tpl?.image_url) return null;
              return (
                <div className="animate-in fade-in zoom-in-95 duration-200">
                  <span className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Imagem Anexada
                  </span>
                  <div className="w-24 h-24 rounded-lg overflow-hidden border border-border shadow-sm relative bg-transparent">
                    <img
                      src={tpl.image_url}
                      alt="Anexo do template"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase">
                Mensagem
              </label>
              <textarea
                value={scheduleText}
                disabled={!!selectedTemplateScheduleId}
                onChange={(e) => {
                  if (selectedTemplateScheduleId)
                    setSelectedTemplateScheduleId("");
                  setScheduleText(e.target.value);
                }}
                className="w-full bg-transparent border border-border rounded-lg p-3 text-foreground outline-none min-h-[120px]"
                placeholder="Digite a mensagem para agendar..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() =>
                  setShowScheduleMsg({ open: false, trialId: null })
                }
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleScheduleMessageAction}
                disabled={scheduling}
                className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 flex items-center gap-2 text-sm shadow-lg shadow-purple-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconClock /> {scheduling ? "Agendando..." : "Agendar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showPapaTestes && tenantId && (
        <PapaTestesModal
          tenantId={tenantId}
          onClose={() => setShowPapaTestes(false)}
          addToast={addToast}
          confirm={confirm}
        />
      )}

      {ConfirmUI}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

// --- SUB-COMPONENTES VISUAIS ---
const ALIGN_CLASS: Record<"left" | "right", string> = {
  left: "text-left",
  right: "text-right",
};

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return <th className={`px-4 py-3 ${ALIGN_CLASS[align]}`}>{children}</th>;
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
      className="px-4 py-3 cursor-pointer select-none group hover:text-emerald-500 transition-colors text-left"
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

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td className={`px-4 py-3 ${ALIGN_CLASS[align]} align-middle`}>
      {children}
    </td>
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      {...rest}
      className={`w-full h-10 px-3 bg-card border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90 ${className}`}
    />
  );
}

function StatusBadge({ status }: { status: TrialStatus }) {
  const tone =
    status === "Ativo"
      ? {
          bg: "bg-emerald-500/10",
          text: "text-emerald-500",
          border: "border-emerald-500/20",
        }
      : status === "Vencido"
        ? {
            bg: "bg-rose-500/10",
            text: "text-rose-500",
            border: "border-rose-500/20",
          }
        : {
            bg: "bg-transparent",
            text: "text-muted-foreground",
            border: "border-border",
          };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium tracking-tight shadow-sm uppercase ${tone.bg} ${tone.text} ${tone.border}`}
    >
      {status}
    </span>
  );
}

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
  disabled,
  loading = false, // ✅ NOVO
}: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  loading?: boolean; // ✅ NOVO
}) {
  const colors = {
    blue: "text-sky-500 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20",
    green:
      "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber:
      "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    purple:
      "text-purple-500 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  };

  return (
    <button
      type="button"
      disabled={disabled || loading} // ✅ Bloqueia clique se estiver carregando
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled && !loading) onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all shadow-sm ${colors[tone]} ${
        disabled
          ? "opacity-30 cursor-not-allowed grayscale"
          : loading
            ? "opacity-70 cursor-wait"
            : "active:scale-95"
      }`}
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
      className="w-full px-4 py-2 flex items-center gap-3 text-foreground/80 hover:bg-muted hover:text-emerald-500 transition-colors text-left text-sm font-medium"
    >
      <span className="opacity-70">{icon}</span>
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.60)",
        display: "grid",
        placeItems: "center",
        zIndex: 99999,
        padding: 16,
      }}
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
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
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

function PapaTestesModal({
  tenantId,
  onClose,
  addToast,
  confirm,
}: {
  tenantId: string;
  onClose: () => void;
  addToast: (
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) => void;
  confirm: any;
}) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"todos" | "trial" | "client">(
    "todos",
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterServer, setFilterServer] = useState("Todos");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("papa_testes")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRecords(data || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar", e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: "Remover do Papa Testes?",
      subtitle: "Este registro será excluído permanentemente.",
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Cancelar",
      details: [`Cliente: ${name}`],
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      const { error } = await supabaseBrowser
        .from("papa_testes")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      setRecords((prev) => prev.filter((r) => r.id !== id));
      addToast("success", "Removido", "Registro excluído do Papa Testes.");
    } catch (e: any) {
      addToast("error", "Erro ao excluir", e.message);
    } finally {
      setDeletingId(null);
    }
  }

  const uniqueServers = useMemo(() => {
    const names = records.map((r) => r.server_name).filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [records]);

  const filtered = useMemo(() => {
    const q = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return records.filter((r) => {
      if (filterType === "trial" && !r.is_trial) return false;
      if (filterType === "client" && r.is_trial) return false;
      if (filterServer !== "Todos" && r.server_name !== filterServer)
        return false;
      if (!q) return true;
      const hay = [
        r.client_name,
        r.whatsapp_username,
        r.username,
        r.server_name,
        r.phone_e164,
      ]
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return hay.includes(q);
    });
  }, [records, search, filterType]);

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const r of filtered) {
      const key = r.whatsapp_username || r.phone_e164 || r.id;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [filtered]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "grid",
        placeItems: "center",
        zIndex: 99999,
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-transparent shrink-0">
          <div>
            <h2 className="font-medium text-foreground text-base flex items-center gap-2">
              🕵️ Papa Testes
              <span className="gap-1 px-2 py-1 rounded-lg text-xs font-medium tracking-tight shadow-sm bg-violet-500/10 text-violet-500 border border-violet-500/20">
                {records.length} registro{records.length !== 1 ? "s" : ""}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Histórico de todos os testes e clientes cadastrados.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <IconX />
          </button>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 border-b border-border shrink-0 flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[180px] relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, WhatsApp, usuário..."
              className="w-full h-9 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-violet-500/50 text-foreground/90"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-rose-500"
              >
                <IconX />
              </button>
            )}
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="h-9 px-3 bg-transparent border border-border rounded-lg text-sm outline-none text-foreground/90"
          >
            <option value="todos">Todos</option>
            <option value="trial">Só Testes</option>
            <option value="client">Só Clientes</option>
          </select>

          <select
            value={filterServer}
            onChange={(e) => setFilterServer(e.target.value)}
            className="h-9 px-3 bg-transparent border border-border rounded-lg text-sm outline-none text-foreground/90"
          >
            <option value="Todos">Servidor (Todos)</option>
            {uniqueServers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {loading ? (
            <div className="text-center text-muted-foreground animate-pulse py-8">
              Carregando...
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="text-center text-muted-foreground py-8 border-2 border-dashed border-border rounded-xl">
              Nenhum registro encontrado.
            </div>
          ) : (
            Object.entries(grouped).map(([key, recs]) => (
              <div
                key={key}
                className="border border-border rounded-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2.5 bg-transparent border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground/90">
                      {recs[0]?.client_name || "—"}
                    </span>
{recs[0]?.whatsapp_username && (
                      <span className="text-xs text-emerald-500">
                        @{recs[0].whatsapp_username}
                      </span>
                    )}
                    {recs.length > 1 && (
                      <span className="gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm bg-amber-500/10 text-amber-500 border border-amber-500/20">
                        {recs.length}x
                      </span>
                    )}
                  </div>
                  {recs[0]?.phone_e164 && (
                    <span className="text-xs text-muted-foreground">
                      {recs[0].phone_e164}
                    </span>
                  )}
                </div>

                <div className="divide-y divide-border">
                  {recs.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm border shrink-0 ${
                            r.is_trial && !r.converted
                              ? "bg-sky-500/10 text-sky-500 border-sky-500/30"
                              : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                          }`}
                          title={
                            r.is_trial && r.converted && r.converted_at
                              ? `Convertido em ${new Date(r.converted_at).toLocaleDateString("pt-BR")}`
                              : undefined
                          }
                        >
                          {r.is_trial ? (r.converted ? "Convertido" : "Teste") : "Cliente"}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(r.created_at).toLocaleDateString("pt-BR")}
                        </span>
                        {r.server_name && (
                          <span className="text-xs text-muted-foreground truncate">
                            {r.server_name}
                          </span>
                        )}
                        {r.username && (
                          <span className="text-xs text-muted-foreground truncate">
                            {r.username}
                          </span>
                        )}
{r.plan_price && (
                          <span className="text-xs font-medium text-emerald-500 shrink-0">
                            {new Intl.NumberFormat("pt-BR", {
                              style: "currency",
                              currency: r.plan_currency || "BRL",
                            }).format(r.plan_price)}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(r.id, r.client_name || "—")}
                        disabled={deletingId === r.id}
                        className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0 ml-2"
                        title="Excluir registro"
                      >
                        {deletingId === r.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <IconTrash />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-transparent shrink-0 flex justify-between items-center">
          <span className="text-xs text-muted-foreground">
            {filtered.length} de {records.length} registro
            {records.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-transparent text-foreground/90 font-medium text-xs hover:bg-muted transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// --- ÍCONES ---
function IconX() {
  return <X className="w-4 h-4" />;
}

function IconChat() {
  return <MessageCircle className="w-4 h-4" />;
}

function IconSortUp() {
  return <ChevronUp className="w-3 h-3" />;
}
function IconSortDown() {
  return <ChevronDown className="w-3 h-3" />;
}
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconSend() {
  return <Send className="w-4 h-4" />;
}
function IconClock() {
  return <Clock className="w-4 h-4" />;
}
function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}

function IconUserPlus() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="17" y1="11" x2="23" y2="11" />
    </svg>
  );
}

function IconRestore() {
  return <RefreshCcw className="w-4 h-4" />;
}
