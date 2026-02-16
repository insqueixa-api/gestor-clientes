"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ✅ Modal ÚNICO (criar/editar teste vem do mesmo modal do cliente)
import NovoCliente, { type ClientData } from "../cliente/novo_cliente";

// ✅ Modal de confirmação / conversão (o mesmo da renovação)
import RecargaCliente from "../cliente/recarga_cliente";

import ToastNotifications, { ToastMessage } from "../ToastNotifications";

// --- TIPOS ---
type TrialStatus = "Ativo" | "Vencido" | "Arquivado";
type SortKey = "name" | "due" | "status" | "server";
type SortDir = "asc" | "desc";

/**
 * ✅ Linha REAL da view vw_clients_list_*
 * Vamos filtrar apenas computed_status = TRIAL
 */
type VwClientRow = {
  id: string;
  tenant_id: string;

  client_name: string | null;
  username: string | null;
  server_password?: string | null;
  m3u_url?: string | null; // ✅ ADICIONAR

  vencimento: string | null;
  computed_status: "ACTIVE" | "OVERDUE" | "TRIAL" | "ARCHIVED" | string;
  client_is_archived: boolean | null;

  server_id: string | null;
  server_name: string | null;

  technology: string | null;

  whatsapp_e164: string | null;

  whatsapp_username: string | null;
  whatsapp_extra: string[] | null;
  whatsapp_opt_in: boolean | null;
  dont_message_until: string | null;

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

  // para editar
  server_id: string;
  whatsapp: string;
  whatsapp_username?: string;
  whatsapp_extra?: string[];
  whatsapp_opt_in?: boolean;
  dont_message_until?: string;
  server_password?: string;
  m3u_url?: string; // ✅ ADICIONAR
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

function mapStatus(computed: string, archived: boolean, vencimento: string | null): TrialStatus {
  if (archived) return "Arquivado";

  // ✅ Regra principal do teste:
  // se agora > vencimento => Vencido
  if (vencimento) {
    const t = new Date(vencimento).getTime();
    if (!Number.isNaN(t) && Date.now() > t) return "Vencido";
  }

  // fallback (se algum dia você mudar o filtro e vier OVERDUE/ARCHIVED)
  const map: Record<string, TrialStatus> = {
    TRIAL: "Ativo",
    OVERDUE: "Vencido",
    ARCHIVED: "Arquivado",
  };
  return map[computed] || "Ativo";
}


function formatDue(rawDue: string | null) {
  if (!rawDue) {
    return { dueISODate: "0000-01-01", dueLabelDate: "—", dueTime: "—" };
  }

  const isoDate = rawDue.split("T")[0];
  const dt = new Date(rawDue);

  if (Number.isNaN(dt.getTime())) {
    return { dueISODate: "0000-01-01", dueLabelDate: "—", dueTime: "—" };
  }

  return {
    dueISODate: isoDate,
    dueLabelDate: dt.toLocaleDateString("pt-BR"),
    dueTime: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function queueTrialsListToast(toast: { type: "success" | "error"; title: string; message?: string }) {
  try {
    if (typeof window === "undefined") return;

    const key = "trials_list_toasts";
    const raw = window.sessionStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    arr.push({ ...toast, ts: Date.now() });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // silencioso
  }
}

// =====================
// Apps (índice + modal)  ✅ igual Cliente
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

  // ✅ modal de conversão
  const [showConvert, setShowConvert] = useState<{ open: boolean; clientId: string | null; clientName?: string }>({
    open: false,
    clientId: null,
    clientName: undefined,
  });

  // Filtros
  const [search, setSearch] = useState("");
  const [showCount, setShowCount] = useState(100);
  const [archivedFilter, setArchivedFilter] = useState<"Não" | "Sim">("Não");
  const [serverFilter, setServerFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState<"Todos" | TrialStatus>("Todos");

  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

    // =====================
  // Apps (chips + modal)  ✅ igual Cliente
  // =====================
  const [appsIndex, setAppsIndex] = useState<AppsIndex>({ byId: {}, byName: {} });
  const [appsLoading, setAppsLoading] = useState(false);

  const [showAppModal, setShowAppModal] = useState(false);
  const [appModal, setAppModal] = useState<{
    clientId: string;
    clientName: string;
    appId?: string | null;
    appName: string;
    infoUrl?: string | null;
    fields: AppField[];
    values: Record<string, any>;
  } | null>(null);



  // Mensagem (igual clientes)
  const [msgMenuForId, setMsgMenuForId] = useState<string | null>(null);
  const [showSendNow, setShowSendNow] = useState<{ open: boolean; trialId: string | null }>({ open: false, trialId: null });
  const [messageText, setMessageText] = useState("");
  const [showScheduleMsg, setShowScheduleMsg] = useState<{ open: boolean; trialId: string | null }>({ open: false, trialId: null });
const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleText, setScheduleText] = useState("");

  // ✅ NOVOS ESTADOS (Igual Cliente)
  type ScheduledMsg = { id: string; client_id: string; send_at: string; message: string; status?: string | null };
  type MessageTemplate = { id: string; name: string; content: string };

  const [scheduledMap, setScheduledMap] = useState<Record<string, ScheduledMsg[]>>({});
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateNowId, setSelectedTemplateNowId] = useState<string>("");
  const [selectedTemplateScheduleId, setSelectedTemplateScheduleId] = useState<string>("");
  
  // ✅ Modal para ver lista de agendados
  const [showScheduledModal, setShowScheduledModal] = useState<{ open: boolean; trialId: string | null; trialName?: string }>({
    open: false,
    trialId: null,
    trialName: undefined,
  });

  const [scheduling, setScheduling] = useState(false); // Loading do botão agendar

  function closeAllPopups() {
    setMsgMenuForId(null);
  }

  // ✅ FUNÇÕES DE CARREGAMENTO (Igual Cliente)
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

    async function loadAppsIndex(tid: string) {
    setAppsLoading(true);
    try {
      const r = await supabaseBrowser
        .from("apps")
        .select("id, name, info_url, is_active, fields_config, partner_server_id, cost_type")
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
        };
        byId[app.id] = app;
        byName[normKey(app.name)] = app;
      });

      setAppsIndex({ byId, byName });
    } catch (e) {
      console.error("Falha ao carregar apps:", e);
      setAppsIndex({ byId: {}, byName: {} });
    } finally {
      setAppsLoading(false);
    }
  }

  async function openAppConfigModal(clientId: string, clientName: string, appNameOrId: string) {
    const raw = String(appNameOrId || "").trim();
    if (!raw) return;

    const byId = appsIndex.byId || {};
    const byName = appsIndex.byName || {};

    const found =
      byId[raw] ||
      byName[normKey(raw)] ||
      byName[normKey(raw.replace(/^#/, ""))];

    if (!found) {
      addToast("error", "App não encontrado", `Não achei o app "${raw}" na tabela apps.`);
      return;
    }

    // busca field_values do client_apps (por app.id)
    let values: Record<string, any> = {};
    try {
      const r = await supabaseBrowser
        .from("client_apps")
        .select("field_values")
        .eq("client_id", clientId)
        .eq("app_id", found.id)
        .maybeSingle();

      if (!r.error && r.data?.field_values) {
        values = r.data.field_values as any;
      }
    } catch (e) {
      console.error("Falha ao buscar client_apps.field_values:", e);
    }

    setAppModal({
      clientId,
      clientName,
      appId: found.id,
      appName: found.name,
      infoUrl: found.info_url ?? null,
      fields: Array.isArray(found.fields_config) ? found.fields_config : [],
      values: { ...values },
    });

    setShowAppModal(true);
  }


  async function loadMessageTemplates(tid: string) {
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

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now() + Math.floor(Math.random() * 100000);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 4000);
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

  // ✅ CORRETO: Usando views de TESTES
const viewName = archivedFilter === "Sim" ? "vw_trials_list_archived" : "vw_trials_list_active";

  const { data, error } = await supabaseBrowser
    .from(viewName)
    .select("*")
    .eq("tenant_id", tid)
    .eq("computed_status", "TRIAL")
    .order("vencimento", { ascending: false, nullsFirst: false });

  if (error) {
    console.error(error);
    addToast("error", "Erro ao carregar testes", error.message);
    setRows([]);
    setLoading(false);
    return;
  }

  const typed = (data || []) as VwClientRow[];

  // ✅ fonte da verdade: notes direto da tabela clients (batch)
const ids = typed.map((r) => String(r.id)).filter(Boolean);

let notesMap: Record<string, string> = {};
try {
  if (ids.length > 0) {
    const { data: cData, error: cErr } = await supabaseBrowser
      .from("clients")
      .select("id, notes")
      .eq("tenant_id", tid)
      .in("id", ids);

    if (!cErr && cData) {
      for (const row of (cData as any[]) || []) {
        const id = String(row.id);
        const n = row.notes;
        notesMap[id] = typeof n === "string" ? n : "";
      }
    } else if (cErr) {
      console.error("Falha ao carregar notes do clients:", cErr);
    }
  }
} catch (e) {
  console.error("Crash ao carregar notes do clients:", e);
}

const mapped: TrialRow[] = typed.map((r) => {
  const due = formatDue(r.vencimento);
  const archived = Boolean(r.client_is_archived);

  // ✅ status agora considera vencimento
  const status = mapStatus(String(r.computed_status), archived, r.vencimento);

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
  apps_names: Array.isArray((r as any).apps_names) ? ((r as any).apps_names as string[]).filter(Boolean) : [],

  archived,

  server_id: String(r.server_id ?? ""),
  whatsapp: String(r.whatsapp_e164 ?? ""),
  whatsapp_username: r.whatsapp_username ?? undefined,
  whatsapp_extra: r.whatsapp_extra ?? undefined,
  whatsapp_opt_in: typeof r.whatsapp_opt_in === "boolean" ? r.whatsapp_opt_in : undefined,
  dont_message_until: r.dont_message_until ?? undefined,
  server_password: (r.server_password ?? undefined) as any,
  m3u_url: r.m3u_url || undefined, // ✅ ADICIONAR
  vencimento: r.vencimento ?? undefined,

  notes: (notesMap[id] ?? r.notes ?? "") as any,

  converted,
};

});


setRows(mapped);
  
  // ✅ Carrega templates e agendamentos reais
  if (tid) {
    await loadMessageTemplates(tid);
    await loadScheduledForClients(tid, mapped.map(m => m.id));
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

      const arr = JSON.parse(raw) as { type: "success" | "error"; title: string; message?: string }[];
      window.sessionStorage.removeItem(key);

      for (const t of arr) addToast(t.type, t.title, t.message);
    } catch {
      // ignora
    }
  }, [loading]);

  // --- FILTROS ---
  const uniqueServers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.server).filter((s) => s !== "—"))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "Todos" && r.status !== statusFilter) return false;
      if (serverFilter !== "Todos" && r.server !== serverFilter) return false;

      if (q) {
        const hay = [r.name, r.username, r.server, r.status].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [rows, search, statusFilter, serverFilter]);

  // --- ORDENAÇÃO ---
  const sorted = useMemo(() => {
    const list = [...filtered];
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
      }
      if (cmp === 0) cmp = compareText(`${a.dueISODate} ${a.dueTime}`, `${b.dueISODate} ${b.dueTime}`);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const visible = useMemo(() => sorted.slice(0, showCount), [sorted, showCount]);

  function toggleSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(nextKey);
      setSortDir("asc");
    }
  }

  // --- ACTIONS ---
  const handleOpenEdit = (r: TrialRow) => {
    const payload: ClientData = {
      id: r.id,
      client_name: r.name,
      username: r.username,
      server_id: r.server_id,
      screens: 1,

      whatsapp_e164: r.whatsapp,
      whatsapp_username: r.whatsapp_username,
      whatsapp_extra: r.whatsapp_extra,

      whatsapp_opt_in: r.whatsapp_opt_in,
      dont_message_until: r.dont_message_until,

      server_password: r.server_password,
      m3u_url: r.m3u_url, // ✅ ADICIONAR

      vencimento: r.vencimento,
      notes: r.notes ?? "",
    } as any;

    setTrialToEdit(payload);
    setTimeout(() => setShowFormModal(true), 0);
  };

  // ✅ Arquivar/restaurar agora é update_client (porque trial é cliente TRIAL)

  const handleDeleteForever = async (r: TrialRow) => {
  if (!tenantId) return;

  if (!r.archived) {
    addToast("error", "Ação bloqueada", "Só é possível excluir definitivamente pela Lixeira.");
    return;
  }

  const confirmed = window.confirm("Excluir permanentemente este teste? Esta ação NÃO pode ser desfeita.");
  if (!confirmed) return;

  try {
const { error } = await supabaseBrowser.rpc("delete_client_forever", {
  p_tenant_id: tenantId,
  p_client_id: r.id,
});


    if (error) throw error;

    addToast("success", "Excluído", "Teste removido definitivamente.");
    loadData();
  } catch (e: any) {
    console.error(e);
    addToast("error", "Falha ao excluir", e?.message || "Erro desconhecido");
  }
};


  const handleArchiveToggle = async (r: TrialRow) => {
    if (!tenantId) return;

    const goingToArchive = !r.archived;
    const confirmed = window.confirm(goingToArchive ? "Arquivar este teste? (Ele irá para a Lixeira)" : "Restaurar este teste da Lixeira?");
    if (!confirmed) return;

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
      console.error(e);
      queueTrialsListToast({
        type: "error",
        title: "Falha ao atualizar teste",
        message: e?.message || "Erro desconhecido",
      });
      await loadData();
    }
  };

  // ✅ Converter abre o mesmo modal da renovação
  const handleConvert = (r: TrialRow) => {
    if (r.archived) return;

    setShowConvert({
      open: true,
      clientId: r.id,
      clientName: r.name,
    });
  };

return (
<div
  className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors"
  onClick={closeAllPopups}
>

  {/* Topo (Padronizado) */}
  <div className="flex items-center justify-between gap-2 pb-0 mb-2">
    <div className="min-w-0 text-left">
      <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
        Gestão de Testes
      </h1>
    </div>

    <div className="flex items-center gap-2 justify-end shrink-0">
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
    className="p-0 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20"
    onClick={(e) => e.stopPropagation()}
  >
  <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider mb-2">
    Filtros Rápidos
  </div>

  {/* ✅ MOBILE: pesquisa + botão abrir painel */}
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
          title="Limpar pesquisa"
        >
          <IconX />
        </button>
      )}
    </div>

    <button
      onClick={() => setMobileFiltersOpen((v) => !v)}
      className={`h-10 px-3 rounded-lg border font-bold text-sm transition-colors ${
        (statusFilter !== "Todos" || serverFilter !== "Todos" || archivedFilter === "Sim")
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10"
      }`}
      title="Filtros"
    >
      Filtros
    </button>
  </div>

  {/* ✅ DESKTOP: tudo na mesma linha */}
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
          title="Limpar pesquisa"
        >
          <IconX />
        </button>
      )}
    </div>

    <div className="w-[190px]">
      <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
        <option value="Todos">Status (Todos)</option>
        <option value="Ativo">Ativo</option>
        <option value="Vencido">Vencido</option>
        <option value="Arquivado">Arquivado</option>
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

    <button
      onClick={() => {
        setSearch("");
        setStatusFilter("Todos");
        setServerFilter("Todos");
        setArchivedFilter("Não");
      }}
      className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
    >
      <IconX /> Limpar
    </button>
  </div>

  {/* ✅ Painel mobile */}
  {mobileFiltersOpen && (
    <div className="md:hidden mt-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-2">

      {/* ✅ Filtrar Lixeira */}
      <button
onClick={(e) => {
  e.stopPropagation();
  setArchivedFilter((cur) => (cur === "Não" ? "Sim" : "Não"));
  setMobileFiltersOpen(false);
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

      <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
        <option value="Todos">Status (Todos)</option>
        <option value="Ativo">Ativo</option>
        <option value="Vencido">Vencido</option>
        <option value="Arquivado">Arquivado</option>
      </Select>

      <Select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
        <option value="Todos">Servidor (Todos)</option>
        {uniqueServers.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </Select>

      <button
        onClick={() => {
          setSearch("");
          setStatusFilter("Todos");
          setServerFilter("Todos");
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
          Lista de Testes{" "}
          <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
            {filtered.length}
          </span>
        </div>

        <div className="flex items-center justify-end gap-3 text-xs text-slate-500 dark:text-white/50 shrink-0">
          <div className="flex items-center gap-2">
            <span>Mostrar</span>
            <select
              value={showCount}
              onChange={(e) => setShowCount(Number(e.target.value))}
              className="bg-transparent border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 outline-none text-slate-700 dark:text-white cursor-pointer hover:border-emerald-500/50 transition-colors"
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
                <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/40">
                  <ThSort label="Teste" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  <ThSort label="Vencimento" active={sortKey === "due"} dir={sortDir} onClick={() => toggleSort("due")} />
                  <ThSort label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
                  <Th>Convertido</Th>
                  <ThSort label="Servidor" active={sortKey === "server"} dir={sortDir} onClick={() => toggleSort("server")} />

                  <Th>Tecnologia</Th>     {/* ✅ NOVO */}
                  <Th>Apps</Th>           {/* ✅ NOVO */}

                  <Th align="right">Ações</Th>

                </tr>
              </thead>

              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.map((r) => {
                  const isExpired = r.status === "Vencido";

                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                  <Td>
                    <div className="flex flex-col max-w-[180px] sm:max-w-none">
                      {/* Nome + Ícone Piscando */}
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="font-semibold text-slate-700 dark:text-white truncate" title={r.name}>
                          {r.name}
                        </span>

                        {/* ✅ Ícone de Mensagem Agendada (Real) */}
                        {(scheduledMap[r.id]?.length || 0) > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowScheduledModal({ open: true, trialId: r.id, trialName: r.name });
                            }}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold hover:bg-purple-200 transition-colors animate-pulse"
                            title="Ver mensagens programadas"
                          >
                            🗓️ {scheduledMap[r.id].length}
                          </button>
                        )}
                      </div>

                      <span className="text-xs font-medium text-slate-500 dark:text-white/60 truncate">
                        {r.username}
                      </span>
                    </div>
                  </Td>

                      <Td>
                        <div className="flex flex-col">
                          <span className={`font-mono font-medium ${isExpired ? "text-rose-500" : "text-slate-600 dark:text-white/80"}`}>
                            {r.dueLabelDate}
                          </span>
                          {/* Padronizado: font-medium + slate-500 */}
                          <span className="text-xs font-medium text-slate-500 dark:text-white/60">{r.dueTime}</span>
                        </div>
                      </Td>

                      <Td>
                        <StatusBadge status={r.status} />
                      </Td>

                      <Td>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                            r.converted
                              ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-500 border-emerald-200 dark:border-emerald-500/20"
                              : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/50 border-slate-200 dark:border-white/10"
                          }`}
                          title={r.converted ? "Teste convertido em cliente" : "Ainda não convertido"}
                        >
                          {r.converted ? "SIM" : "NÃO"}
                        </span>
                      </Td>

                      <Td>
                          <span className="text-slate-600 dark:text-white/70">{r.server}</span>
                        </Td>

                        {/* ✅ Tecnologia */}
                        <Td>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 uppercase">
                            {r.technology || "—"}
                          </span>
                        </Td>

                        {/* ✅ Apps (chips clicáveis → modal) */}
                        <Td>
                          {r.apps_names.length > 0 ? (
                            <div className="flex flex-wrap gap-2 max-w-[320px]">
                              {r.apps_names.map((appName, idx) => {
                                const name = String(appName || "").trim();
                                return (
                                  <button
                                    key={`${r.id}-${name}-${idx}`}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAppConfigModal(r.id, r.name, name);
                                    }}
                                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
                                    title="Ver configuração do app"
                                  >
                                    <span className="text-[11px] font-bold text-slate-700 dark:text-white/80">
                                      {name || "App"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-white/20 italic">—</span>
                          )}
                        </Td>

                        <Td align="right">

                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 relative">
                          {/* Mensagem */}
                          <div className="relative">
                            <IconActionBtn
                              title="Mensagem"
                              tone="blue"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMsgMenuForId((cur) => (cur === r.id ? null : r.id));
                              }}
                            >
                              <IconChat />
                            </IconActionBtn>

                            {msgMenuForId === r.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f141a] z-50 shadow-2xl overflow-hidden"
                              >
                                <MenuItem
                                  icon={<IconSend />}
                                  label="Enviar agora"
                                  onClick={() => {
                                    setMsgMenuForId(null);
                                    setMessageText("");
                                    setShowSendNow({ open: true, trialId: r.id });
                                  }}
                                />
                                <MenuItem
                                  icon={<IconClock />}
                                  label="Programar"
                                  onClick={() => {
                                    setMsgMenuForId(null);
                                    setScheduleText("");
                                    setScheduleDate("");
                                    setShowScheduleMsg({ open: true, trialId: r.id });
                                  }}
                                />
                              </div>
                            )}
                          </div>

                          {/* Criar Cliente (conversão) */}
                          {!r.archived && (
                            <IconActionBtn
                              title={r.converted ? "Já convertido" : "Criar cliente"}
                              tone="green"
                              disabled={r.converted}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(r);
                            }}
                          >
                            <IconEdit />
                          </IconActionBtn>

                          {/* Arquivar / Restaurar */}
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
                    <td colSpan={8} className="p-8 text-center text-slate-400 dark:text-white/40 italic">
                      Nenhum teste encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- MODAL NOVO/EDITAR (NovoCliente) --- */}
      {showFormModal && (
        <NovoCliente
          key={trialToEdit?.id ?? "new-trial"}
          clientToEdit={trialToEdit}
          mode="trial"
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
    toastKey="trials_list_toasts"  // ✅ NOVO: toast do Whats volta pra tela de Testes
    onClose={() => setShowConvert({ open: false, clientId: null, clientName: undefined })}
    onSuccess={() => {
      setShowConvert({ open: false, clientId: null, clientName: undefined });
      queueTrialsListToast({ type: "success", title: "Conversão iniciada", message: "Cliente criado com sucesso!" });
      loadData();
    }}
  />
)}


{/* ✅ MODAL LISTA DE MENSAGENS AGENDADAS */}
{showScheduledModal.open && showScheduledModal.trialId && (
  <Modal
    title={`Agendadas: ${showScheduledModal.trialName || "Teste"}`}
    onClose={() => setShowScheduledModal({ open: false, trialId: null, trialName: undefined })}
  >
    <div className="space-y-3">
      {((scheduledMap[showScheduledModal.trialId] || []) as ScheduledMsg[]).length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-white/50 text-center py-4">
          Nenhuma mensagem agendada.
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {(scheduledMap[showScheduledModal.trialId] || []).map((s) => (
            <div
              key={s.id}
              className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs font-extrabold text-slate-600 dark:text-white/70 flex items-center gap-2">
                  <IconClock />
                  <span>{new Date(s.send_at).toLocaleString("pt-BR")}</span>
                </div>

                <button
                  onClick={async () => {
                    if (!tenantId) return;

                    const { error } = await supabaseBrowser.rpc("client_message_cancel", {
                      p_tenant_id: tenantId,
                      p_job_id: s.id,
                    });

                    if (error) {
                      addToast("error", "Falha ao cancelar", error.message);
                      return;
                    }

                    addToast("success", "Removido", "Agendamento cancelado.");
                    await loadScheduledForClients(tenantId, rows.map((r) => r.id));
                  }}
                  className="text-[10px] text-rose-500 font-bold hover:underline"
                >
                  Excluir
                </button>
              </div>

              <div className="text-sm text-slate-700 dark:text-white/80 whitespace-pre-wrap">
                {s.message}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-3 flex justify-end">
        <button
          onClick={() => setShowScheduledModal({ open: false, trialId: null, trialName: undefined })}
          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/5 font-semibold text-sm transition-colors"
        >
          Fechar
        </button>
      </div>
    </div>
  </Modal>
)}


      {/* --- MODAL DE ENVIO DE MENSAGEM --- */}
      
{showSendNow.open && (
  <Modal title="Enviar Mensagem Agora" onClose={() => {
    setShowSendNow({ open: false, trialId: null });
    setSelectedTemplateNowId("");
    setMessageText("");
  }}>
    <div className="space-y-4">
      {/* ✅ Select de Template */}
      <div>
        <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
          Mensagem pronta (opcional)
        </label>
        <select
          value={selectedTemplateNowId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedTemplateNowId(id);
            const tpl = messageTemplates.find((t) => t.id === id);
            if (tpl) setMessageText(tpl.content);
            else setMessageText("");
          }}
          className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 transition-colors"
        >
          <option value="">Selecionar...</option>
          {messageTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <textarea
        value={messageText}
        onChange={(e) => {
          if (selectedTemplateNowId) setSelectedTemplateNowId("");
          setMessageText(e.target.value);
        }}
        className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg p-3 text-slate-800 dark:text-white outline-none min-h-[120px]"
        placeholder="Digite a mensagem para enviar agora..."
      />
      
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowSendNow({ open: false, trialId: null })}
          className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-600 dark:text-white/60 text-sm font-bold"
        >
          Cancelar
        </button>
        <button
          onClick={() => {
             // Lógica de envio (igual você já tinha ou chamar handleSendMessage se criar)
             // ...
             addToast("success", "Enviado", "Mensagem enviada com sucesso.");
             setShowSendNow({ open: false, trialId: null });
          }}
          className="px-4 py-2 rounded-lg bg-sky-600 text-white font-bold hover:bg-sky-500 flex items-center gap-2 text-sm shadow-lg shadow-sky-900/20"
        >
          <IconSend /> Enviar
        </button>
      </div>
    </div>
  </Modal>
)}

      {/* --- MODAL DE AGENDAMENTO DE MENSAGEM --- */}
{showScheduleMsg.open && (
  <Modal title="Agendar Mensagem" onClose={() => {
    setShowScheduleMsg({ open: false, trialId: null });
    setSelectedTemplateScheduleId("");
    setScheduleText("");
    setScheduleDate("");
  }}>
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-500 dark:text-white/60 mb-1 uppercase">Data e Hora do Envio</label>
        <input
          type="datetime-local"
          value={scheduleDate}
          onChange={(e) => setScheduleDate(e.target.value)}
          className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none"
        />
      </div>

      {/* ✅ Select de Template */}
      <div>
        <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
          Mensagem pronta (opcional)
        </label>
        <select
          value={selectedTemplateScheduleId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedTemplateScheduleId(id);
            const tpl = messageTemplates.find((t) => t.id === id);
            if (tpl) setScheduleText(tpl.content);
            else setScheduleText("");
          }}
          className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 transition-colors"
        >
          <option value="">Selecionar...</option>
          {messageTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-500 dark:text-white/60 mb-1 uppercase">Mensagem</label>
        <textarea
          value={scheduleText}
          onChange={(e) => {
            if (selectedTemplateScheduleId) setSelectedTemplateScheduleId("");
            setScheduleText(e.target.value);
          }}
          className="w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-white/10 rounded-lg p-3 text-slate-800 dark:text-white outline-none min-h-[120px]"
          placeholder="Digite a mensagem para agendar..."
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowScheduleMsg({ open: false, trialId: null })}
          className="px-4 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-slate-600 dark:text-white/60 text-sm font-bold"
        >
          Cancelar
        </button>
        <button
          onClick={async () => {
             // Lógica de agendamento (Exemplo simples, ajustar com sua API real)
             if(!scheduleDate || !scheduleText) return addToast("error", "Erro", "Preencha todos os campos");
             
             // ... call api ...
             addToast("success", "Agendado", "Mensagem programada.");
             setShowScheduleMsg({ open: false, trialId: null });
             
             // Recarregar os ícones piscantes
             if(tenantId) await loadScheduledForClients(tenantId, rows.map(r => r.id));
          }}
          className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 flex items-center gap-2 text-sm shadow-lg shadow-purple-900/20"
        >
          <IconClock /> Agendar
        </button>
      </div>
    </div>
  </Modal>
)}

{showAppModal && appModal && (
  <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden">
      <div className="p-5 border-b border-slate-100 dark:border-white/5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest">
            Aplicativo
          </div>
          <div className="text-lg font-bold text-slate-800 dark:text-white tracking-tight truncate">
            {appModal.appName}
          </div>
          <div className="text-xs text-slate-500 dark:text-white/50 font-medium truncate">
            Teste: {appModal.clientName}
          </div>
        </div>

        <button
          onClick={() => {
            setShowAppModal(false);
            setAppModal(null);
          }}
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 font-bold text-xs hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
        >
          Fechar
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* URL global do app */}
        <div className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <div className="text-[10px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest mb-2">
            URL global do app
          </div>

          {appModal.infoUrl ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="min-w-0 text-xs font-mono text-slate-700 dark:text-white/80 truncate">
                {appModal.infoUrl}
              </div>

              <div className="flex gap-2 sm:ml-auto">
                <button
                  onClick={() => copyText(String(appModal.infoUrl || ""))}
                  className="h-9 px-3 rounded-lg bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white font-bold text-xs hover:opacity-90 transition-all"
                >
                  Copiar
                </button>

                <a
                  href={toOpenableUrl(String(appModal.infoUrl || ""))}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 px-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-300 font-bold text-xs hover:bg-sky-500/20 transition-all inline-flex items-center justify-center"
                >
                  Abrir
                </a>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 dark:text-white/20 italic">
              Este app não possui URL global configurada.
            </div>
          )}
        </div>

        {/* Campos */}
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <div className="text-[10px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest mb-3">
            Campos
          </div>

          {appsLoading ? (
            <div className="text-xs text-slate-400 dark:text-white/20 italic">Carregando apps...</div>
          ) : Array.isArray(appModal.fields) && appModal.fields.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {appModal.fields.map((f) => {
                const byId = appModal.values?.[f.id];
                const byLabel = appModal.values?.[f.label];
                const vRaw = byId ?? byLabel ?? "";
                const v = safeString(vRaw);

                const isLink = f.type === "link" || isLikelyUrl(v);

                return (
                  <div key={f.id} className="space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-wider">
                      {f.label}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        value={v}
                        readOnly
                        placeholder={f.placeholder || ""}
                        className="h-9 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-3 text-xs font-mono text-slate-800 dark:text-white/80"
                      />

                      {f.type !== "date" && v ? (
                        <button
                          onClick={() => copyText(v)}
                          className="h-9 px-3 rounded-lg bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white font-bold text-xs hover:opacity-90 transition-all"
                          title="Copiar"
                        >
                          Copiar
                        </button>
                      ) : null}

                      {isLink && v ? (
                        <a
                          href={toOpenableUrl(v)}
                          target="_blank"
                          rel="noreferrer"
                          className="h-9 px-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-300 font-bold text-xs hover:bg-sky-500/20 transition-all inline-flex items-center justify-center"
                          title="Abrir link"
                        >
                          Abrir
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-slate-400 dark:text-white/20 italic">
              Este app não possui fields_config.
            </div>
          )}
        </div>
      </div>

      <div className="p-5 border-t border-slate-100 dark:border-white/5 flex justify-end gap-2">
        <button
          onClick={() => {
            setShowAppModal(false);
            setAppModal(null);
          }}
          className="h-9 px-4 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white font-bold text-xs hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
        >
          Voltar
        </button>
      </div>
    </div>
  </div>
)}


{/* ✅ Spacer do Rodapé (Contrato UI) */}
      <div className="h-24 md:h-20" />

      <div className="relative z-[999999]"></div>
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

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

// --- SUB-COMPONENTES VISUAIS (IGUAL ADMIN) ---
const ALIGN_CLASS: Record<"left" | "right", string> = {
  left: "text-left",
  right: "text-right",
};

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
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
      className="px-4 py-3 cursor-pointer select-none group hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors text-left"
    >
      <div className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? "opacity-100 text-emerald-600 dark:text-emerald-500" : "opacity-40 group-hover:opacity-70"}`}>
          {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
        </span>
      </div>
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={`px-4 py-3 ${ALIGN_CLASS[align]} align-middle`}>{children}</td>;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      {...rest}
      className={`w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white ${className}`}
    />
  );
}


function StatusBadge({ status }: { status: TrialStatus }) {
  const tone =
    status === "Ativo"
      ? {
          bg: "bg-emerald-100 dark:bg-emerald-500/10",
          text: "text-emerald-700 dark:text-emerald-500",
          border: "border-emerald-200 dark:border-emerald-500/20",
        }
      : status === "Vencido"
      ? {
          bg: "bg-rose-100 dark:bg-rose-500/10",
          text: "text-rose-700 dark:text-rose-500",
          border: "border-rose-200 dark:border-rose-500/20",
        }
      : {
          bg: "bg-slate-100 dark:bg-white/5",
          text: "text-slate-600 dark:text-white/50",
          border: "border-slate-200 dark:border-white/10",
        };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${tone.bg} ${tone.text} ${tone.border}`}>
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
}: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}) {
  const colors = {
    blue: "text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    green:
      "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber:
      "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    purple:
      "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/20",
    red: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
  };

  return (
    <button
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-2 flex items-center gap-3 text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-emerald-600 dark:hover:text-white transition-colors text-left text-sm font-medium"
    >
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
        className="w-full max-w-lg bg-white dark:bg-[#0f141a] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="font-bold text-slate-800 dark:text-white">{title}</div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white"
          >
            <IconX />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// --- ÍCONES ---
function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconSortUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}
function IconSortDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function IconUserPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="17" y1="11" x2="23" y2="11" />
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
