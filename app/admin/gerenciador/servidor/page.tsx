"use client";

import { useEffect, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import Link from "next/link";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import NovoServidorModal from "./novo_servidor";
import RecargaServidorModal from "./recarga_servidor";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// --- TIPAGEM ---
export type ServerRow = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  notes: string | null;
  default_currency: "BRL" | "USD" | "EUR";
  default_credit_unit_price: number | null;

  avg_credit_cost_brl?: number;
  credit_unit_cost_brl?: number;

  credits_available: number;
  whatsapp_session: string | null;
  panel_type: "WEB" | "TELEGRAM" | null;
  panel_web_url: string | null;
  panel_telegram_group: string | null;

  panel_integration: string | null;

  // ✅ extras UI (não depende da view)
  panel_integration_name?: string | null;
  panel_integration_provider?: string | null;
  panel_integration_active?: boolean | null;

  dns: string[];
  is_archived: boolean;
  created_at: string;

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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerRow | null>(null);

  const [isRecargaOpen, setIsRecargaOpen] = useState(false);
  const [rechargingServer, setRechargingServer] = useState<ServerRow | null>(null);

  // ✅ Seu hook (pelo erro) é o formato "confirm simples"
  const { confirm, ConfirmUI } = useConfirm();



  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
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

      const serversPromise = supabase
        .from(targetServerView)
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });

      const clientsPromise = supabase
        .from("vw_clients_list")
        .select("server_id, computed_status, client_is_archived")
        .eq("tenant_id", tenantId);

      const trialClientsPromise = supabase
        .from("clients")
        .select("server_id, is_archived")
        .eq("tenant_id", tenantId)
        .eq("is_trial", true)
        .eq("is_archived", false);

            const resellersPromise = supabase.from("reseller_servers").select("server_id");

      // ✅ NOVO: busca integrações para resolver nome/provider na UI
      const integrationsPromise = supabase
        .from("vw_server_integrations")
        .select("id,integration_name,provider,is_active")
        .eq("tenant_id", tenantId);

      const [serversRes, clientsRes, trialClientsRes, resellersRes, integrationsRes] =
        await Promise.all([
          serversPromise,
          clientsPromise,
          trialClientsPromise,
          resellersPromise,
          integrationsPromise,
        ]);

      if (serversRes.error) throw serversRes.error;
      if (clientsRes.error) throw clientsRes.error;
      if (trialClientsRes.error) throw trialClientsRes.error;
      if (resellersRes.error) throw resellersRes.error;

      // ✅ NOVO: valida + cria map id -> (name/provider/active)
      if (integrationsRes.error) throw integrationsRes.error;

      const rawIntegrations = (integrationsRes.data as any[]) || [];

      const integrationMap = new Map<
        string,
        { name: string | null; provider: string | null; active: boolean | null }
      >();

      rawIntegrations.forEach((i) => {
        integrationMap.set(i.id, {
          name: i.integration_name ?? null,
          provider: i.provider ?? null,
          active: i.is_active ?? null,
        });
      });

      const rawServers = (serversRes.data as any[]) || [];
      const rawClients = (clientsRes.data as ClientLight[]) || [];
      const rawTrialClients = (trialClientsRes.data as TrialClientLight[]) || [];
      const rawResellers = (resellersRes.data as ResellerLinkView[]) || [];

      const statsMap = new Map<
        string,
        { total: number; active: number; inactive: number; trial: number; resellers: number }
      >();

      rawServers.forEach((s) => {
        statsMap.set(s.id, { total: 0, active: 0, inactive: 0, trial: 0, resellers: 0 });
      });

      rawClients.forEach((c) => {
        if (!c.server_id || !statsMap.has(c.server_id)) return;
        if (c.client_is_archived) return;

        const st = statsMap.get(c.server_id)!;
        const status = (c.computed_status || "").toUpperCase();
        if (status === "TRIAL") return;

        st.total++;
        if (status === "ACTIVE") st.active++;
        else if (status === "OVERDUE") st.inactive++;
      });

      rawTrialClients.forEach((t) => {
        if (!t.server_id || !statsMap.has(t.server_id)) return;
        if (t.is_archived) return;
        statsMap.get(t.server_id)!.trial++;
      });

      rawResellers.forEach((r) => {
        if (!r.server_id || !statsMap.has(r.server_id)) return;
        statsMap.get(r.server_id)!.resellers++;
      });

      // ✅ ALTERADO: mergedServers agora resolve o nome da integração
      const mergedServers: ServerRow[] = rawServers.map((s) => {
        const integId = s.panel_integration ? String(s.panel_integration) : null;
        const integ = integId ? integrationMap.get(integId) : null;

        return {
          ...s,
          panel_integration_name: integ?.name ?? null,
          panel_integration_provider: integ?.provider ?? null,
          panel_integration_active: integ?.active ?? null,
          stats:
            statsMap.get(s.id) || { total: 0, active: 0, inactive: 0, trial: 0, resellers: 0 },
        };
      });

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
    // ✅ botão de excluir (arquivar) restaurado
    
    const ok = await confirm({
      title: server.is_archived ? "Restaurar servidor?" : "Excluir servidor?",
      subtitle: `Tem certeza que deseja ${server.is_archived ? "restaurar" : "arquivar (enviar para lixeira)"} o servidor "${server.name}"?`,
      tone: server.is_archived ? "emerald" : "rose",
      confirmText: server.is_archived ? "Restaurar" : "Arquivar",
      cancelText: "Voltar",
      details: server.is_archived
        ? ["O servidor voltará para a lista ativa."]
        : ["Ele irá para a lixeira.", "Você poderá restaurar ou excluir definitivamente depois."],
    });
    if (!ok) return;


    try {
      const { error } = await supabaseBrowser.rpc("toggle_server_archive", { p_server_id: server.id });
      if (error) throw error;

      addToast("success", "Sucesso", `Servidor ${server.is_archived ? "restaurado" : "arquivado"} com sucesso.`);
      fetchServers();
    } catch (error: any) {
      addToast("error", "Erro", error.message);
    }
  }

  async function handleHardDelete(server: ServerRow) {
    if (!server.is_archived) {
      addToast("error", "Ação bloqueada", "Só é possível excluir definitivamente um servidor arquivado.");
      return;
    }

    const ok = await confirm({
      title: "Excluir definitivamente?",
      subtitle: `Isso vai remover o servidor "${server.name}" e TODOS os registros ligados a ele.`,
      tone: "rose",
      confirmText: "Excluir definitivo",
      cancelText: "Voltar",
      details: [
        "Ação irreversível",
        "Remove compras/vendas/uso de crédito do servidor",
        "Remove quaisquer registros ainda ligados a ele",
      ],
    });
    if (!ok) return;


    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) return;

      const userRes = await supabaseBrowser.auth.getUser();
      const userId = userRes.data.user?.id;
      if (!userId) {
        addToast("error", "Erro", "Usuário não autenticado.");
        return;
      }

      const { error } = await supabaseBrowser.rpc("delete_server_hard", {
        p_tenant_id: tenantId,
        p_server_id: server.id,
        p_created_by: userId,
      });

      if (error) throw error;

      addToast("success", "Excluído", "Servidor removido definitivamente.");
      fetchServers();
    } catch (error: any) {
      console.error(error);
      addToast("error", "Erro ao excluir", error.message);
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

  const formatMoney = (amount: number | null | undefined, currency: string) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount || 0);

  const formatNumber = (num: number | undefined) => new Intl.NumberFormat("pt-BR").format(num || 0);

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">
  
  {/* Topo (Padronizado conforme Contrato) */}
  <div className="flex items-center justify-between gap-2 pb-0 mb-2 px-3 sm:px-0">
    
    {/* Título (esquerda) */}
    <div className="min-w-0 text-left">
      <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
        Servidores
      </h1>
    </div>

    {/* Ações (direita) */}
    <div className="flex items-center gap-2 justify-end shrink-0">
      
      {/* Botão Lixeira Padronizado */}
      <button
        onClick={() => setShowArchived(!showArchived)}
        className={`h-10 px-3 rounded-lg text-xs font-bold border transition-colors items-center justify-center ${
          showArchived
            ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
            : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60"
        }`}
      >
        {showArchived ? "Ocultar Lixeira" : "Ver Lixeira"}
      </button>

      <button
        onClick={handleOpenNew}
        className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
      >
        <span>+</span> Novo Servidor
      </button>
    </div>
  </div>

      <div className="space-y-6 pt-0 px-0">
        {loading && (
          <div className="mx-3 sm:mx-0 p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5">
            Carregando servidores...
          </div>
        )}

        {!loading && servers.length === 0 && (
          <div className="mx-3 sm:mx-0 p-12 text-center text-slate-400 dark:text-white/30 bg-white dark:bg-[#161b22] rounded-xl border border-dashed border-slate-200 dark:border-white/10">
            Nenhum servidor encontrado {showArchived ? "na lixeira" : ""}.
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
  {servers.map((server) => (
    <div
      key={server.id}
      // ✅ PADRÃO CONTRATO: Fundo white/dark[#161b22], borda slate-200/white-10
      className={`rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-white dark:bg-[#161b22]
        ${
          server.is_archived
            ? "border-amber-500/30 opacity-75 grayscale-[0.5]"
            : "border-slate-200 dark:border-white/10 hover:border-emerald-500/30"
        }`}
    >
      {/* ✅ HEADER DO CARD: Fundo slate-50/white-5, igual ao header da tabela de clientes */}
      <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
        <Link
          href={`/admin/gerenciador/servidor/${server.id}`}
          className="flex items-center gap-3 min-w-0 pr-3 group cursor-pointer"
        >
          {/* ✅ TÍTULO: Ajustado para text-slate-700 (era 800) para igualar ao título da lista de clientes */}
<h2
  className="text-base font-bold truncate text-slate-700 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors tracking-tight flex items-center gap-2"
  title={server.name}
>
  {server.name}

  {server.panel_integration && (
    <span
      title="Servidor com integração"
      className="inline-flex items-center justify-center text-sky-600 dark:text-sky-400"
    >
      <IconPlug />
    </span>
  )}
</h2>


{server.is_archived && (
  // Alterado: 'rounded' para 'rounded-full', ajustado px para 2.5 (padrão pílula)
  <span className="inline-flex items-center text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
    Arquivado
  </span>
)}
                  </Link>

                  <div className="flex gap-2 shrink-0">
  {/* Hard Delete (Apenas se arquivado) */}
  {server.is_archived && (
    <IconActionBtn
      title="Excluir definitivamente"
      tone="red"
      onClick={(e) => {
        e.stopPropagation();
        handleHardDelete(server);
      }}
    >
      <IconTrash />
    </IconActionBtn>
  )}

  <IconActionBtn
    title="Recarregar Créditos"
    tone="green"
    onClick={(e) => {
      e.stopPropagation();
      handleOpenRecarga(server);
    }}
  >
    <IconMoney />
  </IconActionBtn>

  <IconActionBtn
    title="Editar"
    tone="amber"
    onClick={(e) => {
      e.stopPropagation();
      handleOpenEdit(server);
    }}
  >
    <IconEdit />
  </IconActionBtn>

  {/* Alternar Arquivar/Restaurar */}
  <IconActionBtn
    title={server.is_archived ? "Restaurar" : "Arquivar"}
    tone={server.is_archived ? "green" : "red"}
    onClick={(e) => {
      e.stopPropagation();
      handleArchive(server);
    }}
  >
    {server.is_archived ? <IconRestore /> : <IconTrash />}
  </IconActionBtn>

  {/* Link de Detalhes (usando o estilo do IconActionBtn mas renderizado como Link manualmente se preferir, ou apenas o botão wrapping) */}
  {/* Para manter consistência visual, usei as classes do IconActionBtn no Link abaixo */}
  <Link
    href={`/admin/gerenciador/servidor/${server.id}`}
    onClick={(e) => e.stopPropagation()}
    title="Detalhes"
    className="p-1.5 rounded-lg border transition-all text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20"
  >
    <IconDetails />
  </Link>
</div>
                </div>

                {/* (seu corpo do card original continua igual) */}
                <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2.5 text-slate-500 dark:text-white/50">
                        <svg className="w-4 h-4 text-slate-400 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span>Total de clientes</span>
                      </div>
                      <span className="font-bold text-slate-700 dark:text-white">{formatNumber(server.stats?.total)}</span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Clientes ativos</span>
                      </div>
                      <Link href={`/admin/cliente?server_id=${server.id}&status=active`} className="font-bold text-slate-600 dark:text-white/70 hover:text-emerald-500 hover:underline cursor-pointer transition-colors">
                        {formatNumber(server.stats?.active)}
                      </Link>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-rose-500 dark:text-rose-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Clientes inativos</span>
                      </div>
                      <Link href={`/admin/cliente?server_id=${server.id}&status=inactive`} className="font-bold text-slate-600 dark:text-white/70 hover:text-rose-500 hover:underline cursor-pointer transition-colors">
                        {formatNumber(server.stats?.inactive)}
                      </Link>
                    </div>

                    <div className="border-t border-slate-100 dark:border-white/5 my-1" />

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-sky-500 dark:text-sky-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                        <span>Testes ativos</span>
                      </div>
                      <Link href={`/admin/cliente?server_id=${server.id}&status=trial`} className="font-bold text-slate-600 dark:text-white/70 hover:text-sky-500 hover:underline cursor-pointer transition-colors">
                        {formatNumber(server.stats?.trial)}
                      </Link>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-amber-500 dark:text-amber-400 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <span>Revendas</span>
                      </div>
                      <Link href={`/admin/revendedor?server_id=${server.id}`} className="font-bold text-slate-600 dark:text-white/70 hover:text-amber-500 hover:underline cursor-pointer transition-colors">
                        {formatNumber(server.stats?.resellers)}
                      </Link>
                    </div>
                  </div>

                  <div className="space-y-2 pl-0 sm:pl-4 sm:border-l border-slate-100 dark:border-white/5">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 dark:text-white/50">💲 Custo crédito</span>
                      <span className="font-bold text-slate-700 dark:text-white bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded-lg text-xs">
                        {formatMoney(server.credit_unit_cost_brl ?? server.default_credit_unit_price, "BRL")}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 dark:text-white/50">🧾 Saldo atual</span>
                      <span className={`font-bold px-2 py-0.5 rounded-lg text-xs ${
                        server.credits_available > 10
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : "text-rose-500 bg-rose-500/10"
                      }`}>
                        {formatNumber(server.credits_available)}
                      </span>
                    </div>
                    
<div className="flex justify-between items-center">
  <span className="text-slate-500 dark:text-white/50 flex items-center gap-2">
    {server.panel_integration ? (
      <span className="text-sky-600 dark:text-sky-400" title="Conectado">
        <IconPlug />
      </span>
    ) : (
      <span className="text-slate-400 dark:text-white/30" title="Sem integração">
        <IconPlugOff />
      </span>
    )}
    Integração
  </span>

  <span className="font-medium text-slate-700 dark:text-white truncate max-w-[210px] text-right">
    {server.panel_integration
      ? `${server.panel_integration_name || "Sem nome"} — ${providerLabel(server.panel_integration_provider)}`
      : "--"}
  </span>
</div>



                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 dark:text-white/50">🧩 Painel</span>
                      <span className="font-medium text-slate-700 dark:text-white">
                        {server.panel_type === "WEB" ? "Web" : server.panel_type === "TELEGRAM" ? "Telegram" : "--"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 dark:text-white/50">🌐 DNS config.</span>
                      <span className="font-bold text-slate-700 dark:text-white">{server.dns?.length || 0}</span>
                    </div>
                  </div>
                </div>

                {(server.panel_web_url || server.panel_telegram_group || server.notes) && (
                  <div className="bg-slate-50 dark:bg-black/20 p-3 border-t border-slate-200 dark:border-white/10 text-[11px] space-y-2">
                    {server.panel_web_url && (
                      <div className="flex gap-2">
                        <span className="font-bold text-slate-400 dark:text-white/30 uppercase tracking-tighter">Url:</span>
                        <a href={server.panel_web_url} target="_blank" className="text-emerald-600 dark:text-emerald-400 hover:underline truncate font-medium">
                          {server.panel_web_url}
                        </a>
                      </div>
                    )}
{server.panel_telegram_group && (
  <div className="flex gap-2">
    <span className="font-bold text-slate-400 dark:text-white/30 uppercase tracking-tighter">Telegram:</span>
    <a
      href={
        server.panel_telegram_group.startsWith("http")
          ? server.panel_telegram_group
          : `https://t.me/${server.panel_telegram_group.replace(/^@/, "")}`
      }
      target="_blank"
      rel="noreferrer"
      // Usei 'text-sky-600' (Azul) para o Telegram, mantendo o estilo de fonte do link acima
      className="text-sky-600 dark:text-sky-400 hover:underline truncate font-medium"
    >
      {server.panel_telegram_group}
    </a>
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
        
        {ConfirmUI}

        {/* ✅ OBRIGATÓRIO CONTRATO: Espaço para evitar cortes no mobile */}
        <div className="h-24 md:h-20" />

        <div className="relative z-[999999]">
          <ToastNotifications toasts={toasts} removeToast={removeToast} />
        </div>
      </div>
    </div>
  );
}

// --- COMPONENTES VISUAIS AUXILIARES (PADRÃO CONTRATO) ---

function IconActionBtn({
  children,
  title,
  tone,
  onClick,
}: {
  children: ReactNode;
  title: string;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const colors = {
    blue: "text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 dark:hover:bg-sky-500/20",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    purple: "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/20",
    red: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20",
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}
      type="button"
    >
      {children}
    </button>
  );
}
function providerLabel(p: string | null | undefined) {
  const u = String(p || "").toUpperCase();

  if (u === "NATV") return "NaTV";
  if (u === "FAST") return "Fast";

  return u || "--";
}

// Ícones Padronizados
function IconMoney() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }
function IconRestore() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" /></svg>; }
function IconDetails() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>; }

export function IconPlug() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2L10 2" />
      <path d="M13 16L13 22" />
      <path d="M6 8L6 11C6 14.3137 8.68629 17 12 17C15.3137 17 18 14.3137 18 11L18 8" />
      <path d="M9 2V8" />
      <path d="M15 2V8" />
      {/* Opcional: Um raiozinho pequeno no centro se quiser detalhe */}
      <path d="M11 10L13 12H10.5L12.5 14" strokeWidth="1.5" />
    </svg>
  );
}

export function IconPlugOff() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2L10 2" />
      <path d="M13 16L13 22" />
      <path d="M6 8v3c0 1.2.3 2.3.8 3.3" />
      <path d="M18 11V8" />
      <path d="M9 2v4" />
      <path d="M15 2v2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
