"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Props = {
  onClose: () => void;
  onSuccess: () => void;
};

// --- COMPONENTES VISUAIS PADRONIZADOS ---
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

export default function NovoPlanoModal({ onClose, onSuccess }: Props) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"BRL" | "USD" | "EUR">("BRL");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name) return;
    setSaving(true);
    
    try {
      const tenantId = await getCurrentTenantId();
      const supabase = supabaseBrowser;

      // --- PASSO 1: Buscar dados da Tabela Padrão para clonar ---
      const { data: defaultTable } = await supabase
        .from("plan_tables")
        .select(`
            id,
            items:plan_table_items (
                period,
                months,
                credits_base,
                prices:plan_table_item_prices (
                    screens_count,
                    price_amount
                )
            )
        `)
        .eq("tenant_id", tenantId)
        .eq("currency", currency)
        .eq("is_system_default", true)
        .single();

      // --- PASSO 2: Criar a Nova Tabela Pai ---
      const { data: tableData, error: tableError } = await supabase
        .from("plan_tables")
        .insert({
          tenant_id: tenantId,
          name: name,
          currency: currency,
          is_system_default: false,
          is_active: true
        })
        .select()
        .single();

      if (tableError) throw tableError;
      const newTableId = tableData.id;

      // --- PASSO 3: Popular Itens e Preços ---
      if (defaultTable && defaultTable.items && defaultTable.items.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const srcItem of defaultTable.items as any[]) {
             const { data: newItem, error: itemError } = await supabase
                .from("plan_table_items")
                .insert({
                    tenant_id: tenantId,
                    plan_table_id: newTableId,
                    period: srcItem.period,
                    months: srcItem.months,
                    credits_base: srcItem.credits_base
                })
                .select()
                .single();

             if (itemError) continue;

             if (srcItem.prices && srcItem.prices.length > 0) {
                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 const pricesToInsert = srcItem.prices.map((srcPrice: any) => ({
                     tenant_id: tenantId,
                     plan_table_item_id: newItem.id,
                     screens_count: srcPrice.screens_count,
                     price_amount: srcPrice.price_amount
                 }));
                 await supabase.from("plan_table_item_prices").insert(pricesToInsert);
             }
        }
      } else {
        const periods = [
            { p: 'MONTHLY', m: 1, c: 1 },
            { p: 'BIMONTHLY', m: 2, c: 2 },
            { p: 'QUARTERLY', m: 3, c: 3 },
            { p: 'SEMIANNUAL', m: 6, c: 6 },
            { p: 'ANNUAL', m: 12, c: 12 },
        ];

        for (const item of periods) {
            const { data: itemData, error: itemError } = await supabase
                .from("plan_table_items")
                .insert({
                    tenant_id: tenantId,
                    plan_table_id: newTableId,
                    period: item.p,
                    months: item.m,
                    credits_base: item.c
                })
                .select()
                .single();
            
            if (itemError) continue;

            await supabase.from("plan_table_item_prices").insert([
                { tenant_id: tenantId, plan_table_item_id: itemData.id, screens_count: 1, price_amount: null },
                { tenant_id: tenantId, plan_table_item_id: itemData.id, screens_count: 2, price_amount: null },
                { tenant_id: tenantId, plan_table_item_id: itemData.id, screens_count: 3, price_amount: null },
            ]);
        }
      }
      onSuccess();
    } catch (err) {
      console.error("Erro ao criar:", err);
      alert("Erro ao criar tabela.");
    } finally {
      setSaving(false);
    }
  }

  // --- RENDER (Visual Ajustado) ---
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">Nova tabela</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors">✕</button>
        </div>

        {/* FORM BODY */}
        <div className="p-6 space-y-6 bg-white dark:bg-[#161b22]">
          
          <div className="animate-in slide-in-from-bottom-2 duration-300">
            <Label>Nome da tabela</Label>
            <input 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Tabela especial revenda"
              autoFocus
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>

          <div className="animate-in slide-in-from-bottom-3 duration-400">
            <Label>Moeda</Label>
            <div className="flex bg-slate-100 dark:bg-white/5 rounded-lg p-1 border border-slate-200 dark:border-white/10">
              {(['BRL', 'USD', 'EUR'] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`flex-1 py-2 rounded-md text-xs font-bold transition-all uppercase tracking-wider
                    ${currency === c 
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-sm' 
                      : 'text-slate-500 dark:text-white/40 hover:text-slate-800 dark:hover:text-white'}`}
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-white/30 mt-3 italic px-1 leading-relaxed">
                * Os valores serão clonados automaticamente da tabela <strong>padrão {currency}</strong> se existir, ou criados vazios.
            </p>
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 transition-colors">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-sm font-semibold transition-colors">Cancelar</button>
          <button 
            onClick={handleCreate}
            disabled={saving || !name}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all"
          >
            {saving ? "Criando..." : "Criar tabela"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}