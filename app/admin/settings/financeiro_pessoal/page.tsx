"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  data_pagamento?: string | null;
};

// --- ICONES ---
function IconPlus() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>; }
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconChevronLeft() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>; }
function IconChevronRight() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>; }
function IconChevronDown() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>; }
function IconTrendingUp() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>; }
function IconTrendingDown() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>; }
function IconCheck() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>; }
function IconThumb({ className = "" }) { 
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${className}`}>
      <path d="M7 10v12"/>
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>
    </svg>
  ); 
}
function IconUndo() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }
function IconCalendar() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>; }

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

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function ModalDatePicker({ currentDate, onSelect, onClose }: {
  currentDate: Date,
  onSelect: (date: Date) => void,
  onClose: () => void
}) {
  const [ano, setAno] = useState(currentDate.getFullYear());
  const mesSelecionado = currentDate.getMonth();

  const anos = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 7 + i);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[99999] bg-black/50 grid place-items-center p-4"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xs bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <span className="text-sm font-bold text-slate-700 dark:text-white">Selecionar Período</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors"><IconX /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Seletor de Ano */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Ano</label>
            <div className="flex items-center justify-between bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg p-1">
              <button
                onClick={() => setAno(a => a - 1)}
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-white dark:hover:bg-white/10 transition-colors"
              >
                <IconChevronLeft />
              </button>
              <span className="text-sm font-bold text-slate-700 dark:text-white w-16 text-center">{ano}</span>
              <button
                onClick={() => setAno(a => a + 1)}
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-white dark:hover:bg-white/10 transition-colors"
              >
                <IconChevronRight />
              </button>
            </div>
          </div>

          {/* Grid de Meses */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Mês</label>
            <div className="grid grid-cols-3 gap-1.5">
              {MESES.map((mes, idx) => {
                const isSelected = idx === mesSelecionado && ano === currentDate.getFullYear();
                const isCurrentMonth = idx === new Date().getMonth() && ano === new Date().getFullYear();
                return (
                  <button
                    key={mes}
                    onClick={() => {
                        const hoje = new Date().getDate();
                        const ultimoDiaDoMes = new Date(ano, idx + 1, 0).getDate();
                        const diaCerto = Math.min(hoje, ultimoDiaDoMes);
                        onSelect(new Date(ano, idx, diaCerto));
                    }}
                    className={`py-2 rounded-lg text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20"
                        : isCurrentMonth
                        ? "border border-emerald-300 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                        : "text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5"
                    }`}
                  >
                    {mes.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalDayPicker({ currentDate, onSelect, onClose }: {
  currentDate: Date,
  onSelect: (date: Date) => void,
  onClose: () => void
}) {
  const [viewDate, setViewDate] = useState(currentDate);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const ano = viewDate.getFullYear();
  const mes = viewDate.getMonth();

  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const primeiroDiaDaSemana = new Date(ano, mes, 1).getDay();

  const dias = [];
  for (let i = 0; i < primeiroDiaDaSemana; i++) dias.push(null);
  for (let i = 1; i <= diasNoMes; i++) dias.push(i);

  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-[99999] bg-black/50 grid place-items-center p-4">
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-xs bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <span className="text-sm font-bold text-slate-700 dark:text-white">Selecionar Data</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors"><IconX /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg p-1">
            <button onClick={() => setViewDate(new Date(ano, mes - 1, 1))} className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-white dark:hover:bg-white/10 transition-colors"><IconChevronLeft /></button>
            <button onClick={() => setShowMonthPicker(true)} className="px-3 py-1 text-sm font-bold text-slate-700 dark:text-white text-center capitalize hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-200 dark:hover:bg-white/10 rounded-md transition-colors">
              {meses[mes]} {ano}
            </button>
            <button onClick={() => setViewDate(new Date(ano, mes + 1, 1))} className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-white dark:hover:bg-white/10 transition-colors"><IconChevronRight /></button>
          </div>

          <div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["D","S","T","Q","Q","S","S"].map((d, i) => <div key={i} className="text-center text-[10px] font-bold text-slate-400 py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {dias.map((dia, idx) => {
                if (!dia) return <div key={`empty-${idx}`} />;
                const isSelected = dia === currentDate.getDate() && mes === currentDate.getMonth() && ano === currentDate.getFullYear();
                const isToday = dia === new Date().getDate() && mes === new Date().getMonth() && ano === new Date().getFullYear();
                return (
                  <button
                    key={idx}
                    onClick={() => onSelect(new Date(ano, mes, dia))}
                    className={`h-8 rounded-lg text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/20"
                        : isToday
                        ? "border border-emerald-300 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                        : "text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5"
                    }`}
                  >
                    {dia}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {showMonthPicker && (
        <ModalDatePicker
          currentDate={viewDate}
          onSelect={(date) => {
            setViewDate(date);
            setShowMonthPicker(false);
          }}
          onClose={() => setShowMonthPicker(false)}
        />
      )}
    </div>
  );
}

function FinanceiroPageContent() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null); // ✅ NOVO ESTADO
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
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showMobileCards, setShowMobileCards] = useState(false);

  // Modais
  const [modalData, setModalData] = useState<{ open: boolean, transacao: Transacao | null }>({ open: false, transacao: null });
  const [showAjusteSaldo, setShowAjusteSaldo] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Abre o modal de ajuste de saldo automaticamente se vier com ?ajustar=1
  useEffect(() => {
    if (searchParams.get("ajustar") === "1" && !loading && contasDB.length > 0) {
      setShowAjusteSaldo(true);
      // Limpa o param da URL sem recarregar a página
      router.replace("/admin/settings/financeiro_pessoal", { scroll: false });
    }
  }, [searchParams, loading, contasDB]);
  const [deleteData, setDeleteData] = useState<{ open: boolean, transacao: Transacao | null }>({ open: false, transacao: null });

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  const monthName = currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(" de ", " ");
  
  const handlePrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const handleToday = () => setCurrentDate(new Date());

  const sincronizarRendimentos = async (tid: string, dateObj: Date, contas: any[], categorias: any[]) => {
    const hoje = new Date();
    
    const isMesAtual = dateObj.getMonth() === hoje.getMonth() && dateObj.getFullYear() === hoje.getFullYear();
    const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const isMesAnterior = dateObj.getMonth() === mesPassado.getMonth() && dateObj.getFullYear() === mesPassado.getFullYear();

    if (!isMesAtual && !isMesAnterior) return;

    const catIPTV = categorias.find(c => c.nome.toLowerCase().includes("iptv"))?.id;
const catSaaS = categorias.find(c => c.nome.toLowerCase().includes("saas"))?.id;

    

    try {
      const y = dateObj.getFullYear();
      const m = dateObj.getMonth();
      const ultimoDia = new Date(y, m + 1, 0).getDate();
      
      const dataVenc = `${y}-${String(m + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
      const mesStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      
      // Strings para filtrar data exata no formato Timestamp do Supabase
      const mesStartStr = `${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`;
      const mesEndStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}T23:59:59.999Z`;

      const [resF, resS, resPurchases, resSaasCost] = await Promise.all([
  supabaseBrowser.from("vw_dashboard_finance_cards").select("*").eq("tenant_id", tid).maybeSingle(),
  supabaseBrowser.from("vw_saas_dashboard_finance_cards").select("*").eq("tenant_id", tid).maybeSingle(),
  supabaseBrowser.from("server_credit_purchases").select("total_amount_brl").eq("tenant_id", tid).gte("created_at", mesStartStr).lte("created_at", mesEndStr),
  supabaseBrowser.from("saas_credit_transactions").select("price_amount").eq("tenant_id", tid).in("type", ["purchase", "grant"]).gte("created_at", mesStartStr).lte("created_at", mesEndStr)
]);

let valorIptv = 0;
let valorSaas = 0;
let valorDespesas = 0;
let valorSaasCusto = 0;

      if (isMesAtual) {
  valorIptv = Number(resF.data?.clients_paid_month_brl_estimated || 0) + Number(resF.data?.reseller_paid_month_brl || 0);
  valorSaas = Number(resS.data?.renewal_month_brl || 0) + Number(resS.data?.credits_month_brl || 0);
} else if (isMesAnterior) {
  valorIptv = Number(resF.data?.clients_paid_prev_month_brl_estimated || 0) + Number(resF.data?.reseller_paid_prev_month_brl || 0);
  valorSaas = Number(resS.data?.renewal_prev_brl || 0) + Number(resS.data?.credits_prev_brl || 0);
}

valorDespesas = (resPurchases.data || []).reduce((acc, row) => acc + Number(row.total_amount_brl), 0);
valorSaasCusto = (resSaasCost.data || []).reduce((acc, row) => acc + Number(row.price_amount || 0), 0);

      // Data de pagamento = último dia do mês sincronizado (nunca "hoje")
      const dataPagamentoMes = new Date(`${dataVenc}T12:00:00`).toISOString();

      const upsertDinamico = async (descricao: string, valor: number, catId: string, tipoMovimento: "RECEITA" | "DESPESA") => {
        if (!catId || valor <= 0) return;

        const { data: existentes } = await supabaseBrowser.from("fin_transacoes")
          .select("id")
          .eq("tenant_id", tid)
          .eq("descricao", descricao)
          .gte("data_vencimento", mesStart)
          .lte("data_vencimento", dataVenc);

        if (existentes && existentes.length > 0) {
          await supabaseBrowser.from("fin_transacoes")
            .update({ valor, data_vencimento: dataVenc, status: "PAGO", data_pagamento: dataPagamentoMes, conta_id: null })
            .eq("id", existentes[0].id);
          
          if (existentes.length > 1) {
            const idsParaDeletar = existentes.slice(1).map(e => e.id);
            await supabaseBrowser.from("fin_transacoes").delete().in("id", idsParaDeletar);
          }
        } else {
          await supabaseBrowser.from("fin_transacoes").insert({
            tenant_id: tid, tipo: tipoMovimento, descricao, valor, data_vencimento: dataVenc, status: "PAGO", data_pagamento: dataPagamentoMes,
            conta_id: null, categoria_id: catId, is_recorrente: true, frequencia: "MENSAL", observacoes: "Sincronização Automática"
          });
        }
      };

      await Promise.all([
        upsertDinamico("IPTV - Rendimentos", valorIptv, catIPTV, "RECEITA"),
        upsertDinamico("SaaS - Venda de Créditos", valorSaas, catSaaS || catSaaS, "RECEITA"),
        upsertDinamico("IPTV - Recarga de Servidores", valorDespesas, catIPTV, "DESPESA"),
        upsertDinamico("SaaS - Custo de Créditos", valorSaasCusto, catSaaS || catSaaS, "DESPESA"),
      ]);
    } catch (e) {
      console.error("Erro na sincronização:", e);
    }
  };

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

      // Sincroniza Entradas do Dashboard automaticamente
      await sincronizarRendimentos(tid, dateObj, resContas.data || [], resCat.data || []);

      const saldos: Record<string, number> = {};
      for (const c of resContas.data || []) {
         const { data: saldo } = await supabaseBrowser.rpc("get_saldo_conta", { p_conta_id: c.id });
         saldos[c.id] = Number(saldo || 0);
      }
      setSaldosContas(saldos);

      // Cria as strings de timestamp para a data de pagamento
      const startOfMonthTimestamp = `${startOfMonth}T00:00:00.000Z`;
      const endOfMonthTimestamp = `${endOfMonth}T23:59:59.999Z`;

      const { data, error } = await supabaseBrowser
        .from("fin_transacoes")
        .select(`*, fin_contas_bancarias(nome, icone), fin_categorias(nome, icone)`)
        .eq("tenant_id", tid)
        .or(`and(data_vencimento.gte.${startOfMonth},data_vencimento.lte.${endOfMonth}),and(data_pagamento.gte.${startOfMonthTimestamp},data_pagamento.lte.${endOfMonthTimestamp})`)
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
        observacoes: t.observacoes,
        data_pagamento: t.data_pagamento
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
      setLoading(true);
      const tid = await getCurrentTenantId();
      setTenantId(tid);
      
      if (tid) {
        // ✅ VERIFICA A PERMISSÃO ANTES DE CARREGAR OS DADOS
        const { data } = await supabaseBrowser
          .from("tenants")
          .select("financial_control_enabled")
          .eq("id", tid)
          .single();

        if (data?.financial_control_enabled === false) {
          setIsAuthorized(false);
          setLoading(false);
          return; // Para a execução aqui
        }
        
        setIsAuthorized(true);
        await carregarDados(tid, currentDate);
      } else {
        setLoading(false);
      }
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
    if (t.is_recorrente && t.frequencia) return t.frequencia.charAt(0) + t.frequencia.slice(1).toLowerCase();
    return "Lançamento Único";
  };

  const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const filteredTransacoes = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return transacoes.filter((t) => {
      const cStatus = getComputedStatus(t.status, t.data_vencimento);
      const recText = formatRecorrencia(t);

      if (statusFilter === "QUICK_PENDENTE" && cStatus === "PAGO") return false;
      if (statusFilter === "QUICK_CONCLUIDO" && cStatus !== "PAGO") return false;
      if (statusFilter !== "Todos" && statusFilter !== "QUICK_PENDENTE" && statusFilter !== "QUICK_CONCLUIDO" && cStatus !== statusFilter) return false;
      
      if (tipoFilter !== "Todos" && t.tipo !== tipoFilter) return false;
      if (contaFilter !== "Todos" && t.conta_id !== contaFilter) return false;
      if (categoriaFilter !== "Todos" && t.categoria_id !== categoriaFilter) return false;
      if (recorrenciaFilter !== "Todos") {
        const isAjuste = t.observacoes === "Ajuste automático de saldo";
        if (recorrenciaFilter === "AJUSTE" && !isAjuste) return false;
        if (recorrenciaFilter !== "AJUSTE") {
            if (isAjuste) return false; // esconde ajustes nos outros filtros
            if (recorrenciaFilter === "UNICA" && t.is_recorrente) return false;
            if (recorrenciaFilter === "RECORRENTE" && (!t.is_recorrente || t.parcela_total)) return false;
            if (recorrenciaFilter === "PARCELADA" && !t.parcela_total) return false;
        }
        }

      if (q) {
        const hay = [t.descricao, t.categoria_nome, t.conta_nome, recText].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transacoes, search, statusFilter, tipoFilter, contaFilter, categoriaFilter, recorrenciaFilter]);

  // Base isolada para os cards: ignora todos os filtros, exceto a Conta
  const transacoesCards = contaFilter !== "Todos" 
    ? transacoes.filter(t => t.conta_id === contaFilter) 
    : transacoes;

  // 👇 NOVO: Controle de Ordenação
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: "asc" | "desc" } | null>(null);

  const requestSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedTransacoes = useMemo(() => {
    let sortableItems = [...filteredTransacoes];
    
    sortableItems.sort((a: any, b: any) => {
      // 1. Ordem Principal (se o usuário clicou em alguma coluna)
      if (sortConfig !== null) {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (sortConfig.key === "status_computed") {
          aValue = getComputedStatus(a.status, a.data_vencimento);
          bValue = getComputedStatus(b.status, b.data_vencimento);
        } else if (sortConfig.key === "recorrencia_formatada") {
          aValue = formatRecorrencia(a);
          bValue = formatRecorrencia(b);
        } else if (sortConfig.key === "descricao") {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      }

      // 2. Cascata 1 (Ou Ordem Inicial): Data de Vencimento
      if (a.data_vencimento < b.data_vencimento) return -1;
      if (a.data_vencimento > b.data_vencimento) return 1;

      // 3. Cascata 2: Tipo (Receita sempre em cima de Despesa no mesmo dia)
      if (a.tipo === "RECEITA" && b.tipo === "DESPESA") return -1;
      if (a.tipo === "DESPESA" && b.tipo === "RECEITA") return 1;

      // 4. Cascata 3: Descrição (Ordem Alfabética A-Z)
      const descA = (a.descricao || "").toLowerCase();
      const descB = (b.descricao || "").toLowerCase();
      if (descA < descB) return -1;
      if (descA > descB) return 1;

      return 0; // Se for literalmente o mesmo item
    });

    return sortableItems;
  }, [filteredTransacoes, sortConfig]);
  // 👆 FIM DA ORDENAÇÃO

  // 1. Criamos as referências do mês atual da tela baseadas no currentDate
  const refYear = currentDate.getFullYear();
  const refMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
  const viewStartOfMonth = `${refYear}-${refMonth}-01`;
  const viewEndOfMonth = new Date(refYear, currentDate.getMonth() + 1, 0).toISOString().split("T")[0];

  // 2. Função auxiliar para checar se a data pertence ao mês da tela
  const isDateInViewMonth = (dateString: string | null | undefined) => {
    if (!dateString) return false;
    const isoDate = dateString.split('T')[0]; // Pega apenas YYYY-MM-DD
    return isoDate >= viewStartOfMonth && isoDate <= viewEndOfMonth;
  };

  // 3. CAIXA (Efetivado): Soma apenas o que foi PAGO no mês visualizado
  const receitasPagas = transacoesCards
    .filter(t => t.tipo === "RECEITA" && t.status === "PAGO" && isDateInViewMonth(t.data_pagamento))
    .reduce((acc, t) => acc + t.valor, 0);

  const despesasPagas = transacoesCards
    .filter(t => t.tipo === "DESPESA" && t.status === "PAGO" && isDateInViewMonth(t.data_pagamento))
    .reduce((acc, t) => acc + t.valor, 0);

  // 4. COMPETÊNCIA (Previsão): Soma tudo que tem VENCIMENTO no mês visualizado
  const receitasTotal = transacoesCards
    .filter(t => t.tipo === "RECEITA" && isDateInViewMonth(t.data_vencimento))
    .reduce((acc, t) => acc + t.valor, 0);

  const despesasTotal = transacoesCards
    .filter(t => t.tipo === "DESPESA" && isDateInViewMonth(t.data_vencimento))
    .reduce((acc, t) => acc + t.valor, 0);

  const receitasPendentes = transacoesCards
    .filter(t => t.tipo === "RECEITA" && isDateInViewMonth(t.data_vencimento) && t.status !== "PAGO")
    .reduce((acc, t) => acc + t.valor, 0);

  const despesasPendentes = transacoesCards
    .filter(t => t.tipo === "DESPESA" && isDateInViewMonth(t.data_vencimento) && t.status !== "PAGO")
    .reduce((acc, t) => acc + t.valor, 0);
  
  let saldoAtualReal = 0;
  if (contaFilter !== "Todos") saldoAtualReal = saldosContas[contaFilter] || 0;
  else saldoAtualReal = Object.values(saldosContas).reduce((a, b) => a + b, 0);
  
  const saldoPrevisao = saldoAtualReal + (receitasTotal - receitasPagas) - (despesasTotal - despesasPagas);

  // ✅ TELA DE BLOQUEIO SE NÃO AUTORIZADO
  if (isAuthorized === false) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-500">
        <div className="w-20 h-20 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight mb-2">
          Acesso Restrito
        </h1>
        <p className="text-slate-500 dark:text-white/60 max-w-md mx-auto">
          O módulo de <strong>Controle Financeiro</strong> não está habilitado para a sua conta no momento.
        </p>
        <p className="text-slate-500 dark:text-white/60 max-w-md mx-auto mt-2">
          Entre em contato com o administrador (Master) para solicitar a liberação do seu acesso.
        </p>
      </div>
    );
  }

  // ✅ LOADING INICIAL PARA NÃO PISCAR A TELA
  if (loading && isAuthorized === null) {
    return <div className="p-12 text-center text-slate-400 animate-pulse">Carregando Finanças...</div>;
  }

  return (
    <div className="space-y-3 sm:space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors" id="dashboard-values">
      
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

      {/* 1. TÍTULO MOBILE: Rola junto com a tela e desaparece */}
      <div className="min-w-0 text-left pt-1 pb-0 px-3 md:hidden -mt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight whitespace-nowrap">
              Controle Financeiro
            </h1>
            <EyeToggle />
          </div>
          <button 
            onClick={() => setShowMobileCards(!showMobileCards)}
            className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md dark:bg-white/10 dark:text-white/70"
          >
            {showMobileCards ? "Ocultar Valores" : "Exibir Valores"}
          </button>
        </div>
      </div>

      {/* 2. HEADER STICKY: Botões no Mobile / Título + Botões no Desktop */}
      {/* top-14 crava nos exatos 56px da TopBar, fechando qualquer buraco visual */}
      <div className="sticky top-14 md:top-0 z-[40] bg-slate-50 dark:bg-[#0f141a] px-3 pb-3 pt-0 md:pt-0 sm:mx-0 sm:px-0 border-b border-slate-200/50 dark:border-white/5 sm:border-none flex items-center justify-end md:justify-between shadow-sm sm:shadow-none transition-colors">
        
        {/* Título Desktop (Só aparece em telas grandes) */}
        <div className="min-w-0 text-left hidden md:block">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
              Finanças Pessoais
            </h1>
            <EyeToggle />
          </div>
          
        </div>

        {/* Botões do Calendário */}
        <div className="flex items-center w-full md:w-auto gap-2">
          <div className="flex items-center flex-1 md:flex-none justify-between bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg shadow-sm">
            <button onClick={handlePrevMonth} className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"><IconChevronLeft /></button>
            <button
              onClick={() => setShowDatePicker(true)}
              className="px-2 sm:px-4 text-sm font-bold capitalize w-full md:w-40 text-center text-slate-700 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors truncate"
            >
              {monthName}
            </button>
            <button onClick={handleNextMonth} className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"><IconChevronRight /></button>
          </div>
          <button onClick={handleToday} className="h-10 px-4 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors shrink-0">Hoje</button>
        </div>

        {showDatePicker && (
          <ModalDatePicker
            currentDate={currentDate}
            onSelect={(date) => { setCurrentDate(date); setShowDatePicker(false); }}
            onClose={() => setShowDatePicker(false)}
          />
        )}
      </div>

      <div className={`${showMobileCards ? "grid" : "hidden"} md:grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3 px-3 sm:px-0`}>
        <MetricCard title="Receitas do Mês" value={fmtBRL(receitasPagas)} tone="emerald" icon="📈" footer={
          <span className="flex items-center justify-between w-full gap-2">
            <span>Previsão total: {fmtBRL(receitasTotal)}</span>
            {receitasPendentes > 0 && (
              <span className="font-bold text-amber-600 dark:text-amber-400">Pendente: {fmtBRL(receitasPendentes)}</span>
            )}
          </span>
        } />
        <MetricCard title="Despesas do Mês" value={fmtBRL(despesasPagas)} tone="rose" icon="📉" footer={
          <span className="flex items-center justify-between w-full gap-2">
            <span>Previsão total: {fmtBRL(despesasTotal)}</span>
            {despesasPendentes > 0 && (
              <span className="font-bold text-rose-600 dark:text-rose-400">Pendente: {fmtBRL(despesasPendentes)}</span>
            )}
          </span>
        } />
        <MetricCard title="Saldo Atual" value={fmtBRL(saldoAtualReal)} tone={saldoAtualReal >= 0 ? "emerald" : "rose"} icon="💰" footer={`Atualizar saldo...`} onEdit={() => setShowAjusteSaldo(true)} />
      </div>

      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 z-20">
        <div className="flex items-center justify-between">
          <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider">Lançamentos</div>
          <button onClick={() => setModalData({ open: true, transacao: null })} className="hidden md:flex h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 items-center gap-2 transition-all">
            <IconPlus /> Adicionar Lançamento
          </button>
        </div>

        <div className="md:hidden flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar..." className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"><IconX /></button>}
            </div>
            
            <button onClick={() => setModalData({ open: true, transacao: null })} className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg bg-emerald-600 text-white shadow-lg"><IconPlus /></button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            <button 
              onClick={() => setStatusFilter(statusFilter === "QUICK_PENDENTE" ? "Todos" : "QUICK_PENDENTE")} 
              className={`h-9 px-3 rounded-lg border text-xs font-bold transition-colors whitespace-nowrap flex-1 sm:flex-none ${statusFilter === "QUICK_PENDENTE" ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "border-slate-200 bg-white text-slate-600 dark:bg-[#161b22] dark:border-white/10 dark:text-white/70"}`}
            >
              ⏳ Pendente
            </button>
            <button 
              onClick={() => setStatusFilter(statusFilter === "QUICK_CONCLUIDO" ? "Todos" : "QUICK_CONCLUIDO")} 
              className={`h-9 px-3 rounded-lg border text-xs font-bold transition-colors whitespace-nowrap flex-1 sm:flex-none ${statusFilter === "QUICK_CONCLUIDO" ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "border-slate-200 bg-white text-slate-600 dark:bg-[#161b22] dark:border-white/10 dark:text-white/70"}`}
            >
              ✅ Concluído
            </button>
            <button 
              onClick={() => setMobileFiltersOpen((v) => !v)} 
              className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${mobileFiltersOpen ? "border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400" : "border-slate-200 bg-white text-slate-500 dark:bg-[#161b22] dark:border-white/10 dark:text-white/50"}`}
            >
              <IconChevronDown />
            </button>
            <button onClick={() => { setSearch(""); setStatusFilter("Todos"); setTipoFilter("Todos"); setContaFilter("Todos"); setCategoriaFilter("Todos"); setRecorrenciaFilter("Todos"); setMobileFiltersOpen(false); }}
              className="h-9 px-2 shrink-0 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 text-[11px] font-bold flex items-center justify-center gap-1 transition-colors hover:bg-rose-100 uppercase tracking-wide">
              <IconTrash /> <span className="hidden sm:inline">Limpar</span>
            </button>
          </div>
        </div>

        {mobileFiltersOpen && (
          <div className="md:hidden grid grid-cols-3 gap-1.5 pb-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <select value={contaFilter} onChange={(e) => setContaFilter(e.target.value)} className="w-full h-9 px-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-medium outline-none text-slate-700 dark:text-white truncate">
              <option value="Todos">Conta</option>
              {contasDB.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <select value={categoriaFilter} onChange={(e) => setCategoriaFilter(e.target.value)} className="w-full h-9 px-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-medium outline-none text-slate-700 dark:text-white truncate">
              <option value="Todos">Categoria</option>
              {categoriasDB.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <select value={recorrenciaFilter} onChange={(e) => setRecorrenciaFilter(e.target.value)} className="w-full h-9 px-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-medium outline-none text-slate-700 dark:text-white truncate">
              <option value="Todos">Recorrência</option>
              <option value="UNICA">Única</option>
              <option value="RECORRENTE">Recorrente</option>
              <option value="PARCELADA">Parcelada</option>
              <option value="AJUSTE">Ajuste Auto</option>
            </select>
          </div>
        )}

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
            <option value="PAGO">Pagos / Recebidos</option>
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
            <option value="AJUSTE">Ajuste Automático</option>
          </select>
          <button onClick={() => { setSearch(""); setStatusFilter("Todos"); setTipoFilter("Todos"); setContaFilter("Todos"); setCategoriaFilter("Todos"); setRecorrenciaFilter("Todos"); }} className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors flex items-center gap-2">
            <IconX /> Limpar
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1000px]">
          <thead>
            <tr className="border-b border-slate-200 dark:border-white/10 text-xs font-bold uppercase text-slate-500 dark:text-white/40 select-none">
              <th className="px-4 py-3 whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("descricao")}>Descrição {sortConfig?.key === "descricao" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 w-28 text-center whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("tipo")}>Tipo {sortConfig?.key === "tipo" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 text-center whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("data_vencimento")}>Vencimento {sortConfig?.key === "data_vencimento" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 text-center whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("status_computed")}>Status {sortConfig?.key === "status_computed" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 text-center whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("categoria_nome")}>Categoria {sortConfig?.key === "categoria_nome" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 text-center whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("conta_nome")}>Conta {sortConfig?.key === "conta_nome" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 text-center whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("recorrencia_formatada")}>Recorrência {sortConfig?.key === "recorrencia_formatada" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 text-right whitespace-nowrap cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => requestSort("valor")}>Valor {sortConfig?.key === "valor" ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Ações</th>
            </tr>
          </thead>
          <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
            {sortedTransacoes.length === 0 && !loading && (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400 italic">Nenhum lançamento encontrado.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={9} className="p-8 text-center text-emerald-500 animate-pulse font-bold">Carregando dados...</td></tr>
            )}
            {sortedTransacoes.map((t, index) => {
              const cStatus = getComputedStatus(t.status, t.data_vencimento);
              const recText = formatRecorrencia(t);
              
              // Verifica se deve mostrar o divisor de data
              const isSortedByDate = !sortConfig || sortConfig.key === "data_vencimento";
              const showDateDivider = isSortedByDate && (index === 0 || sortedTransacoes[index - 1].data_vencimento !== t.data_vencimento);
              
              let dateLabel = "";
              if (showDateDivider) {
                const [y, m, d] = t.data_vencimento.split('-');
                const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
                const diaSemana = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
                dateLabel = `${d}/${m}/${y} - ${diaSemana}`;
              }

              // Verifica se a linha deve ficar esmaecida
              const isPago = cStatus === "PAGO";
              const rowOpacity = isPago ? "opacity-60 hover:opacity-100" : "";

              // Retornamos um array com o divisor (se existir) e a linha da transação
              return [
                showDateDivider && (
                  <tr key={`div-${t.id}`} className="bg-slate-100/80 dark:bg-white/5 border-y border-slate-200 dark:border-white/10">
                    <td colSpan={9} className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">
                      🗓️ {dateLabel}
                    </td>
                  </tr>
                ),
                <tr key={t.id} className={`hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer ${rowOpacity}`} onClick={() => setModalData({ open: true, transacao: t })}>
                  
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-700 dark:text-white truncate max-w-[220px] group-hover:text-emerald-600 transition-colors">{t.descricao}</div>
                  </td>

                  <td className="px-4 py-3 text-center">
                    {t.tipo === "RECEITA" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase text-emerald-600 bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-400/30">
                        <IconTrendingUp /> Receita
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase text-rose-600 bg-rose-50 border border-rose-200 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-400/30">
                        <IconTrendingDown /> Despesa
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span className="font-mono text-slate-600 dark:text-white/80">{t.data_vencimento.split('-').reverse().join('/')}</span>
                  </td>

                  <td className="px-4 py-3 text-center">
                    {(() => {
                      let cor = "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/30";
                      let label = cStatus;

                      // Lógica inteligente para o rótulo de pagamento/recebimento
                      if (cStatus === "PAGO") {
                        cor = "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-400/30";
                        label = t.tipo === "RECEITA" ? "RECEBIDO" : "PAGO";
                      } else if (cStatus === "VENCIDO") {
                        cor = "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-400/30";
                      }

                      return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${cor}`}>{label}</span>;
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

                  <td className="px-4 py-3 text-center">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider">{recText}</span>
                  </td>

                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className={`font-bold transition-all duration-300 finance-value ${t.tipo === "RECEITA" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {t.tipo === "RECEITA" ? "+" : "-"} {fmtBRL(t.valor)}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100">
                      {(() => {
                        let btnTone: "green" | "amber" | "red" | "blue" = "blue";
                        let isUp = false;

                        if (cStatus === "PAGO") {
                          btnTone = "green";
                          isUp = true; // Verde
                        } else {
                          btnTone = "blue"; // Azul (Sky) amigável para tudo que ainda precisa ser pago
                          isUp = false; 
                        }

                        return (
                          <ActionBtn 
                            tone={btnTone} 
                            title={t.status === "PAGO" 
                                    ? (t.tipo === "RECEITA" ? "Desfazer Recebimento" : "Desfazer Pagamento") 
                                    : (t.tipo === "RECEITA" ? "Confirmar Recebimento" : "Confirmar Pagamento")} 
                            onClick={() => {
                              // Se está pagando agora, injeta a data. Se está desfazendo, limpa a data.
                              const isPagaNow = t.status !== "PAGO";
                              setModalData({ 
                                open: true, 
                                transacao: { 
                                  ...t, 
                                  status: isPagaNow ? "PAGO" : "PENDENTE",
                                  data_pagamento: isPagaNow ? new Date().toISOString() : null
                                } 
                              });
                            }}>
                            {/* O -scale-y-100 faz o espelhamento perfeito virando de cabeça para baixo sem inverter os lados */}
                            <IconThumb className={!isUp ? "-scale-y-100" : "scale-y-100"} />
                          </ActionBtn>
                        );
                      })()}
                      
                      <ActionBtn tone="amber" title="Editar" onClick={() => setModalData({ open: true, transacao: t })}>
                        <IconEdit />
                      </ActionBtn>
                      
                      <ActionBtn tone="red" title="Excluir" onClick={() => handleDeleteClick(t)}>
                        <IconTrash />
                      </ActionBtn>
                    </div>
                  </td>
                </tr>
              ];
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
        <ModalTransacao tenantId={tenantId} onClose={() => setModalData({ open: false, transacao: null })} transacaoEdit={modalData.transacao} contasDB={contasDB} categoriasDB={categoriasDB} addToast={addToast} pageDate={currentDate} onSuccess={() => { setModalData({ open: false, transacao: null }); carregarDados(tenantId, currentDate); }} />
      )}

      {showAjusteSaldo && tenantId && (
        <ModalAjusteSaldo tenantId={tenantId} contas={contasDB} saldos={saldosContas} onClose={() => setShowAjusteSaldo(false)} onSuccess={() => { setShowAjusteSaldo(false); carregarDados(tenantId, currentDate); }} addToast={addToast} />
      )}
    </div>
  );
}


function MetricCard({ title, value, tone, icon, footer, onEdit }: { title: string, value: string, tone: "emerald"|"rose", icon: string, footer: React.ReactNode, onEdit?: ()=>void }) {
  const colors = {
    emerald: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
    rose: "border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-800 text-rose-900 dark:text-rose-100",
  };
  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden flex flex-col ${colors[tone]} relative ${onEdit ? "cursor-pointer hover:scale-[1.02] hover:shadow-md transition-all" : ""}`}
      onClick={onEdit}
    >
      <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-black/5 dark:border-white/5 font-bold text-[13px] sm:text-sm flex justify-between items-center">
        <span className="flex items-center gap-2">{icon} {title}</span>
        {onEdit && (
          <button onClick={(e)=>{e.stopPropagation(); onEdit();}} className="p-1 rounded-md bg-white/50 hover:bg-white/80 dark:bg-black/10 dark:hover:bg-black/30 transition-colors" title="Ajustar Saldo">
            <IconEdit />
          </button>
        )}
      </div>
      <div className="p-3 sm:p-4 flex-1">
        {/* 👇 CLASSE finance-value MÁGICA DO OLHINHO */}
        <div className={`text-[15px] sm:text-2xl font-bold leading-tight tabular-nums transition-all duration-300 finance-value`}>
          {value}
        </div>
      </div>
      <div className="px-3 sm:px-4 py-2 text-[11px] sm:text-xs bg-black/5 dark:bg-white/5 opacity-80 font-medium">
        {/* 👇 CLASSE finance-value NO FOOTER DA PREVISÃO */}
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
            {contas.map(c => <option key={c.id} value={c.id}>{c.icone} {c.nome} (Atual: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(saldos[c.id] || 0)})</option>)}
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


const ICONES_DISPONIVEIS = [
  "🏦","💳","💵","🪙","💰","🏧","💸","📊","🔐","🤝",
  "🟣","🟠","🟢","🔴","⭐","🌟","📱","💻","🛒","🏥",
  "🚗","📚","🏖️","🏠","💡","🍔","🐶","👗","📦","📈",
  "🎮","✈️","🎵","🍕","☕","🏋️","💊","📺","🎁","⚡",
  "🌮","🎓","👶","🐱","🚌","⛽","🔧","🌿","🎭","🏃",
  "🍺","🛍️","🎯","🏡","💈","📷","🎸","🧴","🐾","🌈",
];

function ModalGerenciarItens({ title, items, onExcluir, onEditar, onClose, addToast, groupByTipo }: {
  title: string,
  items: any[],
  onExcluir: (id: string) => Promise<void>,
  onEditar: (id: string, nome: string, icone: string) => Promise<void>,
  onClose: () => void,
  addToast: any,
  groupByTipo?: boolean
}) {
  const { confirm, ConfirmUI } = useConfirm();
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editIcone, setEditIcone] = useState("");
  const [salvando, setSalvando] = useState(false);

  const receitas = items.filter(i => i.tipo === "RECEITA" || i.tipo === "AMBOS");
  const despesas = items.filter(i => i.tipo === "DESPESA" || i.tipo === "AMBOS");

  function abrirEdicao(it: any) {
    setEditandoId(it.id);
    setEditNome(it.nome);
    setEditIcone(it.icone);
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setEditNome("");
    setEditIcone("");
  }

  async function handleSalvarEdicao(id: string) {
    if (!editNome.trim()) return;
    setSalvando(true);
    try {
      await onEditar(id, editNome.trim(), editIcone);
      addToast("success", "Salvo", "Item atualizado com sucesso.");
      cancelarEdicao();
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  function renderItem(it: any) {
    return (
      <div key={it.id} className="rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5">
          <span className="text-sm font-medium">{it.icone} {it.nome}</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => editandoId === it.id ? cancelarEdicao() : abrirEdicao(it)}
              className={`p-1.5 rounded-lg transition-colors ${editandoId === it.id ? "text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10"}`}
              title="Editar"
            >
              <IconEdit />
            </button>
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Excluir Item",
                  subtitle: `Tem certeza que deseja excluir '${it.nome}'?`,
                  tone: "rose",
                  icon: "🗑️",
                  confirmText: "Sim, excluir",
                });
                if (ok) {
                  try { await onExcluir(it.id); } catch (e: any) { addToast("error", "Erro ao excluir", "Pode estar em uso."); }
                }
              }}
              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
              title="Excluir"
            >
              <IconTrash />
            </button>
          </div>
        </div>

        {editandoId === it.id && (
          <div className="p-3 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Nome</label>
              <input autoFocus value={editNome} onChange={e => setEditNome(e.target.value)} className="w-full h-9 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500 text-slate-800 dark:text-white" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Ícone</label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
                {ICONES_DISPONIVEIS.map(ic => (
                  <button key={ic} onClick={() => setEditIcone(ic)} className={`w-8 h-8 rounded border text-base flex items-center justify-center transition-all ${editIcone === ic ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 scale-110" : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={cancelarEdicao} className="flex-1 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={() => handleSalvarEdicao(it.id)} disabled={salvando} className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50">
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100000] bg-black/60 grid place-items-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">

        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 font-bold text-sm bg-slate-50 dark:bg-white/5 flex justify-between shrink-0">
          <span>{title}</span>
          <button onClick={onClose}><IconX /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {items.length === 0 && (
            <div className="text-center text-slate-400 text-sm italic">Nenhum item cadastrado.</div>
          )}

          {groupByTipo ? (
            <>
              {receitas.length > 0 && (
                <>
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">📈 Receitas</span>
                    <div className="flex-1 h-px bg-emerald-200 dark:bg-emerald-500/30" />
                  </div>
                  {receitas.map(it => renderItem(it))}
                </>
              )}
              {despesas.length > 0 && (
                <>
                  <div className="flex items-center gap-2 py-1 mt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">📉 Despesas</span>
                    <div className="flex-1 h-px bg-rose-200 dark:bg-rose-500/30" />
                  </div>
                  {despesas.map(it => renderItem(it))}
                </>
              )}
            </>
          ) : (
            items.map(it => renderItem(it))
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/10 shrink-0">
          <button onClick={onClose} className="w-full py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
            Cancelar
          </button>
        </div>
      </div>
      {ConfirmUI}
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

function ModalTransacao({ tenantId, onClose, transacaoEdit, addToast, onSuccess, contasDB, categoriasDB, pageDate }: { tenantId: string, onClose: () => void; transacaoEdit?: any | null; addToast: any, onSuccess: ()=>void, contasDB: any[], categoriasDB: any[], pageDate?: Date }) {
  const isEdit = !!transacaoEdit;
  
  const [tipo, setTipo] = useState<"RECEITA" | "DESPESA">(transacaoEdit?.tipo || "DESPESA");
  const [descricao, setDescricao] = useState(transacaoEdit?.descricao || "");
  const [valor, setValor] = useState(transacaoEdit?.valor !== undefined ? String(transacaoEdit.valor) : "0");
  const centsToDisplay = (cents: number) => {
    const str = String(cents).padStart(3, '0');
    const int = str.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const dec = str.slice(-2);
    return (int || '0') + ',' + dec;
  };

  const initialCents = transacaoEdit?.valor ? Math.round(transacaoEdit.valor * 100) : 0;
  const [rawCents, setRawCents] = useState(initialCents);
  const valorDisplay = centsToDisplay(rawCents);

  const handleValorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 13);
    const cents = parseInt(digits || '0', 10);
    setRawCents(cents);
    setValor(String(cents / 100));
  };
  const toDisplay = (iso: string) => iso ? iso.split('-').reverse().join('/') : '';

  const getDefaultDate = () => {
    if (transacaoEdit?.data_vencimento) return transacaoEdit.data_vencimento;
    const ref = pageDate ?? new Date();
    const hoje = new Date();
    // Usa o dia de hoje, mas mês/ano da página
    const d = String(hoje.getDate()).padStart(2, '0');
    const m = String(ref.getMonth() + 1).padStart(2, '0');
    const y = ref.getFullYear();
    return `${y}-${m}-${d}`;
  };

  const isoToRaw = (iso: string) => iso ? iso.split('-').reverse().join('') : '';
  const rawToDisplay = (raw: string) => {
    if (raw.length >= 5) return raw.slice(0, 2) + '/' + raw.slice(2, 4) + '/' + raw.slice(4);
    if (raw.length >= 3) return raw.slice(0, 2) + '/' + raw.slice(2);
    return raw;
  };

  const [rawDigits, setRawDigits] = useState(isoToRaw(getDefaultDate()));
  const [vencimento, setVencimento] = useState(getDefaultDate());
  const vencimentoDisplay = rawToDisplay(rawDigits); // ← derivado, não é state

  const handleVencimentoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    
    const raw = input.value.replace(/\D/g, '').slice(0, 8);
    setRawDigits(raw);
    if (raw.length === 8) {
      const d = raw.slice(0, 2), m = raw.slice(2, 4), y = raw.slice(4);
      setVencimento(`${y}-${m}-${d}`);
    }
    
    // Restaura o cursor para a posição exata onde estava a digitação
    requestAnimationFrame(() => {
      if (cursorPos !== null && input) {
        input.setSelectionRange(cursorPos, cursorPos);
      }
    });
  };
  const [status, setStatus] = useState<"PENDENTE" | "PAGO">(transacaoEdit?.status || "PENDENTE");
  const [obs, setObs] = useState(transacaoEdit?.observacoes || "");

  let rTipoInicial: "UNICA"|"RECORRENTE"|"PARCELADA" = "UNICA";
  if (transacaoEdit?.is_recorrente && transacaoEdit?.parcela_total) rTipoInicial = "PARCELADA";
  else if (transacaoEdit?.is_recorrente) rTipoInicial = "RECORRENTE";

  const [tipoRecorrencia, setTipoRecorrencia] = useState(rTipoInicial);
  const [frequencia, setFrequencia] = useState(transacaoEdit?.frequencia || "MENSAL");
  const [parcelas, setParcelas] = useState(transacaoEdit?.parcela_total ? String(transacaoEdit.parcela_total) : "2");
  const [escopoEdicao, setEscopoEdicao] = useState<"UNICA" | "TODAS">("TODAS"); // ✅ Agora o padrão é alterar TODAS as futuras

  const [contas, setContas] = useState<any[]>(contasDB);
  const [categorias, setCategorias] = useState<any[]>(categoriasDB);
  
  const categoriasAtivas = categorias.filter(c => c.tipo === tipo || c.tipo === "AMBOS");
  const [contaSelecionada, setContaSelecionada] = useState(transacaoEdit?.conta_id || (contas.length > 0 ? contas[0].id : ""));
  const [categoriaSelecionada, setCategoriaSelecionada] = useState(transacaoEdit?.categoria_id || "");

  const [salvando, setSalvando] = useState(false);

  const [showVencimentoPicker, setShowVencimentoPicker] = useState(false);
  const [showNovaConta, setShowNovaConta] = useState(false);
  const [showGerenciarContas, setShowGerenciarContas] = useState(false);
  
  const [showNovaCategoria, setShowNovaCategoria] = useState(false);
  const [showGerenciarCategorias, setShowGerenciarCategorias] = useState(false);

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

  async function handleEditarConta(id: string, nome: string, icone: string) {
    const { error } = await supabaseBrowser.from("fin_contas_bancarias").update({ nome, icone }).eq("id", id);
    if(error) throw error;
    setContas(prev => prev.map(c => c.id === id ? { ...c, nome, icone } : c));
  }

  async function handleExcluirCategoria(id: string) {
    const { error } = await supabaseBrowser.from("fin_categorias").delete().eq("id", id);
    if(error) throw error;
    setCategorias(prev => prev.filter(c => c.id !== id));
    if (categoriaSelecionada === id) setCategoriaSelecionada("");
  }

  async function handleEditarCategoria(id: string, nome: string, icone: string) {
    const { error } = await supabaseBrowser.from("fin_categorias").update({ nome, icone }).eq("id", id);
    if(error) throw error;
    setCategorias(prev => prev.map(c => c.id === id ? { ...c, nome, icone } : c));
  }

  async function handleSave() {
    if (!descricao.trim() || valor === "" || !contaSelecionada || !categoriaSelecionada) {
      addToast("error", "Erro", "Preencha todos os campos obrigatórios (Conta e Categoria inclusos)");
      return;
    }
    setSalvando(true);
    try {
      if (isEdit) {
        if (escopoEdicao === "UNICA" || !transacaoEdit.recorrencia_id) {
          const { error } = await supabaseBrowser.from("fin_transacoes").update({
            tipo, descricao, valor: Number(valor), data_vencimento: vencimento, status, conta_id: contaSelecionada, categoria_id: categoriaSelecionada, observacoes: obs,
            data_pagamento: status === "PAGO" ? (transacaoEdit.data_pagamento || new Date().toISOString()) : null
          }).eq("id", transacaoEdit.id);
          if (error) throw error;
        } else {
          // 1. Atualiza a transação atual
          const { error: errCurrent } = await supabaseBrowser.from("fin_transacoes").update({
            tipo, descricao, valor: Number(valor), data_vencimento: vencimento, status, conta_id: contaSelecionada, categoria_id: categoriaSelecionada, observacoes: obs,
            frequencia: tipoRecorrencia === "RECORRENTE" ? frequencia : null,
            data_pagamento: status === "PAGO" ? (transacaoEdit.data_pagamento || new Date().toISOString()) : null
          }).eq("id", transacaoEdit.id);
          if (errCurrent) throw errCurrent;

          // 2. Busca histórico oficial E faturas "órfãs" para limpeza total (À Prova de Balas)
          const [{ data: oficiais }, { data: orfas }] = await Promise.all([
            supabaseBrowser.from("fin_transacoes").select("id, data_vencimento, status, data_pagamento")
              .eq("recorrencia_id", transacaoEdit.recorrencia_id)
              .gt("data_vencimento", transacaoEdit.data_vencimento),
            supabaseBrowser.from("fin_transacoes").select("id, data_vencimento, status, data_pagamento")
              .eq("descricao", transacaoEdit.descricao) // Busca pelo nome antigo para caçar órfãs duplicadas
              .eq("conta_id", transacaoEdit.conta_id)
              .gt("data_vencimento", transacaoEdit.data_vencimento)
          ]);

          const mapPagos: Record<string, any> = {};
          const idsToDelete = new Set<string>();

          const mergeData = (lista: any[]) => {
            if (!lista) return;
            lista.forEach(f => {
              idsToDelete.add(f.id); // Coloca na lista de extermínio
              if (f.status === "PAGO") {
                const ym = f.data_vencimento.substring(0, 7);
                if (!mapPagos[ym]) mapPagos[ym] = { status: f.status, data_pagamento: f.data_pagamento };
              }
            });
          };

          mergeData(oficiais || []);
          mergeData(orfas || []);

          // 3. Apaga TODAS as parcelas futuras encontradas (limpa a sujeira do banco)
          const arrIds = Array.from(idsToDelete);
          if (arrIds.length > 0) {
            const { error: errDel } = await supabaseBrowser.from("fin_transacoes")
              .delete()
              .in("id", arrIds);
            if (errDel) throw errDel;
          }

          // 4. Recria as futuras garantindo 5 anos de fôlego a partir de HOJE
          const baseDate = new Date(`${vencimento}T12:00:00`);
          const baseDia = baseDate.getDate();

          function addMesesSemOverflow(base: Date, dia: number, meses: number): Date {
            const targetYear = base.getFullYear() + Math.floor((base.getMonth() + meses) / 12);
            const targetMonth = (base.getMonth() + meses) % 12;
            const ultimoDia = new Date(targetYear, targetMonth + 1, 0).getDate();
            return new Date(targetYear, targetMonth, Math.min(dia, ultimoDia), 12, 0, 0);
          }

          let parcelasRestantes = 0;
          let pAtual = transacaoEdit.parcela_atual || 1;
          let pTotal = transacaoEdit.parcela_total || 1;

          if (tipoRecorrencia === "PARCELADA") {
             parcelasRestantes = pTotal - pAtual;
          } else if (tipoRecorrencia === "RECORRENTE") {
             const hoje = new Date();
             const diffAnos = hoje.getFullYear() - baseDate.getFullYear();
             const diffMeses = (diffAnos * 12) + (hoje.getMonth() - baseDate.getMonth());
             parcelasRestantes = Math.max(60, diffMeses + 60); 
          }

          if (parcelasRestantes > 0) {
            const inserts = [];
            for (let i = 1; i <= parcelasRestantes; i++) {
              let dataVenc: Date;
              const f = tipoRecorrencia === "RECORRENTE" ? frequencia : "MENSAL";

              if (tipoRecorrencia === "PARCELADA" || f === "MENSAL") {
                dataVenc = addMesesSemOverflow(baseDate, baseDia, i);
              } else if (f === "BIMESTRAL") {
                dataVenc = addMesesSemOverflow(baseDate, baseDia, i * 2);
              } else if (f === "TRIMESTRAL") {
                dataVenc = addMesesSemOverflow(baseDate, baseDia, i * 3);
              } else if (f === "SEMESTRAL") {
                dataVenc = addMesesSemOverflow(baseDate, baseDia, i * 6);
              } else if (f === "ANUAL") {
                const y = baseDate.getFullYear() + i;
                const m = baseDate.getMonth();
                const ultimoDia = new Date(y, m + 1, 0).getDate();
                dataVenc = new Date(y, m, Math.min(baseDia, ultimoDia), 12, 0, 0);
              } else {
                dataVenc = addMesesSemOverflow(baseDate, baseDia, i);
              }

              const ym = dataVenc.toISOString().substring(0, 7);
              const jaPago = mapPagos[ym];

              inserts.push({
                tenant_id: tenantId,
                tipo,
                descricao, // Usamos a descrição que você editou agora (já atualizada)
                valor: Number(valor),
                data_vencimento: dataVenc.toISOString().split("T")[0],
                status: jaPago ? jaPago.status : "PENDENTE",
                data_pagamento: jaPago ? jaPago.data_pagamento : null,
                conta_id: contaSelecionada,
                categoria_id: categoriaSelecionada,
                observacoes: obs,
                is_recorrente: true,
                frequencia: tipoRecorrencia === "RECORRENTE" ? frequencia : null,
                recorrencia_id: transacaoEdit.recorrencia_id,
                parcela_atual: tipoRecorrencia === "PARCELADA" ? (pAtual + i) : null,
                parcela_total: tipoRecorrencia === "PARCELADA" ? pTotal : null
              });
            }

            if (inserts.length > 0) {
               const { error: batchErr } = await supabaseBrowser.from("fin_transacoes").insert(inserts);
               if (batchErr) throw batchErr;
            }
          }
        }
        addToast("success", "Alteração Salva", "Lançamento atualizado com sucesso!");
      } 
      else {
        const isRecorrente = tipoRecorrencia !== "UNICA";
        const totalMesesOuParcelas = tipoRecorrencia === "PARCELADA" ? Number(parcelas) : (tipoRecorrencia === "RECORRENTE" ? 60 : 1);
        const valorInserir = tipoRecorrencia === "PARCELADA" ? Number(valor) / totalMesesOuParcelas : Number(valor);
        
        const baseDate = new Date(`${vencimento}T12:00:00`);
        const baseDia = baseDate.getDate();

        function addMesesSemOverflow(base: Date, dia: number, meses: number): Date {
          const targetYear = base.getFullYear() + Math.floor((base.getMonth() + meses) / 12);
          const targetMonth = (base.getMonth() + meses) % 12;
          const ultimoDia = new Date(targetYear, targetMonth + 1, 0).getDate();
          return new Date(targetYear, targetMonth, Math.min(dia, ultimoDia), 12, 0, 0);
        }

        const { data: firstTrx, error: firstErr } = await supabaseBrowser.from("fin_transacoes").insert({
          tenant_id: tenantId,
          tipo,
          descricao,
          valor: valorInserir,
          data_vencimento: baseDate.toISOString().split("T")[0],
          status,
          data_pagamento: status === "PAGO" ? new Date().toISOString() : null,
          conta_id: contaSelecionada,
          categoria_id: categoriaSelecionada,
          observacoes: obs,
          is_recorrente: isRecorrente,
          frequencia: tipoRecorrencia === "RECORRENTE" ? frequencia : null,
          parcela_atual: tipoRecorrencia === "PARCELADA" ? 1 : null,
          parcela_total: tipoRecorrencia === "PARCELADA" ? totalMesesOuParcelas : null
        }).select("id").single();

        if (firstErr) throw firstErr;

        if (totalMesesOuParcelas > 1) {
          const recorrenciaIdReal = firstTrx.id;
          
          await supabaseBrowser.from("fin_transacoes").update({ recorrencia_id: recorrenciaIdReal }).eq("id", recorrenciaIdReal);

          const inserts = [];
          
          for (let i = 2; i <= totalMesesOuParcelas; i++) {
            let dataVenc: Date;
            
            if (tipoRecorrencia === "PARCELADA" || frequencia === "MENSAL") {
              dataVenc = addMesesSemOverflow(baseDate, baseDia, i - 1);
            } else if (frequencia === "BIMESTRAL") {
              dataVenc = addMesesSemOverflow(baseDate, baseDia, (i - 1) * 2);
            } else if (frequencia === "TRIMESTRAL") {
              dataVenc = addMesesSemOverflow(baseDate, baseDia, (i - 1) * 3);
            } else if (frequencia === "SEMESTRAL") {
              dataVenc = addMesesSemOverflow(baseDate, baseDia, (i - 1) * 6);
            } else if (frequencia === "ANUAL") {
              const y = baseDate.getFullYear() + (i - 1);
              const m = baseDate.getMonth();
              const ultimoDia = new Date(y, m + 1, 0).getDate();
              dataVenc = new Date(y, m, Math.min(baseDia, ultimoDia), 12, 0, 0);
            } else {
              dataVenc = new Date(baseDate);
            }

            inserts.push({
              tenant_id: tenantId,
              tipo,
              descricao,
              valor: valorInserir,
              data_vencimento: dataVenc.toISOString().split("T")[0],
              status: "PENDENTE",
              data_pagamento: null,
              conta_id: contaSelecionada,
              categoria_id: categoriaSelecionada,
              observacoes: obs,
              is_recorrente: isRecorrente,
              frequencia: tipoRecorrencia === "RECORRENTE" ? frequencia : null,
              recorrencia_id: recorrenciaIdReal,
              parcela_atual: tipoRecorrencia === "PARCELADA" ? i : null,
              parcela_total: tipoRecorrencia === "PARCELADA" ? totalMesesOuParcelas : null
            });
          }

          if (inserts.length > 0) {
            const { error: batchErr } = await supabaseBrowser.from("fin_transacoes").insert(inserts);
            if (batchErr) throw batchErr;
          }
        }
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
        <div className="max-h-[75vh] overflow-y-auto pr-1 space-y-3 sm:space-y-4">
          
          <div className="flex p-1 bg-slate-100 dark:bg-black/20 rounded-lg border border-slate-200 dark:border-white/5">
            <button onClick={() => setTipo("DESPESA")} disabled={isEdit} className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${tipo === "DESPESA" ? "bg-white dark:bg-[#161b22] text-rose-600 dark:text-rose-400 shadow-sm" : "text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80"} ${isEdit ? "opacity-50 cursor-not-allowed" : ""}`}>📉 Despesa</button>
            <button onClick={() => setTipo("RECEITA")} disabled={isEdit} className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${tipo === "RECEITA" ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80"} ${isEdit ? "opacity-50 cursor-not-allowed" : ""}`}>📈 Receita</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">Descrição</label>
              <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Conta de Luz" className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">Valor {tipoRecorrencia === "PARCELADA" && !isEdit ? "Total" : ""} (R$)</label>
              <input type="text" inputMode="numeric" value={valorDisplay} onChange={handleValorChange} onFocus={(e) => e.target.select()} placeholder="0,00" className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-bold outline-none focus:border-emerald-500/50 ${tipo === "RECEITA" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">Data de Vencimento</label>
              <div className="relative">
                <input type="text" inputMode="numeric" value={vencimentoDisplay} onChange={handleVencimentoChange} onFocus={(e) => e.target.select()} placeholder="DD/MM/AAAA" maxLength={10} className="w-full h-10 px-3 pr-10 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-mono" />
                <button
                  type="button"
                  onClick={() => setShowVencimentoPicker(true)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-md transition-colors"
                  title="Abrir calendário"
                >
                  <IconCalendar />
                </button>
              </div>
              {showVencimentoPicker && (
                <ModalDayPicker
                  currentDate={vencimento ? new Date(`${vencimento}T12:00:00`) : new Date()}
                  onSelect={(date) => {
                    const d = String(date.getDate()).padStart(2, '0');
                    const m = String(date.getMonth() + 1).padStart(2, '0');
                    const y = date.getFullYear();
                    setVencimento(`${y}-${m}-${d}`);
                    setRawDigits(`${d}${m}${y}`);
                    setShowVencimentoPicker(false);
                  }}
                  onClose={() => setShowVencimentoPicker(false)}
                />
              )}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">Status</label>
              <div className="flex bg-slate-50 dark:bg-black/20 rounded-lg border border-slate-200 dark:border-white/10 p-1 h-10">
                <button onClick={() => setStatus("PENDENTE")} className={`flex-1 rounded-md text-xs font-bold transition-colors ${status === "PENDENTE" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "text-slate-400 hover:text-slate-600 dark:hover:text-white/80"}`}>⏳ Pendente</button>
                <button onClick={() => setStatus("PAGO")} className={`flex-1 rounded-md text-xs font-bold transition-colors ${status === "PAGO" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "text-slate-400 hover:text-slate-600 dark:hover:text-white/80"}`}>✅ Pago</button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">Conta / Carteira</label>
              <select value={contaSelecionada} onChange={handleContaChange} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-medium">
                <option value="" disabled>Selecionar Conta</option>
                {contas.map(c => <option key={c.id} value={c.id}>{c.icone} {c.nome}</option>)}
                <option disabled>──────────</option>
                <option value="NOVA" className="font-bold text-emerald-600">+ Nova Conta</option>
                <option value="GERENCIAR" className="font-bold text-slate-600 dark:text-white/60">⚙️ Gerenciar Contas</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">Categoria</label>
              <select value={categoriaSelecionada} onChange={handleCategoriaChange} className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 font-medium">
                <option value="" disabled>Selecionar Categoria</option>
                {categoriasAtivas.map(c => <option key={c.id} value={c.id}>{c.icone} {c.nome}</option>)}
                <option disabled>──────────</option>
                <option value="NOVA" className="font-bold text-emerald-600">+ Nova Categoria</option>
                <option value="GERENCIAR" className="font-bold text-slate-600 dark:text-white/60">⚙️ Gerenciar Categorias</option>
              </select>
            </div>
          </div>

          {!isEdit && (
            <div className="p-3 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 space-y-3">
              <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">Recorrência e Parcelamento</label>
              
              <div className="flex bg-white dark:bg-black/20 rounded-md border border-slate-200 dark:border-white/10 p-1">
                <button onClick={() => setTipoRecorrencia("UNICA")} className={`flex-1 py-1 rounded text-xs font-bold transition-all ${tipoRecorrencia === "UNICA" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80"}`}>Única</button>
                <button onClick={() => setTipoRecorrencia("RECORRENTE")} className={`flex-1 py-1 rounded text-xs font-bold transition-all ${tipoRecorrencia === "RECORRENTE" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80"}`}>Recorrente</button>
                <button onClick={() => setTipoRecorrencia("PARCELADA")} className={`flex-1 py-1 rounded text-xs font-bold transition-all ${tipoRecorrencia === "PARCELADA" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-sm" : "text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80"}`}>Parcelado</button>
              </div>

              {tipoRecorrencia === "PARCELADA" && (
                <div className="flex items-center gap-3 animate-in fade-in zoom-in-95">
                  <span className="text-xs font-medium text-slate-600 dark:text-white/70">Qtd de Parcelas:</span>
                  <input type="number" min="2" max="120" value={parcelas} onChange={e => setParcelas(e.target.value)} className="w-16 h-8 px-2 text-center bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md text-sm font-bold outline-none focus:border-emerald-500/50 text-slate-800 dark:text-white" />
                </div>
              )}

              {tipoRecorrencia === "RECORRENTE" && (
                <div className="flex items-center gap-3 animate-in fade-in zoom-in-95">
                  <span className="text-xs font-medium text-slate-600 dark:text-white/70">Repetir a cada:</span>
                  <select value={frequencia} onChange={e => setFrequencia(e.target.value)} className="flex-1 h-8 px-2 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md text-sm font-bold outline-none focus:border-emerald-500/50 text-slate-800 dark:text-white">
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
            <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 space-y-2">
              <label className="block text-[10px] font-bold text-amber-700 dark:text-amber-500 uppercase tracking-wider">⚠️ Alteração em Conta Programada</label>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 sm:items-center">
                <label className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input type="radio" checked={escopoEdicao === "UNICA"} onChange={() => setEscopoEdicao("UNICA")} className="w-3.5 h-3.5 text-emerald-600 focus:ring-emerald-500" />
                  Apenas neste mês
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200 cursor-pointer">
                  <input type="radio" checked={escopoEdicao === "TODAS"} onChange={() => setEscopoEdicao("TODAS")} className="w-3.5 h-3.5 text-emerald-600 focus:ring-emerald-500" />
                  Nesta e nas futuras
                </label>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Detalhes adicionais..." className="w-full p-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none" />
          </div>

          {isEdit && transacaoEdit?.data_pagamento && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
              <span className="text-emerald-500 text-base">✅</span>
              <div>
                <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Data de Pagamento</div>
                <div className="text-sm font-bold text-emerald-800 dark:text-emerald-300 font-mono">
                  {(() => {
                    const dt = new Date(transacaoEdit.data_pagamento);
                    const d = String(dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', day: '2-digit' })).padStart(2,'0');
                    const m = String(dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', month: '2-digit' })).padStart(2,'0');
                    const y = dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric' });
                    const h = dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
                    return `${d}/${m}/${y} às ${h}`;
                  })()}
                </div>
              </div>
            </div>
          )}
          
        </div>

        <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-bold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={salvando} className={`px-5 py-2 rounded-lg text-white text-sm font-bold shadow-lg transition-all disabled:opacity-50 ${tipo === "RECEITA" ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20" : "bg-rose-600 hover:bg-rose-500 shadow-rose-900/20"}`}>
            {salvando ? "Processando..." : (isEdit ? "Salvar Alterações" : "Criar Lançamento")}
          </button>
        </div>
      </Modal>

      {showNovaConta && <ModalNovaConta tenantId={tenantId} addToast={addToast} onClose={() => { setShowNovaConta(false); setContaSelecionada(""); }} onSave={(nova) => { setContas([...contas, nova]); setContaSelecionada(nova.id); setShowNovaConta(false); }} />}
      {showNovaCategoria && <ModalNovaCategoria tenantId={tenantId} addToast={addToast} tipoFixo={tipo} onClose={() => { setShowNovaCategoria(false); setCategoriaSelecionada(""); }} onSave={(nova) => { setCategorias([...categorias, nova]); setCategoriaSelecionada(nova.id); setShowNovaCategoria(false); }} />}
      
      {showGerenciarContas && <ModalGerenciarItens title="Gerenciar Contas" items={contas} onClose={() => setShowGerenciarContas(false)} addToast={addToast} onExcluir={async (id) => { await handleExcluirConta(id); }} onEditar={async (id, nome, icone) => { await handleEditarConta(id, nome, icone); }} />}
      {showGerenciarCategorias && <ModalGerenciarItens title="Gerenciar Categorias" items={categorias} onClose={() => setShowGerenciarCategorias(false)} addToast={addToast} onExcluir={async (id) => { await handleExcluirCategoria(id); }} onEditar={async (id, nome, icone) => { await handleEditarCategoria(id, nome, icone); }} groupByTipo />}
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