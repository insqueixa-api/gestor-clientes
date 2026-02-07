"use client";

import { useEffect, useState } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import NovoPlanoModal from "./novo_plano"; // Ajustado para PascalCase
import EditPlanoModal from "./editar_plano"; // Ajustado para PascalCase

// --- Tipagens (Integrais) ---
type Price = {
  screens_count: number;
  price_amount: number | null;
};

type Item = {
  id: string;
  period: string; 
  credits_base: number;
  prices: Price[];
};

export type PlanRow = {
  id: string;
  tenant_id: string;
  name: string;
  currency: "BRL" | "USD" | "EUR";
  is_active: boolean;
  is_system_default: boolean;
  created_at: string;
  items: Item[];
};

const PERIOD_ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

export default function PlanosPage() {
  const [loading, setLoading] = useState(true);
  const [plano, setPlano] = useState<PlanRow[]>([]);
  
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRow | null>(null);

  // --- Carregamento de Dados (Integral) ---
  async function fetchPlano() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();
      const supabase = supabaseBrowser; 

      const { data, error } = await supabase
        .from("plan_tables")
        .select(`
          *,
          items:plan_table_items (
            id,
            period,
            credits_base,
            prices:plan_table_item_prices (
              screens_count,
              price_amount
            )
          )
        `)
        .eq("tenant_id", tenantId)
        .order("is_system_default", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) throw error;
      setPlano((data as any) as PlanRow[] || []);
    } catch (error) {
      console.error("Erro ao carregar planos:", error);
    } finally {
      setLoading(false);
    }
  }

  // --- Função de Deletar (Integral) ---
  async function handleDelete(plan: PlanRow) {
    if (!confirm(`Tem certeza que deseja excluir a tabela "${plan.name}"?`)) return;
    
    try {
      const supabase = supabaseBrowser;
      const { error } = await supabase
        .from("plan_tables")
        .delete()
        .eq("id", plan.id);

      if (error) throw error;
      setPlano((prev) => prev.filter((p) => p.id !== plan.id));
    } catch (err) {
      console.error("Erro ao deletar:", err);
      alert("Não foi possível excluir esta tabela.");
    }
  }

  useEffect(() => {
    fetchPlano();
  }, []);

  const formatMoney = (amount: number | null, currency: string) => {
    if (amount === null || amount === undefined) return "--";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency,
    }).format(amount);
  };

  const getCellData = (plan: PlanRow, periodKey: string, screenCount: number) => {
    const item = plan.items.find((i) => i.period === periodKey);
    if (!item) return { price: null, credits: 0 };
    const priceObj = item.prices.find((p) => p.screens_count === screenCount);
    const totalCredits = (item.credits_base || 0) * screenCount;
    return {
      price: priceObj?.price_amount ?? null,
      credits: totalCredits
    };
  };

return (
  <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6 bg-slate-50 dark:bg-[#0f141a] transition-colors">

      
      {/* HEADER DA PÁGINA (PADRÃO PAGE.TXT) */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-3 pb-1 mb-6 animate-in fade-in duration-500">
  <div className="text-right w-full md:w-auto">
    <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
      Tabelas de Preço
    </h1>
    <p className="text-slate-500 dark:text-white/60 mt-0.5 text-sm font-medium">
      Gerencie as tabelas de preço padrão e personalizadas.
    </p>
  </div>

  <div className="w-full md:w-auto flex justify-end">
    <button
      onClick={() => setIsNewOpen(true)}
      className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
    >
      <span className="text-lg leading-none">+</span> Nova Tabela
    </button>
  </div>
</div>


      {loading && (
        <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5 font-medium">
          Carregando tabelas de preço...
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 gap-4 sm:gap-6">

          {plano.map((plan) => (
            <div 
              key={plan.id}
              className="bg-white dark:bg-[#161b22] rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-white/10 transition-colors"
            >
              {/* CABEÇALHO DO CARD (PADRÃO MEMORIZADO) */}
              <div className="px-5 py-3 flex justify-between items-center border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
                    {plan.is_system_default ? plan.name.split(' ')[0] : plan.name}
                  </h2>

                  <div className="flex items-center gap-2">
                      {/* Moeda */}
                      <span className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest bg-slate-200/50 dark:bg-white/5 px-2 py-0.5 rounded">
                        {plan.currency}
                      </span>

                      {/* Badges de Status (Tones Suaves) */}
                      {plan.is_system_default ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shadow-sm">
                          Padrão do Sistema
                        </span>
                      ) : (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shadow-sm
                          ${plan.is_active 
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' 
                            : 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white/20'}`}
                        >
                          {plan.is_active ? 'Ativa' : 'Inativa'}
                        </span>
                      )}
                  </div>
                </div>

                {/* AÇÕES (Edit: Amber / Delete: Rose) */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingPlan(plan)}
                    className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all shadow-sm"
                    title="Editar Preços"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                       <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>

                  {!plan.is_system_default && (
                    <button
                      onClick={() => handleDelete(plan)}
                      className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all shadow-sm"
                      title="Excluir Tabela"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                  
                  {plan.is_system_default && (
                     <div className="p-1.5 opacity-20 bg-slate-100 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-center cursor-not-allowed">
                        <svg className="w-4 h-4 text-slate-500 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                     </div>
                  )}
                </div>
              </div>

              {/* CORPO DA MATRIZ (REMOÇÃO DE UPPER) */}
              <div className="p-4 sm:p-5 space-y-6 bg-white dark:bg-[#161b22]">

                {[1, 2, 3].map((screenCount) => (
                  <div key={screenCount} className="animate-in slide-in-from-left-2 duration-300">
                    <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
                      Preços para {screenCount} {screenCount === 1 ? 'Tela' : 'Telas'}
                    </h3>
                    
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                      {PERIOD_ORDER.map((period) => {
                        const { price, credits } = getCellData(plan, period, screenCount);
                        
                        return (
                          <div 
                            key={period} 
                            className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5 flex flex-col justify-center h-16 relative hover:border-emerald-500/30 transition-all group"
                          >
                            <div className="flex justify-between items-center w-full mb-1">
                                <span className="text-[10px] font-bold text-slate-400 dark:text-white/20">
                                    {PERIOD_LABELS[period]}
                                </span>
                                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10">
                                    {credits} cr
                                </span>
                            </div>
                            
                            <div className="text-sm font-bold text-slate-800 dark:text-white tracking-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                {formatMoney(price, plan.currency)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modais */}
      {isNewOpen && (
        <NovoPlanoModal 
          onClose={() => setIsNewOpen(false)} 
          onSuccess={() => { setIsNewOpen(false); fetchPlano(); }} 
        />
      )}

      {editingPlan && (
        <EditPlanoModal 
          plan={editingPlan} 
          onClose={() => setEditingPlan(null)} 
          onSuccess={() => { setEditingPlan(null); fetchPlano(); }} 
        />
      )}
    </div>
  );
}