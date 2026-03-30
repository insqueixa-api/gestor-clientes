"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { EyeToggle } from "@/app/admin/eye-toggle";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// --- TIPOS ---
type Transacao = {
  id: string;
  tipo: "RECEITA" | "DESPESA";
  descricao: string;
  valor: number;
  data_vencimento: string;
  status: "PENDENTE" | "PAGO";
  categoria_nome?: string;
  conta_nome?: string;
  conta_id?: string;
  categoria_id?: string;
  parcela_atual?: number;
  parcela_total?: number;
  is_recorrente?: boolean;
  frequencia?: string;
  recorrencia_id?: string;
  observacoes?: string;
};

// --- ICONES ---
function IconPlus() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>; }
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconChevronLeft() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>; }
function IconChevronRight() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>; }
function IconTrendingUp() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>; }
function IconTrendingDown() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>; }
function IconCheck() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>; }
function IconUndo() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }

function ActionBtn({ tone, onClick, title, children }: { tone: "green"|"amber"|"red"|"blue", onClick: ()=>void, title: string, children: React.ReactNode }) {
  const colors = {
    blue: "text-sky-500 bg-sky-50 border-sky-200 hover:bg-sky-100 dark:bg-sky-500/10 dark:border-sky-500/20 dark:hover:bg-sky-500/20",
    green: "text-emerald-500 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:hover:bg-emerald-500/20",
    amber: "text-amber-500 bg-amber-50 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20 dark:hover:bg-amber-500/20",
    red: "text-rose-500 bg-rose-50 border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:border-rose-500/20 dark:hover:bg-rose-500/20",
  };
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={title} className={`p-1.5 rounded-lg border transition-colors ${colors[tone]}`}>
      {children}
    </button>
  );
}

function FinanceiroPageContent() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const { confirm, ConfirmUI } = useConfirm();

  const [currentDate, setCurrentDate] = useState(new Date());

  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [contasDB, setContasDB] = useState<any[]>([]);
  const [categoriasDB, setCategoriasDB] = useState<any[]>([]);
  const [saldosContas, setSaldosContas] = useState<Record<string, number>>({});
  
  // Filtros
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [tipoFilter, setTipoFilter] = useState("Todos");
  const [contaFilter, setContaFilter] = useState("Todos");
  const [categoriaFilter, setCategoriaFilter] = useState("Todos");
  const [recorrenciaFilter, setRecorrenciaFilter] = useState("Todos");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Modais
  const [modalData, setModalData] = useState<{ open: boolean, transacao: Transacao | null }>({ open: false, transacao: null });
  const [showAjusteSaldo, setShowAjusteSaldo] = useState(false);
  const [deleteData, setDeleteData] = useState<{ open: boolean, transacao: Transacao | null }>({ open: false, transacao: null });

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  const monthName = currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  
  const handlePrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const handleToday = () => setCurrentDate(new Date());

  const carregarDados = async (tid: string, dateObj: Date) => {
    setLoading(true);
    try {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const startOfMonth = `${y}-${m}-01`;
      const endOfMonth = new Date(y, dateObj.getMonth() + 1, 0).toISOString().split("T")[0];

      const [resContas, resCat] = await Promise.all([
        supabaseBrowser.from("fin_contas_bancarias").select("*").eq("tenant_id", tid).order("nome"),
        supabaseBrowser.from("fin_categorias").select("*").eq("tenant_id", tid).order("nome")
      ]);
      if (resContas.data) setContasDB(resContas.data);
      if (resCat.data) setCategoriasDB(resCat.data);

      const saldos: Record<string, number> = {};
      for (const c of resContas.data || []) {
         const { data: saldo } = await supabaseBrowser.rpc("get_saldo_conta", { p_conta_id: c.id });
         saldos[c.id] = Number(saldo || 0);
      }
      setSaldosContas(saldos);

      const { data, error } = await supabaseBrowser
        .from("fin_transacoes")
        .select(`*, fin_contas_bancarias(nome, icone), fin_categorias(nome, icone)`)
        .eq("tenant_id", tid)
        .gte("data_vencimento", startOfMonth)
        .lte("data_vencimento", endOfMonth)
        .order("data_vencimento", { ascending: true });

      if (error) throw error;

      const formatadas: Transacao[] = (data || []).map((t: any) => ({
        id: t.id,
        tipo: t.tipo,
        descricao: t.descricao,
        valor: t.valor,
        data_vencimento: t.data_vencimento,
        status: t.status,
        categoria_nome: t.fin_categorias ? `${t.fin_categorias.icone} ${t.fin_categorias.nome}` : "",
        conta_nome: t.fin_contas_bancarias ? `${t.fin_contas_bancarias.icone} ${t.fin_contas_bancarias.nome}` : "",
        conta_id: t.conta_id,
        categoria_id: t.categoria_id,
        parcela_atual: t.parcela_atual,
        parcela_total: t.parcela_total,
        is_recorrente: t.is_recorrente,
        recorrencia_id: t.recorrencia_id,
        frequencia: t.frequencia,
        observacoes: t.observacoes
      }));

      setTransacoes(formatadas);
    } catch (e: any) {
      addToast("error", "Erro ao carregar dados", e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    async function init() {
      const tid = await getCurrentTenantId();
      setTenantId(tid);
      if (tid) await carregarDados(tid, currentDate);
    }
    init();
  }, [currentDate]);

  const handleExclusaoAprovada = async (t: Transacao, modo: "UNICA" | "TODAS") => {
    if (!tenantId) return;
    try {
      if (modo === "TODAS" && t.recorrencia_id) {
        await supabaseBrowser.from("fin_transacoes").delete().eq("recorrencia_id", t.recorrencia_id).gte("data_vencimento", t.data_vencimento);
      } else {
        await supabaseBrowser.from("fin_transacoes").delete().eq("id", t.id);
      }
      addToast("success", "Excluído", "Transação(ões) removida(s) com sucesso.");
      setDeleteData({ open: false, transacao: null });
      carregarDados(tenantId, currentDate);
    } catch(e) {
      addToast("error", "Erro ao excluir", "Tente novamente.");
    }
  };

  const handleDeleteClick = async (t: Transacao) => {
    if (t.recorrencia_id) {
       setDeleteData({ open: true, transacao: t });
    } else {
      const ok = await confirm({
        title: "Excluir Lançamento",
        subtitle: "Esta ação não pode ser desfeita.",
        tone: "rose",
        icon: "🗑️",
        details: [`Lançamento: ${t.descricao}`, `Valor: R$ ${t.valor.toFixed(2)}`],
        confirmText: "Sim, excluir",
      });
      if (ok) handleExclusaoAprovada(t, "UNICA");
    }
  };

  const getComputedStatus = (status: string, vencimentoIso: string) => {
    if (status === "PAGO") return "PAGO";
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const [y, m, d] = vencimentoIso.split("-").map(Number);
    const venc = new Date(y, m - 1, d); venc.setHours(0, 0, 0, 0);
    return venc < hoje ? "VENCIDO" : "PENDENTE";
  };

  const formatRecorrencia = (t: Transacao) => {
    if (t.observacoes === "Ajuste automático de saldo") return "Ajuste Automático";
    if (t.parcela_total) return `Parcela ${t.parcela_atual}/${t.parcela_total}`;
    if (t.is_recorrente && t.frequencia) {
      if (t.frequencia === "MENSAL") return "Mensal";
      if (t.frequencia === "BIMESTRAL") return "Bimestral";
      if (t.frequencia === "TRIMESTRAL") return "Trimestral";
      if (t.frequencia === "SEMESTRAL") return "Semestral";
      if (t.frequencia === "ANUAL") return "Anual";
    }
    return "Lançamento Único";
  };

  const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const filteredTransacoes = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return transacoes.filter((t) => {
      const cStatus = getComputedStatus(t.status, t.data_vencimento);
      const recText = formatRecorrencia(t);

      if (statusFilter !== "Todos" && cStatus !== statusFilter) return false;
      if (tipoFilter !== "Todos" && t.tipo !== tipoFilter) return false;
      if (contaFilter !== "Todos" && t.conta_id !== contaFilter) return false;
      if (categoriaFilter !== "Todos" && t.categoria_id !== categoriaFilter) return false;
      if (recorrenciaFilter !== "Todos") {
        if (recorrenciaFilter === "UNICA" && t.is_recorrente) return false;
        if (recorrenciaFilter === "RECORRENTE" && (!t.is_recorrente || t.parcela_total)) return false;
        if (recorrenciaFilter === "PARCELADA" && !t.parcela_total) return false;
      }

      if (q) {
        const hay = [t.descricao, t.categoria_nome, t.conta_nome, recText].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transacoes, search, statusFilter, tipoFilter, contaFilter, categoriaFilter, recorrenciaFilter]);

  const receitasPagas = filteredTransacoes.filter(t => t.tipo === "RECEITA" && t.status === "PAGO").reduce((acc, t) => acc + t.valor, 0);
  const receitasTotal = filteredTransacoes.filter(t => t.tipo === "RECEITA").reduce((acc, t) => acc + t.valor, 0);
  const despesasPagas = filteredTransacoes.filter(t => t.tipo === "DESPESA" && t.status === "PAGO").reduce((acc, t) => acc + t.valor, 0);
  const despesasTotal = filteredTransacoes.filter(t => t.tipo === "DESPESA").reduce((acc, t) => acc + t.valor, 0);
  
  let saldoAtualReal = 0;
  if (contaFilter !== "Todos") saldoAtualReal = saldosContas[contaFilter] || 0;
  else saldoAtualReal = Object.values(saldosContas).reduce((a, b) => a + b, 0);
  
  const saldoPrevisao = saldoAtualReal + (receitasTotal - receitasPagas) - (despesasTotal - despesasPagas);

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors" id="dashboard-values">
      
      {/* CSS PARA OCULTAR VALORES COM O EYE-TOGGLE */}
      <style dangerouslySetInnerHTML={{__html: `
        #dashboard-values[data-values-hidden="true"] .finance-value {
          filter: blur(8px);
          opacity: 0.6;
          pointer-events: none;
          user-select: none;
        }
      `}} />

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={(id) => setToasts(t => t.filter(x => x.id !== id))} />
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
              Finanças Pessoais
            </h1>
            <EyeToggle />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Controle exclusivo do SuperAdmin</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg shadow-sm">
            <button onClick={handlePrevMonth} className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"><IconChevronLeft /></button>
            <div className="px-4 text-sm font-bold capitalize w-40 text-center text-slate-700 dark:text-white">{monthName}</div>
            <button onClick={handleNextMonth} className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"><IconChevronRight /></button>
          </div>
          <button onClick={handleToday} className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">Hoje</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3 px-3 sm:px-0">
        <MetricCard title="Receitas do Mês" value={fmtBRL(receitasPagas)} tone="emerald" icon="📈" footer={`Previsão total: ${fmtBRL(receitasTotal)}`} />
        <MetricCard title="Despesas do Mês" value={fmtBRL(despesasPagas)} tone="rose" icon="📉" footer={`Previsão total: ${fmtBRL(despesasTotal)}`} />
        <MetricCard title="Saldo Atual" value={fmtBRL(saldoAtualReal)} tone={saldoAtualReal >= 0 ? "emerald" : "rose"} icon="💰" footer={`Previsão final do mês: ${fmtBRL(saldoPrevisao)}`} onEdit={() => setShowAjusteSaldo(true)} />
      </div>

      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 z-20">
        <div className="flex items-center justify-between">
          <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider">Lançamentos</div>
          <button onClick={() => setModalData({ open: true, transacao: null })} className="hidden md:flex h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 items-center gap-2 transition-all">
            <IconPlus /> Adicionar Lançamento
          </button>
        </div>

        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar..." className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"><IconX /></button>}
          </div>
          <button onClick={() => setMobileFiltersOpen((v) => !v)} className="h-10 px-3 rounded-lg border font-bold text-sm border-slate-200 bg-white text-slate-600">Filtros</button>
          <button onClick={() => setModalData({ open: true, transacao: null })} className="h-10 w-10 flex items-center justify-center rounded-lg bg-emerald-600 text-white shadow-lg"><IconPlus /></button>
        </div>

        <div className="hidden md:flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar por descrição..." className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"><IconX /></button>}
          </div>
          <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)} className="w-[140px] h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white">
            <option value="Todos">Tipo</option>
            <option value="RECEITA">Receitas</option>
            <option value="DESPESA">Despesas</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-[140px] h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white">
            <option value="Todos">Status</option>
            <option value="PAGO">Pagos</option>
            <option value="PENDENTE">Pendentes</option>
            <option value="VENCIDO">Vencidos</option>
          </select>
          <select value={contaFilter} onChange={(e) => setContaFilter(e.target.value)} className="w-[140px] h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white truncate">
            <option value="Todos">Conta</option>
            {contasDB.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select value={categoriaFilter} onChange={(e) => setCategoriaFilter(e.target.value)} className="w-[140px] h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white truncate">
            <option value="Todos">Categoria</option>
            {categoriasDB.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select value={recorrenciaFilter} onChange={(e) => setRecorrenciaFilter(e.target.value)} className="w-[140px] h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white truncate">
            <option value="Todos">Recorrência</option>
            <option value="UNICA">Única</option>
            <option value="RECORRENTE">Recorrente</option>
            <option value="PARCELADA">Parcelada</option>
          </select>
          <button onClick={() => { setSearch(""); setStatusFilter("Todos"); setTipoFilter("Todos"); setContaFilter("Todos"); setCategoriaFilter("Todos"); setRecorrenciaFilter("Todos"); }} className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center gap-2">
            <IconX /> Limpar
          </button>
        </div>
      </div>

      {/* ✅ LARGURA TOTAL NO CELULAR (Margens zeradas) */}
      <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-x-auto -mx-0 sm:mx-0">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/40">
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3 w-28 text-center">Tipo</th>
              <th className="px-4 py-3 text-center">Vencimento</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Categoria</th>
              <th className="px-4 py-3 text-center">Conta</th>
              <th className="px-4 py-3 text-center">Recorrência</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
            {filteredTransacoes.length === 0 && !loading && (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400 italic">Nenhum lançamento encontrado.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={9} className="p-8 text-center text-emerald-500 animate-pulse font-bold">Carregando dados...</td></tr>
            )}
            {filteredTransacoes.map((t) => {
              const cStatus = getComputedStatus(t.status, t.data_vencimento);
              const recText = formatRecorrencia(t);
              return (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => setModalData({ open: true, transacao: t })}>
                  
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-700 dark:text-white truncate max-w-[220px] group-hover:text-emerald-600 transition-colors">{t.descricao}</div>
                  </td>

                  <td className="px-4 py-3 text-center">
                    {t.tipo === "RECEITA" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase text-emerald-600 bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20">
                        <IconTrendingUp /> Receita
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase text-rose-600 bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20">
                        <IconTrendingDown /> Despesa
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className="font-mono text-slate-600 dark:text-white/80">{t.data_vencimento.split('-').reverse().join('/')}</span>
                  </td>

                  <td className="px-4 py-3 text-center">
                    {(() => {
                      let cor = "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/20"; 
                      if (cStatus === "PAGO") cor = "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20";
                      else if (cStatus === "VENCIDO") cor = "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/20";
                      return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${cor}`}>{cStatus}</span>;
                    })()}
                  </td>

                  <td className="px-4 py-3 text-center">
                    <div className="text-xs text-slate-600 dark:text-white/80 font-medium">{t.categoria_nome || "—"}</div>
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10">
                      {t.conta_nome || "—"}
                    </span>
                  </td>

                  {/* ✅ RECORRÊNCIA NA SUA PRÓPRIA COLUNA */}
                  <td className="px-4 py-3 text-center">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider">{recText}</span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold transition-all duration-300 finance-value ${t.tipo === "RECEITA" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {t.tipo === "RECEITA" ? "+" : "-"} {fmtBRL(t.valor)}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100">
                      {/* ✅ Pagar/Desfazer: Abre Modal para Editar e Confirmar */}
                      <ActionBtn 
                        tone={t.status === "PAGO" ? "amber" : "green"} 
                        title={t.status === "PAGO" ? "Desfazer Pagamento (Editar)" : "Confirmar Pagamento (Editar)"} 
                        onClick={() => {
                          setModalData({ open: true, transacao: { ...t, status: t.status === "PAGO" ? "PENDENTE" : "PAGO" } });
                        }}>
                        {t.status === "PAGO" ? <IconUndo /> : <IconCheck />}
                      </ActionBtn>
                      <ActionBtn tone="amber" title="Editar" onClick={() => setModalData({ open: true, transacao: t })}>
                        <IconEdit />
                      </ActionBtn>
                      <ActionBtn tone="red" title="Excluir" onClick={() => handleDeleteClick(t)}>
                        <IconTrash />
                      </ActionBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="h-10" />
      </div>

      {ConfirmUI}

      {deleteData.open && deleteData.transacao && (
        <Modal title="Excluir Grupo Recorrente" onClose={() => setDeleteData({ open: false, transacao: null })}>
           <div className="space-y-4">
             <div className="p-3 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 rounded-xl text-sm text-amber-800 dark:text-amber-300 flex gap-3">
               <span className="text-xl">⚠️</span>
               <p>A transação <b>{deleteData.transacao.descricao}</b> faz parte de um grupo recorrente/parcelado.</p>
             </div>
             <div className="flex flex-col gap-2 pt-2">
               <button onClick={() => handleExclusaoAprovada(deleteData.transacao!, "UNICA")} className="px-4 py-3 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">🗑️ Excluir apenas esta ({monthName})</button>
               <button onClick={() => handleExclusaoAprovada(deleteData.transacao!, "TODAS")} className="px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-sm font-bold text-rose-600 hover:bg-rose-100 transition-colors">🗑️ Excluir esta e as futuras</button>
               <button onClick={() => setDeleteData({ open: false, transacao: null })} className="px-4 py-2 mt-2 text-sm font-bold text-slate-400 hover:text-slate-600">Cancelar</button>
             </div>
           </div>
        </Modal>
      )}

      {modalData.open && tenantId && (
        <ModalTransacao tenantId={tenantId} onClose={() => setModalData({ open: false, transacao: null })} transacaoEdit={modalData.transacao} contasDB={contasDB} categoriasDB={categoriasDB} addToast={addToast} onSuccess={() => { setModalData({ open: false, transacao: null }); carregarDados(tenantId, currentDate); }} />
      )}

      {showAjusteSaldo && tenantId && (
        <ModalAjusteSaldo tenantId={tenantId} contas={contasDB} saldos={saldosContas} onClose={() => setShowAjusteSaldo(false)} onSuccess={() => { setShowAjusteSaldo(false); carregarDados(tenantId, currentDate); }} addToast={addToast} />
      )}
    </div>
  );
}

function MetricCard({ title, value, tone, icon, footer, onEdit }: { title: string, value: string, tone: "emerald"|"rose", icon: string, footer: string, onEdit?: ()=>void }) {
  const colors = {
    emerald: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
    rose: "border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800 text-rose-900 dark:text-rose-100",
  };
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden flex flex-col ${colors[tone]} relative`}>
      <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-black/5 dark:border-white/5 font-bold text-[13px] sm:text-sm flex justify-between items-center">
        <span className="flex items-center gap-2">{icon} {title}</span>
        {onEdit && (
          <button onClick={(e)=>{e.stopPropagation(); onEdit();}} className="p-1 rounded-md bg-white/50 hover:bg-white/80 dark:bg-black/10 dark:hover:bg-black/30 transition-colors" title="Ajustar Saldo">
            <IconEdit />
          </button>
        )}
      </div>
      <div className="p-3 sm:p-4 flex-1">
        <div className={`text-[15px] sm:text-2xl font-bold leading-tight tabular-nums transition-all duration-300 finance-value`}>
          {value}
        </div>
      </div>
      <div className="px-3 sm:px-4 py-2 text-[11px] sm:text-xs bg-black/5 dark:bg-white/5 opacity-80 font-medium">
        <span className="finance-value">{footer}</span>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.60)", display: "grid", placeItems: "center", zIndex: 99999, padding: 16 }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg bg-white dark:bg-[#0f141a] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="font-bold text-slate-800 dark:text-white">{title}</div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors">
            <IconX />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function ModalAjusteSaldo({ tenantId, contas, saldos, onClose, onSuccess, addToast }: { tenantId: string, contas: any[], saldos: Record<string, number>, onClose: ()=>void, onSuccess: ()=>void, addToast: any }) {
  const [contaId, setContaId] = useState(contas[0]?.id || "");
  const [novoSaldo, setNovoSaldo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const saldoAtual = saldos[contaId] || 0;

  async function handleSave() {
    const val = parseFloat(novoSaldo);
    if (isNaN(val)) return;
    const diff = val - saldoAtual;
    if (diff === 0) { onClose(); return; }

    setSalvando(true);
    try {
      const isReceita = diff > 0;
      const { error } = await supabaseBrowser.from("fin_transacoes").insert({
        tenant_id: tenantId, tipo: isReceita ? "RECEITA" : "DESPESA", descricao: "Ajuste Automático de Saldo",
        valor: Math.abs(diff), data_vencimento: new Date().toISOString().split("T")[0], status: "PAGO",
        data_pagamento: new Date().toISOString(), conta_id: contaId, is_recorrente: false, observacoes: "Ajuste automático de saldo"
      });

      if (error) throw error;
      addToast("success", "Saldo Ajustado", "O ajuste foi lançado na conta selecionada.");
      onSuccess();
    } catch(e: any) { addToast("error", "Erro ao ajustar", e.message); } finally { setSalvando(false); }
  }

  return (
    <Modal title="Ajustar Saldo" onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3 bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/20 rounded-xl text-sm text-sky-800 dark:text-sky-300">O sistema criará um lançamento de ajuste para igualar o saldo com o seu banco real.</div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Conta / Carteira</label>
          <select value={contaId} onChange={e=>setContaId(e.target.value)} className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg outline-none text-sm focus:border-emerald-500 text-slate-800 dark:text-white">
            {contas.map(c => <option key={c.id} value={c.id}>{c.icone} {c.nome} (Atual: R$ {saldos[c.id] || 0})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Qual é o saldo real hoje?</label>
          <input autoFocus type="number" step="0.01" value={novoSaldo} onChange={e=>setNovoSaldo(e.target.value)} placeholder="0.00" className="w-full h-11 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg outline-none text-sm font-bold focus:border-emerald-500" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={handleSave} disabled={salvando} className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 disabled:opacity-50">Salvar Ajuste</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalNovaConta({ tenantId, onClose, onSave, addToast }: { tenantId: string, onClose: ()=>void, onSave: (novaConta: any)=>void, addToast: any }) {
  const [nome, setNome] = useState("");
  const [icone, setIcone] = useState("🏦");
  const [salvando, setSalvando] = useState(false);
  const icones = ["🏦","💳","💵","🪙","🟣","🟠","🟢","🔴","🤝","📱"];
  
  async function handleSave() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const { data, error } = await supabaseBrowser.from("fin_contas_bancarias").insert({ tenant_id: tenantId, nome: nome.trim(), icone }).select().single();
      if (error) throw error;
      addToast("success", "Conta criada", "Nova conta adicionada com sucesso.");
      onSave(data);
    } catch(e: any) { addToast("error", "Erro ao criar", e.message); } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-[100000] bg-black/60 grid place-items-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 font-bold text-sm bg-slate-50 dark:bg-white/5 flex justify-between">
          <span>Criar Nova Conta</span>
          <button onClick={onClose}><IconX /></button>
        </div>
        <div className="p-4 space-y-4">
          <div><label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Nome</label><input autoFocus value={nome} onChange={e=>setNome(e.target.value)} placeholder="Ex: C6 Bank" className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg outline-none text-sm focus:border-emerald-500" /></div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ícone</label>
            <div className="flex flex-wrap gap-2">{icones.map(i => <button key={i} onClick={()=>setIcone(i)} className={`w-8 h-8 rounded border text-lg flex items-center justify-center transition-all ${icone === i ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"}`}>{i}</button>)}</div>
          </div>
          <button onClick={handleSave} disabled={salvando} className="w-full h-10 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 shadow-lg transition-colors disabled:opacity-50">Salvar Conta</button>
        </div>
      </div>
    </div>
  );
}

function ModalGerenciarItens({ title, items, onExcluir, onClose, addToast, confirmDialog }: { title: string, items: any[], onExcluir: (id: string)=>Promise<void>, onClose: ()=>void, addToast: any, confirmDialog: any }) {
  return (
    <div className="fixed inset-0 z-[100000] bg-black/60 grid place-items-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 font-bold text-sm bg-slate-50 dark:bg-white/5 flex justify-between shrink-0">
          <span>{title}</span><button onClick={onClose}><IconX /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {items.length === 0 && <div className="text-center text-slate-400 text-sm italic">Nenhum item cadastrado.</div>}
          {items.map(it => (
            <div key={it.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
              <span className="text-sm font-medium">{it.icone} {it.nome}</span>
              <button onClick={async () => {
                const ok = await confirmDialog({
                  title: "Excluir Item",
                  subtitle: `Tem certeza que deseja excluir '${it.nome}'?`,
                  tone: "rose",
                  icon: "🗑️",
                  confirmText: "Sim, Excluir"
                });
                if(ok) {
                  try { await onExcluir(it.id); } catch(e:any) { addToast("error", "Ação bloqueada", "Este item já está em uso em algum lançamento."); }
                }
              }} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"><IconTrash /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModalNovaCategoria({ tenantId, onClose, onSave, tipoFixo, addToast }: { tenantId: string, onClose: ()=>void, onSave: (novaCat: any)=>void, tipoFixo: string, addToast: any }) {
  const [nome, setNome] = useState("");
  const [icone, setIcone] = useState("📦");
  const [salvando, setSalvando] = useState(false);
  const icones = ["🛒","🏥","🚗","📚","🏖️","🏠","💡","🍔","🐶","👗","📱","💻","📦","💰","📈"];
  
  async function handleSave() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const { data, error } = await supabaseBrowser.from("fin_categorias").insert({ tenant_id: tenantId, nome: nome.trim(), icone, tipo: tipoFixo }).select().single();
      if (error) throw error;
      addToast("success", "Categoria criada", "Nova categoria adicionada.");
      onSave(data);
    } catch(e: any) { addToast("error", "Erro ao criar", e.message); } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-[100000] bg-black/60 grid place-items-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 font-bold text-sm bg-slate-50 dark:bg-white/5 flex justify-between">
          <span>Nova Categoria de {tipoFixo === "RECEITA" ? "Receita" : "Despesa"}</span><button onClick={onClose}><IconX /></button>
        </div>
        <div className="p-4 space-y-4">
          <div><label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Nome</label><input autoFocus value={nome} onChange={e=>setNome(e.target.value)} placeholder="Ex: Roupas" className="w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg outline-none text-sm focus:border-emerald-500" /></div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Ícone</label>
            <div className="flex flex-wrap gap-2">{icones.map(i => <button key={i} onClick={()=>setIcone(i)} className={`w-8 h-8 rounded border text-lg flex items-center justify-center transition-all ${icone === i ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"}`}>{i}</button>)}</div>
          </div>
          <button onClick={handleSave} disabled={salvando} className="w-full h-10 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 shadow-lg transition-colors disabled:opacity-50">Salvar Categoria</button>
        </div>
      </div>
    </div>
  );
}

function ModalTransacao({ tenantId, onClose, transacaoEdit, addToast, onSuccess, contasDB, categoriasDB }: { tenantId: string, onClose: () => void; transacaoEdit?: any | null; addToast: any, onSuccess: ()=>void, contasDB: any[], categoriasDB: any[] }) {
  const isEdit = !!transacaoEdit;
  
  const [tipo, setTipo] = useState<"RECEITA" | "DESPESA">(transacaoEdit?.tipo || "DESPESA");
  const [descricao, setDescricao] = useState(transacaoEdit?.descricao || "");
  const [valor, setValor] = useState(transacaoEdit?.valor ? String(transacaoEdit.valor) : "");
  const [vencimento, setVencimento] = useState(transacaoEdit?.data_vencimento || new Date().toISOString().split("T")[0]);
  const [status, setStatus] = useState<"PENDENTE" | "PAGO">(transacaoEdit?.status || "PENDENTE");
  const [obs, setObs] = useState(transacaoEdit?.observacoes || "");

  let rTipoInicial: "UNICA"|"RECORRENTE"|"PARCELADA" = "UNICA";
  if (transacaoEdit?.is_recorrente && transacaoEdit?.parcela_total) rTipoInicial = "PARCELADA";
  else if (transacaoEdit?.is_recorrente) rTipoInicial = "RECORRENTE";

  const [tipoRecorrencia, setTipoRecorrencia] = useState(rTipoInicial);
  const [frequencia, setFrequencia] = useState(transacaoEdit?.frequencia || "MENSAL");
  const [parcelas, setParcelas] = useState(transacaoEdit?.parcela_total ? String(transacaoEdit.parcela_total) : "2");
  
  // ✅ Agora a opção de edição padrão é alterar TODAS as parcelas futuras
  const [escopoEdicao, setEscopoEdicao] = useState<"UNICA" | "TODAS">("TODAS"); 

  const [contas, setContas] = useState<any[]>(contasDB);
  const [categorias, setCategorias] = useState<any[]>(categoriasDB);
  
  const categoriasAtivas = categorias.filter(c => c.tipo === tipo || c.tipo === "AMBOS");
  const [contaSelecionada, setContaSelecionada] = useState(transacaoEdit?.conta_id || (contas.length > 0 ? contas[0].id : ""));
  const [categoriaSelecionada, setCategoriaSelecionada] = useState(transacaoEdit?.categoria_id || "");

  const [salvando, setSalvando] = useState(false);

  const [showNovaConta, setShowNovaConta] = useState(false);
  const [showGerenciarContas, setShowGerenciarContas] = useState(false);
  
  const [showNovaCategoria, setShowNovaCategoria] = useState(false);
  const [showGerenciarCategorias, setShowGerenciarCategorias] = useState(false);

  const { confirm } = useConfirm();

  const handleContaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === "NOVA") setShowNovaConta(true);
    else if (e.target.value === "GERENCIAR") setShowGerenciarContas(true);
    else setContaSelecionada(e.target.value);
  };

  const handleCategoriaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === "NOVA") setShowNovaCategoria(true);
    else if (e.target.value === "GERENCIAR") setShowGerenciarCategorias(true);
    else setCategoriaSelecionada(e.target.value);
  };

  async function handleExcluirConta(id: string) {
    const { error } = await supabaseBrowser.from("fin_contas_bancarias").delete().eq("id", id);
    if(error) throw error;
    setContas(prev => prev.filter(c => c.id !== id));
    if (contaSelecionada === id) setContaSelecionada("");
  }

  async function handleExcluirCategoria(id: string) {
    const { error } = await supabaseBrowser.from("fin_categorias").delete().eq("id", id);
    if(error) throw error;
    setCategorias(prev => prev.filter(c => c.id !== id));
    if (categoriaSelecionada === id) setCategoriaSelecionada("");
  }

  async function handleSave() {
    if (!descricao.trim() || !valor || !contaSelecionada || !categoriaSelecionada) {
      addToast("error", "Erro", "Preencha todos os campos obrigatórios (Conta e Categoria inclusos)");
      return;
    }
    setSalvando(true);
    try {
      if (isEdit) {
        if (escopoEdicao === "UNICA" || !transacaoEdit.recorrencia_id) {
          const { error } = await supabaseBrowser.from("fin_transacoes").update({
            tipo, descricao, valor: Number(valor), data_vencimento: vencimento, status, conta_id: contaSelecionada, categoria_id: categoriaSelecionada, observacoes: obs
          }).eq("id", transacaoEdit.id);
          if (error) throw error;
        } else {
          const { error } = await supabaseBrowser.from("fin_transacoes").update({
            tipo, descricao, valor: Number(valor), conta_id: contaSelecionada, categoria_id: categoriaSelecionada, observacoes: obs
          }).eq("recorrencia_id", transacaoEdit.recorrencia_id).gte("data_vencimento", transacaoEdit.data_vencimento);
          if (error) throw error;
          
          await supabaseBrowser.from("fin_transacoes").update({ status }).eq("id", transacaoEdit.id);
        }
        addToast("success", "Alteração Salva", "Lançamento atualizado com sucesso!");
      } 
      else {
        const isRecorrente = tipoRecorrencia !== "UNICA";
        const totalMesesOuParcelas = tipoRecorrencia === "PARCELADA" ? Number(parcelas) : (tipoRecorrencia === "RECORRENTE" ? 12 : 1);
        const valorInserir = tipoRecorrencia === "PARCELADA" ? Number(valor) / totalMesesOuParcelas : Number(valor);
        const recorrenciaId = isRecorrente ? crypto.randomUUID() : null; 
        
        const inserts = [];
        const baseDate = new Date(`${vencimento}T12:00:00`);

        for (let i = 1; i <= totalMesesOuParcelas; i++) {
          const dataVenc = new Date(baseDate);
          
          if (i > 1) {
            if (tipoRecorrencia === "PARCELADA" || frequencia === "MENSAL") dataVenc.setMonth(dataVenc.getMonth() + (i - 1));
            else if (frequencia === "BIMESTRAL") dataVenc.setMonth(dataVenc.getMonth() + (i - 1) * 2);
            else if (frequencia === "TRIMESTRAL") dataVenc.setMonth(dataVenc.getMonth() + (i - 1) * 3);
            else if (frequencia === "SEMESTRAL") dataVenc.setMonth(dataVenc.getMonth() + (i - 1) * 6);
            else if (frequencia === "ANUAL") dataVenc.setFullYear(dataVenc.getFullYear() + (i - 1));
          }

          inserts.push({
            tenant_id: tenantId,
            tipo,
            descricao,
            valor: valorInserir,
            data_vencimento: dataVenc.toISOString().split("T")[0],
            status: (i === 1 && status === "PAGO") ? "PAGO" : "PENDENTE",
            data_pagamento: (i === 1 && status === "PAGO") ? new Date().toISOString() : null,
            conta_id: contaSelecionada,
            categoria_id: categoriaSelecionada,
            observacoes: obs,
            is_recorrente: isRecorrente,
            frequencia: tipoRecorrencia === "RECORRENTE" ? frequencia : null,
            recorrencia_id: recorrenciaId,
            parcela_atual: tipoRecorrencia === "PARCELADA" ? i : null,
            parcela_total: tipoRecorrencia === "PARCELADA" ? totalMesesOuParcelas : null
          });
        }

        const { error } = await supabaseBrowser.from("fin_transacoes").insert(inserts);
        if (error) throw error;
        addToast("success", "Lançamento Criado", tipoRecorrencia !== "UNICA" ? "Lançamentos programados com sucesso!" : "Lançamento adicionado.");
      }

      onSuccess();
    } catch(e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Modal title={isEdit ? "Editar Lançamento" : "Adicionar Lançamento"} onClose={onClose}>
        <div className="max-h-[75vh] overflow-y-auto pr-1 space-y-5">
          
          <div className="flex p-1 bg-slate-100 dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/5">
            <button onClick={() => setTipo("DESPESA")} disabled={isEdit} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${tipo === "DESPESA" ? "bg-white dark:bg-[#161b22] text-rose-600 dark:text-rose-400 shadow-sm" : "text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80"} ${isEdit ? "opacity-50 cursor-not-allowed" : ""}`}>📉 Despesa</button>
            <button onClick={() => setTipo("RECEITA")} disabled={isEdit} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${tipo === "RECEITA" ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80"} ${isEdit ? "opacity-50 cursor-not-allowed" : ""}`}>📈 Receita</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Descrição</label>
              <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Conta de Luz" className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Valor {tipoRecorrencia === "PARCELADA" && !isEdit ? "Total" : ""} (R$)</label>
              <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" className={`w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-bold outline-none focus:border-emerald-500/50 ${tipo === "RECEITA" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Data de Vencimento</label>
              <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-mono" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Status</label>
              <div className="flex bg-slate-50 dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/10 p-1 h-11">
                <button onClick={() => setStatus("PENDENTE")} className={`flex-1 rounded-lg text-xs font-bold transition-colors ${status === "PENDENTE" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "text-slate-400 hover:text-slate-600 dark:hover:text-white/80"}`}>⏳ Pendente</button>
                <button onClick={() => setStatus("PAGO")} className={`flex-1 rounded-lg text-xs font-bold transition-colors ${status === "PAGO" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "text-slate-400 hover:text-slate-600 dark:hover:text-white/80"}`}>✅ Pago</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Conta / Carteira</label>
              <select value={contaSelecionada} onChange={handleContaChange} className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-medium">
                <option value="" disabled>Selecionar Conta</option>
                {contas.map(c => <option key={c.id} value={c.id}>{c.icone} {c.nome}</option>)}
                <option disabled>──────────</option>
                <option value="NOVA" className="font-bold text-emerald-600">+ Nova Conta</option>
                <option value="GERENCIAR" className="font-bold text-slate-600 dark:text-white/60">⚙️ Gerenciar Contas</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Categoria</label>
              <select value={categoriaSelecionada} onChange={handleCategoriaChange} className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-medium">
                <option value="" disabled>Selecionar Categoria</option>
                {categoriasAtivas.map(c => <option key={c.id} value={c.id}>{c.icone} {c.nome}</option>)}
                <option disabled>──────────</option>
                <option value="NOVA" className="font-bold text-emerald-600">+ Nova Categoria</option>
                <option value="GERENCIAR" className="font-bold text-slate-600 dark:text-white/60">⚙️ Gerenciar Categorias</option>
              </select>
            </div>
          </div>

          {!isEdit && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-4">
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Recorrência e Parcelamento</label>
              
              <div className="flex bg-white dark:bg-black/20 rounded-lg border border-slate-200 dark:border-white/10 p-1">
                <button onClick={() => setTipoRecorrencia("UNICA")} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${tipoRecorrencia === "UNICA" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80"}`}>Única</button>
                <button onClick={() => setTipoRecorrencia("RECORRENTE")} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${tipoRecorrencia === "RECORRENTE" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80"}`}>Recorrente</button>
                <button onClick={() => setTipoRecorrencia("PARCELADA")} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${tipoRecorrencia === "PARCELADA" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80"}`}>Parcelado</button>
              </div>

              {tipoRecorrencia === "PARCELADA" && (
                <div className="flex items-center gap-3 animate-in fade-in zoom-in-95">
                  <span className="text-xs font-medium text-slate-600 dark:text-white/70">Qtd de Parcelas:</span>
                  <input type="number" min="2" max="120" value={parcelas} onChange={e => setParcelas(e.target.value)} className="w-20 h-9 px-2 text-center bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-bold outline-none focus:border-emerald-500/50 text-slate-800 dark:text-white" />
                </div>
              )}

              {tipoRecorrencia === "RECORRENTE" && (
                <div className="flex items-center gap-3 animate-in fade-in zoom-in-95">
                  <span className="text-xs font-medium text-slate-600 dark:text-white/70">Repetir a cada:</span>
                  <select value={frequencia} onChange={e => setFrequencia(e.target.value)} className="flex-1 h-9 px-2 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-bold outline-none focus:border-emerald-500/50 text-slate-800 dark:text-white">
                    <option value="MENSAL">Mês</option>
                    <option value="BIMESTRAL">2 Meses</option>
                    <option value="TRIMESTRAL">3 Meses</option>
                    <option value="SEMESTRAL">6 Meses</option>
                    <option value="ANUAL">Ano</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {isEdit && rTipoInicial !== "UNICA" && (
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 space-y-3">
              <label className="block text-[10px] font-bold text-amber-700 dark:text-amber-500 uppercase tracking-wider">⚠️ Alteração em Conta Programada</label>
              <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                <label className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input type="radio" checked={escopoEdicao === "UNICA"} onChange={() => setEscopoEdicao("UNICA")} className="w-4 h-4 text-emerald-600 focus:ring-emerald-500" />
                  Apenas neste mês
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input type="radio" checked={escopoEdicao === "TODAS"} onChange={() => setEscopoEdicao("TODAS")} className="w-4 h-4 text-emerald-600 focus:ring-emerald-500" />
                  Nesta e nas futuras
                </label>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Detalhes adicionais..." className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
          </div>
          
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={salvando} className={`px-6 py-2 rounded-lg text-white text-sm font-bold shadow-lg transition-all disabled:opacity-50 ${tipo === "RECEITA" ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20" : "bg-rose-600 hover:bg-rose-500 shadow-rose-900/20"}`}>
            {salvando ? "Processando..." : (isEdit ? "Salvar Alterações" : "Criar Lançamento")}
          </button>
        </div>
      </Modal>

      {showNovaConta && <ModalNovaConta tenantId={tenantId} addToast={addToast} onClose={() => { setShowNovaConta(false); setContaSelecionada(""); }} onSave={(nova) => { setContas([...contas, nova]); setContaSelecionada(nova.id); setShowNovaConta(false); }} />}
      {showNovaCategoria && <ModalNovaCategoria tenantId={tenantId} addToast={addToast} tipoFixo={tipo} onClose={() => { setShowNovaCategoria(false); setCategoriaSelecionada(""); }} onSave={(nova) => { setCategorias([...categorias, nova]); setCategoriaSelecionada(nova.id); setShowNovaCategoria(false); }} />}
      
      {showGerenciarContas && <ModalGerenciarItens title="Gerenciar Contas" items={contas} onClose={() => setShowGerenciarContas(false)} addToast={addToast} confirmDialog={confirm} onExcluir={async (id) => { await handleExcluirConta(id); }} />}
      {showGerenciarCategorias && <ModalGerenciarItens title="Gerenciar Categorias" items={categoriasAtivas} onClose={() => setShowGerenciarCategorias(false)} addToast={addToast} confirmDialog={confirm} onExcluir={async (id) => { await handleExcluirCategoria(id); }} />}
    </>
  );
}

export default function FinanceiroPessoalPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 animate-pulse">Carregando Finanças...</div>}>
      <FinanceiroPageContent />
    </Suspense>
  );
}