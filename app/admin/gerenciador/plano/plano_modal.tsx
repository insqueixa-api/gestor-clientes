"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

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
  is_master_only: boolean;
  table_type: "iptv" | "saas" | "saas_credits";
  created_at: string;
  items: Item[];
};

type Props = {
  plan?: PlanRow | null;
  newTableType?: "iptv" | "saas" | "saas_credits" | null;
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

const CREDIT_TIERS = ["C_10","C_20","C_30","C_50","C_100","C_150","C_200","C_300","C_400","C_500"] as const;
const CREDIT_TIER_LABELS: Record<string, string> = {
  C_10:"10 cr", C_20:"20 cr", C_30:"30 cr", C_50:"50 cr", C_100:"100 cr",
  C_150:"150 cr", C_200:"200 cr", C_300:"300 cr", C_400:"400 cr", C_500:"500 cr",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

export default function PlanoModal({ plan, newTableType, onClose, onSuccess }: Props) {
  const isEditing = !!plan;
  const effectiveType = plan?.table_type ?? newTableType ?? "iptv";
  const isSaasCredits = effectiveType === "saas_credits";
  const isSaas = effectiveType === "saas";
  const isMasterOnly = plan?.is_master_only ?? isSaas;
  
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"BRL" | "USD" | "EUR">("BRL");
  const [originalCurrency, setOriginalCurrency] = useState<"BRL" | "USD" | "EUR">("BRL");
  const [items, setItems] = useState<EditableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Carregar dados iniciais
useEffect(() => {
    async function loadData() {
      if (isEditing && plan) {
        setName(plan.name);
        setCurrency(plan.currency);
        setOriginalCurrency(plan.currency);
        await loadItemsFromPlan(plan.id, plan.currency);
      } else if (isSaasCredits) {
        // saas_credits não clona nada — inicializa estrutura fixa direto
        setItems(CREDIT_TIERS.map((tier) => ({
          itemId: `temp-${tier}`,
          period: tier,
          credits: 0,
          price1: "",
          price2: "",
          price3: "",
        })));
      }
      setLoading(false);
    }
    loadData();
  }, [plan, isEditing]);

  // Carrega itens de uma tabela (usado na carga inicial e quando muda moeda)
  async function loadItemsFromPlan(planId: string, curr: "BRL" | "USD" | "EUR") {
    const supabase = supabaseBrowser;
    
    const { data: dbItems } = await supabase
      .from("plan_table_items")
      .select("id, period, credits_base")
      .eq("plan_table_id", planId);

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
      
      const ordered = PERIOD_ORDER.map(period => matrix.find(m => m.period === period)).filter(Boolean) as EditableItem[];
      setItems(ordered);
    }
  }

  // Clona da tabela padrão (usado na criação e quando muda moeda na edição)
  async function cloneFromDefault(curr: "BRL" | "USD" | "EUR") {
    setLoading(true);
    const tenantId = await getCurrentTenantId();
    const supabase = supabaseBrowser;

    // saas_credits: estrutura fixa de tiers, sem clonar
    if (isSaasCredits) {
      setItems(CREDIT_TIERS.map((tier) => ({
        itemId: `temp-${tier}`,
        period: tier,
        credits: 0,
        price1: "",
        price2: "",
        price3: "",
      })));
      setLoading(false);
      return;
    }

    try {
      const query = supabase
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
        .eq("is_system_default", true);

      // saas clona da tabela is_master_only=true; iptv clona pela moeda
      const { data: defaultTable } = isSaas
        ? await query.eq("is_master_only", true).single()
        : await query.eq("currency", curr).eq("is_master_only", false).single();

      if (defaultTable && defaultTable.items && defaultTable.items.length > 0) {
        const clonedItems = (defaultTable.items as any[]).map((srcItem: any) => {
          const p1 = srcItem.prices?.find((p: any) => p.screens_count === 1);
          const p2 = srcItem.prices?.find((p: any) => p.screens_count === 2);
          const p3 = srcItem.prices?.find((p: any) => p.screens_count === 3);
          
          return {
            itemId: `temp-${srcItem.period}`,
            period: srcItem.period,
            credits: srcItem.credits_base || 0,
            price1: p1?.price_amount?.toString() ?? "",
            price2: p2?.price_amount?.toString() ?? "",
            price3: p3?.price_amount?.toString() ?? "",
          };
        });
        
        const ordered = PERIOD_ORDER.map(period => clonedItems.find(m => m.period === period)).filter(Boolean) as EditableItem[];
        setItems(ordered);
      } else {
        // Estrutura vazia se não encontrar padrão
        const emptyItems: EditableItem[] = PERIOD_ORDER.map((period) => {
          const creditsMap: Record<string, number> = {
            MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12
          };
          return {
            itemId: `temp-${period}`,
            period,
            credits: creditsMap[period] || 1,
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

  // Quando muda moeda na criação ou edição
  useEffect(() => {
    if (isSaasCredits) return; // créditos não dependem de moeda
    if (isEditing) {
      if (currency !== originalCurrency) {
        cloneFromDefault(currency);
      }
    } else {
      cloneFromDefault(currency);
    }
  }, [currency]);

  const handlePriceChange = (period: string, field: 'price1'|'price2'|'price3', val: string) => {
    setItems(prev => prev.map(item => 
      item.period === period ? { ...item, [field]: val } : item
    ));
  };

  async function handleSave() {
    if (!name.trim()) {
      alert("Informe o nome da tabela.");
      return;
    }

    setSaving(true);
    const supabase = supabaseBrowser;
    const tenantId = await getCurrentTenantId();

    if (!tenantId) {
      alert("Erro de sessão. Recarregue a página.");
      setSaving(false);
      return;
    }

    try {
      if (isEditing && plan) {
        // ✅ Atualiza nome e moeda (agora sempre pode, exceto sistema) - TRAVADO COM TENANT
        const { error: updErr } = await supabase
  .from("plan_tables")
  .update({ name: name.trim(), currency })
  .eq("id", plan.id)
  .eq("tenant_id", tenantId);
  
if (updErr) throw new Error("Falha ao atualizar a tabela.");

        // ✅ Atualiza preços - TRAVADO COM TENANT E SEM NEGATIVOS
        for (const row of items) {
          for (let screen = 1; screen <= 3; screen++) {
            const val = row[`price${screen}` as keyof EditableItem] as string;
            if (val === "") continue;
            
            const numVal = Number(val);
            if (numVal < 0) throw new Error("Os preços não podem ser negativos.");
            
            await supabase
              .from("plan_table_item_prices")
              .update({ price_amount: numVal })
              .match({ plan_table_item_id: row.itemId, screens_count: screen });
          }
        }
      } else {
        // Criação
        const { data: tableData, error: tableError } = await supabase
          .from("plan_tables")
          .insert({
            tenant_id: tenantId,
            name: name.trim(),
            currency: currency,
            is_system_default: false,
            is_active: true,
            is_master_only: isSaas,
            table_type: effectiveType,
          })
          .select()
          .single();

        if (tableError) throw new Error("Falha ao criar tabela principal.");
        const newTableId = tableData.id;

        const monthsMap: Record<string, number> = {
          MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12
        };

        const getSafeNum = (val: string) => {
          if (!val) return null;
          const n = Number(val);
          return n >= 0 ? n : 0;
        };

        for (const item of items) {
          const { data: newItem, error: itemError } = await supabase
            .from("plan_table_items")
            .insert({
              tenant_id: tenantId,
              plan_table_id: newTableId,
              period: item.period,
              months: monthsMap[item.period] ?? 0,
              credits_base: item.credits,
            })
            .select()
            .single();

          if (itemError || !newItem) continue;

          // saas_credits: só screens_count=1 (o preço do pacote)
          const pricesToInsert = isSaasCredits
            ? [{ tenant_id: tenantId, plan_table_item_id: newItem.id, screens_count: 1, price_amount: getSafeNum(item.price1) }]
            : [
                { tenant_id: tenantId, plan_table_item_id: newItem.id, screens_count: 1, price_amount: getSafeNum(item.price1) },
                { tenant_id: tenantId, plan_table_item_id: newItem.id, screens_count: 2, price_amount: getSafeNum(item.price2) },
                { tenant_id: tenantId, plan_table_item_id: newItem.id, screens_count: 3, price_amount: getSafeNum(item.price3) },
              ];

          await supabase.from("plan_table_item_prices").insert(pricesToInsert);
        }
      }

      onSuccess();
    } catch (err: any) {
      if (process.env.NODE_ENV !== "production") console.error("Erro ao salvar:", err?.message || err);
      alert(err?.message || "Ocorreu um erro inesperado ao salvar a tabela.");
    } finally {
      setSaving(false);
    }
  }

  const formatCurrency = (c: string) => c === 'BRL' ? 'R$' : c === 'USD' ? '$' : '€';

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-[1200px] max-h-[90vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        
        {/* HEADER - Título simples, botões menores no mobile */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 sticky top-0 z-10">
          <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white tracking-tight">
            {isEditing
              ? "Editar Tabela"
              : isSaasCredits
              ? "Nova Tabela — Venda Créditos SaaS"
              : isSaas
              ? "Nova Tabela SaaS"
              : "Nova Tabela IPTV"}
          </h2>

          <div className="flex gap-2 sm:gap-3">
            <button 
              onClick={onClose} 
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-xs sm:text-sm font-semibold transition-colors"
            >
              Cancelar
            </button>
            
              <button 
                onClick={handleSave}
                disabled={saving || loading}
                className="px-3 sm:px-6 py-1.5 sm:py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-[#161b22]">
          
          {/* Dados Básicos - Moeda editável agora */}
          <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-white/10 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nome da tabela</Label>
                <input 
  value={name}
  onChange={e => setName(e.target.value)}
  placeholder="Ex: Tabela especial revenda"
  disabled={plan?.is_system_default && plan?.is_master_only}
                  className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50"
                />
              </div>
              <div>
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
                {isEditing && currency !== originalCurrency && (
                  <p className="text-[10px] text-amber-500 mt-2 italic">
                    * Atenção: valores resetados para tabela Padrão {currency}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Matriz de Preços */}
          <div className="p-4 sm:p-6 space-y-8">
           {loading ? (
              <div className="text-center py-20 text-slate-400 animate-pulse font-medium">
                {isEditing ? "Carregando dados..." : "Preparando tabela..."}
              </div>
            ) : isSaasCredits ? (
              /* ── Créditos SaaS: dois grupos de 5 ── */
              [
                { label: "Pacotes Pequenos", tiers: CREDIT_TIERS.slice(0, 5) },
                { label: "Pacotes Grandes",  tiers: CREDIT_TIERS.slice(5) },
              ].map(({ label, tiers }) => (
                <div key={label} className="animate-in slide-in-from-left-2 duration-300">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
                    {label}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                    {tiers.map((tier) => {
                      const item = items.find(i => i.period === tier);
                      if (!item) return null;
                      return (
                        <div
                          key={tier}
                          className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col justify-center h-16 sm:h-20 relative focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all"
                        >
                          <div className="flex justify-between items-center w-full mb-1">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-white/20">Pacote</span>
                            <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10">
                              {CREDIT_TIER_LABELS[tier]}
                            </span>
                          </div>
                          <div className="relative">
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/20 text-xs font-bold">
                              {formatCurrency(currency)}
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              value={item.price1}
                              onChange={(e) => handlePriceChange(tier, "price1", e.target.value)}
                              className="w-full bg-transparent border-none p-0 pl-6 sm:pl-7 text-sm sm:text-base font-bold text-slate-800 dark:text-white focus:ring-0 outline-none placeholder-slate-300 dark:placeholder-white/5"
                              placeholder="0,00"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              (isMasterOnly ? [1, 2] : [1, 2, 3]).map((screenCount) => (
  <div key={screenCount} className="animate-in slide-in-from-left-2 duration-300">
    <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
      Preços para {screenCount} {isMasterOnly
        ? screenCount === 1 ? 'Sessão WhatsApp' : 'Sessões WhatsApp'
        : screenCount === 1 ? 'tela' : 'telas'}
    </h3>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                    {PERIOD_ORDER.map((period) => {
                      const item = items.find(i => i.period === period);
                      if (!item) return null;

                      const currentCredits = item.credits * screenCount;
                      const field = `price${screenCount}` as 'price1' | 'price2' | 'price3';
                      const value = item[field];

                      return (
                        <div 
                          key={period} 
                          className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col justify-center h-16 sm:h-20 relative focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all group"
                        >
                          <div className="flex justify-between items-center w-full mb-1">
                            <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 dark:text-white/20">
                              {PERIOD_LABELS[period]}
                            </span>
                            <span className="text-[8px] sm:text-[9px] font-bold text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10">
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
                              disabled={false}
                              onChange={(e) => handlePriceChange(period, field, e.target.value)}
                              className="w-full bg-transparent border-none p-0 pl-6 sm:pl-7 text-sm sm:text-base font-bold text-slate-800 dark:text-white focus:ring-0 outline-none placeholder-slate-300 dark:placeholder-white/5 transition-colors disabled:opacity-50"
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

        <div className="px-4 sm:px-6 py-3 sm:py-4 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10 flex justify-between items-center transition-colors">
          <span className="text-[10px] text-slate-400 italic">
            * {isEditing 
              ? "Altere o nome, moeda e valores conforme necessário" 
              : "Ajuste os valores clonados da tabela padrão"}
          </span>
          
            <span className="text-[10px] text-slate-400 dark:text-white/30">
              A tabela será criada como <strong>ativa</strong> por padrão
            </span>
          
        </div>
      </div>
    </div>,
    document.body
  );
}