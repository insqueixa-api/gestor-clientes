"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

// --- Tipagens ---
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

type PlanRow = {
  id: string;
  tenant_id: string;
  name: string;
  currency: "BRL" | "USD" | "EUR";
  is_active: boolean;
  is_system_default: boolean;
  created_at: string;
  items: Item[];
};

type Props = {
  plan?: PlanRow | null;
  onClose: () => void;
  onSuccess: () => void;
};

type EditableItem = {
  itemId: string;
  period: string;
  credits: number;
  price1: string;
  price2: string;
  price3: string;
};

const PERIOD_ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

export default function PlanoModal({ plan, onClose, onSuccess }: Props) {
  const isEditing = !!plan;
  const isSystemDefault = plan?.is_system_default ?? false;
  
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"BRL" | "USD" | "EUR">("BRL");
  const [items, setItems] = useState<EditableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Carregar dados iniciais
  useEffect(() => {
    async function loadData() {
      if (isEditing && plan) {
        // MODO EDIÇÃO: Carrega dados do plano existente
        setName(plan.name);
        setCurrency(plan.currency);
        
        const supabase = supabaseBrowser;
        const { data: dbItems } = await supabase
          .from("plan_table_items")
          .select("id, period, credits_base")
          .eq("plan_table_id", plan.id);

        if (dbItems) {
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
              price1: p1?.price_amount?.toString() ?? "",
              price2: p2?.price_amount?.toString() ?? "",
              price3: p3?.price_amount?.toString() ?? "",
            };
          });
          // Ordena conforme PERIOD_ORDER
          const ordered = PERIOD_ORDER.map(period => matrix.find(m => m.period === period)).filter(Boolean) as EditableItem[];
          setItems(ordered);
        }
      }
      setLoading(false);
    }
    
    loadData();
  }, [plan, isEditing]);

  // Quando mudar a moeda no modo criação, busca a tabela padrão e clona
  useEffect(() => {
    async function cloneFromDefault() {
      if (isEditing) return; // Só no modo criação
      
      setLoading(true);
      const tenantId = await getCurrentTenantId();
      const supabase = supabaseBrowser;

      try {
        // Busca tabela padrão da moeda selecionada
        const { data: defaultTable } = await supabase
          .from("plan_tables")
          .select(`
            id,
            items:plan_table_items (
              id,
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

        if (defaultTable && defaultTable.items && defaultTable.items.length > 0) {
          // Clona os dados da tabela padrão
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const clonedItems = (defaultTable.items as any[]).map((srcItem: any) => {
            const p1 = srcItem.prices?.find((p: any) => p.screens_count === 1);
            const p2 = srcItem.prices?.find((p: any) => p.screens_count === 2);
            const p3 = srcItem.prices?.find((p: any) => p.screens_count === 3);
            
            return {
              itemId: `temp-${srcItem.period}`, // ID temporário
              period: srcItem.period,
              credits: srcItem.credits_base || 0,
              price1: p1?.price_amount?.toString() ?? "",
              price2: p2?.price_amount?.toString() ?? "",
              price3: p3?.price_amount?.toString() ?? "",
            };
          });
          
          // Ordena conforme PERIOD_ORDER
          const ordered = PERIOD_ORDER.map(period => clonedItems.find(m => m.period === period)).filter(Boolean) as EditableItem[];
          setItems(ordered);
        } else {
          // Se não encontrar tabela padrão, cria estrutura vazia
          const emptyItems: EditableItem[] = PERIOD_ORDER.map((period, idx) => {
            const creditsMap: Record<string, number> = {
              MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12
            };
            return {
              itemId: `temp-${period}`,
              period,
              credits: creditsMap[period] || idx + 1,
              price1: "",
              price2: "",
              price3: "",
            };
          });
          setItems(emptyItems);
        }
      } catch (err) {
        console.error("Erro ao clonar tabela padrão:", err);
      } finally {
        setLoading(false);
      }
    }

    cloneFromDefault();
  }, [currency, isEditing]);

  const handlePriceChange = (period: string, field: 'price1'|'price2'|'price3', val: string) => {
    setItems(prev => prev.map(item => 
      item.period === period ? { ...item, [field]: val } : item
    ));
  };

  async function handleSave() {
    if (!name.trim()) {
      alert("Informe o nome da tabela");
      return;
    }

    setSaving(true);
    const supabase = supabaseBrowser;
    const tenantId = await getCurrentTenantId();

    try {
      if (isEditing && plan) {
        // --- MODO EDIÇÃO ---
        
        // 1. Atualiza nome e moeda (se não for sistema default)
        if (!isSystemDefault) {
          await supabase
            .from("plan_tables")
            .update({ name, currency })
            .eq("id", plan.id);
        }

        // 2. Atualiza preços
        for (const row of items) {
          for (let screen = 1; screen <= 3; screen++) {
            const val = row[`price${screen}` as keyof EditableItem] as string;
            if (val === "") continue;
            
            await supabase
              .from("plan_table_item_prices")
              .update({ price_amount: Number(val) })
              .match({ plan_table_item_id: row.itemId, screens_count: screen });
          }
        }

      } else {
        // --- MODO CRIAÇÃO ---
        
        // 1. Cria tabela pai
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

        // 2. Cria itens e preços (mesma lógica do seu NovoPlanoModal original)
        const monthsMap: Record<string, number> = {
          MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12
        };

        for (const item of items) {
          const { data: newItem, error: itemError } = await supabase
            .from("plan_table_items")
            .insert({
              tenant_id: tenantId,
              plan_table_id: newTableId,
              period: item.period,
              months: monthsMap[item.period],
              credits_base: item.credits
            })
            .select()
            .single();

          if (itemError || !newItem) continue;

          // Insere os 3 preços
          const pricesToInsert = [
            { 
              tenant_id: tenantId, 
              plan_table_item_id: newItem.id, 
              screens_count: 1, 
              price_amount: item.price1 ? Number(item.price1) : null 
            },
            { 
              tenant_id: tenantId, 
              plan_table_item_id: newItem.id, 
              screens_count: 2, 
              price_amount: item.price2 ? Number(item.price2) : null 
            },
            { 
              tenant_id: tenantId, 
              plan_table_item_id: newItem.id, 
              screens_count: 3, 
              price_amount: item.price3 ? Number(item.price3) : null 
            },
          ];

          await supabase.from("plan_table_item_prices").insert(pricesToInsert);
        }
      }

      onSuccess();
    } catch (err) {
      console.error("Erro ao salvar:", err);
      alert("Erro ao salvar tabela.");
    } finally {
      setSaving(false);
    }
  }

  const formatCurrency = (c: string) => c === 'BRL' ? 'R$' : c === 'USD' ? '$' : '€';

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-[1200px] max-h-[90vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        
        {/* HEADER */}
        <div className="px-6 py-4 flex justify-between items-center bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              {isEditing 
                ? (isSystemDefault ? "Visualizar Plano" : "Editar Tabela") 
                : "Nova Tabela"}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest bg-slate-200/50 dark:bg-white/5 px-2 py-0.5 rounded">
                {currency}
              </span>
              {isSystemDefault && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shadow-sm">
                  Padrão do Sistema
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button 
              onClick={onClose} 
              className="px-4 py-2 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-sm font-semibold transition-colors"
            >
              Cancelar
            </button>
            {!isSystemDefault && (
              <button 
                onClick={handleSave}
                disabled={saving || loading}
                className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all"
              >
                {saving ? "Salvando..." : (isEditing ? "Salvar alterações" : "Criar tabela")}
              </button>
            )}
          </div>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto bg-white dark:bg-[#161b22]">
          
          {/* Seção de Dados Básicos */}
          <div className="p-6 border-b border-slate-200 dark:border-white/10 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nome da tabela</Label>
                <input 
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ex: Tabela especial revenda"
                  disabled={isSystemDefault}
                  className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50"
                />
              </div>
              <div>
                <Label>Moeda {isEditing && "(não editável)"}</Label>
                <div className="flex bg-slate-100 dark:bg-white/5 rounded-lg p-1 border border-slate-200 dark:border-white/10">
                  {(['BRL', 'USD', 'EUR'] as const).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => !isEditing && setCurrency(c)}
                      disabled={isEditing} // Só pode escolher moeda na criação
                      className={`flex-1 py-2 rounded-md text-xs font-bold transition-all uppercase tracking-wider
                        ${currency === c 
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-sm' 
                          : 'text-slate-500 dark:text-white/40 hover:text-slate-800 dark:hover:text-white'}
                        ${isEditing ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {!isEditing && (
                  <p className="text-[10px] text-slate-400 dark:text-white/30 mt-2 italic">
                    * Os valores serão clonados da tabela padrão {currency} se existir
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Matriz de Preços */}
          <div className="p-6 space-y-8">
            {loading ? (
              <div className="text-center py-20 text-slate-400 animate-pulse font-medium">
                {isEditing ? "Carregando dados..." : "Clonando tabela padrão..."}
              </div>
            ) : (
              [1, 2, 3].map((screenCount) => (
                <div key={screenCount} className="animate-in slide-in-from-left-2 duration-300">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
                    Preços para {screenCount} {screenCount === 1 ? 'tela' : 'telas'}
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    // Substitua esta parte do map:
{PERIOD_ORDER.map((period) => {
  const item = items.find(i => i.period === period);
  if (!item) return null;

  const currentCredits = item.credits * screenCount;
  
  // CORREÇÃO: tipagem explícita do field
  const field = `price${screenCount}` as 'price1' | 'price2' | 'price3';
  const value = item[field];

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
          {formatCurrency(currency)}
        </span>
        <input 
          type="number" 
          step="0.01"
          value={value}
          disabled={isSystemDefault}
          onChange={(e) => handlePriceChange(period, field, e.target.value)}
          className="w-full bg-transparent border-none p-0 pl-7 text-base font-bold text-slate-800 dark:text-white focus:ring-0 outline-none placeholder-slate-300 dark:placeholder-white/5 transition-colors disabled:opacity-50"
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
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10 flex justify-between items-center transition-colors">
          <span className="text-[10px] text-slate-400 italic">
            * {isEditing 
              ? "Altere o nome e os valores conforme necessário" 
              : "Ajuste os valores clonados da tabela padrão"}
          </span>
          {!isEditing && (
            <span className="text-[10px] text-slate-400 dark:text-white/30">
              A tabela será criada como <strong>ativa</strong> por padrão
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}