"use client";
import { X } from "lucide-react";


import { useEffect, useMemo, useState } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import PlanoModal from "./plano_modal";
import ToastNotifications from "../../ToastNotifications"; // ✅ Novo import

// --- Tipagens (Enxutas para IPTV) ---
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
  is_master_only: boolean;
  table_type: "iptv";
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

  // ✅ Controle de Toasts na Página Principal
  const [toasts, setToasts] = useState<any[]>([]);
  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const checkQueuedToasts = () => {
    try {
      const key = "planos_list_toasts";
      const raw = window.sessionStorage.getItem(key);
      if (raw) {
        const arr = JSON.parse(raw) as any[];
        if (arr.length > 0) {
          const newToasts = arr.map((t, idx) => ({
            id: Date.now() + idx,
            type: t.type,
            title: t.title,
            message: t.message,
            durationMs: 5000
          }));
          setToasts(prev => [...prev, ...newToasts]);
          window.sessionStorage.removeItem(key);
        }
      }
    } catch {}
  };

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRow | null>(null);

  // controle de expand/minimize por tabela (default: minimizada)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [newTableType, setNewTableType] = useState<"iptv" | null>(null);

  const filteredPlans = useMemo(() => {
    // Garante que só exiba iptv (caso tenha lixo antigo no banco)
    const plans = plano.filter((p) => p.table_type === "iptv");

    const q = search.trim().toLowerCase();
    if (!q) return plans;

    return plans.filter((p) => {
      const hay = [
        p.name,
        p.currency,
        p.is_active ? "ativa" : "inativa",
        p.is_system_default ? "padrao do sistema" : "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [plano, search]);

  async function fetchPlano() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();

      if (!tenantId) {
        setLoading(false);
        return;
      }

      const supabase = supabaseBrowser;

      const { data, error } = await supabase
        .from("plan_tables")
        .select(
          `
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
        `
        )
        .eq("tenant_id", tenantId)
        .order("is_system_default", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) throw error;

      const next = (((data as any) as PlanRow[]) || []) as PlanRow[];
      setPlano(next);

      // Garante que qualquer tabela nova comece minimizada
      setExpanded((prev) => {
        const out: Record<string, boolean> = { ...prev };
        for (const p of next) {
          if (out[p.id] === undefined) out[p.id] = false; // minimizada
        }
        return out;
      });
    } catch (error) {
    } finally {
      setLoading(false);
      checkQueuedToasts(); // ✅ Puxa os alertas da fila e exibe
    }
  }

  // --- Função de Deletar (Blindada) ---
  async function handleDelete(plan: PlanRow) {
    if (!confirm(`Tem certeza que deseja excluir a tabela "${plan.name}"?`)) return;

    setLoading(true);

    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Acesso negado: Tenant ausente.");

      const supabase = supabaseBrowser;

      // 1. Deletar preços PRIMEIRO (Evita crash de foreign key)
      const itemIds = plan.items.map((i) => i.id).filter(Boolean);

      if (itemIds.length > 0) {
        const { error: pricesErr } = await supabase
          .from("plan_table_item_prices")
          .delete()
          .in("plan_table_item_id", itemIds);

        if (pricesErr) throw new Error(`Erro ao deletar preços: ${pricesErr.message}`);
      }

      // 2. Deletar Itens associados a esta tabela
      const { error: itemsErr } = await supabase
        .from("plan_table_items")
        .delete()
        .eq("plan_table_id", plan.id);

      if (itemsErr) throw new Error(`Erro ao deletar itens: ${itemsErr.message}`);

      // 3. Deletar Tabela Principal
      const { data, error } = await supabase
        .from("plan_tables")
        .delete()
        .eq("id", plan.id)
        .or(`tenant_id.eq.${tenantId},is_system_default.eq.true`)
        .select();

      if (error) {
        throw new Error(`Erro ao deletar tabela: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new Error("Tabela não encontrada ou você não tem permissão para apagá-la.");
      }

      // 4. Atualiza o estado da UI sem recarregar a página
      setPlano((prev) => prev.filter((p) => p.id !== plan.id));
      setExpanded((prev) => {
        const out = { ...prev };
        delete out[plan.id];
        return out;
      });
    } catch (err: any) {
      if (process.env.NODE_ENV !== "production") console.error("Falha no DELETE:", err?.message || err);
      alert(err?.message || "Ocorreu um erro inesperado ao excluir a tabela.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlano();
    checkQueuedToasts(); // ✅ Garante que lê ao carregar a página
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
    if (!item) return { price: null };
    const priceObj = item.prices.find((p) => p.screens_count === screenCount);
    
    return {
      price: priceObj?.price_amount ?? null,
    };
  };

  return (

    
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-background transition-colors">
      {/* Topo */}
      <div className="flex items-center justify-between gap-2 pb-0 mb-2 px-3 sm:px-0 md:px-4">
        <div className="min-w-0 text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
            Tabelas de Preço
          </h1>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={() => {
              setNewTableType("iptv");
              setIsNewOpen(true);
            }}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
          >
            <span>+</span> Nova Tabela
          </button>
        </div>
      </div>

      {/* Barra de Busca */}
      <div
        className={`p-0 px-3 sm:px-0 md:p-4 bg-transparent md:bg-white md:dark:bg-card border-0 md:border md:border-slate-200 md:dark:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 ${(isNewOpen || editingPlan) ? "z-0" : "z-20"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-muted-foreground tracking-wider mb-2">
          Busca
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar tabela..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"
                title="Limpar busca"
              >
                <IconX />
              </button>
            )}
          </div>

          <button
            onClick={() => setSearch("")}
            className="hidden md:inline-flex h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors items-center justify-center gap-2"
          >
            <IconX /> Limpar
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-12 text-center text-slate-400 dark:text-muted-foreground animate-pulse bg-white dark:bg-card rounded-none sm:rounded-xl border border-slate-200 dark:border-border font-medium">
          Carregando tabelas de preço...
        </div>
      )}

      {!loading && (() => {
        const groups = [
          {
            key: "iptv",
            label: "Tabela de Preço",
            icon: <IconTV />,
            color: "text-sky-500",
            plans: filteredPlans,
          },
        ].filter((g) => g.plans.length > 0);

        if (groups.length === 0) {
          return (
            <div
              className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-none sm:rounded-xl shadow-sm transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-8 text-center text-slate-400 dark:text-muted-foreground italic">
                Nenhuma tabela encontrada.
              </div>
            </div>
          );
        }

        return (
          <div className="space-y-6" onClick={(e) => e.stopPropagation()}>
            {groups.map((group) => (
              <div
                key={group.key}
                className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors"
              >
                {/* Cabeçalho do grupo */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-white/5">
                  <span className={`${group.color}`}>{group.icon}</span>
                  <span className="text-sm font-bold text-slate-700 dark:text-white whitespace-nowrap">
                    {group.label}
                  </span>
                  <span className="ml-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                    {group.plans.length}
                  </span>
                </div>

                <div className="p-4 sm:p-5">
                  <div className="grid grid-cols-1 gap-4 sm:gap-6">
                    {group.plans.map((plan) => {
                      const isExpanded = !!expanded[plan.id];

                      return (
                        <div
                          key={plan.id}
                          className="bg-white dark:bg-card rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-border transition-colors"
                        >
                          {/* CABEÇALHO DO CARD */}
                          <div className="px-5 py-3 flex justify-between items-center border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-white/5">
                            <div className="flex items-center gap-3">
                              <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
                                {plan.is_system_default && plan.name.startsWith("Padrão") ? "Padrão" : plan.name}
                              </h2>

                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest bg-slate-200/50 dark:bg-white/5 px-2 py-0.5 rounded">
                                  {plan.currency}
                                </span>

                                {(plan.is_system_default || plan.name.startsWith("Padrão")) ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shadow-sm">
                                    Padrão do Sistema
                                  </span>
                                ) : (
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shadow-sm
                                    ${
                                      plan.is_active
                                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                        : "bg-slate-100 text-slate-400 border-slate-200 dark:bg-white/5 dark:border-border dark:text-white/20"
                                    }`}
                                  >
                                    {plan.is_active ? "Ativa" : "Inativa"}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* AÇÕES */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setExpanded((prev) => ({ ...prev, [plan.id]: !prev[plan.id] }))}
                                className="p-1.5 rounded-lg bg-slate-500/10 border border-slate-500/20 text-slate-600 dark:text-muted-foreground hover:bg-slate-500/20 transition-all shadow-sm"
                                title={isExpanded ? "Minimizar tabela" : "Maximizar tabela"}
                                aria-label={isExpanded ? "Minimizar tabela" : "Maximizar tabela"}
                              >
                                {isExpanded ? (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12h12" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <rect x="6" y="6" width="12" height="12" rx="1" />
                                  </svg>
                                )}
                              </button>

                              <button
                                onClick={() => setEditingPlan(plan)}
                                className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all shadow-sm"
                                title="Editar Preços"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>

                              {!plan.is_system_default && !plan.name.startsWith("Padrão") && (
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
                            </div>
                          </div>

                          {/* CONTEÚDO EXPANDIDO */}
            {isExpanded && (
              <div className="p-4 sm:p-5 space-y-6 bg-white dark:bg-card">
                {[1, 2, 3].map((screenCount) => (
                  <div key={screenCount} className="animate-in slide-in-from-left-2 duration-300">
                                  <h3 className="text-xs font-bold text-slate-500 dark:text-muted-foreground mb-3 ml-1 tracking-tight">
                                    Preços para {screenCount} {screenCount === 1 ? "Tela" : "Telas"}
                                  </h3>

                                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                                    {PERIOD_ORDER.map((period) => {
                                      const { price } = getCellData(plan, period, screenCount);

                                      return (
                                        <div
                                          key={period}
                                          className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 flex flex-col justify-center h-16 relative hover:border-emerald-500/30 transition-all group"
                                        >
                                          <div className="flex justify-between items-center w-full mb-1">
                                            <span className="text-[10px] font-bold text-slate-400 dark:text-white/20">
                                              {PERIOD_LABELS[period]}
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
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Modal Unificado */}
      {(isNewOpen || editingPlan) && (
        <PlanoModal
          plan={editingPlan}
          onClose={() => {
            setIsNewOpen(false);
            setEditingPlan(null);
            setNewTableType(null);
          }}
          onSuccess={() => {
            setIsNewOpen(false);
            setEditingPlan(null);
            setNewTableType(null);
            fetchPlano();
          }}
        />
      )}

      {/* ✅ NOVO: Componente que estava faltando para exibir os toasts na tela */}
      <div className="fixed inset-x-0 top-2 z-[999999] px-3 sm:px-6 pointer-events-none">
        <div className="pointer-events-auto">
          <ToastNotifications toasts={toasts} removeToast={removeToast} />
        </div>
      </div>
    </div>
  );
}

function IconX() {
  return (
    <X className="w-4 h-4" />
  );
}

function IconTV() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}