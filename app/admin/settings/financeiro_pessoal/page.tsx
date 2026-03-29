"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { EyeToggle } from "@/app/admin/eye-toggle";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { getCurrentTenantId } from "@/lib/tenant";

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
  parcela_atual?: number;
  parcela_total?: number;
  recorrencia: string; // Única, Mensal, Anual, Parcelado
  observacoes?: string;
};

// --- ICONES ---
function IconPlus() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>; }
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconChevronLeft() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>; }
function IconChevronRight() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>; }
function IconTrendingUp() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>; }
function IconTrendingDown() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>; }

function FinanceiroPageContent() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [valuesHidden, setValuesHidden] = useState(false);

  // Calendário
  const [currentDate, setCurrentDate] = useState(new Date());

  // Dados
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  
  // Filtros
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [tipoFilter, setTipoFilter] = useState("Todos");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Modais
  const [showModalAdd, setShowModalAdd] = useState(false);

  // Helper Toast
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  const monthName = currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  
  const handlePrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const handleToday = () => setCurrentDate(new Date());

  useEffect(() => {
    async function load() {
      setLoading(true);
      const tid = await getCurrentTenantId();
      setTenantId(tid);
      
      // MOCK DE DADOS PARA VISUALIZAÇÃO
      setTransacoes([
        { id: "1", tipo: "RECEITA", descricao: "Salário UniGestor", valor: 15000, data_vencimento: "2026-03-05", status: "PAGO", categoria_nome: "💼 Salário", conta_nome: "Itaú", recorrencia: "Mensal" },
        { id: "2", tipo: "DESPESA", descricao: "Cartão de Crédito Nubank", valor: 4500.50, data_vencimento: "2026-04-10", status: "PENDENTE", categoria_nome: "💳 Cartão", conta_nome: "Nubank", recorrencia: "Única" },
        { id: "3", tipo: "DESPESA", descricao: "IPVA do Porsche", valor: 3200, data_vencimento: "2026-03-15", status: "PENDENTE", parcela_atual: 3, parcela_total: 5, categoria_nome: "🚗 Veículo", conta_nome: "Inter", recorrencia: "Parcelado" },
        { id: "4", tipo: "RECEITA", descricao: "Venda de Consultoria", valor: 2500, data_vencimento: "2026-03-20", status: "PENDENTE", categoria_nome: "💡 Serviços", conta_nome: "Stripe", recorrencia: "Única" },
        { id: "5", tipo: "DESPESA", descricao: "Conta de Luz", valor: 350.20, data_vencimento: "2026-03-22", status: "PAGO", categoria_nome: "⚡ Moradia", conta_nome: "Itaú", recorrencia: "Mensal" }
      ]);
      
      setLoading(false);
    }
    load();
  }, [currentDate]);

  // CÁLCULOS DO DASHBOARD (Realizado vs Previsão)
  const receitasPagas = transacoes.filter(t => t.tipo === "RECEITA" && t.status === "PAGO").reduce((acc, t) => acc + t.valor, 0);
  const receitasTotal = transacoes.filter(t => t.tipo === "RECEITA").reduce((acc, t) => acc + t.valor, 0);

  const despesasPagas = transacoes.filter(t => t.tipo === "DESPESA" && t.status === "PAGO").reduce((acc, t) => acc + t.valor, 0);
  const despesasTotal = transacoes.filter(t => t.tipo === "DESPESA").reduce((acc, t) => acc + t.valor, 0);

  const saldoPago = receitasPagas - despesasPagas;
  const saldoTotal = receitasTotal - despesasTotal;

  const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  // Função que descobre se a conta atrasou
  const getComputedStatus = (status: string, vencimentoIso: string) => {
    if (status === "PAGO") return "PAGO";
    
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const [y, m, d] = vencimentoIso.split("-").map(Number);
    const venc = new Date(y, m - 1, d);
    venc.setHours(0, 0, 0, 0);
    
    return venc < hoje ? "VENCIDO" : "PENDENTE";
  };

  // APLICAÇÃO DOS FILTROS
  const filteredTransacoes = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    return transacoes.filter((t) => {
      const cStatus = getComputedStatus(t.status, t.data_vencimento);

      if (statusFilter !== "Todos" && cStatus !== statusFilter) return false;
      if (tipoFilter !== "Todos" && t.tipo !== tipoFilter) return false;
      
      if (q) {
        const hay = [t.descricao, t.categoria_nome, t.conta_nome, t.recorrencia]
          .join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime());
  }, [transacoes, search, statusFilter, tipoFilter]);

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors" id="dashboard-values">
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={(id) => setToasts(t => t.filter(x => x.id !== id))} />
      </div>

      {/* HEADER + CALENDÁRIO */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
              Finanças Pessoais
            </h1>
            <button
              onClick={(e) => { e.stopPropagation(); setValuesHidden(v => !v); }}
              title={valuesHidden ? "Exibir valores" : "Ocultar valores"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white hover:border-slate-400 dark:hover:border-white/30 transition-all text-xs font-medium shadow-sm select-none"
            >
              {valuesHidden ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12S5.5 5 12 5s10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" fill="currentColor" stroke="none" /></svg>
              )}
              <span className="hidden sm:inline text-[11px] tracking-wide">{valuesHidden ? "Exibir" : "Ocultar"}</span>
            </button>
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

      {/* DASHBOARD CARDS */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3 px-3 sm:px-0">
        <MetricCard 
          title="Receitas do Mês" 
          value={fmtBRL(receitasPagas)} 
          tone="emerald" 
          isHidden={valuesHidden} 
          icon="📈" 
          footer={`Previsão total: ${fmtBRL(receitasTotal)}`} 
        />
        <MetricCard 
          title="Despesas do Mês" 
          value={fmtBRL(despesasPagas)} 
          tone="rose" 
          isHidden={valuesHidden} 
          icon="📉" 
          footer={`Previsão total: ${fmtBRL(despesasTotal)}`} 
        />
        <MetricCard 
          title="Saldo Atual" 
          value={fmtBRL(saldoPago)} 
          tone={saldoPago >= 0 ? "emerald" : "rose"} 
          isHidden={valuesHidden} 
          icon="💰" 
          footer={`Previsão final do mês: ${fmtBRL(saldoTotal)}`} 
        />
      </div>

      {/* --- BARRA DE FILTROS --- */}
      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 z-20">
        
        <div className="flex items-center justify-between">
          <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider">
            Lançamentos
          </div>
          <button
            onClick={() => setShowModalAdd(true)}
            className="hidden md:flex h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 items-center gap-2 transition-all"
          >
            <IconPlus /> Adicionar Lançamento
          </button>
        </div>

        {/* MOBILE: pesquisa + botões */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
            />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"><IconX /></button>}
          </div>

          <button
            onClick={() => setMobileFiltersOpen((v) => !v)}
            className={`h-10 px-3 rounded-lg border font-bold text-sm transition-colors ${
              (statusFilter !== "Todos" || tipoFilter !== "Todos")
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70"
            }`}
          >
            Filtros
          </button>
          
          <button onClick={() => setShowModalAdd(true)} className="h-10 w-10 flex items-center justify-center rounded-lg bg-emerald-600 text-white shadow-lg">
            <IconPlus />
          </button>
        </div>

        {/* DESKTOP: tudo na mesma linha */}
        <div className="hidden md:flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por descrição, conta, categoria..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
            />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"><IconX /></button>}
          </div>

          <div className="w-[180px]">
            <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white">
              <option value="Todos">Tipo (Todos)</option>
              <option value="RECEITA">Apenas Receitas</option>
              <option value="DESPESA">Apenas Despesas</option>
            </select>
          </div>

          <div className="w-[180px]">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white">
              <option value="Todos">Status (Todos)</option>
              <option value="PAGO">Pagos</option>
              <option value="PENDENTE">Pendentes (No prazo)</option>
              <option value="VENCIDO">Vencidos (Atrasados)</option>
            </select>
          </div>

          <button
            onClick={() => { setSearch(""); setStatusFilter("Todos"); setTipoFilter("Todos"); }}
            className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center gap-2"
          >
            <IconX /> Limpar
          </button>
        </div>

        {/* PAINEL MOBILE FILTROS */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-2">
            <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none text-slate-700 dark:text-white">
              <option value="Todos">Tipo (Todos)</option>
              <option value="RECEITA">Apenas Receitas</option>
              <option value="DESPESA">Apenas Despesas</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none text-slate-700 dark:text-white">
              <option value="Todos">Status (Todos)</option>
              <option value="PAGO">Pagos</option>
              <option value="PENDENTE">Pendentes</option>
            </select>
            <button onClick={() => { setSearch(""); setStatusFilter("Todos"); setTipoFilter("Todos"); setMobileFiltersOpen(false); }} className="w-full h-10 px-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 text-sm font-bold flex items-center justify-center gap-2">
              <IconX /> Limpar Filtros
            </button>
          </div>
        )}
      </div>

      {/* TABELA DE TRANSAÇÕES */}
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-x-auto sm:mx-0 mx-3">
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
            </tr>
          </thead>
          <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
            {filteredTransacoes.length === 0 && !loading && (
              <tr><td colSpan={8} className="p-8 text-center text-slate-400 italic">Nenhum lançamento encontrado.</td></tr>
            )}
            {filteredTransacoes.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => {/* Modal Editar */}}>
                
                {/* DESCRIÇÃO E PARCELA */}
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-700 dark:text-white truncate max-w-[220px] group-hover:text-emerald-600 transition-colors">{t.descricao}</div>
                  {t.parcela_total && <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Parcela {t.parcela_atual}/{t.parcela_total}</div>}
                </td>

                {/* TIPO */}
                <td className="px-4 py-3 text-center">
                  {t.tipo === "RECEITA" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                      <IconTrendingUp /> Receita
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase text-rose-600 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20">
                      <IconTrendingDown /> Despesa
                    </span>
                  )}
                </td>

                {/* VENCIMENTO */}
                <td className="px-4 py-3 text-center">
                  <span className="font-mono text-slate-600 dark:text-white/80">{t.data_vencimento.split('-').reverse().join('/')}</span>
                </td>

                {/* STATUS */}
                <td className="px-4 py-3 text-center">
                  {(() => {
                    const cStatus = getComputedStatus(t.status, t.data_vencimento);
                    let cor = "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/20"; // Pendente
                    
                    if (cStatus === "PAGO") {
                      cor = "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20";
                    } else if (cStatus === "VENCIDO") {
                      cor = "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/20";
                    }

                    return (
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${cor}`}>
                        {cStatus}
                      </span>
                    );
                  })()}
                </td>

                {/* CATEGORIA */}
                <td className="px-4 py-3 text-center">
                  <div className="text-xs text-slate-600 dark:text-white/80 font-medium">{t.categoria_nome || "—"}</div>
                </td>

                {/* CONTA */}
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 border border-slate-200 dark:border-white/10 uppercase">
                    {t.conta_nome || "—"}
                  </span>
                </td>

                {/* RECORRENCIA */}
                <td className="px-4 py-3 text-center">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider">{t.recorrencia}</span>
                </td>

                {/* VALOR */}
                <td className="px-4 py-3 text-right">
                  <span className={`font-bold transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""} ${t.tipo === "RECEITA" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {t.tipo === "RECEITA" ? "+" : "-"} {fmtBRL(t.valor)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="h-10" />
      </div>

      {/* MODAL DE ADICIONAR / EDITAR */}
      {showModalAdd && (
        <ModalTransacao onClose={() => setShowModalAdd(false)} />
      )}

    </div>
  );
}

// Sub-Componente de Card do Dashboard (Padrão Gestor)
function MetricCard({ title, value, tone, isHidden, icon, footer }: { title: string, value: string, tone: "emerald"|"rose", isHidden: boolean, icon: string, footer: string }) {
  const colors = {
    emerald: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
    rose: "border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800 text-rose-900 dark:text-rose-100",
  };
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden flex flex-col ${colors[tone]}`}>
      <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-black/5 dark:border-white/5 font-bold text-[13px] sm:text-sm flex justify-between items-center">
        <span className="flex items-center gap-2">{icon} {title}</span>
      </div>
      <div className="p-3 sm:p-4 flex-1">
        <div className={`text-[15px] sm:text-2xl font-bold leading-tight tabular-nums transition-all duration-300 ${isHidden ? "blur-md select-none" : ""}`}>
          {value}
        </div>
      </div>
      <div className="px-3 sm:px-4 py-2 text-[11px] sm:text-xs bg-black/5 dark:bg-white/5 opacity-80 font-medium">
        {footer}
      </div>
    </div>
  );
}

// Modal Genérico (copiado do seu código)
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

// --- COMPONENTE DO MODAL DE TRANSAÇÃO ---
function ModalTransacao({ 
  onClose, 
  transacaoEdit 
}: { 
  onClose: () => void; 
  transacaoEdit?: Transacao | null;
}) {
  const [tipo, setTipo] = useState<"RECEITA" | "DESPESA">(transacaoEdit?.tipo || "DESPESA");
  const [descricao, setDescricao] = useState(transacaoEdit?.descricao || "");
  const [valor, setValor] = useState(transacaoEdit?.valor ? String(transacaoEdit.valor) : "");
  const [vencimento, setVencimento] = useState(transacaoEdit?.data_vencimento || new Date().toISOString().split("T")[0]);
  const [status, setStatus] = useState<"PENDENTE" | "PAGO">(transacaoEdit?.status || "PENDENTE");
  const [obs, setObs] = useState(transacaoEdit?.observacoes || "");

  // Recorrência Simplificada
  // Tipos base: "UNICA", "RECORRENTE", "PARCELADA"
  const [tipoRecorrencia, setTipoRecorrencia] = useState<"UNICA" | "RECORRENTE" | "PARCELADA">("UNICA");
  const [frequencia, setFrequencia] = useState("Mensal"); // Para quando for Recorrente
  const [parcelas, setParcelas] = useState(transacaoEdit?.parcela_total ? String(transacaoEdit.parcela_total) : "2"); // Para Parcelada

  // Contas Mockadas (Depois virão do banco)
  const contas = [
    { id: "1", nome: "Itaú" },
    { id: "2", nome: "Nubank" },
    { id: "3", nome: "Inter" },
    { id: "4", nome: "Mercado Pago" },
    { id: "5", nome: "Stripe" },
  ];
  const [contaSelecionada, setContaSelecionada] = useState("1");

  // Categorias Padrão
  const categorias = [
    { id: "1", nome: "💳 Cartão de Crédito" },
    { id: "2", nome: "📚 Educação" },
    { id: "3", nome: "👨‍👩‍👧 Família" },
    { id: "4", nome: "🏛️ Impostos e Taxas" },
    { id: "5", nome: "📈 Investimentos" },
    { id: "6", nome: "🏖️ Lazer" },
    { id: "7", nome: "🏠 Moradia" },
    { id: "8", nome: "💼 Salário" },
    { id: "9", nome: "🏥 Saúde" },
    { id: "10", nome: "⚡ Serviços Essenciais" },
    { id: "11", nome: "🚗 Veicular" },
    { id: "12", nome: "📺 IPTV" },
    { id: "13", nome: "📦 Outros" },
  ];
  const [categoriaSelecionada, setCategoriaSelecionada] = useState("");

  const isEdit = !!transacaoEdit;

  // Lida com o clique no Select de Conta/Categoria para interceptar o "+ Nova"
  const handleContaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === "NOVA") {
      alert("Abrir sub-modal de Nova Conta (em breve)");
      // setContaSelecionada(""); // ou mantém a anterior
    } else {
      setContaSelecionada(e.target.value);
    }
  };

  const handleCategoriaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === "NOVA") {
      alert("Abrir sub-modal de Nova Categoria (em breve)");
    } else {
      setCategoriaSelecionada(e.target.value);
    }
  };

  return (
    <Modal title={isEdit ? "Editar Lançamento" : "Adicionar Lançamento"} onClose={onClose}>
      <div className="max-h-[75vh] overflow-y-auto pr-1 space-y-5">
        
        {/* TABS TIPO */}
        <div className="flex p-1 bg-slate-100 dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/5">
          <button
            onClick={() => setTipo("DESPESA")}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${tipo === "DESPESA" ? "bg-white dark:bg-[#161b22] text-rose-600 dark:text-rose-400 shadow-sm" : "text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80"}`}
          >
            📉 Despesa
          </button>
          <button
            onClick={() => setTipo("RECEITA")}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${tipo === "RECEITA" ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80"}`}
          >
            📈 Receita
          </button>
        </div>

        {/* VALOR E DESCRIÇÃO */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Descrição</label>
            <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Conta de Luz" className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Valor (R$)</label>
            <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" className={`w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm font-bold outline-none focus:border-emerald-500/50 ${tipo === "RECEITA" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} />
          </div>
        </div>

        {/* VENCIMENTO E STATUS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Data de Vencimento</label>
            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-mono" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Status</label>
            <div className="flex bg-slate-50 dark:bg-black/20 rounded-xl border border-slate-200 dark:border-white/10 p-1 h-11">
              <button onClick={() => setStatus("PENDENTE")} className={`flex-1 rounded-lg text-xs font-bold transition-colors ${status === "PENDENTE" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "text-slate-400 hover:text-slate-600"}`}>⏳ Pendente</button>
              <button onClick={() => setStatus("PAGO")} className={`flex-1 rounded-lg text-xs font-bold transition-colors ${status === "PAGO" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "text-slate-400 hover:text-slate-600"}`}>✅ Pago</button>
            </div>
          </div>
        </div>

        {/* CONTA BANCÁRIA E CATEGORIA */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Conta / Carteira</label>
            <select 
              value={contaSelecionada} 
              onChange={handleContaChange} 
              className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-medium"
            >
              <option value="" disabled>Selecionar Conta</option>
              {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              <option disabled>──────────</option>
              <option value="NOVA" className="font-bold text-emerald-600">+ Nova Conta</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Categoria</label>
            <select 
              value={categoriaSelecionada} 
              onChange={handleCategoriaChange} 
              className="w-full h-11 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-medium"
            >
              <option value="" disabled>Selecionar Categoria</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              <option disabled>──────────</option>
              <option value="NOVA" className="font-bold text-emerald-600">+ Nova Categoria</option>
            </select>
          </div>
        </div>

        {/* RECORRÊNCIA SIMPLIFICADA */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-4">
          <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Recorrência e Parcelamento</label>
          
          <div className="flex bg-white dark:bg-black/20 rounded-lg border border-slate-200 dark:border-white/10 p-1">
            <button onClick={() => setTipoRecorrencia("UNICA")} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${tipoRecorrencia === "UNICA" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 hover:text-slate-700 dark:text-white/50"}`}>Única</button>
            <button onClick={() => setTipoRecorrencia("RECORRENTE")} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${tipoRecorrencia === "RECORRENTE" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 hover:text-slate-700 dark:text-white/50"}`}>Recorrente</button>
            <button onClick={() => setTipoRecorrencia("PARCELADA")} className={`flex-1 py-1.5 rounded text-xs font-bold transition-all ${tipoRecorrencia === "PARCELADA" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 hover:text-slate-700 dark:text-white/50"}`}>Parcelado</button>
          </div>

          {tipoRecorrencia === "PARCELADA" && (
             <div className="flex items-center gap-3 animate-in fade-in zoom-in-95">
               <span className="text-xs font-medium text-slate-600 dark:text-white/70">Qtd de Parcelas:</span>
               <input type="number" min="2" max="120" value={parcelas} onChange={e => setParcelas(e.target.value)} className="w-20 h-9 px-2 text-center bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-bold outline-none focus:border-emerald-500/50" />
             </div>
          )}

          {tipoRecorrencia === "RECORRENTE" && (
             <div className="flex items-center gap-3 animate-in fade-in zoom-in-95">
               <span className="text-xs font-medium text-slate-600 dark:text-white/70">Repetir a cada:</span>
               <select value={frequencia} onChange={e => setFrequencia(e.target.value)} className="flex-1 h-9 px-2 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-bold outline-none focus:border-emerald-500/50">
                 <option value="Mensal">Mês</option>
                 <option value="Bimestral">2 Meses (Bimestral)</option>
                 <option value="Trimestral">3 Meses (Trimestral)</option>
                 <option value="Semestral">6 Meses (Semestral)</option>
                 <option value="Anual">Ano (Anual)</option>
               </select>
             </div>
          )}
        </div>

        {/* OBSERVAÇÕES */}
        <div>
          <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">Observações</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Detalhes adicionais..." className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
        </div>
        
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">Cancelar</button>
        <button className={`px-6 py-2 rounded-lg text-white text-sm font-bold shadow-lg transition-all ${tipo === "RECEITA" ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20" : "bg-rose-600 hover:bg-rose-500 shadow-rose-900/20"}`}>
          {isEdit ? "Salvar Alterações" : "Criar Lançamento"}
        </button>
      </div>
    </Modal>
  );
}

export default function FinanceiroPessoalPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 animate-pulse">Carregando Finanças...</div>}>
      <FinanceiroPageContent />
    </Suspense>
  );
}