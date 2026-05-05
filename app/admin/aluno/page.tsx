"use client";

import { useEffect, useState, useMemo } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "../ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import { useModules } from "@/lib/modules/ModulesContext";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

// ⚠️ Confirme o nome exato da coluna JSONB no seu banco (clients table)
const JSONB_COLUMN = "dados_aluno";

const MODALIDADES = [
  "Musculação", "Jiu-Jitsu", "Ioga", "Natação",
  "Boxe", "Funcional", "Pilates", "Crossfit", "Kickboxing", "Outras",
];

// Modalidades que exibem campo de faixa/nível extra
const MODALIDADES_COM_FAIXA: Record<string, string> = {
  "Jiu-Jitsu": "Faixa",
};

const FAIXAS_JIU_JITSU = ["Branca", "Cinza", "Azul", "Roxa", "Marrom", "Preta"];

// ─── TIPOS ────────────────────────────────────────────────────────────────────

type AlunoStatus = "Ativo" | "Vencido" | "Arquivado";
type SortKey = "name" | "due" | "status" | "modalidade";
type SortDir = "asc" | "desc";

type DadosAluno = {
  modalidade?: string;
  faixa?: string;
  tipo_plano?: string;
  info?: string;
  data_nascimento?: string;
  cpf_rg?: string;
  foto_url?: string;
  contato_emergencia?: string;
  historico_medico?: string;
  lesoes?: string;
  objetivo?: string;
};

type VwClientRow = {
  id: string;
  tenant_id: string;
  client_name: string | null;
  username: string | null;
  vencimento: string | null;
  computed_status: string;
  client_is_archived: boolean | null;
  price_amount: number | null;
  price_currency: string | null;
  plan_name: string | null;
  whatsapp_e164: string | null;
  whatsapp_username: string | null;
  whatsapp_opt_in: boolean | null;
  secondary_display_name?: string | null;
  secondary_phone_e164?: string | null;
  secondary_whatsapp_username?: string | null;
  name_prefix?: string | null;
};

type AlunoRow = {
  id: string;
  name: string;
  username: string;
  dueISODate: string;
  dueLabelDate: string;
  status: AlunoStatus;
  archived: boolean;
  whatsapp: string;
  whatsapp_username?: string;
  secondary_display_name?: string;
  secondary_phone_e164?: string;
  secondary_whatsapp_username?: string;
  price_amount?: number;
  price_currency?: string;
  plan_name?: string;
  vencimento?: string;
  dados: DadosAluno;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isoDateInSaoPaulo(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function getDiffDays(isoDateTarget: string) {
  if (!isoDateTarget || isoDateTarget === "9999-12-31") return 9999;
  const today = isoDateInSaoPaulo();
  const d1 = new Date(`${today}T12:00:00`);
  const d2 = new Date(`${isoDateTarget}T12:00:00`);
  return Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDueDateOnly(rawDue: string | null) {
  if (!rawDue) return { dueISODate: "0000-01-01", dueLabelDate: "—" };
  const dt = new Date(rawDue);
  if (isNaN(dt.getTime())) return { dueISODate: "0000-01-01", dueLabelDate: "—" };
  const isoDate = isoDateInSaoPaulo(dt);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(dt);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return {
    dueISODate: isoDate,
    dueLabelDate: `${get("day")}/${get("month")}/${get("year")}`,
  };
}

function mapStatus(computed: string, archived: boolean, vencimento: string | null): AlunoStatus {
  if (archived) return "Arquivado";
  if (vencimento) {
    const t = new Date(vencimento).getTime();
    if (!isNaN(t) && Date.now() > t) return "Vencido";
  }
  const map: Record<string, AlunoStatus> = {
    ACTIVE: "Ativo", TRIAL: "Ativo", OVERDUE: "Vencido", ARCHIVED: "Arquivado",
  };
  return map[computed] || "Ativo";
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

function formatCurrency(amount?: number, currency?: string) {
  if (!amount) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
  } catch {
    return `${currency || "BRL"} ${amount.toFixed(2)}`;
  }
}

function queueToast(toast: { type: "success" | "error"; title: string; message?: string }) {
  try {
    if (typeof window === "undefined") return;
    const key = "alunos_list_toasts";
    const raw = window.sessionStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    arr.push({ ...toast, ts: Date.now() });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

function AlunosPageContent() {
  const [rows, setRows] = useState<AlunoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"Todos" | AlunoStatus>("Todos");
  const [modalidadeFilter, setModalidadeFilter] = useState("Todos");
  const [archivedFilter, setArchivedFilter] = useState<"Não" | "Sim">("Não");
  const [showCount, setShowCount] = useState(100);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Modais — a implementar
  const [showFormModal, setShowFormModal] = useState(false);
  const [alunoToEdit, setAlunoToEdit] = useState<AlunoRow | null>(null);
  const [showRenovarId, setShowRenovarId] = useState<string | null>(null);

  // Toast + Confirm
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const { confirm, ConfirmUI } = useConfirm();

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now() + Math.floor(Math.random() * 100000);
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }

  // ─── CARREGAMENTO ──────────────────────────────────────────────────────────

  async function loadData() {
    setLoading(true);
    const tid = await getCurrentTenantId();
    setTenantId(tid);

    if (tid) {
      const { data: tenantRow } = await supabaseBrowser
        .from("tenants")
        .select("active_modules")
        .eq("id", tid)
        .maybeSingle();

      const mods = tenantRow?.active_modules || [];
      const canAccess = mods.includes("academia") || mods.includes("personal");

      if (!canAccess) {
        setHasAccess(false);
        setLoading(false);
        return;
      }
      setHasAccess(true);
    }

    if (!tid) { setLoading(false); return; }

    const viewName = archivedFilter === "Sim"
      ? "vw_clients_list_archived"
      : "vw_clients_list_active";

    const { data, error } = await supabaseBrowser
      .from(viewName)
      .select("*")
      .eq("tenant_id", tid)
      .order("vencimento", { ascending: false, nullsFirst: false });

    if (error) {
      addToast("error", "Erro ao carregar alunos", error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const typed = (data || []) as VwClientRow[];
    const ids = typed.map(r => String(r.id)).filter(Boolean);

    // Busca JSONB extra separadamente
    let dadosMap: Record<string, DadosAluno> = {};
    if (ids.length > 0) {
      try {
        const { data: clientData } = await supabaseBrowser
          .from("clients")
          .select(`id, ${JSONB_COLUMN}`)
          .eq("tenant_id", tid)
          .in("id", ids);

        for (const row of clientData || []) {
          dadosMap[String(row.id)] = (row[JSONB_COLUMN] as DadosAluno) || {};
        }
      } catch (e) {
        console.error("Falha ao carregar dados_aluno:", e);
      }
    }

    const mapped: AlunoRow[] = typed.map(r => {
      const due = formatDueDateOnly(r.vencimento);
      const archived = Boolean(r.client_is_archived);
      const status = mapStatus(String(r.computed_status), archived, r.vencimento);
      const id = String(r.id);
      return {
        id,
        name: String(r.client_name ?? "Sem Nome"),
        username: String(r.username ?? "—"),
        dueISODate: due.dueISODate,
        dueLabelDate: due.dueLabelDate,
        status,
        archived,
        whatsapp: String(r.whatsapp_e164 ?? ""),
        whatsapp_username: r.whatsapp_username ?? undefined,
        secondary_display_name: r.secondary_display_name ?? undefined,
        secondary_phone_e164: r.secondary_phone_e164 ?? undefined,
        secondary_whatsapp_username: r.secondary_whatsapp_username ?? undefined,
        price_amount: r.price_amount ?? undefined,
        price_currency: r.price_currency ?? undefined,
        plan_name: r.plan_name ?? undefined,
        vencimento: r.vencimento ?? undefined,
        dados: dadosMap[id] || {},
      };
    });

    setRows(mapped);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedFilter]);

  // Toasts pós-refresh
  useEffect(() => {
    if (loading) return;
    try {
      const key = "alunos_list_toasts";
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;
      const arr = JSON.parse(raw) as { type: "success" | "error"; title: string; message?: string }[];
      window.sessionStorage.removeItem(key);
      for (const t of arr) addToast(t.type, t.title, t.message);
    } catch {}
  }, [loading]);

  // ─── FILTROS + SORT ────────────────────────────────────────────────────────

  const uniqueModalidades = useMemo(() => {
    const set = new Set(rows.map(r => r.dados?.modalidade).filter((m): m is string => !!m));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== "Todos" && r.status !== statusFilter) return false;
      if (modalidadeFilter !== "Todos" && r.dados?.modalidade !== modalidadeFilter) return false;
      if (q) {
        const hay = [r.name, r.username, r.secondary_display_name ?? "", r.dados?.modalidade ?? ""].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, modalidadeFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = compareText(a.name, b.name); break;
        case "due": cmp = new Date(a.dueISODate).getTime() - new Date(b.dueISODate).getTime(); break;
        case "status": {
          const rank = (s: AlunoStatus) => s === "Vencido" ? 3 : s === "Arquivado" ? 2 : 1;
          cmp = rank(a.status) - rank(b.status); break;
        }
        case "modalidade": cmp = compareText(a.dados?.modalidade || "", b.dados?.modalidade || ""); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const visible = useMemo(() => sorted.slice(0, showCount), [sorted, showCount]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  // ─── AÇÕES ─────────────────────────────────────────────────────────────────

  async function handleArchiveToggle(r: AlunoRow) {
    if (!tenantId) return;
    const going = !r.archived;
    const ok = await confirm({
      title: going ? "Arquivar aluno" : "Restaurar aluno",
      subtitle: going ? "O aluno irá para a Lixeira (pode ser restaurado depois)." : "O aluno voltará para a lista ativa.",
      tone: going ? "amber" : "emerald",
      icon: going ? "🗑️" : "↩️",
      details: [`Aluno: ${r.name}`, going ? "Destino: Lixeira" : "Destino: Ativos"],
      confirmText: going ? "Arquivar" : "Restaurar",
      cancelText: "Voltar",
    });
    if (!ok) return;

    const { error } = await supabaseBrowser.rpc("update_client", {
      p_tenant_id: tenantId,
      p_client_id: r.id,
      p_is_archived: going,
    });

    if (error) { addToast("error", "Falha ao atualizar", error.message); return; }

    queueToast({ type: "success", title: going ? "Aluno arquivado" : "Aluno restaurado" });
    await loadData();
  }

  async function handleDeleteForever(r: AlunoRow) {
    if (!tenantId || !r.archived) return;
    const ok = await confirm({
      title: "Excluir definitivamente",
      subtitle: "Essa ação NÃO pode ser desfeita.",
      tone: "rose",
      icon: "⚠️",
      details: [`Aluno: ${r.name}`, "Ação: excluir para sempre"],
      confirmText: "Excluir",
      cancelText: "Voltar",
    });
    if (!ok) return;

    const { error } = await supabaseBrowser.rpc("delete_client_forever", {
      p_tenant_id: tenantId,
      p_client_id: r.id,
    });

    if (error) addToast("error", "Falha ao excluir", error.message);
    else { addToast("success", "Excluído", "Aluno removido definitivamente."); loadData(); }
  }

  // ─── GUARDS ────────────────────────────────────────────────────────────────

  if (hasAccess === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-[#0f141a]">
        <div className="text-slate-400 dark:text-white/40 animate-pulse font-bold tracking-tight">Verificando permissões...</div>
      </div>
    );
  }

  if (hasAccess === false) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight mb-2">Acesso Restrito</h1>
        <p className="text-slate-500 dark:text-white/60 max-w-md mx-auto">
          Esta página é exclusiva para módulos Academia e Personal.
        </p>
      </div>
    );
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  const hasActiveFilters = search.trim() || statusFilter !== "Todos" || modalidadeFilter !== "Todos" || archivedFilter === "Sim";

  return (
    <div
      className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-0 mb-2 px-3 sm:px-0 md:px-4">
        <div className="min-w-0 text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
            Gestão de Alunos
          </h1>
        </div>
        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={() => setArchivedFilter(archivedFilter === "Não" ? "Sim" : "Não")}
            className={`hidden md:inline-flex h-10 px-3 rounded-lg text-xs font-bold border transition-colors items-center justify-center ${
              archivedFilter === "Sim"
                ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60"
            }`}
          >
            {archivedFilter === "Sim" ? "Ocultar Lixeira" : "Ver Lixeira"}
          </button>
          <button
            onClick={() => { setAlunoToEdit(null); setShowFormModal(true); }}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
          >
            <span>+</span> Novo Aluno
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="p-0 px-3 sm:px-0 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20">
        <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider mb-2">
          Filtros Rápidos
        </div>

        {/* Mobile */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar aluno..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500">
                <IconX />
              </button>
            )}
          </div>
          <button
            onClick={() => setMobileFiltersOpen(v => !v)}
            className={`h-10 px-3 rounded-lg border font-bold text-sm transition-colors ${
              hasActiveFilters
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70"
            }`}
          >
            Filtros
          </button>
        </div>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar aluno..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500">
                <IconX />
              </button>
            )}
          </div>

          <div className="w-[180px]">
            <SelectUI value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              <option value="Todos">Status (Todos)</option>
              <option value="Ativo">Ativo</option>
              <option value="Vencido">Vencido</option>
              <option value="Arquivado">Arquivado</option>
            </SelectUI>
          </div>

          <div className="w-[200px]">
            <SelectUI value={modalidadeFilter} onChange={e => setModalidadeFilter(e.target.value)}>
              <option value="Todos">Modalidade (Todos)</option>
              {uniqueModalidades.map(m => <option key={m} value={m}>{m}</option>)}
            </SelectUI>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(""); setStatusFilter("Todos"); setModalidadeFilter("Todos"); setArchivedFilter("Não"); }}
              className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center gap-2"
            >
              <IconX /> Limpar
            </button>
          )}
        </div>

        {/* Mobile expandido */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-2">
            <button
              onClick={() => { setArchivedFilter(cur => cur === "Não" ? "Sim" : "Não"); setMobileFiltersOpen(false); }}
              className={`w-full h-10 px-3 rounded-lg text-sm font-bold border flex items-center justify-between transition-colors ${
                archivedFilter === "Sim"
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                  : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70"
              }`}
            >
              <span className="flex items-center gap-2"><IconTrash /> Lixeira</span>
              <span className="text-xs opacity-80">{archivedFilter === "Sim" ? "ON" : "OFF"}</span>
            </button>

            <SelectUI value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
              <option value="Todos">Status (Todos)</option>
              <option value="Ativo">Ativo</option>
              <option value="Vencido">Vencido</option>
              <option value="Arquivado">Arquivado</option>
            </SelectUI>

            <SelectUI value={modalidadeFilter} onChange={e => setModalidadeFilter(e.target.value)}>
              <option value="Todos">Modalidade (Todos)</option>
              {uniqueModalidades.map(m => <option key={m} value={m}>{m}</option>)}
            </SelectUI>

            {hasActiveFilters && (
              <button
                onClick={() => { setSearch(""); setStatusFilter("Todos"); setModalidadeFilter("Todos"); setArchivedFilter("Não"); setMobileFiltersOpen(false); }}
                className="w-full h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                <IconX /> Limpar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5">
          Carregando alunos...
        </div>
      ) : (
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-700 dark:text-white whitespace-nowrap">
              Lista de Alunos{" "}
              <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
                {filtered.length}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-white/50">
              <span>Mostrar</span>
              <select
                value={showCount}
                onChange={e => setShowCount(Number(e.target.value))}
                className="bg-transparent border border-slate-300 dark:border-white/10 rounded px-1 py-0.5 outline-none text-slate-700 dark:text-white cursor-pointer hover:border-emerald-500/50 transition-colors"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[960px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/40">
                  <ThSort label="Aluno" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  <ThSort label="Vencimento" active={sortKey === "due"} dir={sortDir} onClick={() => toggleSort("due")} />
                  <ThSort label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
                  <ThSort label="Modalidade" active={sortKey === "modalidade"} dir={sortDir} onClick={() => toggleSort("modalidade")} />
                  <Th>Tipo Plano</Th>
                  <Th>Recorrência</Th>
                  <Th>Valor</Th>
                  <Th>Info</Th>
                  <Th align="right">Ações</Th>
                </tr>
              </thead>

              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.map(r => {
                  const diff = getDiffDays(r.dueISODate);
                  const modalidadeFaixaLabel = MODALIDADES_COM_FAIXA[r.dados?.modalidade || ""];

                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">

                      {/* Aluno / Responsável — mesmo layout da página de clientes */}
                      <Td>
                        <div className="flex flex-col max-w-[180px] sm:max-w-none">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <Link
                              href={`/admin/aluno/${r.id}`}
                              className="font-semibold text-slate-700 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors hover:underline decoration-emerald-500/30 underline-offset-2 truncate"
                              title={r.name}
                            >
                              {r.name.split(" ")[0]}
                              {r.secondary_display_name && (
                                <span className="text-slate-400 dark:text-white/30 font-normal">
                                  {" / "}{r.secondary_display_name.split(" ")[0]}
                                </span>
                              )}
                            </Link>
                          </div>
                          {r.whatsapp_username && (
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
                              @{r.whatsapp_username}
                            </span>
                          )}
                          {r.secondary_whatsapp_username && (
                            <span className="text-xs font-normal text-slate-400 dark:text-white/45 truncate">
                              @{r.secondary_whatsapp_username}
                            </span>
                          )}
                        </div>
                      </Td>

                      {/* Vencimento — apenas data, sem hora */}
                      <Td>
                        <span className={`font-mono font-medium ${r.status === "Vencido" ? "text-rose-500" : "text-slate-600 dark:text-white/80"}`}>
                          {r.dueLabelDate}
                        </span>
                      </Td>

                      {/* Status — mesmos badges de contagem de dias */}
                      <Td>
                        {(() => {
                          let label = r.status as string;
                          let tone: "green" | "red" | "amber" | "blue" = "blue";

                          if (r.status === "Arquivado") {
                            label = diff < 0 ? `Lixeira (há ${Math.abs(diff)}d)` : "Lixeira";
                            tone = "red";
                          } else if (r.status === "Vencido") {
                            if (diff === -1) label = "Venceu Ontem";
                            else if (diff === -2) label = "Venceu há 2 dias";
                            else if (diff < -2) label = `Venceu há ${Math.abs(diff)} dias`;
                            tone = "red";
                          } else {
                            if (diff === 0) { label = "Vence Hoje"; tone = "amber"; }
                            else if (diff === 1) { label = "Vence Amanhã"; tone = "green"; }
                            else if (diff === 2) { label = "Vence em 2 dias"; tone = "green"; }
                            else { tone = "green"; }
                          }

                          const colors = {
                            green: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
                            red: "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20",
                            amber: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
                            blue: "bg-sky-100 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/20",
                          };

                          return (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${colors[tone]}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </Td>

                      {/* Modalidade + Faixa condicional */}
                      <Td>
                        <div className="flex flex-col gap-1">
                          {r.dados?.modalidade ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/20 whitespace-nowrap">
                              {r.dados.modalidade}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 italic">—</span>
                          )}
                          {modalidadeFaixaLabel && r.dados?.faixa && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 whitespace-nowrap">
                              🥋 {r.dados.faixa}
                            </span>
                          )}
                        </div>
                      </Td>

                      {/* Tipo de Plano */}
                      <Td>
                        {r.dados?.tipo_plano ? (
                          <span className="text-xs font-medium text-slate-700 dark:text-white/80">{r.dados.tipo_plano}</span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">—</span>
                        )}
                      </Td>

                      {/* Recorrência (plan_name) */}
                      <Td>
                        {r.plan_name ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10">
                            {r.plan_name}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">—</span>
                        )}
                      </Td>

                      {/* Valor */}
                      <Td>
                        <span className="font-medium text-slate-700 dark:text-white/80">
                          {formatCurrency(r.price_amount, r.price_currency)}
                        </span>
                      </Td>

                      {/* Info customizável */}
                      <Td>
                        {r.dados?.info ? (
                          <span className="text-xs text-slate-600 dark:text-white/60 line-clamp-2 max-w-[120px]" title={r.dados.info}>
                            {r.dados.info}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">—</span>
                        )}
                      </Td>

                      {/* Ações — mesmo padrão da página de clientes */}
                      <Td align="right">
                        <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100">
                          {/* Editar */}
                          <ActionBtn title="Editar" tone="amber" onClick={() => { setAlunoToEdit(r); setShowFormModal(true); }}>
                            <IconEdit />
                          </ActionBtn>

                          {/* Renovar */}
                          {!r.archived && (
                            <ActionBtn
                              title="Renovar mensalidade"
                              tone="green"
                              onClick={() => {
                                setShowRenovarId(r.id);
                                // TODO: implementar modal de renovação
                                addToast("error", "Em breve", "Modal de renovação em desenvolvimento.");
                              }}
                            >
                              <IconRenew />
                            </ActionBtn>
                          )}

                          {/* Arquivar / Restaurar */}
                          <ActionBtn
                            title={r.archived ? "Restaurar" : "Arquivar"}
                            tone={r.archived ? "green" : "red"}
                            onClick={() => handleArchiveToggle(r)}
                          >
                            {r.archived ? <IconRestore /> : <IconTrash />}
                          </ActionBtn>

                          {/* Excluir definitivo — só na lixeira */}
                          {archivedFilter === "Sim" && r.archived && (
                            <ActionBtn title="Excluir definitivamente" tone="red" onClick={() => handleDeleteForever(r)}>
                              <IconTrashFull />
                            </ActionBtn>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}

                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400 dark:text-white/40 italic">
                      Nenhum aluno encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="h-24 md:h-20" />
          </div>
        </div>
      )}

      {/* Modal Novo/Editar — placeholder, a implementar */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#161b22] rounded-xl p-6 max-w-sm w-full text-center border border-slate-200 dark:border-white/10 shadow-2xl">
            <div className="text-4xl mb-3">🎓</div>
            <p className="text-slate-700 dark:text-white font-bold mb-2">
              Modal de {alunoToEdit ? "Edição" : "Novo Aluno"}
            </p>
            <p className="text-xs text-slate-400 dark:text-white/40 mb-4">Em desenvolvimento — em breve disponível.</p>
            <button
              onClick={() => setShowFormModal(false)}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {ConfirmUI}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={id => setToasts(prev => prev.filter(t => t.id !== id))} />
      </div>
    </div>
  );
}

// ─── EXPORT com Suspense (para useSearchParams etc.) ─────────────────────────

export default function AlunosPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f141a]">
        <div className="text-slate-400 dark:text-white/40 animate-pulse font-bold">Carregando...</div>
      </div>
    }>
      <AlunosPageContent />
    </Suspense>
  );
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-3 text-${align}`}>{children}</th>;
}

function ThSort({ label, active, dir, onClick }: {
  label: string; active: boolean; dir: SortDir; onClick: () => void;
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
  return <td className={`px-4 py-3 text-${align} align-middle`}>{children}</td>;
}

function SelectUI(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
    />
  );
}

function ActionBtn({ children, title, tone, onClick, disabled }: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "red";
  onClick: () => void;
  disabled?: boolean;
}) {
  const colors = {
    blue: "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    red: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg border transition-all shadow-sm ${colors[tone]} ${
        disabled ? "opacity-30 cursor-not-allowed" : "active:scale-95"
      }`}
    >
      {children}
    </button>
  );
}

// ─── ÍCONES ───────────────────────────────────────────────────────────────────

function IconX() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}
function IconSortUp() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>;
}
function IconSortDown() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>;
}
function IconEdit() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
}
function IconTrash() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
}
function IconTrashFull() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
}
function IconRestore() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>;
}
function IconRenew() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>;
}
