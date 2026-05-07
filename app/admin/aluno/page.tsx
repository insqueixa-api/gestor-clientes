"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import NovoAluno from "./NovoAluno";
import RecargaAluno from "./RecargaAluno";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import Link from "next/link";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const JSONB_COLUMN = "dados_extras";

const SCREEN_LABELS: Record<number, string> = { 1: "Individual", 2: "Família", 3: "Família Total" };
function screenToLabel(n: number) { return SCREEN_LABELS[n] || `${n}x`; }

// ─── TIPOS ────────────────────────────────────────────────────────────────────

type AlunoStatus = "Ativo" | "Vencido" | "Arquivado";
type SortKey = "name" | "due" | "status" | "modalidade" | "tipo_plano" | "recorrencia" | "value";
type SortDir  = "asc" | "desc";

type DadosAluno = {
  modalidade?: string;
  campos_detalhamento?: any[];
  foto_url?: string;
  data_nascimento?: string;
  cpf_rg?: string;
  contato_emergencia_parentesco?: string;
  saude?: any;
};

type VwClientRow = {
  id: string; tenant_id: string;
  client_name: string | null; username: string | null;
  vencimento: string | null; computed_status: string;
  client_is_archived: boolean | null;
  screens: number | null; plan_name: string | null;
  plan_table_id?: string | null;
  price_amount: number | null; price_currency: string | null;
  server_id: string | null; server_name: string | null;
  whatsapp_e164: string | null; whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  secondary_display_name?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;
  dont_message_until: string | null; notes: string | null;
  alerts_open: number | null; // Adicione este campo
};

type AlunoRow = {
  id: string; name: string; username: string;
  dueISODate: string; dueLabelDate: string; dueTime: string;
  status: AlunoStatus; archived: boolean;
  screens: number; tipoplano: string; recorrencia: string; rawPlanName: string;
  valueCents: number; valueLabel: string;
  server_id: string; plan_table_id?: string;
  whatsapp: string; whatsapp_username?: string;
  price_amount?: number; price_currency?: string;
  secondary_display_name?: string; secondary_phone_e164?: string;
  secondary_whatsapp_username?: string;
  rawVencimento?: string | null;
  whatsapp_opt_in?: boolean; notes?: string; dont_message_until?: string;
  dados: DadosAluno;
  alertsCount: number; // Adicione este campo
};

type ScheduledMsg = { id: string; client_id: string; send_at: string; message: string; status?: string | null; };
type MessageTemplate = { id: string; name: string; content: string; image_url?: string | null; category?: string | null; };

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isoDateInSaoPaulo(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function addDaysIso(iso: string, days: number) {
  const b = new Date(`${iso}T12:00:00-03:00`);
  b.setDate(b.getDate() + days);
  return isoDateInSaoPaulo(b);
}

function getDiffDays(isoTarget: string) {
  if (!isoTarget || isoTarget === "9999-12-31") return 9999;
  const today = isoDateInSaoPaulo();
  return Math.ceil((new Date(`${isoTarget}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
}

function formatDue(raw: string | null) {
  if (!raw) return { dueISODate: "9999-12-31", dueLabelDate: "—", dueTime: "—" };
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return { dueISODate: "9999-12-31", dueLabelDate: "—", dueTime: "—" };
  const isoDate = isoDateInSaoPaulo(dt);
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(dt);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return { dueISODate: isoDate, dueLabelDate: `${get("day")}/${get("month")}/${get("year")}`, dueTime: `${get("hour")}:${get("minute")}` };
}

function formatMoney(amount: number | null, currency: string | null) {
  if (!amount || amount <= 0) return { value: 0, label: "—" };
  const cur = currency || "BRL";
  return { value: amount, label: new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(amount) };
}

function mapStatus(computed: string, archived: boolean, vencimento: string | null): AlunoStatus {
  if (archived) return "Arquivado";
  if (vencimento && Date.now() > new Date(vencimento).getTime()) return "Vencido";
  return ({ ACTIVE: "Ativo", OVERDUE: "Vencido", TRIAL: "Ativo", ARCHIVED: "Arquivado" } as any)[computed] || "Ativo";
}

function extractRecorrencia(planName: string) {
  const p = (planName || "").trim();
  if (!p || p === "—") return "—";
  if (p.includes("-")) return p.split("-").pop()?.trim() || p;
  return p;
}

function saoPauloToIso(local: string) { return `${local}:00`; }

function compareText(a: string, b: string) { return a.localeCompare(b, "pt-BR", { sensitivity: "base" }); }

function statusRank(s: AlunoStatus) { return s === "Vencido" ? 3 : s === "Arquivado" ? 2 : 1; }

function queueToast(toast: { type: "success" | "error"; title: string; message?: string }) {
  try {
    const key = "alunos_list_toasts";
    const arr = JSON.parse(window.sessionStorage.getItem(key) || "[]");
    arr.push({ ...toast, ts: Date.now() });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

// ─── HELPERS WHATSAPP ─────────────────────────────────────────────────────────

function buildWaLabel(profile: any, name: string) {
  if (!profile?.connected) return `${name} (desconectado)`;
  const digits = String(profile?.jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4); const rest = digits.slice(4);
    return `${name}  |  +55 (${ddd}) ${rest.length === 9 ? `${rest.slice(0,5)}-${rest.slice(5)}` : `${rest.slice(0,4)}-${rest.slice(4)}`}`;
  }
  return `${name} (conectado)`;
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

function AlunosPageContent() {
  const [rows, setRows]           = useState<AlunoRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [tenantId, setTenantId]   = useState<string | null>(null);
  const loadingRef                = useRef(false);

  // ─── Filtros ─────────────────────────────────────────────────────────────
  const [search, setSearch]                   = useState("");
  const [statusFilter, setStatusFilter]       = useState<"Todos" | AlunoStatus>("Todos");
  const [modalidadeFilter, setModalidadeFilter] = useState("Todos");
  const [tipoPlanFilter, setTipoPlanFilter]   = useState("Todos");
  const [recorrenciaFilter, setRecorrenciaFilter] = useState("Todos");
  const [dueFilter, setDueFilter]             = useState("Todos");
  const [archivedFilter, setArchivedFilter]   = useState<"Não" | "Sim">("Não");
  const [pageSize, setPageSize]               = useState(100);
  const [page, setPage]                       = useState(1);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [valuesHidden, setValuesHidden]       = useState(false);

  // ─── Sort ─────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey]     = useState<SortKey>("due");
  const [sortDir, setSortDir]     = useState<SortDir>("asc");
  const [isDefaultSort, setIsDefaultSort] = useState(true);

  // ─── Seleção ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // ─── Modais ───────────────────────────────────────────────────────────────
  const [showFormModal, setShowFormModal]   = useState(false);
  const [alunoToEdit, setAlunoToEdit]       = useState<AlunoRow | null>(null);
  const [showRenewId, setShowRenewId]       = useState<string | null>(null);
  const [enlargedPhoto, setEnlargedPhoto]   = useState<string | null>(null); // Novo estado para foto grande
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [renewingId, setRenewingId]         = useState<string | null>(null);

  // Mensagens
  const [msgMenuForId, setMsgMenuForId]     = useState<string | null>(null);
  const [showSendNow, setShowSendNow]       = useState<{ open: boolean; clientId: string | null }>({ open: false, clientId: null });
  const [showScheduleMsg, setShowScheduleMsg] = useState<{ open: boolean; clientId: string | null }>({ open: false, clientId: null });
  const [messageText, setMessageText]       = useState("");
  const [scheduleText, setScheduleText]     = useState("");
  const [scheduleDate, setScheduleDate]     = useState("");
  const [scheduling, setScheduling]         = useState(false);
  const [sendingNow, setSendingNow]         = useState(false);
  const sendNowAbortRef                     = useRef<AbortController | null>(null);

  // Templates + sessões
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateNowId, setSelectedTemplateNowId]       = useState("");
  const [selectedTemplateScheduleId, setSelectedTemplateScheduleId] = useState("");
  const [selectedSessionNow, setSelectedSessionNow]             = useState("default");
  const [selectedSessionSchedule, setSelectedSessionSchedule]   = useState("default");
  const [sessionOptions, setSessionOptions]                     = useState<{ id: string; label: string }[]>([
    { id: "default", label: "Carregando..." },
  ]);

  // Alertas
  const [showNewAlert, setShowNewAlert]   = useState<{ open: boolean; clientId: string | null; clientName?: string }>({ open: false, clientId: null });
  const [showAlertList, setShowAlertList] = useState<{ open: boolean; clientId: string | null; clientName?: string }>({ open: false, clientId: null });
  const [newAlertText, setNewAlertText]   = useState("");
  const [clientAlerts, setClientAlerts]   = useState<any[]>([]);

  // Agendamentos
  const [scheduledMap, setScheduledMap]   = useState<Record<string, ScheduledMsg[]>>({});
  const [showScheduledModal, setShowScheduledModal] = useState<{ open: boolean; clientId: string | null; clientName?: string }>({ open: false, clientId: null });

  // Toast + Confirm
  const [toasts, setToasts]     = useState<ToastMessage[]>([]);
  const toastTimersRef          = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const { confirm, ConfirmUI }  = useConfirm();

  function addToast(type: "success" | "error" | "warning", title: string, message?: string) {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, type, title, message }]);
    if (toastTimersRef.current[id]) clearTimeout(toastTimersRef.current[id]);
    toastTimersRef.current[id] = setTimeout(() => removeToast(id), 5000);
  }
  function removeToast(id: number) {
    clearTimeout(toastTimersRef.current[id]);
    delete toastTimersRef.current[id];
    setToasts(p => p.filter(t => t.id !== id));
  }
  useEffect(() => () => { Object.values(toastTimersRef.current).forEach(clearTimeout); }, []);

  // ─── FUNÇÕES AUXILIARES ───────────────────────────────────────────────────

  async function getToken() {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session?.access_token) throw new Error("Sem sessão");
    return session.access_token;
  }

  async function loadWhatsAppSessions() {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/whatsapp/profile",  { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
        fetch("/api/whatsapp/profile2", { cache: "no-store" }).then(r => r.json()).catch(() => ({})),
      ]);
      const n1 = localStorage.getItem("wa_label_1") || "Principal";
      const n2 = localStorage.getItem("wa_label_2") || "Secundária";
      setSessionOptions([
        { id: "default",  label: buildWaLabel(r1, n1) },
        { id: "session2", label: buildWaLabel(r2, n2) },
      ]);
    } catch {}
  }

  async function loadMessageTemplates(tid: string) {
    const { data } = await supabaseBrowser
      .from("message_templates").select("id,name,content,image_url,category")
      .eq("tenant_id", tid).order("name");
    if (!data) return;
    const mapped = (data as any[]).map(r => ({
      id: String(r.id), name: String(r.name ?? ""),
      content: String(r.content ?? ""), image_url: r.image_url || null,
      category: r.category || "Geral",
    })) as MessageTemplate[];
    setMessageTemplates(mapped);
    // Seleciona Pagamento Realizado como padrão
    const def = mapped.find(t => t.name.toLowerCase().includes("pagamento"));
    if (def) setSelectedTemplateNowId(def.id);
  }

  async function loadScheduledForClients(tid: string, clientIds: string[]) {
    if (!clientIds.length) { setScheduledMap({}); return; }
    const { data } = await supabaseBrowser
      .from("client_message_jobs")
      .select("id, client_id, send_at, message, status")
      .eq("tenant_id", tid).in("client_id", clientIds)
      .in("status", ["SCHEDULED", "QUEUED"])
      .gte("send_at", new Date().toISOString())
      .order("send_at", { ascending: true });
    const map: Record<string, ScheduledMsg[]> = {};
    for (const r of (data as any[]) || []) {
      const cid = String(r.client_id);
      if (!map[cid]) map[cid] = [];
      map[cid].push({ id: String(r.id), client_id: cid, send_at: String(r.send_at), message: String(r.message ?? ""), status: r.status });
    }
    setScheduledMap(map);
  }

  // ─── CARREGAMENTO ─────────────────────────────────────────────────────────

  async function loadData() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      setTenantId(tid);

      // Verifica acesso
      const { data: tenantRow } = await supabaseBrowser
        .from("tenants").select("active_modules").eq("id", tid).maybeSingle();
      const mods = tenantRow?.active_modules || [];
      if (!(mods.includes("academia") || mods.includes("personal"))) {
        setHasAccess(false); return;
      }
      setHasAccess(true);

      await Promise.all([loadWhatsAppSessions(), loadMessageTemplates(tid)]);

      const viewName = archivedFilter === "Sim" ? "vw_clients_list_archived" : "vw_clients_list_active";
      const { data, error } = await supabaseBrowser
        .from(viewName).select("*").eq("tenant_id", tid)
        .order("vencimento", { ascending: true });

      if (error) { addToast("error", "Erro ao carregar alunos", error.message); setRows([]); return; }

      const typed = (data || []) as VwClientRow[];
      const ids   = typed.map(r => String(r.id));

      // Busca JSONB separadamente
      let dadosMap: Record<string, DadosAluno> = {};
      if (ids.length) {
        const { data: cData } = await supabaseBrowser
          .from("clients").select(`id, ${JSONB_COLUMN}`)
          .eq("tenant_id", tid).in("id", ids);
        for (const row of cData || []) dadosMap[String(row.id)] = (row[JSONB_COLUMN] as DadosAluno) || {};
      }

      const ts = Date.now(); // <-- NOVO: timestamp para quebrar o cache das imagens

      const mapped: AlunoRow[] = typed.map(r => {
        const due   = formatDue(r.vencimento);
        const money = formatMoney(r.price_amount, r.price_currency);
        const archived = Boolean(r.client_is_archived);
        const screens  = Number(r.screens || 1);
        const id       = String(r.id);

        // Tratamento para quebrar o cache da foto
        const rawDados = dadosMap[id] || {} as DadosAluno;
        let fotoUrlComCacheBuster = rawDados.foto_url;
        if (fotoUrlComCacheBuster) {
           const separator = fotoUrlComCacheBuster.includes("?") ? "&" : "?";
           fotoUrlComCacheBuster = `${fotoUrlComCacheBuster}${separator}cb=${ts}`;
        }

        return {
          id, name: String(r.client_name ?? "Sem Nome"),
          username: String(r.username ?? "—"),
          dueISODate: due.dueISODate, dueLabelDate: due.dueLabelDate, dueTime: due.dueTime,
          status: mapStatus(String(r.computed_status), archived, r.vencimento),
          archived, screens,
          tipoplano: screenToLabel(screens),
          recorrencia: extractRecorrencia(String(r.plan_name ?? "")),
          rawPlanName: String(r.plan_name ?? "—"),
          valueCents: Math.round(money.value * 100), valueLabel: money.label,
          server_id: String(r.server_id ?? ""),
          plan_table_id: r.plan_table_id ?? undefined,
          whatsapp: String(r.whatsapp_e164 ?? ""),
          whatsapp_username: r.whatsapp_username ?? undefined,
          price_amount: r.price_amount ?? undefined,
          price_currency: r.price_currency ?? undefined,
          secondary_display_name: r.secondary_display_name ?? undefined,
          secondary_phone_e164: r.secondary_phone_e164 ?? undefined,
          secondary_whatsapp_username: r.secondary_whatsapp_username ?? undefined,
          rawVencimento: r.vencimento,
          whatsapp_opt_in: r.whatsapp_opt_in ?? undefined,
          notes: r.notes ?? "",
          dont_message_until: r.dont_message_until ?? undefined,
          dados: { ...rawDados, foto_url: fotoUrlComCacheBuster }, // <-- ALTERADO
          alertsCount: Number(r.alerts_open || 0),
        };
      });

      setRows(mapped);
      await loadScheduledForClients(tid, mapped.map(m => m.id));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [archivedFilter]); // eslint-disable-line

  // Toast pós-refresh
  useEffect(() => {
    if (loading) return;
    try {
      const key = "alunos_list_toasts";
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;
      window.sessionStorage.removeItem(key);
      JSON.parse(raw).forEach((t: any) => addToast(t.type, t.title, t.message));
    } catch {}
  }, [loading]);

  // ─── FILTROS + SORT ───────────────────────────────────────────────────────

  const uniqueModalidades = useMemo(() => Array.from(new Set(rows.map(r => r.dados?.modalidade).filter(Boolean) as string[])).sort(), [rows]);
  const uniqueRecorrencias = useMemo(() => Array.from(new Set(rows.map(r => r.recorrencia).filter(r => r !== "—"))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const today = isoDateInSaoPaulo();

    return rows.filter(r => {
      if (statusFilter !== "Todos" && r.status !== statusFilter) return false;
      if (modalidadeFilter !== "Todos" && r.dados?.modalidade !== modalidadeFilter) return false;
      if (tipoPlanFilter !== "Todos" && r.tipoplano !== tipoPlanFilter) return false;
      if (recorrenciaFilter !== "Todos" && r.recorrencia !== recorrenciaFilter) return false;

      if (dueFilter !== "Todos") {
        const diff = getDiffDays(r.dueISODate);
        if (dueFilter === "Venceu há 2 dias" && diff !== -2) return false;
        if (dueFilter === "Venceu Ontem"     && diff !== -1) return false;
        if (dueFilter === "Hoje"             && diff !== 0 ) return false;
        if (dueFilter === "Vence Amanhã"     && diff !== 1 ) return false;
        if (dueFilter === "Vence em 2 dias"  && diff !== 2 ) return false;
        if (dueFilter === "Mês Atual" && !r.dueISODate.startsWith(today.slice(0, 7))) return false;
      }

      if (q) {
        const hay = [
          r.name, r.username,
          r.secondary_display_name ?? "",
          r.whatsapp, r.whatsapp_username ?? "",
          r.secondary_phone_e164 ?? "",
          r.dados?.cpf_rg ?? "",
          r.dados?.modalidade ?? "",
          r.tipoplano, r.recorrencia,
        ].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, modalidadeFilter, tipoPlanFilter, recorrenciaFilter, dueFilter]);

  useEffect(() => { setPage(1); }, [search, statusFilter, modalidadeFilter, tipoPlanFilter, recorrenciaFilter, dueFilter, archivedFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];

    if (isDefaultSort && sortKey === "due" && sortDir === "asc") {
      list.sort((a, b) => {
        const da = getDiffDays(a.dueISODate), db = getDiffDays(b.dueISODate);
        const mainA = da >= -2, mainB = db >= -2;
        if (mainA && !mainB) return -1;
        if (!mainA && mainB) return 1;
        return a.dueISODate !== b.dueISODate ? a.dueISODate.localeCompare(b.dueISODate) : a.dueTime.localeCompare(b.dueTime);
      });
      return list;
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":       cmp = compareText(a.name, b.name); break;
        case "due":        cmp = compareText(`${a.dueISODate} ${a.dueTime}`, `${b.dueISODate} ${b.dueTime}`); break;
        case "status":     cmp = statusRank(a.status) - statusRank(b.status); break;
        case "modalidade": cmp = compareText(a.dados?.modalidade || "", b.dados?.modalidade || ""); break;
        case "tipo_plano": cmp = a.screens - b.screens; break;
        case "recorrencia": cmp = compareText(a.recorrencia, b.recorrencia); break;
        case "value":      cmp = a.valueCents - b.valueCents; break;
      }
      if (cmp === 0) cmp = compareText(`${a.dueISODate} ${a.dueTime}`, `${b.dueISODate} ${b.dueTime}`);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir, isDefaultSort]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sorted.length / pageSize)), [sorted.length, pageSize]);
  const safePage   = useMemo(() => Math.min(Math.max(1, page), totalPages), [page, totalPages]);
  const visible    = useMemo(() => sorted.slice((safePage - 1) * pageSize, safePage * pageSize), [sorted, safePage, pageSize]);

  useEffect(() => { if (page !== safePage) setPage(safePage); }, [safePage]); // eslint-disable-line

  useEffect(() => {
    const el = selectAllRef.current; if (!el) return;
    const total = visible.length, sel = visible.filter(r => selectedIds.has(r.id)).length;
    el.indeterminate = sel > 0 && sel < total;
  }, [selectedIds, visible]);

  function toggleSort(key: SortKey) {
    setIsDefaultSort(false);
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  // ─── AÇÕES ────────────────────────────────────────────────────────────────

  async function handleArchiveToggle(r: AlunoRow) {
    if (!tenantId) return;
    const going = !r.archived;
    const ok = await confirm({
      title: going ? "Arquivar aluno" : "Restaurar aluno",
      subtitle: going ? "O aluno irá para a Lixeira." : "O aluno voltará para a lista ativa.",
      tone: going ? "amber" : "emerald", icon: going ? "🗑️" : "↩️",
      details: [`Aluno: ${r.name}`, going ? "Destino: Lixeira" : "Destino: Ativos"],
      confirmText: going ? "Arquivar" : "Restaurar", cancelText: "Voltar",
    });
    if (!ok) return;
    const { error } = await supabaseBrowser.rpc("update_client", { p_tenant_id: tenantId, p_client_id: r.id, p_is_archived: going });
    if (error) { addToast("error", "Falha ao atualizar", error.message); return; }
    queueToast({ type: "success", title: going ? "Aluno arquivado" : "Aluno restaurado" });
    loadData();
  }

  async function handleDeleteForever(r: AlunoRow) {
    if (!tenantId || !r.archived) return;
    const ok = await confirm({
      title: "Excluir definitivamente", subtitle: "Essa ação NÃO pode ser desfeita.",
      tone: "rose", icon: "⚠️",
      details: [`Aluno: ${r.name}`, "Ação: excluir para sempre"],
      confirmText: "Excluir", cancelText: "Voltar",
    });
    if (!ok) return;
    const { error } = await supabaseBrowser.rpc("delete_client_forever", { p_tenant_id: tenantId, p_client_id: r.id });
    if (error) addToast("error", "Falha ao excluir", error.message);
    else { addToast("success", "Excluído", "Aluno removido definitivamente."); loadData(); }
  }

  async function handleSendMessage() {
    if (!tenantId || !showSendNow.clientId || sendingNow) return;
    const msg = messageText.trim();
    if (!msg) { addToast("error", "Mensagem vazia", "Digite uma mensagem antes de enviar."); return; }
    setSendingNow(true);
    if (sendNowAbortRef.current) { try { sendNowAbortRef.current.abort(); } catch {} }
    const controller = new AbortController();
    sendNowAbortRef.current = controller;
    try {
      const token = await getToken();
      const res = await fetch("/api/whatsapp/envio_agora", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, client_id: showSendNow.clientId, message: msg, whatsapp_session: selectedSessionNow, message_template_id: selectedTemplateNowId || null }),
      });
      if (!res.ok) throw new Error("Falha ao enviar");
      addToast("success", "Enviado", "Mensagem enviada via WhatsApp.");
      setShowSendNow({ open: false, clientId: null }); setMessageText(""); setSelectedTemplateNowId("");
    } catch (e: any) { if (e?.name !== "AbortError") addToast("error", "Falha no Envio", e.message); }
    finally { setSendingNow(false); sendNowAbortRef.current = null; }
  }

  async function handleScheduleMessage() {
    if (!tenantId || !showScheduleMsg.clientId || scheduling) return;
    const msg = scheduleText.trim();
    if (!msg)          { addToast("error", "Mensagem vazia", "Digite uma mensagem."); return; }
    if (!scheduleDate) { addToast("error", "Data obrigatória", "Selecione data e hora."); return; }
    const check = new Date(`${scheduleDate}:00-03:00`).getTime();
    if (!isFinite(check) || check <= Date.now()) { addToast("error", "Data inválida", "Escolha uma data futura."); return; }
    setScheduling(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/whatsapp/envio_programado", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, client_id: showScheduleMsg.clientId, message: msg, send_at: saoPauloToIso(scheduleDate), whatsapp_session: selectedSessionSchedule, message_template_id: selectedTemplateScheduleId || null }),
      });
      if (!res.ok) throw new Error("Falha ao agendar");
      addToast("success", "Agendado", "Mensagem programada com sucesso.");
      setShowScheduleMsg({ open: false, clientId: null }); setScheduleText(""); setScheduleDate(""); setSelectedTemplateScheduleId("");
      if (tenantId) await loadScheduledForClients(tenantId, rows.map(x => x.id));
    } catch { addToast("error", "Falha no Agendamento", "Não foi possível agendar."); }
    finally { setScheduling(false); }
  }

  async function handleSaveAlert() {
    if (!newAlertText.trim() || !showNewAlert.clientId || !tenantId) return;
    const { error } = await supabaseBrowser.from("client_alerts")
      .insert({ tenant_id: tenantId, client_id: showNewAlert.clientId, message: newAlertText, status: "OPEN" });
    if (error) { addToast("error", "Erro ao criar alerta", error.message); return; }
    addToast("success", "Alerta criado");
    setShowNewAlert({ open: false, clientId: null }); setNewAlertText("");
    loadData();
  }

  async function handleOpenAlertList(clientId: string, clientName: string) {
    setClientAlerts([]); setShowAlertList({ open: true, clientId, clientName });
    if (!tenantId) return;
    const { data } = await supabaseBrowser.from("client_alerts")
      .select("*").eq("tenant_id", tenantId).eq("client_id", clientId).eq("status", "OPEN")
      .order("created_at", { ascending: false });
    setClientAlerts(data || []);
  }

  async function handleDeleteAlert(alertId: string) {
    if (!tenantId) return;
    const it = (clientAlerts as any[]).find(a => String(a.id) === alertId);
    const ok = await confirm({ title: "Remover alerta", subtitle: "Será removido permanentemente.", tone: "rose", icon: "⚠️", details: [`Alerta: ${it?.message?.slice(0, 80) || "—"}`], confirmText: "Remover", cancelText: "Voltar" });
    if (!ok) return;
    const { error } = await supabaseBrowser.from("client_alerts").delete().eq("id", alertId);
    if (error) { addToast("error", "Erro ao excluir", error.message); return; }
    setClientAlerts(p => (p as any[]).filter(a => a.id !== alertId));
    loadData();
  }

  async function handleClickRenew(r: AlunoRow) {
    setRenewingId(r.id);
    setTimeout(() => { setShowRenewId(r.id); setTimeout(() => setRenewingId(null), 2000); }, 50);
  }

  async function handleOpenEdit(r: AlunoRow) {
    setEditingId(r.id);
    setTimeout(() => {
      setAlunoToEdit(r);
      setShowFormModal(true);
      setTimeout(() => setEditingId(null), 2000);
    }, 50);
  }

  function resetFilters() {
    setSearch(""); setStatusFilter("Todos"); setModalidadeFilter("Todos");
    setTipoPlanFilter("Todos"); setRecorrenciaFilter("Todos"); setDueFilter("Todos");
    setArchivedFilter("Não"); setSortKey("due"); setSortDir("asc"); setIsDefaultSort(true);
  }

  const hasActiveFilters = search.trim() || statusFilter !== "Todos" || modalidadeFilter !== "Todos" || tipoPlanFilter !== "Todos" || recorrenciaFilter !== "Todos" || dueFilter !== "Todos" || archivedFilter === "Sim";

  // ─── GUARDS ───────────────────────────────────────────────────────────────

  if (hasAccess === null) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f141a]"><div className="text-slate-400 animate-pulse font-bold">Verificando permissões...</div></div>;
  }
  if (hasAccess === false) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6">
        <div className="w-20 h-20 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mb-6 text-3xl">🔒</div>
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white mb-2">Acesso Restrito</h1>
        <p className="text-slate-500 dark:text-white/60">Esta página é exclusiva para módulos Academia e Personal.</p>
      </div>
    );
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors" onClick={() => setMsgMenuForId(null)}>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0 md:px-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">Gestão de Alunos</h1>
          <button
            onClick={e => { e.stopPropagation(); setValuesHidden(v => !v); }}
            title={valuesHidden ? "Exibir valores" : "Ocultar valores"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white transition-all text-xs font-medium shadow-sm"
          >
            {valuesHidden
              ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
              : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12S5.5 5 12 5s10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="2.8" fill="currentColor" stroke="none"/></svg>}
            <span className="hidden sm:inline text-[11px]">{valuesHidden ? "Exibir" : "Ocultar"}</span>
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); setArchivedFilter(v => v === "Não" ? "Sim" : "Não"); }}
            className={`hidden md:inline-flex h-10 px-3 rounded-lg text-xs font-bold border transition-colors items-center ${archivedFilter === "Sim" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60"}`}
          >
            {archivedFilter === "Sim" ? "Ocultar Lixeira" : "Ver Lixeira"}
          </button>
          <button
            onClick={e => { e.stopPropagation(); setAlunoToEdit(null); setShowFormModal(true); }}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg transition-all"
          >
            <span>+</span> Novo Aluno
          </button>
        </div>
      </div>

      {/* --- BARRA DE FILTROS COMPLETA --- */}
      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20" onClick={e => e.stopPropagation()}>
        <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider mb-2">Filtros Rápidos</div>

        {/* ✅ MOBILE (somente): pesquisa + botão abrir painel */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"><IconX /></button>}
          </div>
          <button
            onClick={() => setMobileFiltersOpen(v => !v)}
            className={`h-10 px-3 rounded-lg border font-bold text-sm transition-colors ${hasActiveFilters ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10"}`}
            title="Filtros"
          >
            Filtros
          </button>
        </div>

        {/* ✅ DESKTOP (somente): tudo na mesma linha */}
        <div className="hidden md:flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <div className="flex-1 min-w-[200px] relative">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar aluno, telefone..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"><IconX /></button>}
          </div>

          <div className="w-[140px] shrink-0">
            <FSel value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              <option value="Todos">Status (Todos)</option>
              <option value="Ativo">Ativo</option>
              <option value="Vencido">Vencido</option>
            </FSel>
          </div>

          <div className="w-[150px] shrink-0">
            <FSel value={modalidadeFilter} onChange={e => setModalidadeFilter(e.target.value)}>
              <option value="Todos">Modalidade (Todos)</option>
              {uniqueModalidades.map(m => <option key={m} value={m}>{m}</option>)}
            </FSel>
          </div>

          <div className="w-[150px] shrink-0">
            <FSel value={tipoPlanFilter} onChange={e => setTipoPlanFilter(e.target.value)}>
              <option value="Todos">Plano (Todos)</option>
              <option value="Individual">Individual</option>
              <option value="Família">Família</option>
              <option value="Família Total">Família Total</option>
            </FSel>
          </div>

          <div className="w-[150px] shrink-0">
            <FSel value={recorrenciaFilter} onChange={e => setRecorrenciaFilter(e.target.value)}>
              <option value="Todos">Recorrência (Todos)</option>
              {uniqueRecorrencias.map(r => <option key={r} value={r}>{r}</option>)}
            </FSel>
          </div>

          <div className="w-[160px] shrink-0">
            <FSel value={dueFilter} onChange={e => setDueFilter(e.target.value)}>
              <option value="Todos">Vencimento (Todos)</option>
              <option value="Venceu há 2 dias">Venceu há 2 dias</option>
              <option value="Venceu Ontem">Venceu Ontem</option>
              <option value="Hoje">Hoje</option>
              <option value="Vence Amanhã">Vence Amanhã</option>
              <option value="Vence em 2 dias">Vence em 2 dias</option>
              <option value="Mês Atual">Mês Atual</option>
            </FSel>
          </div>

          <button
            onClick={resetFilters}
            className="h-10 px-3 shrink-0 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <IconX /> Limpar
          </button>
        </div>

        {/* ✅ Painel de filtros no mobile */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-2">
            <button onClick={(e) => { e.stopPropagation(); setArchivedFilter(v => v === "Não" ? "Sim" : "Não"); }}
              className={`w-full h-10 px-3 rounded-lg text-sm font-bold border flex items-center justify-between transition-colors ${archivedFilter === "Sim" ? "bg-amber-500/10 text-amber-600 border-amber-500/30" : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70"}`}>
              <span className="flex items-center gap-2"><IconTrash /> Lixeira</span>
              <span className="text-xs opacity-80">{archivedFilter === "Sim" ? "ON" : "OFF"}</span>
            </button>

            <FSel value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              <option value="Todos">Status (Todos)</option>
              <option value="Ativo">Ativo</option>
              <option value="Vencido">Vencido</option>
            </FSel>

            <FSel value={modalidadeFilter} onChange={e => setModalidadeFilter(e.target.value)}>
              <option value="Todos">Modalidade (Todos)</option>
              {uniqueModalidades.map(m => <option key={m} value={m}>{m}</option>)}
            </FSel>

            <FSel value={tipoPlanFilter} onChange={e => setTipoPlanFilter(e.target.value)}>
              <option value="Todos">Tipo Plano (Todos)</option>
              <option value="Individual">Individual</option>
              <option value="Família">Família</option>
              <option value="Família Total">Família Total</option>
            </FSel>

            <FSel value={recorrenciaFilter} onChange={e => setRecorrenciaFilter(e.target.value)}>
              <option value="Todos">Recorrência (Todos)</option>
              {uniqueRecorrencias.map(r => <option key={r} value={r}>{r}</option>)}
            </FSel>

            <FSel value={dueFilter} onChange={e => setDueFilter(e.target.value)}>
              <option value="Todos">Vencimento (Todos)</option>
              <option value="Venceu há 2 dias">Venceu há 2 dias</option>
              <option value="Venceu Ontem">Venceu Ontem</option>
              <option value="Hoje">Hoje</option>
              <option value="Vence Amanhã">Vence Amanhã</option>
              <option value="Vence em 2 dias">Vence em 2 dias</option>
              <option value="Mês Atual">Mês Atual</option>
            </FSel>

            <button onClick={() => { resetFilters(); setMobileFiltersOpen(false); }}
              className="w-full h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold transition-colors flex items-center justify-center gap-2">
              <IconX /> Limpar
            </button>
          </div>
        )}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5">Carregando alunos...</div>
      ) : (
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors" onClick={e => e.stopPropagation()}>

          {/* Toolbar da tabela */}
          <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-800 dark:text-white whitespace-nowrap">
              Alunos <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-white/50">
              <div className="md:hidden">
                <select value={safePage} onChange={e => setPage(Number(e.target.value))} className="h-10 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-700 dark:text-white outline-none">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => <option key={n} value={n}>Pág. {n}</option>)}
                </select>
              </div>
              <div className="hidden md:flex items-center gap-3">
                <span>Mostrar</span>
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="bg-transparent border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 outline-none text-slate-700 dark:text-white cursor-pointer">
                  <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                </select>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 font-bold disabled:opacity-40 flex items-center justify-center">←</button>
                <span className="min-w-[90px] text-center">Pág. <strong>{safePage}</strong> / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="h-8 w-8 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 font-bold disabled:opacity-40 flex items-center justify-center">→</button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/40">
                  <th className="px-3 py-2 w-10">
                    <input ref={selectAllRef} type="checkbox"
                      checked={visible.length > 0 && visible.every(r => selectedIds.has(r.id))}
                      onChange={e => { const next = new Set(selectedIds); visible.forEach(r => e.target.checked ? next.add(r.id) : next.delete(r.id)); setSelectedIds(next); }}
                      className="rounded border-slate-300 dark:border-white/20" />
                  </th>
                  <ThSort label="Aluno"       active={sortKey === "name"}       dir={sortDir} onClick={() => toggleSort("name")} />
                  <ThSort label="Vencimento"  active={sortKey === "due"}        dir={sortDir} onClick={() => toggleSort("due")} />
                  <Th align="center"><SortClick label="Status"      active={sortKey === "status"}     dir={sortDir} onClick={() => toggleSort("status")} /></Th>
                  <Th align="center"><SortClick label="Modalidade"  active={sortKey === "modalidade"} dir={sortDir} onClick={() => toggleSort("modalidade")} /></Th>
                  <Th align="center"><SortClick label="Tipo Plano"  active={sortKey === "tipo_plano"} dir={sortDir} onClick={() => toggleSort("tipo_plano")} /></Th>
                  <Th align="center"><SortClick label="Recorrência" active={sortKey === "recorrencia"} dir={sortDir} onClick={() => toggleSort("recorrencia")} /></Th>
                  <Th align="center"><SortClick label="Valor"       active={sortKey === "value"}      dir={sortDir} onClick={() => toggleSort("value")} /></Th>
                  <Th align="center">Ações</Th>
                </tr>
              </thead>

              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.map(r => {
                  const diff = getDiffDays(r.dueISODate);
                  const schedCount = scheduledMap[r.id]?.length || 0;

                  return (
                    <tr key={r.id} className={`transition-colors group ${selectedIds.has(r.id) ? "bg-emerald-50/70 dark:bg-emerald-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selectedIds.has(r.id)}
                          onChange={e => { const next = new Set(selectedIds); e.target.checked ? next.add(r.id) : next.delete(r.id); setSelectedIds(next); }}
                          className="rounded border-slate-300 dark:border-white/20" />
                      </td>

                      {/* Aluno */}
                      <Td>
                        <div className="flex items-center gap-3">
                          {/* FOTO MINIATURA */}
                          {r.dados?.foto_url ? (
                            <div 
                              className="w-16 h-16 rounded-lg overflow-hidden border-2 border-emerald-500/20 shrink-0 cursor-pointer hover:opacity-80 hover:scale-105 transition-all shadow-sm"
                              onClick={(e) => { e.stopPropagation(); setEnlargedPhoto(r.dados.foto_url || null); }}
                              title="Ampliar foto"
                            >
                              <img src={r.dados.foto_url} alt={r.name} className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-white/5 border-2 border-slate-200 dark:border-white/10 shrink-0 flex items-center justify-center text-slate-400 text-2xl shadow-sm">
                              👤
                            </div>
                          )}

                          {/* DADOS DO ALUNO */}
                          <div className="flex flex-col max-w-[200px]">
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <Link href={`/admin/aluno/${r.id}`}
                                className="font-semibold text-slate-700 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors hover:underline decoration-emerald-500/30 truncate">
                                {r.name.split(" ")[0]}
                                {r.secondary_display_name && <span className="text-slate-400 dark:text-white/30 font-normal"> / {r.secondary_display_name.split(" ")[0]}</span>}
                              </Link>
                              
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

                                {schedCount > 0 && (
                                  <button onClick={e => { e.stopPropagation(); setShowScheduledModal({ open: true, clientId: r.id, clientName: r.name }); }}
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold hover:bg-purple-200 transition-colors animate-pulse" title="Agendamentos">
                                    🗓️ {schedCount}
                                  </button>
                                )}
                              </div>
                            </div>
                            
                            <span className={`text-xs font-medium text-slate-500 dark:text-white/70 truncate ${valuesHidden ? "blur-sm select-none" : ""}`}>{r.username}</span>
                            {r.whatsapp_username && <span className={`text-xs text-emerald-600 dark:text-emerald-400 truncate ${valuesHidden ? "blur-sm select-none" : ""}`}>@{r.whatsapp_username}</span>}
                            {r.secondary_whatsapp_username && <span className={`text-xs text-slate-400 dark:text-white/45 truncate ${valuesHidden ? "blur-sm select-none" : ""}`}>@{r.secondary_whatsapp_username}</span>}
                          </div>
                        </div>
                      </Td>

                      {/* Vencimento */}
                      <Td>
                        <span className="font-mono font-medium text-slate-600 dark:text-white/80">
                          {r.dueLabelDate}
                        </span>
                      </Td>

                      {/* Status com dias */}
                      <Td align="center">
                        {(() => {
                          let label = r.status as string;

                          // 1. Textos dinâmicos baseados nos dias
                          let textDiff = "";
                          if (diff < -2) textDiff = `Venceu há ${Math.abs(diff)} dias`;
                          else if (diff === -2) textDiff = "Venceu há 2 dias";
                          else if (diff === -1) textDiff = "Venceu Ontem";
                          else if (diff === 0) textDiff = "Vence Hoje";
                          else if (diff === 1) textDiff = "Vence Amanhã";
                          else if (diff === 2) textDiff = "Vence em 2 dias";
                          else if (diff > 2) textDiff = `Vence em ${diff} dias`;

                          // 2. Aplicação do texto no label
                          if (r.status === "Arquivado") {
                            label = textDiff ? `Lixeira (${textDiff})` : "Lixeira";
                          } else {
                            label = textDiff || label;
                          }

                          // 3. Regra exata de cores do Cliente
                          let tone: "green" | "red" | "amber" | "blue" = "blue";
                          if (r.status === "Vencido") {
                            tone = "red";
                          } else if (r.status === "Ativo") {
                            if (diff === 0) tone = "amber";
                            else tone = "green";
                          } else if (r.status === "Arquivado") {
                            tone = "red";
                          }

                          // 4. Classes otimizadas de tema claro/escuro
                          const colors = {
                            green: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-200 border-emerald-200 dark:border-emerald-400/30",
                            red: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-200 border-rose-200 dark:border-rose-400/30",
                            amber: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-200 border-amber-200 dark:border-amber-400/30",
                            blue: "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-200 border-sky-200 dark:border-sky-400/30"
                          };

                          return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${colors[tone]}`}>{label}</span>;
                        })()}
                      </Td>

                      {/* Modalidade */}
                      <Td align="center">
                        {r.dados?.modalidade
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/20 whitespace-nowrap">{r.dados.modalidade}</span>
                          : <span className="text-xs text-slate-400 italic">—</span>}
                      </Td>

                      {/* Tipo Plano */}
                      <Td align="center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 whitespace-nowrap">{r.tipoplano}</span>
                      </Td>

                      {/* Recorrência */}
                      <Td align="center">
                        <span className="text-slate-600 dark:text-white/80 text-xs">{r.recorrencia}</span>
                      </Td>

                      {/* Valor */}
                      <Td align="center">
                        <span className={`font-medium text-slate-700 dark:text-white/90 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}>{r.valueLabel}</span>
                      </Td>

                      {/* Ações */}
                      <Td align="center">
                        <div className="flex items-center justify-center gap-2 opacity-80 group-hover:opacity-100 relative">
                          {/* Mensagem */}
                          <div className="relative">
                            <IABtn title="Mensagem" tone="blue" onClick={e => { e.stopPropagation(); setMsgMenuForId(cur => cur === r.id ? null : r.id); }}><IconChat /></IABtn>
                            {msgMenuForId === r.id && (
                              <div onClick={e => e.stopPropagation()} className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f141a] z-50 shadow-2xl overflow-hidden">
                                <MItem icon={<IconSend />} label="Enviar agora"  onClick={() => { setMsgMenuForId(null); setMessageText(""); setSelectedTemplateNowId(""); setShowSendNow({ open: true, clientId: r.id }); }} />
                                <MItem icon={<IconClock />} label="Programar"    onClick={() => { setMsgMenuForId(null); setScheduleText(""); setScheduleDate(""); setSelectedTemplateScheduleId(""); setShowScheduleMsg({ open: true, clientId: r.id }); }} />
                              </div>
                            )}
                          </div>
                          {/* Renovar */}
                          {!r.archived && <IABtn title="Renovar" tone="green" loading={renewingId === r.id} onClick={e => { e.stopPropagation(); handleClickRenew(r); }}><IconMoney /></IABtn>}
                          {/* Editar */}
                          <IABtn title="Editar" tone="amber" loading={editingId === r.id} onClick={e => { e.stopPropagation(); handleOpenEdit(r); }}><IconEdit /></IABtn>
                          {/* Alerta */}
                          <IABtn title="Novo alerta" tone="purple" onClick={e => { e.stopPropagation(); setNewAlertText(""); setShowNewAlert({ open: true, clientId: r.id, clientName: r.name }); }}><IconBell /></IABtn>
                          {/* Arquivar/Restaurar */}
                          <IABtn title={r.archived ? "Restaurar" : "Arquivar"} tone={r.archived ? "green" : "red"} onClick={e => { e.stopPropagation(); handleArchiveToggle(r); }}>
                            {r.archived ? <IconRestore /> : <IconTrash />}
                          </IABtn>
                          {/* Excluir definitivo */}
                          {archivedFilter === "Sim" && r.archived && (
                            <IABtn title="Excluir definitivamente" tone="red" onClick={e => { e.stopPropagation(); handleDeleteForever(r); }}><IconTrashFull /></IABtn>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}

                {visible.length === 0 && (
                  <tr><td colSpan={9} className="p-8 text-center text-slate-400 dark:text-white/40 italic">Nenhum aluno encontrado.</td></tr>
                )}
              </tbody>
            </table>
            <div className="h-24 md:h-20" />
          </div>
        </div>
      )}

      {/* ═══════════════ MODAIS ═══════════════ */}

      {showFormModal && (
        <NovoAluno
          alunoToEdit={alunoToEdit}
          onClose={() => { setShowFormModal(false); setAlunoToEdit(null); }}
          onSuccess={() => { setShowFormModal(false); setAlunoToEdit(null); loadData(); }}
        />
      )}

      {showRenewId && (
        <RecargaAluno
          clientId={showRenewId}
          clientName={rows.find(r => r.id === showRenewId)?.name || ""}
          onClose={() => setShowRenewId(null)}
          onSuccess={() => { setShowRenewId(null); loadData(); }}
          toastKey="alunos_list_toasts"
        />
      )}

      {/* Enviar agora */}
      {showSendNow.open && (
        <Modal title="Enviar Mensagem Rápida" onClose={() => { setShowSendNow({ open: false, clientId: null }); setMessageText(""); setSelectedTemplateNowId(""); }}>
          <div className="space-y-4">
            <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">💬</span>
              <p className="text-sm text-sky-900 dark:text-sky-200">Mensagem enviada <strong>imediatamente</strong> via WhatsApp.</p>
            </div>
            <div><MLabel>Sessão</MLabel>
              <MSelect value={selectedSessionNow} onChange={e => setSelectedSessionNow(e.target.value)}>
                {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </MSelect>
            </div>
            <TemplateSelect templates={messageTemplates} value={selectedTemplateNowId} onChange={(id, content) => { setSelectedTemplateNowId(id); setMessageText(content); }} label="Mensagem pronta (opcional)" />
            <MTextArea value={messageText} disabled={!!selectedTemplateNowId} onChange={e => { if (selectedTemplateNowId) setSelectedTemplateNowId(""); setMessageText(e.target.value); }} placeholder="Digite a mensagem..." />
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowSendNow({ open: false, clientId: null })} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 text-sm font-bold">Cancelar</button>
              <button onClick={handleSendMessage} disabled={sendingNow} className="px-6 py-2 rounded-lg bg-sky-600 text-white font-bold hover:bg-sky-500 shadow-lg flex items-center gap-2 text-sm disabled:opacity-50">
                <IconSend /> {sendingNow ? "Enviando..." : "Enviar Agora"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Agendar */}
      {showScheduleMsg.open && (
        <Modal title="Agendar Mensagem" onClose={() => { setShowScheduleMsg({ open: false, clientId: null }); setScheduleText(""); setScheduleDate(""); setSelectedTemplateScheduleId(""); }}>
          <div className="space-y-4">
            <div><MLabel>Data e Hora do Envio</MLabel>
              <input type="datetime-local" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-purple-500 text-sm dark:[color-scheme:dark]" />
            </div>
            <div><MLabel>Sessão</MLabel>
              <MSelect value={selectedSessionSchedule} onChange={e => setSelectedSessionSchedule(e.target.value)}>
                {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </MSelect>
            </div>
            <TemplateSelect templates={messageTemplates} value={selectedTemplateScheduleId} onChange={(id, content) => { setSelectedTemplateScheduleId(id); setScheduleText(content); }} label="Mensagem pronta (opcional)" />
            <MTextArea value={scheduleText} disabled={!!selectedTemplateScheduleId} onChange={e => { if (selectedTemplateScheduleId) setSelectedTemplateScheduleId(""); setScheduleText(e.target.value); }} placeholder="Ex: Olá, seu plano vence amanhã..." />
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowScheduleMsg({ open: false, clientId: null })} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 text-sm font-bold">Cancelar</button>
              <button onClick={handleScheduleMessage} disabled={scheduling} className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 shadow-lg flex items-center gap-2 text-sm disabled:opacity-50">
                <IconClock /> {scheduling ? "Agendando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Novo alerta */}
      {showNewAlert.open && (
        <Modal title="Criar Alerta" onClose={() => setShowNewAlert({ open: false, clientId: null })}>
          <div className="space-y-4">
            <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-100 dark:border-purple-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">🔔</span>
              <p className="text-sm text-purple-900 dark:text-purple-200">Alerta para <strong>{showNewAlert.clientName}</strong></p>
            </div>
            <MTextArea value={newAlertText} onChange={e => setNewAlertText(e.target.value)} placeholder="Descreva a pendência deste aluno..." autoFocus />
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowNewAlert({ open: false, clientId: null })} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 text-sm font-bold">Cancelar</button>
              <button onClick={handleSaveAlert} className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 shadow-lg text-sm">Salvar Alerta</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Lista de alertas */}
      {showAlertList.open && (
        <Modal title={`Alertas: ${showAlertList.clientName}`} onClose={() => setShowAlertList({ open: false, clientId: null })}>
          <div className="space-y-4">
            
            <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
              {(clientAlerts as any[]).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/30 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl">
                   <span className="text-2xl mb-2">✅</span>
                   <p className="text-sm">Nenhum alerta pendente.</p>
                </div>
              ) : (
                (clientAlerts as any[]).map((alert) => (
                  <div key={alert.id} className="group p-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl shadow-sm hover:border-rose-200 dark:hover:border-rose-500/30 transition-all flex justify-between items-start gap-4">
                    <div className="flex gap-3">
                        <span className="text-rose-500 mt-0.5">⚠️</span>
                        <p className="text-sm text-slate-700 dark:text-white/90 whitespace-pre-wrap leading-relaxed">{alert.message || ""}</p>
                    </div>
                    <button 
                      onClick={() => handleDeleteAlert(String(alert.id))} 
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

      {/* Agendamentos */}
      {showScheduledModal.open && showScheduledModal.clientId && (
        <ScheduledMessagesModal
          tenantId={tenantId!}
          clientId={showScheduledModal.clientId}
          clientName={showScheduledModal.clientName || "Aluno"}
          items={scheduledMap[showScheduledModal.clientId] || []}
          onClose={() => setShowScheduledModal({ open: false, clientId: null })}
          onDeleted={async () => { if (tenantId) await loadScheduledForClients(tenantId, rows.map(x => x.id)); }}
          addToast={addToast}
        />
      )}

      {/* MODAL FOTO AMPLIADA */}
      {enlargedPhoto && (
        <div 
          className="fixed inset-0 z-[999999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setEnlargedPhoto(null)}
        >
          <div className="relative max-w-2xl w-full flex flex-col items-center">
            <button 
              onClick={() => setEnlargedPhoto(null)}
              className="absolute -top-12 right-0 p-2 text-white/70 hover:text-white transition-colors"
            >
              <IconX />
            </button>
            <img 
              src={enlargedPhoto} 
              alt="Foto ampliada" 
              className="w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10" 
              onClick={(e) => e.stopPropagation()} 
            />
          </div>
        </div>
      )}

      {ConfirmUI}
      <div className="relative z-[999999]"><ToastNotifications toasts={toasts} removeToast={removeToast} /></div>
    </div>
  );
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export default function AlunosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f141a]"><div className="text-slate-400 animate-pulse font-bold">Carregando...</div></div>}>
      <AlunosPageContent />
    </Suspense>
  );
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

function FSel({ value, onChange, children }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select value={value} onChange={onChange}
      className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white">
      {children}
    </select>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return <th className={`px-3 py-2 text-${align}`}>{children}</th>;
}

function ThSort({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th onClick={onClick} className="px-3 py-2 cursor-pointer select-none group hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors text-left">
      <div className="flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? "opacity-100 text-emerald-600 dark:text-emerald-500" : "opacity-40 group-hover:opacity-70"}`}>
          {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
        </span>
      </div>
    </th>
  );
}

function SortClick({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <div onClick={onClick} className="inline-flex items-center justify-center gap-1 cursor-pointer select-none hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors">
      <span className="font-bold uppercase text-xs tracking-wide">{label}</span>
      <span className={`flex items-center ${active ? "opacity-100 text-emerald-600 dark:text-emerald-500" : "opacity-30"}`}>
        {dir === "asc" ? <IconSortUp /> : <IconSortDown />}
      </span>
    </div>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return <td className={`px-3 py-2 text-${align} align-middle`}>{children}</td>;
}

function IABtn({ children, title, tone, onClick, loading = false }: {
  children: React.ReactNode; title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void; loading?: boolean;
}) {
  const colors = {
    blue:   "text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    green:  "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber:  "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    purple: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/20",
    red:    "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
  };
  return (
    <button onClick={e => { e.stopPropagation(); if (!loading) onClick(e); }} title={title}
      className={`p-1.5 rounded-lg border transition-all shadow-sm ${colors[tone]} ${loading ? "opacity-70 cursor-wait" : "active:scale-95"}`}>
      {loading
        ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        : children}
    </button>
  );
}

function MItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group w-full px-4 py-2.5 flex items-center gap-3 text-slate-600 dark:text-white/60 hover:bg-emerald-500/10 dark:hover:bg-white/5 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all text-left text-sm font-bold">
      <span className="opacity-70 group-hover:scale-110 transition-transform">{icon}</span>{label}
    </button>
  );
}

function MLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">{children}</label>;
}
function MSelect({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500 text-sm">{children}</select>;
}
function MTextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl p-4 text-slate-800 dark:text-white outline-none focus:border-emerald-500 min-h-[120px] text-sm resize-none disabled:opacity-70 transition-colors" />;
}

function TemplateSelect({ templates, value, onChange, label }: {
  templates: MessageTemplate[]; value: string;
  onChange: (id: string, content: string) => void; label: string;
}) {
  return (
    <div>
      <MLabel>{label}</MLabel>
      <MSelect value={value} onChange={e => {
        const id = e.target.value;
        const tpl = templates.find(t => t.id === id);
        onChange(id, tpl?.content || "");
      }}>
        <option value="">Selecionar...</option>
        {Object.entries(
          templates
            .filter(t => t.category !== "Revenda IPTV" && t.category !== "Revenda SaaS" && !t.name.toLowerCase().startsWith("teste"))
            .reduce((acc, t) => { const cat = t.category || "Geral"; if (!acc[cat]) acc[cat] = []; acc[cat].push(t); return acc; }, {} as Record<string, MessageTemplate[]>)
        ).map(([cat, tmpls]) => (
          <optgroup key={cat} label={`— ${cat} —`}>
            {tmpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </optgroup>
        ))}
      </MSelect>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-4">
      <div onMouseDown={e => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#0f141a] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="font-bold text-slate-800 dark:text-white">{title}</div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60"><IconX /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function ScheduledMessagesModal({ tenantId, clientId, clientName, items, onClose, onDeleted, addToast }: {
  tenantId: string; clientId: string; clientName: string; items: ScheduledMsg[];
  onClose: () => void; onDeleted: () => void;
  addToast: (type: "success" | "error" | "warning", title: string, msg?: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { confirm, ConfirmUI } = useConfirm();

  async function handleDelete(id: string) {
    const it = items.find(x => x.id === id);
    const ok = await confirm({ title: "Cancelar agendamento", subtitle: "Remover da fila de envios?", tone: "rose", icon: "🗑️",
      details: [it?.send_at ? `Envio: ${new Date(it.send_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "—"],
      confirmText: "Excluir", cancelText: "Voltar" });
    if (!ok) return;
    setDeletingId(id);
    const { error } = await supabaseBrowser.rpc("client_message_cancel", { p_tenant_id: tenantId, p_job_id: id });
    setDeletingId(null);
    if (error) { addToast("error", "Erro ao excluir", error.message); return; }
    addToast("success", "Cancelado", "Mensagem removida da fila.");
    await onDeleted();
  }

  return (
    <>
      <Modal title={`Mensagens Programadas • ${clientName}`} onClose={onClose}>
        {items.length === 0
          ? <div className="flex flex-col items-center py-8 text-slate-400 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl"><span className="text-2xl mb-2">🗓️</span><p className="text-sm">Nenhum agendamento.</p></div>
          : <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {items.map(it => (
                <div key={it.id} className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold text-slate-500 dark:text-white/60 bg-white dark:bg-white/10 px-2 py-0.5 rounded border border-slate-100 dark:border-white/5 inline-block mb-2">
                        {new Date(it.send_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      </div>
                      <p className="text-sm text-slate-700 dark:text-white/90 whitespace-pre-wrap break-words">{it.message}</p>
                    </div>
                    <button onClick={() => handleDelete(it.id)} disabled={deletingId === it.id}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors">
                      {deletingId === it.id ? <span className="animate-spin inline-block">⏳</span> : <IconTrash />}
                    </button>
                  </div>
                </div>
              ))}
            </div>}
      </Modal>
      {ConfirmUI}
    </>
  );
}

// ─── ÍCONES ───────────────────────────────────────────────────────────────────

function IconX()        { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>; }
function IconSortUp()   { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>; }
function IconSortDown() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>; }
function IconChat()     { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>; }
function IconSend()     { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>; }
function IconClock()    { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconMoney()    { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>; }
function IconEdit()     { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconBell()     { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>; }
function IconTrash()    { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
function IconTrashFull(){ return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>; }
function IconRestore()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>; }
