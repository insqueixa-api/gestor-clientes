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
    is_master_only: boolean;
    table_type: "iptv" | "saas" | "saas_credits";
    created_at: string;
    items: Item[];
  };

  const PERIOD_ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

  const CREDIT_TIERS_ROW1 = ["C_10", "C_20", "C_30", "C_50", "C_100"] as const;
  const CREDIT_TIERS_ROW2 = ["C_150", "C_200", "C_300", "C_400", "C_500"] as const;
  const CREDIT_TIER_LABELS: Record<string, string> = {
    C_10: "10 cr", C_20: "20 cr", C_30: "30 cr", C_50: "50 cr", C_100: "100 cr",
    C_150: "150 cr", C_200: "200 cr", C_300: "300 cr", C_400: "400 cr", C_500: "500 cr",
  };

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
    const [search, setSearch] = useState("");
    const [userRole, setUserRole] = useState<"SUPERADMIN" | "MASTER" | "USER" | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [newTableType, setNewTableType] = useState<"iptv" | "saas" | "saas_credits" | null>(null);

    const filteredPlans = useMemo(() => {
      // USER não enxerga tabelas SaaS nem Créditos SaaS
      let plans = userRole === "USER"
        ? plano.filter((p) => p.table_type === "iptv")
        : plano;

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
    }, [plano, search, userRole]);


    // --- Carregamento de Dados (Integral) ---
    async function ensureTablesCloned(tenantId: string, role: string | null) {
  const supabase = supabaseBrowser;

  // Verifica se já tem tabelas próprias
  const { data: own } = await supabase
    .from("plan_tables")
    .select("id")
    .eq("tenant_id", tenantId); // ✅ REMOVIDO o filtro is_system_default para ele encontrar os clones corretamente

  if (own && own.length > 0) return; // já tem, não clona

  // Busca tabelas padrão do sistema — USER só clona iptv
  let query = supabase
    .from("plan_tables")
    .select(`id, name, currency, is_master_only, table_type,
      items:plan_table_items (
        id, period, credits_base
      )`)
    .eq("is_system_default", true);

  if (role === "USER") {
    query = query.eq("table_type", "iptv");
  }

  const { data: defaults } = await query;

    if (!defaults || defaults.length === 0) return;

    let newSaasPlanTableId: string | null = null;
    let newCreditsPlanTableId: string | null = null;

    for (const tpl of defaults as any[]) {
        const { data: newTable } = await supabase
          .from("plan_tables")
          .insert({
          tenant_id: tenantId,
          name: tpl.name,
          currency: tpl.currency,
          table_type: tpl.table_type,
          is_system_default: false, // ✅ CORRIGIDO: O clone pertence à revenda, não é um padrão do sistema!
          is_master_only: tpl.is_master_only ?? false,
          is_active: true,
        })
          .select("id")
          .single();

      if (!newTable) continue;

      if (tpl.table_type === "saas") newSaasPlanTableId = newTable.id;
      if (tpl.table_type === "saas_credits") newCreditsPlanTableId = newTable.id;

      for (const item of (tpl.items || []) as any[]) {
        const { data: newItem } = await supabase
          .from("plan_table_items")
          .insert({
            tenant_id: tenantId,
            plan_table_id: newTable.id,
            period: item.period,
            credits_base: item.credits_base,
          })
          .select("id")
          .single();

        if (!newItem) continue;

        const screens = tpl.table_type === "saas_credits"
          ? [1]
          : tpl.is_master_only
          ? [1, 2]
          : [1, 2, 3];

        await supabase.from("plan_table_item_prices").insert(
          screens.map(s => ({
            tenant_id: tenantId,
            plan_table_item_id: newItem.id,
            screens_count: s,
            price_amount: null,
          }))
        );
      }
    }

    // Vincula as tabelas SaaS ao tenant
    if (newSaasPlanTableId || newCreditsPlanTableId) {
      const update: Record<string, string> = {};
      if (newSaasPlanTableId) update.saas_plan_table_id = newSaasPlanTableId;
      if (newCreditsPlanTableId) update.credits_plan_table_id = newCreditsPlanTableId;
      await supabase.from("tenants").update(update).eq("id", tenantId);
    }
  }

  async function fetchPlano() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();
    const { data: roleData } = await supabaseBrowser.rpc("saas_my_role");
    const currentRole = (roleData ?? "USER").toUpperCase();
    setUserRole(currentRole as any);
    await ensureTablesCloned(tenantId, currentRole);
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

        // 3. Deletar Tabela Principal (✅ Trava Absoluta de Tenant adicionada)
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
  }, []);

    async function fetchRole() {
    try {
      const { data } = await supabaseBrowser.rpc("saas_my_role");
      if (data) setUserRole(data.toUpperCase() as any);
    } catch (e) {
      console.error("Erro ao buscar role:", e);
    }
  }

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
            <div className="relative">
              <button
                onClick={() => {
                  if (userRole === "USER") {
                    setNewTableType("iptv");
                    setIsNewOpen(true);
                  } else {
                    // SUPERADMIN, MASTER ou ainda carregando (null) → dropdown
                    setDropdownOpen((v) => !v);
                  }
                }}
                className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
              >
                <span>+</span> Nova Tabela
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setDropdownOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 z-40 bg-white dark:bg-[#1e2530] border border-slate-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden min-w-[230px]">
                    <div className="px-3 py-2 text-[10px] font-bold uppercase text-slate-400 dark:text-white/30 tracking-wider border-b border-slate-100 dark:border-white/5">
                      Tipo de Tabela
                    </div>

                    {/* Opção 1 — IPTV */}
                    <button
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 flex items-center gap-3 transition-colors"
                      onClick={() => {
                        setDropdownOpen(false);
                        setNewTableType("iptv");
                        setIsNewOpen(true);
                      }}
                    >
                      <span className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 shrink-0">
                        <IconTV />
                      </span>
                      <div>
                        <div className="text-xs font-bold text-slate-700 dark:text-white">Tabela IPTV</div>
                        <div className="text-[10px] text-slate-400 dark:text-white/30">Renovação de cliente</div>
                      </div>
                    </button>

                    {/* Opção 2 — SaaS */}
                    <button
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 flex items-center gap-3 transition-colors"
                      onClick={() => {
                        setDropdownOpen(false);
                        setNewTableType("saas");
                        setIsNewOpen(true);
                      }}
                    >
                      <span className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 shrink-0">
                        <IconWpp />
                      </span>
                      <div>
                        <div className="text-xs font-bold text-slate-700 dark:text-white">Tabela SaaS</div>
                        <div className="text-[10px] text-slate-400 dark:text-white/30">Renovação de SaaS</div>
                      </div>
                    </button>

                    {/* Opção 3 — Créditos SaaS */}
                    <button
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 flex items-center gap-3 transition-colors"
                      onClick={() => {
                        setDropdownOpen(false);
                        setNewTableType("saas_credits");
                        setIsNewOpen(true);
                      }}
                    >
                      <span className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                        <IconCoins />
                      </span>
                      <div>
                        <div className="text-xs font-bold text-slate-700 dark:text-white">Venda Créditos SaaS</div>
                        <div className="text-[10px] text-slate-400 dark:text-white/30">Pacotes de créditos</div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>      </div>

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

              {!loading && (() => {
          const groups = [
            {
              key: "iptv",
              label: "Tabelas IPTV",
              icon: <IconTV />,
              color: "text-sky-500",
              plans: filteredPlans.filter((p) => p.table_type === "iptv"),
            },
            {
              key: "saas",
              label: "Tabelas SaaS",
              icon: <IconWpp />,
              color: "text-purple-500",
              plans: filteredPlans.filter((p) => p.table_type === "saas"),
            },
            {
              key: "saas_credits",
              label: "Venda Créditos SaaS",
              icon: <IconCoins />,
              color: "text-emerald-500",
              plans: filteredPlans.filter((p) => p.table_type === "saas_credits"),
            },
          ].filter((g) => g.plans.length > 0);

          if (groups.length === 0) {
            return (
              <div
                className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-8 text-center text-slate-400 dark:text-white/40 italic">
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
                  className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors"
                >
                  {/* Cabeçalho do grupo */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
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
                        className="bg-white dark:bg-[#161b22] rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-white/10 transition-colors"
                      >
                        {/* CABEÇALHO DO CARD (PADRÃO MEMORIZADO) */}
                        <div className="px-5 py-3 flex justify-between items-center border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                          <div className="flex items-center gap-3">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
                              {plan.is_system_default && plan.table_type === "iptv"
                                ? plan.name.split(" ")[0]
                                : plan.name}
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

                        {isExpanded && plan.table_type === "saas_credits" ? (
                          /* ── Créditos SaaS ── */
                          <div className="p-4 sm:p-5 space-y-6 bg-white dark:bg-[#161b22]">
                            {[
                              { label: "Pacotes Pequenos", tiers: CREDIT_TIERS_ROW1 },
                              { label: "Pacotes Grandes",  tiers: CREDIT_TIERS_ROW2  },
                            ].map(({ label, tiers }) => (
                              <div key={label} className="animate-in slide-in-from-left-2 duration-300">
                                <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
                                  {label}
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                                  {tiers.map((tier) => {
                                    const item  = plan.items.find((i) => i.period === tier);
                                    const price = item?.prices?.find((p) => p.screens_count === 1)?.price_amount ?? null;
                                    return (
                                      <div
                                        key={tier}
                                        className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5 flex flex-col justify-center h-16 relative hover:border-emerald-500/30 transition-all group"
                                      >
                                        <div className="flex justify-between items-center w-full mb-1">
                                          <span className="text-[10px] font-bold text-slate-400 dark:text-white/20">
                                            Pacote
                                          </span>
                                          <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10">
                                            {CREDIT_TIER_LABELS[tier]}
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
                        ) : isExpanded ? (
                          /* ── IPTV / SaaS (comportamento original) ── */
                          <div className="p-4 sm:p-5 space-y-6 bg-white dark:bg-[#161b22]">
                            {(plan.is_master_only ? [1, 2] : [1, 2, 3]).map((screenCount) => (
                              <div key={screenCount} className="animate-in slide-in-from-left-2 duration-300">
                                <h3 className="text-xs font-bold text-slate-500 dark:text-white/40 mb-3 ml-1 tracking-tight">
                                  Preços para {screenCount} {plan.is_master_only 
                                  ? screenCount === 1 ? "Sessão WhatsApp" : "Sessões WhatsApp"
                                  : screenCount === 1 ? "Tela" : "Telas"}
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
                        ) : null}
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
      newTableType={newTableType}
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
  function IconTV() {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8M12 17v4"/>
      </svg>
    );
  }
  function IconWpp() {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884"/>
      </svg>
    );
  }
  function IconCoins() {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="8" cy="8" r="6"/>
        <path d="M18.09 10.37A6 6 0 1 0 10.34 18"/>
        <path d="M7 6h1v4"/>
      </svg>
    );
  }
