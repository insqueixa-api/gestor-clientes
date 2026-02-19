"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import PlanoModal from "./plano_modal";

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

  // ✅ controle de expand/minimize por tabela (default: minimizada)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ NOVO: busca (padrão admin)
  const [search, setSearch] = useState("");

  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return plano;

    return plano.filter((p) => {
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


  // --- Carregamento de Dados (Integral) ---
  async function fetchPlano() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();
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

      // ✅ NOVO: garante que qualquer tabela nova comece minimizada
      setExpanded((prev) => {
        const out: Record<string, boolean> = { ...prev };
        for (const p of next) {
          if (out[p.id] === undefined) out[p.id] = false; // minimizada
        }
        // (não removo chaves antigas pra não “piscar”)
        return out;
      });
    } catch (error) {
      console.error("Erro ao carregar planos:", error);
    } finally {
      setLoading(false);
    }
  }

  // --- Função de Deletar (Integral) ---
  // --- Função de Deletar (Integral) ---
async function handleDelete(plan: PlanRow) {
  if (!confirm(`Tem certeza que deseja excluir a tabela "${plan.name}"?`)) return;

  const supabase = supabaseBrowser;

  console.group("🔍 DEBUG DELETE");
  console.log("Tabela a deletar:", plan.id);
  console.log("Tenant da tabela:", plan.tenant_id);

  try {
    // 1) Usuário atual (cliente)
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.warn("⚠️ getUser error:", userErr);
    const user = userRes?.user ?? null;
    console.log("👤 Usuário logado (getUser):", user?.id || "NENHUM");

    // 2) Tenant atual (seu helper)
    const currentTenantId = await getCurrentTenantId();
    console.log("🏢 Tenant atual:", currentTenantId);
    console.log("🏢 Tenant da tabela:", plan.tenant_id);
    console.log("✅ Match?", currentTenantId === plan.tenant_id);

    // 3) ✅ DEBUG DEFINITIVO: o que o banco está vendo no request
    console.log("🧾 Checando contexto do request (RLS)...");
    const { data: ctx, error: ctxErr } = await supabase.rpc("debug_request_context");
    console.log("🧾 REQUEST CONTEXT:", ctx);
    console.log("🧾 REQUEST CONTEXT error:", ctxErr);

    // 4) Delete
    console.log("🗑️ Tentando delete...");
// 1. Deletar preços primeiro
const { error: pricesErr } = await supabase
  .from("plan_table_item_prices")
  .delete()
  .in(
    "plan_table_item_id",
    plan.items.map((i) => i.id)
  );

if (pricesErr) {
  console.error("❌ Erro ao deletar preços:", pricesErr);
  alert(`Erro ao deletar preços: ${pricesErr.message}`);
  console.groupEnd();
  return;
}

// 2. Deletar itens
const { error: itemsErr } = await supabase
  .from("plan_table_items")
  .delete()
  .eq("plan_table_id", plan.id);

if (itemsErr) {
  console.error("❌ Erro ao deletar itens:", itemsErr);
  alert(`Erro ao deletar itens: ${itemsErr.message}`);
  console.groupEnd();
  return;
}

// 3. Deletar tabela
const { data, error, status, statusText } = await supabase
  .from("plan_tables")
  .delete()
  .eq("id", plan.id)
  .select();

    console.log("📊 Status:", status, statusText);
    console.log("📊 Data retornada:", data);
    console.log("📊 Error:", error);

    if (error) {
      console.error("❌ Erro Supabase:", error);
      alert(`Erro: ${error.message}\nCódigo: ${error.code}`);
      console.groupEnd();
      return;
    }

    if (!data || data.length === 0) {
      // Aqui a gente diferencia: RLS mesmo vs request sem auth
      const role = (ctx as any)?.role;
      const uid = (ctx as any)?.uid;

      if (!uid || role === "anon") {
        alert(
          "⚠️ O DELETE está chegando como ANON (sem sessão/JWT).\n" +
            "Então auth.uid() = null e o RLS bloqueia.\n\n" +
            "Me manda o log do '🧾 REQUEST CONTEXT' que eu te devolvo o DE/PARA do supabaseBrowser."
        );
      } else {
        alert(
          "⚠️ RLS bloqueou o delete mesmo com usuário autenticado.\n\n" +
            "Me manda o log do '🧾 REQUEST CONTEXT' + a policy de DELETE de plan_tables."
        );
      }

      console.groupEnd();
      return;
    }

    console.log("✅ Deletado com sucesso no banco!");

    // 5) Atualiza estado
    setPlano((prev) => prev.filter((p) => p.id !== plan.id));
    setExpanded((prev) => {
      const out = { ...prev };
      delete out[plan.id];
      return out;
    });

    console.groupEnd();
  } catch (err) {
    console.error("💥 Erro catch:", err);
    alert("Erro inesperado");
    console.groupEnd();
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
      credits: totalCredits,
    };
  };

    return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">
      {/* Topo (padrão admin) */}
      <div className="flex items-center justify-between gap-2 pb-0 mb-2 px-3 sm:px-0 md:px-4">
        <div className="min-w-0 text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
            Tabelas de Preço
          </h1>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={() => setIsNewOpen(true)}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
          >
            <span>+</span> Nova Tabela
          </button>
        </div>
      </div>

      {/* Barra de Busca (padrão admin) */}
      <div
        className="p-0 px-3 sm:px-0 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider mb-2">
          Busca
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar tabela..."
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
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
                <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-none sm:rounded-xl border border-slate-200 dark:border-white/5 font-medium">

          Carregando tabelas de preço...
        </div>
      )}

            {!loading && (
        <div
          className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-700 dark:text-white whitespace-nowrap">
              Lista de Tabelas{" "}
              <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
                {filteredPlans.length}
              </span>
            </div>
          </div>

          {filteredPlans.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-white/40 italic">
              Nenhuma tabela encontrada.
            </div>
          ) : (
            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-4 sm:gap-6">
                {filteredPlans.map((plan) => {
                  const isExpanded = !!expanded[plan.id];

                  return (
                    <div
                      key={plan.id}
                      className="bg-white dark:bg-[#161b22] rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-white/10 transition-colors"
                    >
                      {/* CABEÇALHO DO CARD (PADRÃO MEMORIZADO) */}
                      <div className="px-5 py-3 flex justify-between items-center border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                        <div className="flex items-center gap-3">
                          <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
                            {plan.is_system_default ? plan.name.split(" ")[0] : plan.name}
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
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shadow-sm
                                ${
                                  plan.is_active
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                    : "bg-slate-100 text-slate-400 border-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-white/20"
                                }`}
                              >
                                {plan.is_active ? "Ativa" : "Inativa"}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* AÇÕES (Expand: Square / Collapse: Minus / Edit: Amber / Delete: Rose) */}
                        <div className="flex items-center gap-2">
                          {/* ✅ expand/minimize */}
                          <button
                            onClick={() => setExpanded((prev) => ({ ...prev, [plan.id]: !prev[plan.id] }))}
                            className="p-1.5 rounded-lg bg-slate-500/10 border border-slate-500/20 text-slate-600 dark:text-white/70 hover:bg-slate-500/20 transition-all shadow-sm"
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
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                          </button>

                          {!plan.is_system_default && (
                            <button
                              onClick={() => handleDelete(plan)}
                              className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all shadow-sm"
                              title="Excluir Tabela"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          )}

                          {plan.is_system_default && (
                            <div className="p-1.5 opacity-20 bg-slate-100 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-center cursor-not-allowed">
                              <svg className="w-4 h-4 text-slate-500 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-4 sm:p-5 space-y-6 bg-white dark:bg-[#161b22]">
                          {[1, 2, 3].map((screenCount) => (
                            <div key={screenCount} className="animate-in slide-in-from-left-2 duration-300">
                              <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
                                Preços para {screenCount} {screenCount === 1 ? "Tela" : "Telas"}
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
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}


      {/* Modal Unificado */}
{(isNewOpen || editingPlan) && (
  <PlanoModal 
    plan={editingPlan} // Se null = modo criação, se objeto = modo edição
    onClose={() => {
      setIsNewOpen(false);
      setEditingPlan(null);
    }}
    onSuccess={() => {
      setIsNewOpen(false);
      setEditingPlan(null);
      fetchPlano();
    }}
  />
)}
    </div>
  );
}
function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
