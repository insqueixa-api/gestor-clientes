"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import NovoServidorModal from "./novo_servidor";
import RecargaServidorModal from "./recarga_servidor";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";

// --- TIPAGEM ---

export type ServerRow = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  notes: string | null;
  default_currency: "BRL" | "USD" | "EUR";
  default_credit_unit_price: number | null;
  
  // Campos Financeiros (Aliases da View)
  avg_credit_cost_brl?: number; 
  credit_unit_cost_brl?: number; 

  credits_available: number;
  whatsapp_session: string | null;
  panel_type: "WEB" | "TELEGRAM" | null;
  panel_web_url: string | null;
  panel_telegram_group: string | null;
  panel_integration: string | null;
  dns: string[];
  is_archived: boolean;
  created_at: string;

  // Estatísticas (Hydration)
  stats?: {
    total: number;
    active: number;
    inactive: number;
    trial: number;
    resellers: number;
  };
};

type ClientLight = {
  server_id: string | null;
  computed_status: string;
  client_is_archived: boolean;
};

// ✅ Trials agora vêm direto da tabela clients (somente o necessário)
type TrialClientLight = {
  server_id: string | null;
  is_archived: boolean;
};


type ResellerLinkView = {
  server_id: string;
};

export default function AdminServersPage() {
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  
  // Modal & Edição
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerRow | null>(null);

  // Modal Recarga
  const [isRecargaOpen, setIsRecargaOpen] = useState(false);
  const [rechargingServer, setRechargingServer] = useState<ServerRow | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 4000);
  }

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // --- FETCH DATA ---
  async function fetchServers() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();
      if (!tenantId) return;

      const supabase = supabaseBrowser;
      const targetServerView = showArchived ? "vw_servers_archived" : "vw_servers_active";

      // 1. Busca os Servidores
      const serversPromise = supabase
        .from(targetServerView)
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });

      // 2. Busca Clientes (lista para status, etc)
      const clientsPromise = supabase
        .from("vw_clients_list")
        .select("server_id, computed_status, client_is_archived")
        .eq("tenant_id", tenantId);

      // 3. Busca Testes ativos (AGORA = clients.is_trial)
      // ⚠️ aqui lemos direto da tabela `clients` (leve e seguro)
      const trialClientsPromise = supabase
        .from("clients")
        .select("server_id, is_archived")
        .eq("tenant_id", tenantId)
        .eq("is_trial", true)
        .eq("is_archived", false);


      // 4. Busca Revendas (Direto da Tabela Crua para garantir)
      const resellersPromise = supabase
        .from("reseller_servers") 
        .select("server_id"); 

      const [serversRes, clientsRes, trialClientsRes, resellersRes] = await Promise.all([
        serversPromise,
        clientsPromise,
        trialClientsPromise,
        resellersPromise
      ]);

      // ✅ blindagem pra não “zerar” silencioso
      if (serversRes.error) throw serversRes.error;
      if (clientsRes.error) throw clientsRes.error;
      if (trialClientsRes.error) throw trialClientsRes.error;
      if (resellersRes.error) throw resellersRes.error;

      const rawServers = (serversRes.data as any[]) || [];
      const rawClients = (clientsRes.data as ClientLight[]) || [];
      const rawTrialClients = (trialClientsRes.data as TrialClientLight[]) || [];
      const rawResellers = (resellersRes.data as ResellerLinkView[]) || [];


      // --- CÁLCULO DE ESTATÍSTICAS ---
      const statsMap = new Map<string, { total: number; active: number; inactive: number; trial: number; resellers: number }>();

      rawServers.forEach(s => {
        statsMap.set(s.id, { total: 0, active: 0, inactive: 0, trial: 0, resellers: 0 });
      });

      // A. Clientes (❌ não inclui trials)
      rawClients.forEach(c => {
        if (!c.server_id || !statsMap.has(c.server_id)) return;
        const st = statsMap.get(c.server_id)!;

        if (c.client_is_archived) return;

        const status = (c.computed_status || "").toUpperCase();

        // ✅ se for TRIAL, não entra em clientes
        if (status === "TRIAL") return;

        st.total++;
        if (status === "ACTIVE") st.active++;
        else if (status === "OVERDUE") st.inactive++;
      });


        // B. Testes ativos (agora é clients.is_trial=true e não arquivado)
        rawTrialClients.forEach(t => {
          if (!t.server_id || !statsMap.has(t.server_id)) return;
          const st = statsMap.get(t.server_id)!;

          // aqui já veio filtrado is_archived=false, mas deixo blindado:
          if (t.is_archived) return;

          st.trial++;
        });


      // C. Revendas
      rawResellers.forEach(r => {
        if (!r.server_id || !statsMap.has(r.server_id)) return;
        const st = statsMap.get(r.server_id)!;
        st.resellers++;
      });

      const mergedServers: ServerRow[] = rawServers.map(s => ({
        ...s,
        stats: statsMap.get(s.id) || { total: 0, active: 0, inactive: 0, trial: 0, resellers: 0 }
      }));

      setServers(mergedServers);
      
    } catch (error: any) {
      console.error("Erro ao carregar dados:", error);
      addToast("error", "Erro ao carregar", error.message);
    } finally {
      setLoading(false);
    }
  }

  // --- ACTIONS ---
  async function handleArchive(server: ServerRow) {
    const action = server.is_archived ? 'restaurar' : 'arquivar';
    if (!confirm(`Tem certeza que deseja ${action} o servidor "${server.name}"?`)) return;
    try {
      const supabase = supabaseBrowser;
      const { error } = await supabase.rpc("toggle_server_archive", { p_server_id: server.id });
      if (error) throw error;
      addToast("success", "Sucesso", `Servidor ${server.is_archived ? 'restaurado' : 'arquivado'} com sucesso.`);
      fetchServers(); 
    } catch (error: any) {
      addToast("error", "Erro", error.message);
    }
  }

  function handleOpenNew() {
    setEditingServer(null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(server: ServerRow) {
    setEditingServer(server);
    setIsModalOpen(true);
  }

  function handleOpenRecarga(server: ServerRow) {
    setRechargingServer(server);
    setIsRecargaOpen(true);
  }

  useEffect(() => {
    fetchServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  // Helpers
  const formatMoney = (amount: number | null | undefined, currency: string) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || 'BRL',
    }).format(amount || 0);
  };
  const formatNumber = (num: number | undefined) => new Intl.NumberFormat("pt-BR").format(num || 0);

  return (
    <div className="p-5 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors space-y-6">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 pb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
            Servidores
          </h1>
          <p className="text-slate-500 dark:text-white/60 mt-0.5 text-sm">
            Cadastre e gerencie servidores IPTV (créditos, painel, WhatsApp, DNS).
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors flex items-center gap-2
              ${showArchived 
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' 
                : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}
          >
            {showArchived ? 'Ocultar arquivados' : 'Ver lixeira'}
          </button>

          <button
            onClick={handleOpenNew}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
          >
            <span>+</span> Novo servidor
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5">
          Carregando servidores...
        </div>
      )}

      {!loading && servers.length === 0 && (
        <div className="p-12 text-center text-slate-400 dark:text-white/30 bg-white dark:bg-[#161b22] rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          Nenhum servidor encontrado {showArchived ? 'na lixeira' : ''}.
        </div>
      )}

      {/* GRID DE CARDS */}
      {!loading && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {servers.map((server) => (
            <div 
              key={server.id}
              className={`rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-white dark:bg-[#161b22]
                ${server.is_archived 
                  ? 'border-amber-500/30 opacity-75 grayscale-[0.5]' 
                  : 'border-slate-200 dark:border-white/10 hover:border-emerald-500/30'
                }`}
            >
              {/* CABEÇALHO DO CARD */}
              <div className="px-5 py-3 flex justify-between items-center border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                
                {/* --- LINK CORRIGIDO PARA A PASTA 'SERVIDOR' --- */}
                <Link 
                  href={`/admin/gerenciador/servidor/${server.id}`} // <--- CORRIGIDO
                  className="flex items-center gap-3 min-w-0 pr-4 group cursor-pointer"
                >
                  <h2 className="text-base font-bold truncate text-slate-800 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors tracking-tight" title={server.name}>
                    {server.name}
                  </h2>
                  {server.is_archived && (
                    <span className="text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded uppercase">Arquivado</span>
                  )}
                </Link>

                <div className="flex gap-2 shrink-0">
                    {/* --- NOVO BOTÃO DE RECARGA (PADRÃO CLIENTE) --- */}
                    <IconActionBtn 
                      title="Recarregar Créditos" 
                      tone="green" 
                      onClick={(e) => { e.stopPropagation(); handleOpenRecarga(server); }}
                    >
                      <IconMoney />
                    </IconActionBtn>

                    {/* --- BOTÃO EDITAR (MANTIDO MAS COM PADRÃO VISUAL NOVO SE QUISER) --- */}
                    {/* Se quiser padronizar tudo, use IconActionBtn tone="amber" aqui tbm */}
                    <button onClick={() => handleOpenEdit(server)} className="p-1.5 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-all" title="Editar">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    
                    {/* ... Resto dos botões (Arquivar, Detalhes) ... */}
                    <button onClick={() => handleArchive(server)} className={`p-1.5 rounded-lg border transition-all ${server.is_archived ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100' : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100'}`} title={server.is_archived ? "Restaurar" : "Arquivar"}>
                      {server.is_archived 
                        ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      }
                    </button>

                      <Link href={`/admin/gerenciador/servidor/${server.id}`} className="p-1.5 rounded-lg border border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-500/20 transition-all" title="Detalhes">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                    </Link>
                  </div>
              </div>

              {/* CORPO DO CARD */}
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                
                {/* COLUNA ESQUERDA */}
                <div className="space-y-4"> 
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2.5 text-slate-500 dark:text-white/50">
                        <svg className="w-4 h-4 text-slate-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        <span>Total de clientes</span>
                    </div>
                    <span className="font-bold text-slate-700 dark:text-white">{formatNumber(server.stats?.total)}</span>
                  </div>
                  
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>Clientes ativos</span>
                    </div>
                    <Link href={`/admin/cliente?server_id=${server.id}&status=active`} className="font-bold text-slate-600 dark:text-white/70 hover:text-emerald-500 hover:underline cursor-pointer transition-colors">
                      {formatNumber(server.stats?.active)}
                    </Link>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2.5 text-rose-500 dark:text-rose-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>Clientes inativos</span>
                    </div>
                    <Link href={`/admin/cliente?server_id=${server.id}&status=inactive`} className="font-bold text-slate-600 dark:text-white/70 hover:text-rose-500 hover:underline cursor-pointer transition-colors">
                      {formatNumber(server.stats?.inactive)}
                    </Link>
                  </div>

                  <div className="border-t border-slate-100 dark:border-white/5 my-1"></div>

                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2.5 text-sky-500 dark:text-sky-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                        <span>Testes ativos</span>
                    </div>
                    <Link href={`/admin/cliente?server_id=${server.id}&status=trial`} className="font-bold text-slate-600 dark:text-white/70 hover:text-sky-500 hover:underline cursor-pointer transition-colors">
                      {formatNumber(server.stats?.trial)}
                    </Link>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2.5 text-amber-500 dark:text-amber-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                        <span>Revendas</span>
                    </div>
                    <Link href={`/admin/revendedor?server_id=${server.id}`} className="font-bold text-slate-600 dark:text-white/70 hover:text-amber-500 hover:underline cursor-pointer transition-colors">
                      {formatNumber(server.stats?.resellers)}
                    </Link>
                  </div>
                </div>

                {/* COLUNA DIREITA */}
                <div className="space-y-2 pl-0 sm:pl-4 sm:border-l border-slate-100 dark:border-white/5">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">💲 Custo crédito</span>
                    <span className="font-bold text-slate-700 dark:text-white bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded-lg text-xs">
                      {formatMoney(server.credit_unit_cost_brl ?? server.default_credit_unit_price, 'BRL')}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">🧾 Saldo atual</span>
                    <span className={`font-bold px-2 py-0.5 rounded-lg text-xs ${
                      server.credits_available > 10 
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' 
                        : 'text-rose-500 bg-rose-500/10'
                    }`}>
                      {formatNumber(server.credits_available)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">📱 Whatsapp</span>
                    <span className="font-medium text-slate-700 dark:text-white truncate max-w-[100px]" title={server.whatsapp_session || ''}>
                      {server.whatsapp_session || '--'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">🔗 Integração</span>
                    <span className="font-medium text-slate-700 dark:text-white">
                      {server.panel_integration || '--'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">🧩 Painel</span>
                    <span className="font-medium text-slate-700 dark:text-white">
                      {server.panel_type === 'WEB' ? 'Web' : server.panel_type === 'TELEGRAM' ? 'Telegram' : '--'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">🌐 DNS config.</span>
                    <span className="font-bold text-slate-700 dark:text-white">
                      {server.dns?.length || 0}
                    </span>
                  </div>
                </div>
              </div>

              {(server.panel_web_url || server.panel_telegram_group || server.notes) && (
                <div className="bg-slate-50 dark:bg-black/20 p-3 border-t border-slate-200 dark:border-white/10 text-[11px] space-y-2">
                  {server.panel_web_url && (
                    <div className="flex gap-2">
                      <span className="font-bold text-slate-400 dark:text-white/30 uppercase tracking-tighter">Url:</span>
                      <a href={server.panel_web_url} target="_blank" className="text-emerald-600 dark:text-emerald-400 hover:underline truncate font-medium">{server.panel_web_url}</a>
                    </div>
                  )}
                  {server.panel_telegram_group && (
                    <div className="flex gap-2">
                      <span className="font-bold text-slate-400 dark:text-white/30 uppercase tracking-tighter">Telegram:</span>
                      <span className="text-slate-600 dark:text-white/70 truncate">{server.panel_telegram_group}</span>
                    </div>
                  )}
                  {server.notes && (
                    <div className="italic text-slate-400 dark:text-white/30 pt-1 border-t border-dashed border-slate-200 dark:border-white/5 mt-2 line-clamp-1">
                      obs: {server.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <NovoServidorModal
          server={editingServer}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => { 
            setIsModalOpen(false); 
            addToast("success", "Salvo", "Dados do servidor atualizados.");
            fetchServers(); 
          }}
        />
      )}

      {/* --- RENDERIZAÇÃO CONDICIONAL DO MODAL DE RECARGA --- */}
      {isRecargaOpen && rechargingServer && (
        <RecargaServidorModal
          server={rechargingServer}
          onClose={() => setIsRecargaOpen(false)}
          onSuccess={() => {
            setIsRecargaOpen(false);
            addToast("success", "Recarga realizada", "Créditos adicionados com sucesso.");
            fetchServers();
          }}
        />
      )}

      <ToastNotifications toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
// --- COMPONENTES VISUAIS AUXILIARES (Cole isso no final do arquivo page.tsx) ---

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: React.MouseEvent) => void;
}) {
  const colors = {
    blue: "text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    purple: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/20",
    red: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
  };
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(e); }} title={title} className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}>
      {children}
    </button>
  );
}

function IconMoney() { 
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; 
}