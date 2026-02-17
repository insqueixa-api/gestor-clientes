"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";

// --- Tipagens Locais ---
type PlanRow = {
  id: string;
  name: string;
  currency: "BRL" | "USD" | "EUR";
  is_active: boolean;
  is_system_default: boolean;
};

type Props = {
  plan: PlanRow;
  onClose: () => void;
  onSuccess: () => void;
};

type EditableItem = {
  itemId: string;
  period: string;
  credits: number;
  price1: number | string;
  price2: number | string;
  price3: number | string;
};

const PERIOD_ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

export default function EditPlanTableModal({ plan, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Carregar dados (Lógica Integral)
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const supabase = supabaseBrowser; 

      const { data: dbItems } = await supabase
        .from("plan_table_items")
        .select("id, period, credits_base")
        .eq("plan_table_id", plan.id);

      if (!dbItems) { setLoading(false); return; }

      const itemIds = dbItems.map(i => i.id);
      const { data: dbPrices } = await supabase
        .from("plan_table_item_prices")
        .select("plan_table_item_id, screens_count, price_amount")
        .in("plan_table_item_id", itemIds);

      const priceMap = dbPrices || [];

      const matrix = dbItems.map(item => {
        const p1 = priceMap.find(p => p.plan_table_item_id === item.id && p.screens_count === 1);
        const p2 = priceMap.find(p => p.plan_table_item_id === item.id && p.screens_count === 2);
        const p3 = priceMap.find(p => p.plan_table_item_id === item.id && p.screens_count === 3);

        return {
          itemId: item.id,
          period: item.period,
          credits: item.credits_base || 0,
          price1: p1?.price_amount ?? "",
          price2: p2?.price_amount ?? "",
          price3: p3?.price_amount ?? "",
        };
      });

      setItems(matrix);
      setLoading(false);
    }
    loadData();
  }, [plan.id]);

  // Salvar (Lógica Integral)
  async function handleSave() {
    setSaving(true);
    const supabase = supabaseBrowser;

    try {
      for (const row of items) {
        const updatePrice = async (screens: number, val: number | string) => {
             if (val === "" || val === null) return;
             await supabase.from("plan_table_item_prices")
             .update({ price_amount: Number(val) })
             .match({ plan_table_item_id: row.itemId, screens_count: screens });
        };

        await updatePrice(1, row.price1);
        await updatePrice(2, row.price2);
        await updatePrice(3, row.price3);
      }
      onSuccess();
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar preços.");
    } finally {
      setSaving(false);
    }
  }

  const handlePriceChange = (period: string, field: 'price1'|'price2'|'price3', val: string) => {
    setItems(prev => prev.map(item => {
        if (item.period === period) {
            return { ...item, [field]: val };
        }
        return item;
    }));
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-[1200px] max-h-[90vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        
        {/* HEADER (Padrão page.txt) */}
        <div className="px-6 py-4 flex justify-between items-center bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
               {plan.is_system_default ? plan.name.split(' ')[0] : plan.name}
            </h2>
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest bg-slate-200/50 dark:bg-white/5 px-2 py-0.5 rounded">
                    {plan.currency}
                </span>
                {plan.is_system_default ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shadow-sm">
                        Plano padrão
                    </span>
                ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
                        Editando tabela
                    </span>
                )}
            </div>
          </div>

          <div className="flex gap-3">
             <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-sm font-semibold transition-colors">
                Cancelar
             </button>
             <button 
                onClick={handleSave}
                disabled={saving || loading}
                className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all"
             >
                {saving ? "Processando..." : "Salvar alterações"}
             </button>
          </div>
        </div>

        {/* CORPO (Matriz de Inputs) */}
        <div className="p-6 space-y-8 overflow-y-auto bg-white dark:bg-[#161b22]">
          {loading ? (
            <div className="text-center py-20 text-slate-400 animate-pulse font-medium">Carregando dados da matriz...</div>
          ) : (
            [1, 2, 3].map((screenCount) => (
              <div key={screenCount} className="animate-in slide-in-from-left-2 duration-300">
                 <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
                    Preços para {screenCount} {screenCount === 1 ? 'tela' : 'telas'}
                 </h3>
                 
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    {PERIOD_ORDER.map((period) => {
                       const item = items.find(i => i.period === period);
                       if (!item) return null;

                       const currentCredits = item.credits * screenCount;
                       const fieldName = `price${screenCount}` as 'price1'|'price2'|'price3';
                       const value = item[fieldName];

                       return (
                          <div 
                              key={period} 
                              className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 flex flex-col justify-center h-20 relative focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all group"
                          >
                             <div className="flex justify-between items-center w-full mb-1">
                                <span className="text-[11px] font-bold text-slate-400 dark:text-white/20">
                                   {PERIOD_LABELS[period]}
                                </span>
                                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10">
                                   {currentCredits} cr
                                </span>
                             </div>
                             
                             <div className="relative">
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/20 text-xs font-bold">
                                  {plan.currency === 'BRL' ? 'R$' : plan.currency === 'USD' ? '$' : '€'}
                                </span>
                                <input 
                                   type="number" 
                                   step="0.01"
                                   value={value}
                                   onChange={(e) => handlePriceChange(period, fieldName, e.target.value)}
                                   className="w-full bg-transparent border-none p-0 pl-7 text-base font-bold text-slate-800 dark:text-white focus:ring-0 outline-none placeholder-slate-300 dark:placeholder-white/5 transition-colors"
                                   placeholder="0,00"
                                />
                             </div>
                          </div>
                       );
                    })}
                 </div>
              </div>
            ))
          )}
        </div>

        {/* FOOTER (Opcional, caso queira botões repetidos embaixo, mas o Header já os possui) */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10 flex justify-end transition-colors text-[10px] text-slate-400 italic">
          * As alterações são aplicadas instantaneamente ao salvar.
        </div>
      </div>
    </div>,
    document.body
  );
}