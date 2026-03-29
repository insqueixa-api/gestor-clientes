"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { EyeToggle } from "@/app/admin/eye-toggle"; // Reaproveitando do seu Dashboard
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { supabaseBrowser } from "@/lib/supabase/browser";
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
  observacoes?: string;
};

// --- ICONES BÁSICOS ---
function IconPlus() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>; }
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconChevronLeft() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>; }
function IconChevronRight() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>; }

function FinanceiroPageContent() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [valuesHidden, setValuesHidden] = useState(false);

  // Navegação de Calendário
  const [currentDate, setCurrentDate] = useState(new Date());

  // Dados
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  
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
      
      // Aqui entrarão as buscas do Supabase...
      // Simulando dados mockados para o esqueleto:
      setTransacoes([
        { id: "1", tipo: "RECEITA", descricao: "Salário UniGestor", valor: 15000, data_vencimento: "2026-03-05", status: "PAGO", categoria_nome: "💼 Salário", conta_nome: "Itaú" },
        { id: "2", tipo: "DESPESA", descricao: "Cartão de Crédito Nubank", valor: 4500.50, data_vencimento: "2026-03-10", status: "PENDENTE", categoria_nome: "💳 Cartão", conta_nome: "Nubank" },
        { id: "3", tipo: "DESPESA", descricao: "IPVA do Porsche", valor: 3200, data_vencimento: "2026-03-15", status: "PENDENTE", parcela_atual: 3, parcela_total: 5, categoria_nome: "🚗 Veículo", conta_nome: "Inter" }
      ]);
      
      setLoading(false);
    }
    load();
  }, [currentDate]);

  // Cálculos do Dashboard
  const totalReceitas = transacoes.filter(t => t.tipo === "RECEITA").reduce((acc, t) => acc + t.valor, 0);
  const totalDespesas = transacoes.filter(t => t.tipo === "DESPESA").reduce((acc, t) => acc + t.valor, 0);
  const saldoMes = totalReceitas - totalDespesas;

  const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

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

      {/* DASHBOARD CARDS */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3 px-3 sm:px-0">
        <MetricCard title="Receitas do Mês" value={fmtBRL(totalReceitas)} tone="emerald" isHidden={valuesHidden} icon="📈" />
        <MetricCard title="Despesas do Mês" value={fmtBRL(totalDespesas)} tone="rose" isHidden={valuesHidden} icon="📉" />
        <MetricCard title="Saldo do Mês" value={fmtBRL(saldoMes)} tone={saldoMes >= 0 ? "emerald" : "rose"} isHidden={valuesHidden} icon="💰" />
      </div>

      {/* CONTROLES / FILTROS DA TABELA */}
      <div className="px-3 md:p-4 bg-white md:dark:bg-[#161b22] border border-slate-200 md:dark:border-white/10 rounded-xl shadow-sm flex items-center justify-between">
        <div className="text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider">
          Transações do Mês
        </div>
        <button
          onClick={() => setShowModalAdd(true)}
          className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 flex items-center gap-2 transition-all"
        >
          <IconPlus /> Adicionar Lançamento
        </button>
      </div>

      {/* TABELA PADRÃO DO GESTOR */}
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-x-auto sm:mx-0 mx-3">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/40">
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3 text-center">Vencimento</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Categoria / Conta</th>
              <th className="px-4 py-3 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
            {transacoes.length === 0 && !loading && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">Nenhum lançamento neste mês.</td></tr>
            )}
            {transacoes.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => {/* Aqui abriremos edição */}}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-700 dark:text-white truncate max-w-[200px]">{t.descricao}</div>
                  {t.parcela_total && <div className="text-[10px] font-bold text-slate-400">Parcela {t.parcela_atual}/{t.parcela_total}</div>}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="font-mono text-slate-600 dark:text-white/80">{t.data_vencimento.split('-').reverse().join('/')}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${t.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="text-xs text-slate-600 dark:text-white/80 font-medium">{t.categoria_nome || "—"}</div>
                  <div className="text-[10px] text-slate-400">{t.conta_nome || "—"}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-bold transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""} ${t.tipo === "RECEITA" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {t.tipo === "RECEITA" ? "+" : "-"} {fmtBRL(t.valor)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL DE ADICIONAR (Esqueleto Inicial) */}
      {showModalAdd && (
        <Modal title="Adicionar Lançamento" onClose={() => setShowModalAdd(false)}>
          <div className="p-4 text-center text-slate-500">
             (Aqui entrará o formulário completo com Abas de Receita/Despesa, parcelamento e botões de conta)
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-200 dark:border-white/10">
            <button onClick={() => setShowModalAdd(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-600 dark:text-white/60">Cancelar</button>
            <button className="px-6 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold">Salvar</button>
          </div>
        </Modal>
      )}

    </div>
  );
}

// Sub-Componente de Card do Dashboard (Padrão Gestor)
function MetricCard({ title, value, tone, isHidden, icon }: { title: string, value: string, tone: "emerald"|"rose", isHidden: boolean, icon: string }) {
  const colors = {
    emerald: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
    rose: "border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800 text-rose-900 dark:text-rose-100",
  };
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden flex flex-col ${colors[tone]}`}>
      <div className="px-4 py-3 border-b border-black/5 dark:border-white/5 font-bold text-sm flex justify-between items-center">
        <span className="flex items-center gap-2">{icon} {title}</span>
      </div>
      <div className="p-4 flex-1">
        <div className={`text-2xl sm:text-3xl font-bold tracking-tight transition-all duration-300 ${isHidden ? "blur-md select-none" : ""}`}>
          {value}
        </div>
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
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60"><IconX /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export default function FinanceiroPessoalPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 animate-pulse">Carregando Finanças...</div>}>
      <FinanceiroPageContent />
    </Suspense>
  );
}