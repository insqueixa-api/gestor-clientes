"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import RecargaServidorModal from "../recarga_servidor"; 
import type { ServerRow } from "../page"; 

// --- Tipagens ---

type MovementRow = {
  id: string;
  happened_at: string;
  kind: "PURCHASE" | "DIRECT_SALE" | "RESELLER_SALE" | "CLIENT_USAGE";
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

  // Filtros
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Controle do Modal de Recarga
  const [isRecargaOpen, setIsRecargaOpen] = useState(false);

  async function loadData() {
      setLoading(true);
      
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
        setServer(sData as ServerRow);

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
            console.error("Erro movimentos:", movErr);
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
        console.error("Erro ao carregar detalhes:", error);
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
    const sales = movements.filter(m => m.kind === 'DIRECT_SALE' || m.kind === 'RESELLER_SALE');
    const purchases = movements.filter(m => m.kind === 'PURCHASE');

    const totalRevenue = sales.reduce((acc, m) => acc + (m.total_brl || 0), 0);
    const totalRestockCost = purchases.reduce((acc, m) => acc + (m.total_brl || 0), 0);
    const creditsSold = sales.reduce((acc, m) => acc + (m.qty_credits || 0), 0);
    
    const unitCostBase = server?.credit_unit_cost_brl ?? server?.default_credit_unit_price ?? 0; 
    
    const estimatedProfit = totalRevenue - (creditsSold * unitCostBase);

    const clientMoves = movements.filter(m => m.kind === 'DIRECT_SALE');
    const clientRevenue = clientMoves.reduce((acc, m) => acc + (m.total_brl || 0), 0);
    const clientCredits = clientMoves.reduce((acc, m) => acc + (m.qty_credits || 0), 0);

    const resellerMoves = movements.filter(m => m.kind === 'RESELLER_SALE');
    const resellerRevenue = resellerMoves.reduce((acc, m) => acc + (m.total_brl || 0), 0);
    const resellerCredits = resellerMoves.reduce((acc, m) => acc + (m.qty_credits || 0), 0);

    return {
      revenue: totalRevenue, 
      restockCost: totalRestockCost, 
      creditsSold, 
      estimatedProfit,
      cliente: { 
          consumed: clientCredits, 
          revenue: clientRevenue, 
          profit: clientRevenue - (clientCredits * unitCostBase) 
      },
      resellers: { 
          consumed: resellerCredits, 
          revenue: resellerRevenue, 
          profit: resellerRevenue - (resellerCredits * unitCostBase) 
      }
    };
  }, [movements, server]);

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
      <div className="flex flex-col md:flex-row justify-between items-end gap-3 pb-1 mb-6 border-b border-slate-200 dark:border-white/10">

<div className="w-full md:w-auto text-right">
  <div className="flex items-center justify-end gap-3">

            <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">{server.name}</h1>
            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border shadow-sm ${server.credits_available > 10 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'}`}>
              {fmtInt(server.credits_available)} créditos disponíveis
            </span>
          </div>
          <div className="text-slate-500 dark:text-white/40 mt-1 text-xs flex items-center justify-end gap-2 font-medium">

             <Link href="/admin/gerenciador/servidor" className="hover:text-emerald-500 transition-colors">Servidores</Link>
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
                 <div className="grid grid-cols-2 gap-4">
                    <DetailStat label="Receita" value={fmtMoney(metrics.resellers.revenue)} />
                    <DetailStat label="Lucro" value={fmtMoney(metrics.resellers.profit)} valueColor="text-emerald-600 dark:text-emerald-400" />
                 </div>
              </div>
           </div>
        </div>

        {/* BLOCO 4: MOVIMENTAÇÕES (TABELA) */}
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
            <span className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">Movimentações de {formatMonth(selectedDate)}</span>
          </div>
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-sm text-left relative border-collapse">
              <thead className="bg-slate-50 dark:bg-black/20 text-slate-500 dark:text-white/40 border-b border-slate-200 dark:border-white/10 sticky top-0 z-10 backdrop-blur-md">
                <tr>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Data</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Tipo</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider text-center">Qtd.</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Valor (brl)</th>
                  <th className="px-5 py-3 font-bold text-[11px] uppercase tracking-wider">Observações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {movements.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400 dark:text-white/20 italic">Nenhuma movimentação identificada neste período.</td></tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-slate-700 dark:text-white/80 group">
                      <td className="px-5 py-3 whitespace-nowrap font-mono text-[11px] opacity-60">{fmtDate(m.happened_at)}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shadow-sm ${
                           m.kind === 'PURCHASE' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' : 
                           m.kind === 'CLIENT_USAGE' ? 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' :
                           'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        }`}>
                          {m.kind === 'PURCHASE' ? 'Recarga' : m.kind === 'DIRECT_SALE' ? 'venda cliente' : m.kind === 'RESELLER_SALE' ? 'venda revenda' : 'consumo cliente'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-bold text-center group-hover:text-emerald-500 transition-colors">{m.qty_credits}</td>
                      <td className="px-5 py-3 font-mono font-bold">
                        {m.total_brl !== null ? fmtMoney(m.total_brl) : '--'}
                      </td>
                      <td className="px-5 py-3 text-xs opacity-50 truncate max-w-[200px] italic">{m.label}</td>
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
                loadData(); 
            }}
        />
      )}

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