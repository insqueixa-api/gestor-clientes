"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import { useModules } from "@/lib/modules/ModulesContext";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";

// ✅ Importa o modal de recarga (Ajuste o caminho se sua pasta cliente tiver outro nome)
import RecargaCliente from "../cliente/recarga_cliente";

// --- TIPOS ---
type LogRow = {
  id: string;
  created_at: string;
  client_id: string;
  client_name: string;
  server_username: string;
  server_name: string;
  screens: number;
  payment_method: string;
  payment_status: string;
  fulfillment_status: string;
  fulfillment_error: string | null;
  whatsapp_status: string | null;
  price_amount: number;
  price_currency: string;
  period: string;
  plan_label: string | null;
  gateway_name: string;
  mp_payment_id: string | null; // ✅ Adicionado
};

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

// --- ICONES ---
function IconLog() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>; }
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconCheckCircle() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>; }
function IconRefresh() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>; }

function AuditoriaPageContent() {
  const { hasAlunos, hasIPTVorSaaS } = useModules();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  
  // Filtros
  const [search, setSearch] = useState("");
  const [filterFulfillment, setFilterFulfillment] = useState("Todos");
  
  // Paginação
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { confirm, ConfirmUI } = useConfirm();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // ✅ NOVO: Estado para abrir o modal de renovação
  const [renewState, setRenewState] = useState<{ logId: string; clientId: string; clientName: string } | null>(null);

  function addToast(type: "success" | "error" | "warning", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  async function loadData(searchTerm = "") {
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      setTenantId(tid);

      if (tid) {
        // Verifica acesso
        const { data: tenantRow } = await supabaseBrowser
          .from("tenants")
          .select("active_modules")
          .eq("id", tid)
          .maybeSingle();

        const mods = tenantRow?.active_modules || [];
        const hasAcessoPermitido = mods.includes("iptv") || mods.includes("saas") || mods.includes("academia") || mods.includes("personal");

        if (!hasAcessoPermitido) {
          setHasAccess(false);
          setLoading(false);
          return;
        }
        setHasAccess(true);

        // 1. Busca os logs exatos de pagamento
        let query = supabaseBrowser
          .from("client_portal_payments")
          .select("id, created_at, client_id, payment_method, status, fulfillment_status, fulfillment_error, price_amount, price_currency, period, plan_label, gateway_type, mp_payment_id") // ✅ Adicionado mp_payment_id
          .eq("tenant_id", tid)
          .order("created_at", { ascending: false })
          .limit(100);

        if (searchTerm) {
          const term = searchTerm.trim();
          const { data: matchedClients } = await supabaseBrowser
            .from("clients")
            .select("id")
            .eq("tenant_id", tid)
            .or(`display_name.ilike.%${term}%,server_username.ilike.%${term}%`);
          
          if (matchedClients && matchedClients.length > 0) {
            const matchedIds = matchedClients.map(c => c.id);
            query = query.or(`client_id.in.(${matchedIds.join(',')}),gateway_type.ilike.%${term}%`);
          } else {
            query = query.ilike("gateway_type", `%${term}%`);
          }
        }

        const { data: paymentsData, error } = await query;
        if (error) throw error;

        // 2. Extrai clientes e busca dados completos (incluindo telas e ID do servidor)
        const clientIds = [...new Set((paymentsData || []).map((p: any) => p.client_id))].filter(Boolean);
        const clientsMap: Record<string, any> = {};

        if (clientIds.length > 0) {
          const { data: clientsData } = await supabaseBrowser
            .from("clients")
            .select("id, display_name, server_username, server_id, screens")
            .in("id", clientIds)
            .eq("tenant_id", tid);

          if (clientsData) {
            clientsData.forEach((c: any) => {
              clientsMap[c.id] = c;
            });
          }
        }

        // 3. Puxa a lista de servidores para mapear o ID para o Nome real
        const { data: serversData } = await supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tid);
          
        const serversMap: Record<string, string> = {};
        if (serversData) {
          serversData.forEach((s: any) => {
            serversMap[s.id] = s.name;
          });
        }

        // 4. Junta tudo na linha da tabela
        const mapped: LogRow[] = (paymentsData || []).map((r: any) => {
          const cInfo = clientsMap[r.client_id] || {};
          const serverName = serversMap[cInfo.server_id] || "—";

          return {
            id: r.id,
            created_at: r.created_at,
            client_id: r.client_id,
            client_name: cInfo.display_name || "Cliente Excluído",
            server_username: cInfo.server_username || "—",
            server_name: serverName,
            screens: cInfo.screens || 1, // Puxa as telas ou assume 1
            payment_method: r.payment_method,
            payment_status: r.status, 
            fulfillment_status: r.fulfillment_status,
            fulfillment_error: r.fulfillment_error,
            whatsapp_status: r.fulfillment_status === 'done' ? 'sent' : null, 
            price_amount: r.price_amount,
            price_currency: r.price_currency,
            period: r.period,
            plan_label: r.plan_label,
            gateway_name: r.gateway_type, 
            mp_payment_id: r.mp_payment_id || null, // ✅ Adicionado ao mapeamento
          };
        });

        setRows(mapped);
      }
    } catch (e: any) {
      console.error(e);
      addToast("error", "Erro ao carregar auditoria", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      loadData(search);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    return rows.filter((r) => {
      if (filterFulfillment !== "Todos" && r.fulfillment_status !== filterFulfillment) return false;
      
      if (q) {
        const hay = [r.client_name, r.server_username, r.server_name, r.gateway_name, r.payment_method]
          .join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, filterFulfillment]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // --- AÇÕES ---
  const handleMarcarConcluido = async (log: LogRow) => {
    if (!tenantId) return;

    const ok = await confirm({
      title: "Concluir Renovação Manual",
      subtitle: "A renovação já foi feita no Elite e o cliente já foi avisado?",
      tone: "emerald",
      icon: "✅",
      details: [
        `Cliente: ${log.client_name}`,
        `Login: ${log.server_username}`,
      ],
      confirmText: "Sim, Marcar como Concluído",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      const { error } = await supabaseBrowser
        .from("client_portal_payments")
        .update({ 
          fulfillment_status: "done",
          fulfilled_at: new Date().toISOString()
        })
        .eq("id", log.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      addToast("success", "Auditoria Atualizada", "Processo marcado como concluído com sucesso!");
      loadData(); 
    } catch (e: any) {
      addToast("error", "Erro ao atualizar", e.message);
    }
  };

  // ✅ NOVA FUNÇÃO: Cancela a renovação manual sem abrir o modal
  const handleCancelarAcao = async (log: LogRow) => {
    if (!tenantId) return;

    const ok = await confirm({
      title: "Cancelar Renovação Manual",
      subtitle: "Deseja marcar esta renovação como cancelada? Ela sairá da lista de pendências.",
      tone: "rose",
      icon: "🚫",
      details: [
        `Cliente: ${log.client_name}`,
        `Login: ${log.server_username}`,
      ],
      confirmText: "Sim, Cancelar",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      const { error } = await supabaseBrowser
        .from("client_portal_payments")
        .update({ 
          fulfillment_status: "cancelled", // Muda para cancelado
          fulfilled_at: new Date().toISOString()
        })
        .eq("id", log.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      addToast("success", "Ação Encerrada", "A renovação foi marcada como cancelada.");
      loadData(); 
    } catch (e: any) {
      addToast("error", "Erro ao cancelar", e.message);
    }
  };

  // --- HELPERS VISUAIS (Com Bloqueio de Fluxo) ---
  function getPaymentBadge(status: string) {
    if (status === "approved" || status === "PAGO") return <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-200 dark:border-emerald-500/30">Aprovado</span>;
    if (status === "pending") return <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase border border-amber-200 dark:border-amber-500/30">Pendente</span>;
    if (status === "rejected" || status === "cancelled") return <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-[10px] font-bold uppercase border border-rose-200 dark:border-rose-500/30">Recusado</span>;
    return <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 text-[10px] font-bold uppercase border border-slate-200 dark:border-white/20">{status}</span>;
  }

  function getFulfillmentBadge(status: string, paymentStatus: string) {
    // ✅ Se o status for cancelado manualmente ou o pagamento falhou
    if (status === "cancelled" || paymentStatus === "rejected" || paymentStatus === "cancelled") {
      return <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/40 text-[10px] font-bold uppercase border border-slate-200 dark:border-white/20">Cancelada</span>;
    }

    // Se o pagamento ainda está pendente, mostra o traço aguardando
    if (paymentStatus !== "approved" && paymentStatus !== "PAGO") {
      return <span className="text-slate-300 dark:text-white/20 font-bold">—</span>;
    }

    if (status === "done") return <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 text-[10px] font-bold uppercase border border-blue-200 dark:border-blue-500/30">Concluído</span>;
    if (status === "manual_pending") return <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 text-[10px] font-bold uppercase border border-purple-200 dark:border-purple-500/30 animate-pulse">Ação Manual</span>;
    if (status === "error") return <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-[10px] font-bold uppercase border border-rose-200 dark:border-rose-500/30">Erro API</span>;
    return <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 text-[10px] font-bold uppercase border border-slate-200 dark:border-white/20">Processando</span>;
  }

  function getWhatsappBadge(status: string | null, paymentStatus: string) {
    // Se o pagamento NÃO foi aprovado, a mensagem nunca é enviada. Mostra o traço.
    if (paymentStatus !== "approved" && paymentStatus !== "PAGO") {
      return <span className="text-slate-300 dark:text-white/20 font-bold">—</span>;
    }

    if (status === "sent") return <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-200 dark:border-emerald-500/30">Enviado</span>;
    if (status === "error") return <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-[10px] font-bold uppercase border border-rose-200 dark:border-rose-500/30">Erro</span>;
    return <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-400 text-[10px] font-bold uppercase border border-slate-200 dark:border-white/20">Aguardando</span>;
  }

  if (hasAccess === false) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-500">
        <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white tracking-tight mb-2">Acesso Restrito</h1>
        <p className="text-slate-500 dark:text-white/60">Você não tem autorização para acessar a Auditoria do Portal.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">
      
      {/* TOPO */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate flex items-center gap-2">
              <IconLog /> Auditoria do Portal
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-white/60 mt-1">
            Log completo de ponta a ponta dos pagamentos e renovações.
          </p>
        </div>
        <div className="flex items-center gap-2 justify-end shrink-0">
          <button onClick={() => loadData(search)} className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all">
            <IconRefresh /> <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div className="px-3 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] flex gap-2">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Buscar (Pressione Enter)"
                className="w-full h-10 px-3 pr-10 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
              />
              {search && (
                <button 
                  onClick={() => { setSearch(""); loadData(""); }} 
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500"
                  title="Limpar busca"
                >
                  <IconX />
                </button>
              )}
            </div>
            <button 
              onClick={() => loadData(search)}
              className="h-10 px-4 bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 text-slate-700 dark:text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
            >
              Buscar
            </button>
          </div>

          <select
            value={filterFulfillment}
            onChange={(e) => setFilterFulfillment(e.target.value)}
            className="w-[180px] h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
          >
            <option value="Todos">Processamento (Todos)</option>
            <option value="done">Concluídos</option>
            <option value="manual_pending">Ação Manual (Pendentes)</option>
            <option value="error">Erros na Renovação</option>
            <option value="pending">Aguardando Pagamento</option>
          </select>
        </div>
      </div>

      {/* TABELA */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-none sm:rounded-xl border border-slate-200 dark:border-white/5">
          Carregando logs de auditoria...
        </div>
      ) : (
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 bg-slate-50 dark:bg-white/5">
                  <th className="px-4 py-3">Data / Hora</th>
                  <th className="px-4 py-3">Cliente / Login / Servidor</th>
                  <th className="px-4 py-3 text-center">Plano / Telas</th>
                  <th className="px-4 py-3 text-center">Banco</th>
                  <th className="px-4 py-3 text-center">Pagamento</th>
                  <th className="px-4 py-3 text-center">Renovação</th>
                  <th className="px-4 py-3 text-center">Mensagem WA</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-200 dark:divide-white/5">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400 dark:text-white/40 italic">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                ) : (
                  visible.map((r) => {
                    const dateObj = new Date(r.created_at);
                    const isManualPending = r.fulfillment_status === "manual_pending";
                    
                    // ✅ Variáveis declaradas para corrigir o erro
                    const isRejected = r.payment_status === "rejected" || r.payment_status === "cancelled";
                    const canShowAction = isManualPending || isRejected;

                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                        
                        {/* Data e Hora */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-mono text-slate-700 dark:text-white/90">
                              {dateObj.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-white/50">
                              {dateObj.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </td>

                        {/* Cliente / Login / Servidor */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-800 dark:text-white truncate max-w-[200px]">{r.client_name}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs font-mono text-slate-500 dark:text-white/60">{r.server_username}</span>
                              <span className="text-slate-300 dark:text-white/20">•</span>
                              <span className="text-[11px] text-slate-400">{r.server_name}</span>
                            </div>
                          </div>
                        </td>

                        {/* Plano / Telas */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col gap-0.5 items-center">
                            <span className="text-xs font-bold text-slate-600 dark:text-white/80">{r.plan_label || PERIOD_LABELS[r.period] || r.period}</span>
                            <span className="text-[10px] text-slate-400">{r.screens} tela(s)</span>
                          </div>
                        </td>

                        {/* Banco */}
                        <td className="px-4 py-3 text-center">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-white/70 uppercase tracking-wider">
                            {r.gateway_name || r.payment_method}
                          </span>
                        </td>

                        {/* Pagamento (Status + Ref) */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col gap-1 items-center">
                            {getPaymentBadge(r.payment_status)}
                            {r.mp_payment_id && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(r.mp_payment_id!);
                                  addToast("success", "Copiado", "Código da transação copiado!");
                                }}
                                className="text-[9px] font-mono text-slate-400 dark:text-white/40 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                                title="Clique para copiar a referência"
                              >
                                Ref: {String(r.mp_payment_id).slice(-8)}
                              </button>
                            )}
                          </div>
                        </td>
                        {/* Renovação */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col gap-1 items-center">
                            {getFulfillmentBadge(r.fulfillment_status, r.payment_status)}
                            {r.fulfillment_error && r.payment_status === 'approved' && (
                              <span className="text-[10px] text-rose-500 leading-tight max-w-[200px] truncate" title={r.fulfillment_error}>
                                {r.fulfillment_error}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Mensagem WA */}
                        <td className="px-4 py-3 text-center">
                           {getWhatsappBadge(r.whatsapp_status, r.payment_status)}
                        </td>

                        {/* Valor */}
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-slate-700 dark:text-white">
                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: r.price_currency || "BRL" }).format(r.price_amount)}
                          </span>
                        </td>

                        {/* Ações */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {isManualPending && (
                              <>
                                {/* Botão Concluir (Roxo) */}
                                <button
                                  onClick={() => setRenewState({ logId: r.id, clientId: r.client_id, clientName: r.client_name })}
                                  className="px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 dark:text-purple-300 text-[10px] font-bold uppercase rounded-lg transition-colors border border-purple-200 dark:border-purple-500/30 shadow-sm flex items-center justify-center gap-1"
                                  title="Abrir painel de renovação"
                                >
                                  <IconCheckCircle /> Concluir
                                </button>
                                
                                {/* ✅ Botão Cancelar (Vermelho suave) */}
                                <button
                                  onClick={() => handleCancelarAcao(r)}
                                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:text-rose-400 text-[10px] font-bold uppercase rounded-lg transition-colors border border-rose-200 dark:border-rose-500/20 shadow-sm flex items-center justify-center gap-1"
                                  title="Encerrar esta pendência sem renovar"
                                >
                                  <IconX /> Cancelar
                                </button>
                              </>
                            )}
                            
                            {/* Caso de Renovação para Recusados */}
                            {isRejected && (
                               <button
                               onClick={() => setRenewState({ logId: r.id, clientId: r.client_id, clientName: r.client_name })}
                               className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-500/20 dark:hover:bg-rose-500/30 dark:text-rose-300 text-[10px] font-bold uppercase rounded-lg transition-colors border border-rose-200 dark:border-rose-500/30 shadow-sm flex items-center justify-center gap-1 mx-auto"
                               title="Tentar renovar manualmente"
                             >
                               <span className="text-sm leading-none">🔄</span> Renovar
                             </button>
                            )}

                            {!canShowAction && (
                              <span className="text-slate-300 dark:text-white/20 text-xs font-bold">—</span>
                            )}
                          </div>
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          <div className="border-t border-slate-200 dark:border-white/10 px-4 py-3 flex items-center justify-between bg-slate-50 dark:bg-white/5">
            <span className="text-xs text-slate-500 dark:text-white/50">
              Mostrando página {safePage} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} className="px-3 py-1 rounded border border-slate-200 dark:border-white/10 text-xs font-bold disabled:opacity-40 bg-white dark:bg-black/20 text-slate-600 dark:text-white/70">Anterior</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="px-3 py-1 rounded border border-slate-200 dark:border-white/10 text-xs font-bold disabled:opacity-40 bg-white dark:bg-black/20 text-slate-600 dark:text-white/70">Próxima</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Renderiza o Modal de Recarga ao clicar no Concluir */}
      {renewState && (
        <RecargaCliente
          clientId={renewState.clientId}
          clientName={renewState.clientName}
          onClose={() => setRenewState(null)}
          onSuccess={async () => {
            try {
              // 1. Atualiza o banco marcando a auditoria como concluída
              await supabaseBrowser
                .from("client_portal_payments")
                .update({ 
                  fulfillment_status: "done",
                  fulfilled_at: new Date().toISOString()
                })
                .eq("id", renewState.logId)
                .eq("tenant_id", tenantId);
              
              // 2. Fecha o modal e atualiza a lista
              addToast("success", "Auditoria Atualizada", "Renovação registrada e auditoria concluída!");
              setRenewState(null);
              loadData(); 
            } catch (e) {
              console.error(e);
            }
          }}
        />
      )}

      {ConfirmUI}
      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={(id) => setToasts(t => t.filter(x => x.id !== id))} />
      </div>
    </div>
  );
}

export default function AuditoriaPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 animate-pulse">Carregando Auditoria...</div>}>
      <AuditoriaPageContent />
    </Suspense>
  );
}