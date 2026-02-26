"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import RecargaServidorModal from "../recarga_servidor"; 
import type { ServerRow } from "../page"; 
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";

// --- Tipagens ---

type MovementRow = {
  id: string;
  happened_at: string;
  kind: "PURCHASE" | "RESELLER_SALE" | "CLIENT_RENEWAL"; // ✅ Adicionado tipo do cliente
  qty_credits: number;
  total_brl: number;
  unit_price: number;
  label: string;
};

type ClientStats = {
  total: number;
  active: number;
  inactive: number;
};

export default function ServerDetailsPage() {
const params = useParams();

// ✅ aceita /[id] ou /[server_id] ou /[serverId]
const p = params as any;
const serverIdRaw = (p?.id ?? p?.server_id ?? p?.serverId) as string | string[] | undefined;
const serverId = Array.isArray(serverIdRaw) ? serverIdRaw[0] : serverIdRaw;
const serverIdSafe = (serverId ?? "").trim();


  const [loading, setLoading] = useState(true);
  const [server, setServer] = useState<ServerRow | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  
  // Stats
const [clientStats, setClientStats] = useState<ClientStats>({ total: 0, active: 0, inactive: 0 });
const [resellerCount, setResellerCount] = useState(0);
const [clientRenewals, setClientRenewals] = useState<any[]>([]);

// Filtros
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  // ✅ NOVO: Estados para os Filtros da Tabela
  const [searchTerm, setSearchTerm] = useState("");
  const [filterKind, setFilterKind] = useState("ALL");

// Controle do Modal de Recarga
  const [isRecargaOpen, setIsRecargaOpen] = useState(false);

  // Toast
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function loadData() {
      setLoading(true);

      // ✅ Validação UUID antes de qualquer query
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!serverIdSafe || !uuidRegex.test(serverIdSafe)) {
    setLoading(false);
    return;
  }
      
      try {
const tenantId = await getCurrentTenantId();
if (!tenantId) throw new Error("Tenant não encontrado");
const supabase = supabaseBrowser;


        // 1. Dados do Servidor
        const { data: sData, error: sErr } = await supabase
          .from("servers")
          .select("*")
          .eq("id", serverId)
          .eq("tenant_id", tenantId)
          .single();

        if (sErr) throw sErr;
        
        let serverObj = { ...sData } as any;

        // ✅ Busca os dados da integração para injetar no objeto (necessário para o modal)
        if (serverObj.panel_integration) {
          const { data: integData } = await supabase
            .from("vw_server_integrations")
            .select("integration_name, provider, is_active")
            .eq("id", serverObj.panel_integration)
            .maybeSingle();

          if (integData) {
            serverObj.panel_integration_name = integData.integration_name;
            serverObj.panel_integration_provider = integData.provider;
            serverObj.panel_integration_active = integData.is_active;
          }
        }

        setServer(serverObj as ServerRow);

        // 2. Movimentações
        const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).toISOString();
        const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

        const { data: movData, error: movErr } = await supabase
          .from("vw_server_movements") 
          .select(`
            id, 
            happened_at, 
            kind, 
            qty_credits:credits_qty,       
            total_brl:total_amount_brl,    
            unit_price, 
            label:notes
          `)
          .eq("server_id", serverId)
          .gte("happened_at", startOfMonth)
          .lte("happened_at", endOfMonth)
          .order("happened_at", { ascending: false });

        if (!movErr && movData) {
            setMovements(movData as any[]);
        } else {
            if (process.env.NODE_ENV !== "production") console.error("Erro movimentos:", movErr);
            setMovements([]); 
        }

        // 2b. Renovações de clientes deste servidor no mês (Sem JOIN problemático)
        const { data: renewalsData, error: renErr } = await supabase
          .from("client_renewals")
          .select("id, client_id, created_at, months, screens, unit_price, total_amount, currency, credits_used, notes")
          .eq("tenant_id", tenantId)
          .eq("server_id", serverId)
          .gte("created_at", startOfMonth)
          .lte("created_at", endOfMonth)
          .eq("status", "PAID");

        if (process.env.NODE_ENV !== "production") if (renErr) console.error("Erro ao buscar client_renewals:", renErr);

        setClientRenewals(renewalsData || []);

        // Busca o nome dos clientes em uma requisição separada e blindada
        const clientIds = [...new Set((renewalsData || []).map((r: any) => r.client_id).filter(Boolean))];
        const clientsMap: Record<string, any> = {};
        
        if (clientIds.length > 0) {
          const { data: clientsData } = await supabase
            .from("clients")
            .select("id, display_name, server_username")
            .in("id", clientIds);
            
          clientsData?.forEach(c => { clientsMap[c.id] = c; });
        }

        // Transforma os logs criando um padrão absoluto para a tabela
        const mappedRenewals: MovementRow[] = (renewalsData || []).map((r: any) => {
          const clientInfo = clientsMap[r.client_id] || {};
          const clientName = clientInfo.display_name || "Cliente Desconhecido";
          const userName = clientInfo.server_username ? `(${clientInfo.server_username})` : "";
          
          const rawNotes = String(r.notes || "").trim();
          
          let generatedLabel = "";

          // ✅ 1. Se já vier completo do Portal (começando com a palavra Renovação), usamos 100% igual.
          if (rawNotes.startsWith("Renovação") || rawNotes.startsWith("Renovacao")) {
            generatedLabel = rawNotes;
          } 
          // ✅ 2. Se for uma recarga feita pelo seu Painel (onde notes é apenas a observação do cliente)
          else {
            const formattedMoney = new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: r.currency || "BRL",
            }).format(Number(r.total_amount || 0));

            generatedLabel = `Renovação via Painel · ${clientName} ${userName} · ${r.months} mês(es) · ${r.screens} tela(s) · ${formattedMoney}`;
            
            // Se você digitou alguma observação no modal, ela entra aqui no finalzinho
            if (rawNotes) {
              generatedLabel += ` · Obs: ${rawNotes}`;
            }
          }

          return {
            id: r.id,
            happened_at: r.created_at,
            kind: "CLIENT_RENEWAL",
            qty_credits: Number(r.credits_used || 0),
            total_brl: Number(r.total_amount || 0),
            unit_price: Number(r.unit_price || 0),
            label: generatedLabel
          };
        });

        // Junta as movimentações de painel com as de clientes
        const allMoves = [...(movData || []), ...mappedRenewals].sort((a, b) => 
          new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime()
        );

        if (allMoves.length > 0) {
            setMovements(allMoves as MovementRow[]);
        } else {
            setMovements([]); 
        }

        // 3. Stats Clientes
        const { count: totalClients } = await supabase
          .from("vw_clients_list")
          .select("*", { count: 'exact', head: true })
          .eq("server_id", serverId);
          
        const { count: activeClients } = await supabase
          .from("vw_clients_list")
          .select("*", { count: 'exact', head: true })
          .eq("server_id", serverId)
          .eq("computed_status", "ACTIVE");

        setClientStats({
          total: totalClients || 0,
          active: activeClients || 0,
          inactive: (totalClients || 0) - (activeClients || 0)
        });

        // 4. Stats Revendas
        const { count: totalResellers } = await supabase
          .from("reseller_servers")
          .select("*", { count: 'exact', head: true })
          .eq("server_id", serverId);
        
        setResellerCount(totalResellers || 0);

      } catch (error) {
        if (process.env.NODE_ENV !== "production") console.error("Erro ao carregar detalhes:", error);
      } finally {
        setLoading(false);
      }
  }

  useEffect(() => {
    if (serverIdSafe) loadData();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, selectedDate]);

  // --- Métricas Calculadas ---
  const metrics = useMemo(() => {
    // ✅ Agora o "movements" tem tudo, então filtramos a partir dele
    const salesReseller = movements.filter(m => m.kind === 'RESELLER_SALE');
    const salesClient = movements.filter(m => m.kind === 'CLIENT_RENEWAL');
    const purchases = movements.filter(m => m.kind === 'PURCHASE');

    const resellerRevenue = salesReseller.reduce((acc, m) => acc + (m.total_brl || 0), 0);
    const resellerCredits = salesReseller.reduce((acc, m) => acc + (m.qty_credits || 0), 0);

    const clientRevenue = salesClient.reduce((acc, m) => acc + (m.total_brl || 0), 0);
    const clientCredits = salesClient.reduce((acc, m) => acc + (m.qty_credits || 0), 0);

    // ✅ Faturamento Total agora inclui revenda + cliente
    const totalRevenue = clientRevenue + resellerRevenue; 
    const totalRestockCost = purchases.reduce((acc, m) => acc + (m.total_brl || 0), 0);
    
    // ✅ Total de créditos vendidos (revenda + cliente)
    const creditsSold = resellerCredits + clientCredits; 
    
    const unitCostBase = Number(server?.avg_credit_cost_brl ?? 0);
    const estimatedProfit = totalRevenue - totalRestockCost; // Lucro Operacional Financeiro

    return {
      revenue: totalRevenue, 
      restockCost: totalRestockCost, 
      creditsSold, 
      estimatedProfit,
      cliente: { 
          consumed: clientCredits, 
          revenue: clientRevenue,
          cost: clientCredits * unitCostBase,
          profit: clientRevenue - (clientCredits * unitCostBase),
      },
      resellers: { 
          consumed: resellerCredits, 
          revenue: resellerRevenue,
          cost: resellerCredits * unitCostBase,
          profit: resellerRevenue - (resellerCredits * unitCostBase),
      }
    };
  }, [movements, server]);

  // ✅ Lógica de filtro da tabela super blindada e com sub-tipos de clientes
  const filteredMovements = useMemo(() => {
    if (!movements) return [];
    
    return movements.filter(m => {
      // 1. Filtro por Tipo (Dropdown)
      if (filterKind !== "ALL") {
        if (filterKind === "RESELLER_SALE" && m.kind !== "RESELLER_SALE") return false;
        if (filterKind === "PURCHASE" && m.kind !== "PURCHASE") return false;
        
        // Sub-filtros para Clientes
        if (filterKind.startsWith("CLIENT_RENEWAL")) {
          if (m.kind !== "CLIENT_RENEWAL") return false;
          
          const lbl = String(m.label || "").toLowerCase();
          if (filterKind === "CLIENT_RENEWAL_AUTO" && !lbl.includes("automática") && !lbl.includes("automatica")) return false;
          if (filterKind === "CLIENT_RENEWAL_MANUAL" && !lbl.includes("manual") && !lbl.includes("painel")) return false;
          if (filterKind === "CLIENT_RENEWAL_PORTAL" && !lbl.includes("portal")) return false;
        }
      }
      
      // 2. Filtro por Busca Escrita (Texto)
      if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        
        // Verifica o nome/descrição (Garantido que nunca quebra)
        const safeLabel = String(m?.label || "").toLowerCase();
        let matchDate = false;
        let matchValue = false;
        
        // Tenta formatar a data para ver se o que foi digitado bate com a data
        try {
          if (m?.happened_at) matchDate = String(fmtDate(m.happened_at)).toLowerCase().includes(term);
        } catch (e) {}
        
        // Tenta formatar o valor para ver se o que foi digitado bate com o valor
        try {
          if (m?.total_brl != null) matchValue = String(fmtMoney(Number(m.total_brl))).toLowerCase().includes(term);
        } catch (e) {}
        
        // Se nenhum dos 3 bater, esconde a linha
        if (!safeLabel.includes(term) && !matchDate && !matchValue) {
          return false;
        }
      }
      return true;
    });
  }, [movements, searchTerm, filterKind]);

  const handlePrevMonth = () => setSelectedDate(prev => { const d = new Date(prev); d.setMonth(d.getMonth() - 1); return d; });
  const handleNextMonth = () => setSelectedDate(prev => { const d = new Date(prev); d.setMonth(d.getMonth() + 1); return d; });

  const formatMonth = (date: Date) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
  const fmtMoney = (val: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
  const fmtInt = (val: number) => new Intl.NumberFormat("pt-BR").format(val);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR") + " " + new Date(d).toLocaleTimeString("pt-BR", {hour: '2-digit', minute:'2-digit'});

  if (loading && !server) return <div className="text-slate-400 dark:text-white/40 animate-pulse p-8">Carregando detalhes...</div>;
  if (!server) return <div className="text-rose-500 p-8">Servidor não encontrado.</div>;

  return (
  <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6">

      
      {/* HEADER */}
<div className="flex flex-col md:flex-row justify-between items-start gap-3 pb-1 mb-6 border-b border-slate-200 dark:border-white/10">

  <div className="w-full md:w-auto text-left">
    
    <div className="flex items-center justify-start gap-3">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
        {server.name}
      </h1>

      <span
        className={`px-2 py-0.5 rounded-lg text-xs font-bold border shadow-sm ${
          server.credits_available > 10
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
            : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
        }`}
      >
        {fmtInt(server.credits_available)} créditos disponíveis
      </span>
    </div>

    <div className="text-slate-500 dark:text-white/40 mt-1 text-xs flex items-center justify-start gap-2 font-medium">
      <Link
        href="/admin/gerenciador/servidor"
        className="hover:text-emerald-500 transition-colors"
      >
        Servidores
      </Link>

      <span className="opacity-30">/</span>

      <span className="text-slate-400">detalhes</span>
    </div>

  </div>


        {/* SELETOR DE MÊS */}
        <div className="w-full md:w-auto flex justify-end">
        <div className="flex items-center bg-slate-100 dark:bg-white/5 rounded-lg p-1 border border-slate-200 dark:border-white/10 shadow-sm w-full md:w-auto"></div>
          <button onClick={handlePrevMonth} className="p-2 hover:bg-white dark:hover:bg-white/10 rounded-md text-slate-500 dark:text-white/70 transition-all active:scale-95">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="px-6 text-sm font-bold text-slate-700 dark:text-white min-w-[160px] text-center capitalize tracking-tight">{formatMonth(selectedDate)}</span>
          <button onClick={handleNextMonth} className="p-2 hover:bg-white dark:hover:bg-white/10 rounded-md text-slate-500 dark:text-white/70 transition-all active:scale-95">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <div className="flex gap-3 w-full md:w-auto justify-end">
          <Link
  href="/admin/gerenciador/servidor"
  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10 text-sm font-bold transition-all shadow-sm inline-flex items-center justify-center"
>
  Voltar
</Link>

          
<button
  onClick={() => setIsRecargaOpen(true)}
  className="h-10 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
>

             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
             Nova Recarga
          </button>
        </div>
      </div>

      <div className="space-y-6">
        
        {/* BLOCO 1: RESUMO FINANCEIRO */}
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
            <span className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">Resumo financeiro ({formatMonth(selectedDate)})</span>
          </div>
          <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
             <StatCard title="Faturamento total" value={fmtMoney(metrics.revenue)} />
             <StatCard title="Custo recargas" value={fmtMoney(metrics.restockCost)} />
             <StatCard title="Lucro operacional" value={fmtMoney(metrics.estimatedProfit)} className={metrics.estimatedProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"} />
             <StatCard title="Créditos vendidos" value={fmtInt(metrics.creditsSold)} />
          </div>
        </div>

        {/* BLOCO 2: STATS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
           {/* Clientes */}
           <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm flex flex-col transition-colors">
              <div className="px-5 py-3 border-b border-slate-200 dark:border-white/10 flex items-center gap-2 bg-slate-50 dark:bg-white/5 font-bold text-sm text-slate-800 dark:text-white tracking-tight">
                 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                 Métricas de clientes
              </div>
              <div className="p-5 space-y-6">
                 <div className="grid grid-cols-3 gap-4 border-b border-slate-100 dark:border-white/5 pb-6">
                    <DetailStat label="Total clientes" value={fmtInt(clientStats.total)} />
                    <DetailStat label="Ativos" value={fmtInt(clientStats.active)} valueColor="text-emerald-600 dark:text-emerald-400" />
                    <DetailStat label="Consumo" value={fmtInt(metrics.cliente.consumed) + " cr"} />
                 </div>
                 <div className="grid grid-cols-3 gap-4">
                    <DetailStat label="Receita" value={fmtMoney(metrics.cliente.revenue)} />
                    <DetailStat label="Custo" value={fmtMoney(metrics.cliente.cost)} valueColor="text-rose-500 dark:text-rose-400" />
                    <DetailStat label="Lucro" value={fmtMoney(metrics.cliente.profit)} valueColor="text-emerald-600 dark:text-emerald-400" />
                 </div>
              </div>
           </div>

           {/* Revendas */}
           <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm flex flex-col transition-colors">
              <div className="px-5 py-3 border-b border-slate-200 dark:border-white/10 flex items-center gap-2 bg-slate-50 dark:bg-white/5 font-bold text-sm text-slate-800 dark:text-white tracking-tight">
                 <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                 Métricas de revendas
              </div>
<div className="p-5 space-y-6">
                 <div className="grid grid-cols-2 gap-4 border-b border-slate-100 dark:border-white/5 pb-6">
                    <DetailStat label="Total revendas" value={fmtInt(resellerCount)} />
                    <DetailStat label="Consumo" value={fmtInt(metrics.resellers.consumed) + " cr"} />
                 </div>
                 <div className="grid grid-cols-3 gap-4">
                    <DetailStat label="Receita" value={fmtMoney(metrics.resellers.revenue)} />
                    <DetailStat label="Custo" value={fmtMoney(metrics.resellers.cost)} valueColor="text-rose-500 dark:text-rose-400" />
                    <DetailStat label="Lucro" value={fmtMoney(metrics.resellers.profit)} valueColor="text-emerald-600 dark:text-emerald-400" />
                 </div>
              </div>
           </div>
        </div>

        {/* BLOCO 4: MOVIMENTAÇÕES (TABELA) */}
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
          
          {/* HEADER DA TABELA COM FILTROS */}
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50 dark:bg-white/5">
            <span className="text-sm font-bold text-slate-800 dark:text-white tracking-tight shrink-0">
              Movimentações de {formatMonth(selectedDate)}
            </span>
            
            {/* Controles de Filtro */}
            <div className="flex w-full sm:w-auto items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                <input 
                  type="text" 
                  placeholder="Buscar cliente, obs, data..." 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full h-9 pl-8 pr-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
              <select 
                value={filterKind}
                onChange={e => setFilterKind(e.target.value)}
                className="h-9 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-bold text-slate-700 dark:text-white outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              >
                <option value="ALL">Todos os Tipos</option>
                <optgroup label="Clientes">
                  <option value="CLIENT_RENEWAL">Todos de Clientes</option>
                  <option value="CLIENT_RENEWAL_AUTO">↳ Automáticas</option>
                  <option value="CLIENT_RENEWAL_PORTAL">↳ Via Portal</option>
                  <option value="CLIENT_RENEWAL_MANUAL">↳ Manuais</option>
                </optgroup>
                <optgroup label="Outros">
                  <option value="RESELLER_SALE">Vendas Revendas</option>
                  <option value="PURCHASE">Recargas Servidor</option>
                </optgroup>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-sm text-left relative border-collapse">
              <thead className="bg-slate-50 dark:bg-black/20 text-slate-500 dark:text-white/40 border-b border-slate-200 dark:border-white/10 sticky top-0 z-10 backdrop-blur-md">
                <tr>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Data</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Tipo</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider text-center">Qtd.</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Valor (brl)</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Descrição / Cliente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredMovements.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400 dark:text-white/20 italic">Nenhum registro encontrado.</td></tr>
                ) : (
                  filteredMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-slate-700 dark:text-white/80 group">
                      <td className="px-5 py-3 whitespace-nowrap font-mono text-[11px] opacity-60">{fmtDate(m.happened_at)}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shadow-sm whitespace-nowrap ${
                           m.kind === 'PURCHASE' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' : 
                           m.kind === 'RESELLER_SALE' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' :
                           'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        }`}>
                          {m.kind === 'PURCHASE' ? 'Recarga' : m.kind === 'RESELLER_SALE' ? 'Revenda' : 'Cliente'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-bold text-center group-hover:text-emerald-500 transition-colors">{m.qty_credits}</td>
                      <td className="px-5 py-3 font-mono font-bold">
                        {m.total_brl !== null ? fmtMoney(m.total_brl) : '--'}
                      </td>
                      {/* ✅ Nova formatação da Descrição */}
                      <td className="px-5 py-3 text-xs leading-relaxed max-w-[300px]">
                        {m.kind === 'CLIENT_RENEWAL' ? (
                          <span className="font-medium text-slate-800 dark:text-slate-200">{m.label}</span>
                        ) : (
                          <span className="opacity-70 italic">{m.label}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

{/* MODAL DE RECARGA */}
      {isRecargaOpen && server && (
        <RecargaServidorModal 
            server={server}
            onClose={() => setIsRecargaOpen(false)}
            onSuccess={() => {
                setIsRecargaOpen(false);
                addToast("success", "Recarga realizada", "Créditos adicionados com sucesso.");
                loadData(); 
            }}
            onError={(msg) => addToast("error", "Erro na recarga", msg)} // ✅ Adicionado
        />
      )}

      {/* RENDERIZAR TOASTS */}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>

    </div>
  );
}

// --- Componentes Auxiliares ---
function StatCard({ title, value, className = "" }: { title: string, value: string, className?: string }) {
  return (
    <div className="bg-slate-100/50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/5 flex flex-col justify-between h-24 transition-all hover:border-emerald-500/30">
      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-white/20 tracking-widest">{title}</div>
      <div className={`text-xl font-bold text-slate-800 dark:text-white tracking-tight ${className}`}>{value}</div>
    </div>
  )
}

function DetailStat({ label, value, valueColor = "text-slate-800 dark:text-white", sub }: { label: string, value: string, valueColor?: string, sub?: string }) {
    return (
        <div className="group">
            <div className="text-[11px] font-bold text-slate-400 dark:text-white/30 mb-1 tracking-tight">{label}</div>
            <div className={`text-lg font-bold tracking-tight group-hover:scale-105 transition-transform origin-left ${valueColor}`}>{value}</div>
            {sub && <div className="text-[10px] text-slate-400 dark:text-white/20 font-medium">{sub}</div>}
        </div>
    )
}