"use client";
// app/admin/gerenciador/servidor/page.tsx
import {
  CreditCard,
  Pencil,
  RefreshCcw,
  Network,
  EyeOff,
  Eye,
  Trash2,
  MessageCircle,
} from "lucide-react";

import React, { useEffect, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
const NovoServidorModal = dynamic(() => import("./novo_servidor"), {
  ssr: false,
});
const RecargaServidorModal = dynamic(() => import("./recarga_servidor"), {
  ssr: false,
});
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";

// --- TIPAGEM ---
export type ServerRow = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
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

export default function AdminServersPage() {
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerRow | null>(null);

  const [isRecargaOpen, setIsRecargaOpen] = useState(false);
  const [rechargingServer, setRechargingServer] = useState<ServerRow | null>(
    null,
  );

  // ✅ Seu hook (pelo erro) é o formato "confirm simples"
  const { confirm, ConfirmUI } = useConfirm();
  const [valuesHidden, setValuesHidden] = useState(false);

  const [syncingServerId, setSyncingServerId] = useState<string | null>(null);

  // ✅ NOVO: Estados para guardar os nomes das sessões do WhatsApp
  const [waLabel1, setWaLabel1] = useState("Contato Principal");
  const [waLabel2, setWaLabel2] = useState("Contato Secundário");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWaLabel1(localStorage.getItem("wa_label_1") || "Contato Principal");
      setWaLabel2(localStorage.getItem("wa_label_2") || "Contato Secundário");
    }
  }, []);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(
    type: "success" | "error",
    title: string,
    message?: string,
  ) {
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
      if (!tenantId) {
        setLoading(false);
        return;
      }

      const supabase = supabaseBrowser;
      const targetServerView = showArchived
        ? "vw_servers_archived"
        : "vw_servers_active";

      // 1. Preparar todas as consultas (Promises)
      const serversPromise = supabase
        .from(targetServerView)
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });

      // ✅ Usando a nova view de Clientes Ativos (Traz ACTIVE e OVERDUE)
      const clientsActivePromise = supabase
        .from("vw_clients_list_active")
        .select("server_id, computed_status")
        .eq("tenant_id", tenantId);

      // ✅ Usando a nova view de Clientes Arquivados (Apenas para somar no total)
      const clientsArchivedPromise = supabase
        .from("vw_clients_list_archived")
        .select("server_id")
        .eq("tenant_id", tenantId);

      // ✅ Usando a nova view de Testes Ativos
      const trialsActivePromise = supabase
        .from("vw_trials_list_active")
        .select("server_id")
        .eq("tenant_id", tenantId);

      // ✅ PROTEGIDO: Adicionado .eq("tenant_id", tenantId)
      const resellersPromise = supabase
        .from("reseller_servers")
        .select("server_id")
        .eq("tenant_id", tenantId);

      const integrationsPromise = supabase
        .from("vw_server_integrations")
        .select("id,integration_name,provider,is_active")
        .eq("tenant_id", tenantId);

      // 2. Executar TODAS as buscas simultaneamente no banco
      const [
        serversRes,
        clientsActiveRes,
        clientsArchivedRes,
        trialsActiveRes,
        resellersRes,
        integrationsRes,
      ] = await Promise.all([
        serversPromise,
        clientsActivePromise,
        clientsArchivedPromise,
        trialsActivePromise,
        resellersPromise,
        integrationsPromise,
      ]);

      // 3. Tratar erros
      if (serversRes.error) throw serversRes.error;
      if (clientsActiveRes.error) throw clientsActiveRes.error;
      if (clientsArchivedRes.error) throw clientsArchivedRes.error;
      if (trialsActiveRes.error) throw trialsActiveRes.error;
      if (resellersRes.error) throw resellersRes.error;
      if (integrationsRes.error) throw integrationsRes.error;

      // 4. Extrair os dados brutos
      const rawServers = serversRes.data || [];
      const rawClientsActive = clientsActiveRes.data || [];
      const rawClientsArchived = clientsArchivedRes.data || [];
      const rawTrialsActive = trialsActiveRes.data || [];
      const rawResellers = resellersRes.data || [];
      const rawIntegrations = integrationsRes.data || [];

      // 5. Mapear Integrações
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

      // 6. Criar o Mapa de Estatísticas (INICIALIZAR ZERADO)
      const statsMap = new Map<
        string,
        {
          total: number;
          active: number;
          inactive: number;
          trial: number;
          resellers: number;
        }
      >();

      rawServers.forEach((s) => {
        statsMap.set(s.id, {
          total: 0,
          active: 0,
          inactive: 0,
          trial: 0,
          resellers: 0,
        });
      });

      // 7. Contabilizar Clientes Ativos / Vencidos
      rawClientsActive.forEach((c) => {
        if (!c.server_id || !statsMap.has(c.server_id)) return;
        const st = statsMap.get(c.server_id)!;
        const status = (c.computed_status || "").toUpperCase();

        st.total++;
        if (status === "ACTIVE") st.active++;
        else if (status === "OVERDUE") st.inactive++;
      });

      // 8. Contabilizar Clientes Arquivados (Somam apenas no "Total")
      rawClientsArchived.forEach((c) => {
        if (!c.server_id || !statsMap.has(c.server_id)) return;
        statsMap.get(c.server_id)!.total++;
      });

      // 9. Contabilizar Testes Ativos
      rawTrialsActive.forEach((t) => {
        if (!t.server_id || !statsMap.has(t.server_id)) return;
        statsMap.get(t.server_id)!.trial++;
      });

      // 10. Contabilizar Revendas
      rawResellers.forEach((r) => {
        if (!r.server_id || !statsMap.has(r.server_id)) return;
        statsMap.get(r.server_id)!.resellers++;
      });

      // 11. Unir tudo e montar o objeto final (mergedServers)
      const mergedServers = rawServers.map((s) => {
        return {
          ...s,
          stats: statsMap.get(s.id),
          integration_details: s.panel_integration
            ? integrationMap.get(s.panel_integration)
            : null,
        };
      });

      // ✅ Salva no state da página
      setServers(mergedServers);
    } catch {
      // addToast("error", "Erro", "Não foi possível carregar os servidores."); (Opcional se você tiver Toast aqui)
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
        : [
            "Ele irá para a lixeira.",
            "Você poderá restaurar ou excluir definitivamente depois.",
          ],
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser.rpc("toggle_server_archive", {
        p_server_id: server.id,
      });
      if (error) throw error;

      addToast(
        "success",
        "Sucesso",
        `Servidor ${server.is_archived ? "restaurado" : "arquivado"} com sucesso.`,
      );
      fetchServers();
    } catch (error: any) {
      addToast("error", "Erro", error.message);
    }
  }

  async function handleSyncIntegration(server: ServerRow) {
    if (syncingServerId === server.id) return;

    // Se não tiver ID de integração, avisamos mas não travamos o processo de "salvar" do banco
    if (!server.panel_integration) {
      addToast(
        "error",
        "Integração Ausente",
        "Vincule uma integração nas configurações do servidor.",
      );
      return;
    }

    setSyncingServerId(server.id);

    try {
      // Convertemos para UPPERCASE para evitar erro de "Elite" vs "ELITE"
      const provider = String(server.panel_integration_provider || "")
        .toUpperCase()
        .trim();

      let url = "";
      if (provider === "FAST") url = "/api/integrations/fast/sync";
      else if (provider === "NATV") url = "/api/integrations/natv/sync";
      else if (provider === "ELITE") url = "/api/integrations/elite/sync";

      // Se você mudou o nome sem querer, o sistema agora te diz QUAL nome está lá
      if (!url) {
        throw new Error(
          `O servidor "${provider}" não possui uma rota de sincronização. Verifique se escreveu 'ELITE' corretamente.`,
        );
      }

      addToast(
        "success",
        "Sincronizando...",
        "Lendo dados diretamente do painel...",
      );

      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;

      if (provider === "ELITE") {
        // 1) Busca credenciais do banco
        const credRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            action: "get_credentials",
            integration_id: server.panel_integration,
          }),
        });
        const credJson = await credRes.json().catch(() => ({}));
        if (!credRes.ok || !credJson?.ok)
          throw new Error(
            credJson?.error || "Falha ao buscar credenciais do Elite.",
          );

        // 2) Dispara a Extensão
        await new Promise((resolve, reject) => {
          const evtHandler = async (e: any) => {
            window.removeEventListener(
              "UNIGESTOR_INTEGRATION_RESPONSE",
              evtHandler,
            );
            if (e.detail?.ok) {
              // 3) Extensão leu com sucesso. Manda pro banco!
              const saveRes = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                  action: "save_sync",
                  integration_id: server.panel_integration,
                  saldo: e.detail.saldo,
                  loggedUser: e.detail.loggedUser,
                }),
              });
              const saveJson = await saveRes.json().catch(() => ({}));
              if (!saveRes.ok || !saveJson?.ok)
                reject(
                  new Error(
                    saveJson?.error || "Falha ao salvar saldo do Elite.",
                  ),
                );
              else resolve(true);
            } else {
              reject(
                new Error(
                  e.detail?.error ||
                    "A Extensão falhou ao ler o painel Elite. Verifique a aba de erros da extensão.",
                ),
              );
            }
          };
          window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", evtHandler);
          window.dispatchEvent(
            new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
              detail: {
                action: "ELITE_SYNC",
                baseUrl: credJson.credentials.baseUrl,
                username: credJson.credentials.username,
                password: credJson.credentials.password,
              },
            }),
          );
        });
      } else {
        // --- FLUXO ANTIGO (FAST/NATV via FlareSolverr) ---
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            integration_id: server.panel_integration,
            tenant_id: server.tenant_id,
          }), // O antigo
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok)
          throw new Error(
            json?.error || "Erro na resposta da API de Integração.",
          );
      }

      addToast("success", "Sincronizado", "Saldo e dados atualizados!");
      fetchServers();
    } catch (e: any) {
      // Mostra o erro amigável no Toast
      addToast("error", "Falha na Sincronização", e.message);
    } finally {
      setSyncingServerId(null);
    }
  }

  async function handleViewDns(server: ServerRow) {
    const validDns = (server.dns || []).filter((d) => d.trim() !== "");

    if (validDns.length === 0) {
      addToast(
        "error",
        "Sem DNS",
        "Nenhuma DNS válida configurada neste servidor.",
      );
      return;
    }

    const isFechar = await confirm({
      title: `DNS: ${server.name}`,
      subtitle: "Lista de DNS configuradas para este servidor.",
      tone: "sky",
      confirmText: "Fechar",
      cancelText: "Editar", // ✅ Nome do botão
      details: validDns.map((dns, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between bg-card border border-border p-2.5 rounded-lg mb-1.5 shadow-sm"
        >
          <span className="font-mono text-xs text-muted-foreground truncate mr-2 select-all">
            {dns}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(dns);
              addToast("success", "Copiado", "DNS copiada com sucesso!");
            }}
            className="p-1.5 text-muted-foreground hover:text-sky-500 hover:bg-muted rounded transition-colors shrink-0"
            title="Copiar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      )), // ✅ Sem o 'as any'!
    });
    // ✅ Se clicou em "Editar" (botão secundário retorna false)
    if (!isFechar) {
      handleOpenEdit(server); // Abre o modal do servidor direto!
    }
  }
  async function handleHardDelete(server: ServerRow) {
    if (!server.is_archived) {
      addToast(
        "error",
        "Ação bloqueada",
        "Só é possível excluir definitivamente um servidor arquivado.",
      );
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
        "Bloqueado se ainda houver cliente ativo (não arquivado) vinculado — arquive-os antes",
        "Apaga também os clientes já arquivados vinculados a este servidor, com todo o histórico deles (renovações, eventos, cupons etc.)",
        "Remove compras/vendas/uso de crédito do servidor",
      ],
    });
    if (!ok) return;

    try {
      if (!tenantId) return;

      const userRes = await supabaseBrowser.auth.getUser();
      const userId = userRes.data.user?.id;
      if (!userId) {
        addToast("error", "Erro", "Usuário não autenticado.");
        return;
      }

      // ✅ Trocado de delete_archived_server pra delete_server_hard: a
      // primeira nunca conseguia de verdade excluir um servidor com
      // QUALQUER cliente vinculado (mesmo arquivado) — clients.server_id é
      // NOT NULL e tem FK RESTRICT pra servers, então o
      // "UPDATE clients SET server_id = NULL" dela sempre falhava com erro
      // de banco (silenciosamente escondido pelo catch genérico do
      // frontend). delete_server_hard já bloqueia corretamente se houver
      // cliente ATIVO vinculado (com mensagem clara), e apaga de vez os
      // clientes já arquivados (com cascade correto nas tabelas que não
      // têm ON DELETE automático) — é a função que sempre deveria ter sido
      // ligada a este botão.
      const { error } = await supabaseBrowser.rpc("delete_server_hard", {
        p_tenant_id: tenantId,
        p_server_id: server.id,
        p_created_by: userId,
      });

      if (error) throw error;

      addToast("success", "Excluído", "Servidor removido definitivamente.");
      fetchServers();
    } catch (err: any) {
      // ✅ Antes engolia a mensagem real do erro (sempre "Não foi possível
      // remover o servidor.", genérico) — com isso, o aviso de
      // delete_archived_server sobre clientes ativos ainda vinculados
      // (RAISE EXCEPTION com a contagem) nunca chegava ao admin. Mostra a
      // mensagem real quando ela existe (RPC sempre lança texto seguro,
      // sem vazar detalhe interno de banco), com fallback genérico só se
      // não vier nenhuma.
      addToast(
        "error",
        "Erro ao excluir",
        err?.message || "Não foi possível remover o servidor.",
      );
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
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(amount || 0);

  const formatNumber = (num: number | undefined) =>
    new Intl.NumberFormat("pt-BR").format(num || 0);

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* Topo (Padronizado conforme Contrato) */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        {/* Título (esquerda) */}
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-medium text-foreground tracking-tight truncate">
              Servidores
            </h1>
            <button
              onClick={() => setValuesHidden((v) => !v)}
              title={valuesHidden ? "Exibir valores" : "Ocultar valores"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground/90 hover:border-foreground/20 transition-all text-xs font-medium shadow-sm select-none"
            >
              {valuesHidden ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              <span className="hidden sm:inline text-[11px] tracking-wide">
                {valuesHidden ? "Exibir" : "Ocultar"}
              </span>
            </button>
          </div>
        </div>

        {/* Ações (direita) */}
        <div className="flex items-center gap-2 justify-end shrink-0">
          {/* Botão Lixeira Padronizado */}
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`h-10 px-3 rounded-lg text-xs font-medium border transition-colors items-center justify-center ${
              showArchived
                ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                : "bg-muted border-border text-muted-foreground"
            }`}
          >
            {showArchived ? "Ocultar Lixeira" : "Ver Lixeira"}
          </button>

          <button
            onClick={handleOpenNew}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
          >
            <span>+</span> Novo Servidor
          </button>
        </div>
      </div>

      <div className="space-y-6 pt-0 px-0">
        {loading && (
          <div className="mx-3 sm:mx-0 p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
            Carregando servidores...
          </div>
        )}

        {!loading && servers.length === 0 && (
          <div className="mx-3 sm:mx-0 p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
            Nenhum servidor encontrado {showArchived ? "na lixeira" : ""}.
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
            {servers.map((server) => (
              <div
                key={server.id}
                // ✅ PADRÃO CONTRATO: Fundo white/dark[#161b22], borda slate-200/white-10
                className={`rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card
        ${
          server.is_archived
            ? "border-amber-500/30 opacity-75 grayscale-[0.5]"
            : "border-border hover:border-emerald-500/30"
        }`}
              >
                {/* ✅ HEADER DO CARD: Fundo slate-50/white-5, igual ao header da tabela de clientes */}
                <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-transparent">
                  <Link
                    href={`/admin/gerenciador/servidor/${server.id}`}
                    prefetch={false}
                    className="flex items-center gap-3 min-w-0 pr-3 group cursor-pointer"
                  >
                    {/* ✅ TÍTULO: Ajustado para text-foreground/90 (era 800) para igualar ao título da lista de clientes */}
                    {server.logo_url ? (
                      <img
                        src={server.logo_url}
                        alt={server.name}
                        className="w-8 h-8 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-transparent border border-border flex items-center justify-center shrink-0 text-base">
                        📡
                      </div>
                    )}
                    <h2
                      className="text-base font-medium truncate text-foreground/90 group-hover:text-emerald-500 transition-colors tracking-tight flex items-center gap-2"
                      title={server.name}
                    >
                      {server.name}

                      {server.panel_integration && (
                        <span
                          title="Servidor com integração"
                          className="inline-flex items-center justify-center text-sky-500"
                        >
                          <IconPlug />
                        </span>
                      )}
                    </h2>

                    {server.is_archived && (
                      // Alterado: 'rounded' para 'rounded-full', ajustado px para 2.5 (padrão pílula)
                      <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
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

                    {/* Botão de Sync (só se tiver integração) */}
                    {server.panel_integration && (
                      <IconActionBtn
                        title={
                          syncingServerId === server.id
                            ? "Sincronizando..."
                            : "Sincronizar saldo da integração"
                        }
                        tone={syncingServerId === server.id ? "amber" : "blue"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSyncIntegration(server);
                        }}
                      >
                        <IconSync />
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
                      prefetch={false}
                      title="Detalhes"
                      className="p-1.5 rounded-lg border transition-all text-sky-500 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20"
                    >
                      <IconDetails />
                    </Link>
                  </div>
                </div>

                {/* (seu corpo do card original continua igual) */}
                <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2.5 text-muted-foreground">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <span>Total de clientes</span>
                      </div>
                      <span
                        className={`font-normal text-foreground/90 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                      >
                        {formatNumber(server.stats?.total)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-emerald-500 font-normal">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Clientes ativos</span>
                      </div>
                      <Link
                        href={`/admin/cliente?server_id=${server.id}&status=active`}
                        prefetch={false}
                        className={`font-normal text-muted-foreground hover:text-emerald-500 hover:underline cursor-pointer transition-all duration-300 ${valuesHidden ? "blur-sm select-none pointer-events-none" : ""}`}
                      >
                        {formatNumber(server.stats?.active)}
                      </Link>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-rose-500 font-normal">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <span>Clientes inativos</span>
                      </div>
                      <Link
                        href={`/admin/cliente?server_id=${server.id}&status=inactive`}
                        prefetch={false}
                        className={`font-normal text-muted-foreground hover:text-rose-500 hover:underline cursor-pointer transition-all duration-300 ${valuesHidden ? "blur-sm select-none pointer-events-none" : ""}`}
                      >
                        {formatNumber(server.stats?.inactive)}
                      </Link>
                    </div>

                    <div className="border-t border-border my-1" />

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-amber-500 font-normal">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="9" />
                          <polyline points="12 7 12 12 15 14" />
                          <line x1="9" y1="2" x2="15" y2="2" />
                        </svg>
                        <span>Testes ativos</span>
                      </div>
                      <Link
                        href={`/admin/cliente?server_id=${server.id}&status=trial`}
                        prefetch={false}
                        className={`font-normal text-muted-foreground hover:text-sky-500 hover:underline cursor-pointer transition-all duration-300 ${valuesHidden ? "blur-sm select-none pointer-events-none" : ""}`}
                      >
                        {formatNumber(server.stats?.trial)}
                      </Link>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 text-violet-500 font-normal">
                        <Network className="w-4 h-4 text-violet-500" />
                        <span>Revendas</span>
                      </div>
                      <Link
                        href={`/admin/revendedor?server_id=${server.id}`}
                        prefetch={false}
                        className={`font-normal text-muted-foreground hover:text-violet-500 hover:underline cursor-pointer transition-all duration-300 ${valuesHidden ? "blur-sm select-none pointer-events-none" : ""}`}
                      >
                        {formatNumber(server.stats?.resellers)}
                      </Link>
                    </div>
                  </div>

                  <div className="space-y-2 pl-0 sm:pl-4 sm:border-l border-border">
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <IconCardCusto /> Custo crédito
                      </span>
                      <span
                        className={`font-normal text-foreground/90 bg-transparent border border-border px-2 py-0.5 rounded-lg text-xs transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                      >
                        {formatMoney(
                          server.credit_unit_cost_brl ??
                            server.default_credit_unit_price,
                          "BRL",
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <IconCardSaldo /> Saldo atual
                      </span>
                      <span
                        className={`font-normal px-2 py-0.5 rounded-lg text-xs transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""} ${server.credits_available > 10 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"}`}
                      >
                        {formatNumber(server.credits_available)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground flex items-center gap-2">
                        {server.panel_integration ? (
                          <span className="text-sky-500" title="Conectado">
                            <IconPlug />
                          </span>
                        ) : (
                          <span
                            className="text-muted-foreground/60"
                            title="Sem integração"
                          >
                            <IconPlugOff />
                          </span>
                        )}
                        Integração
                      </span>

                      <span className="font-normal text-foreground/90 truncate max-w-[210px] text-right">
                        {server.panel_integration
                          ? `${server.panel_integration_name || "Sem nome"} — ${providerLabel(server.panel_integration_provider)}`
                          : "--"}
                      </span>
                    </div>

                    {/* ✅ INÍCIO DO NOVO BLOCO: PORTAL (SESSÃO WHATSAPP) */}
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground flex items-center gap-2">
                        <span title="WhatsApp do Portal">
                          <IconChat />
                        </span>
                        WhatsApp Portal
                      </span>
                      <span className="font-normal text-foreground/90 truncate max-w-[210px] text-right">
                        {server.whatsapp_session === "session2"
                          ? waLabel2
                          : waLabel1}
                      </span>
                    </div>
                    {/* ✅ FIM DO NOVO BLOCO */}

                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <IconCardPainel /> Painel
                      </span>
                      <span className="font-normal text-foreground/90">
                        {server.panel_type === "WEB"
                          ? "Web"
                          : server.panel_type === "TELEGRAM"
                            ? "Telegram"
                            : "--"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <IconCardDns /> DNS config.
                      </span>
                      {(server.dns?.filter((d) => d.trim()).length || 0) > 0 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDns(server);
                          }}
                          className="font-normal px-2 py-0.5 rounded-lg text-xs text-sky-500 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                          title="Ver DNS configuradas"
                        >
                          {server.dns.filter((d) => d.trim()).length}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                        </button>
                      ) : (
                        <span className="font-medium text-foreground/90">
                          0
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {(server.panel_web_url ||
                  server.panel_telegram_group ||
                  server.notes) && (
                  <div
                    className={`bg-transparent p-3 border-t border-border text-[11px] space-y-2 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}
                  >
                    {server.panel_web_url && (
                      <div className="flex gap-2">
                        <span className="font-medium text-muted-foreground uppercase tracking-tighter">
                          Url:
                        </span>
                        <a
                          href={server.panel_web_url}
                          target="_blank"
                          className="text-emerald-500 hover:underline truncate font-medium"
                        >
                          {server.panel_web_url}
                        </a>
                      </div>
                    )}
                    {server.panel_telegram_group && (
                      <div className="flex gap-2">
                        <span className="font-medium text-muted-foreground uppercase tracking-tighter">
                          Telegram:
                        </span>
                        <a
                          href={
                            server.panel_telegram_group.startsWith("http")
                              ? server.panel_telegram_group
                              : `https://t.me/${server.panel_telegram_group.replace(/^@/, "")}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-500 hover:underline truncate font-medium"
                        >
                          {server.panel_telegram_group}
                        </a>
                      </div>
                    )}
                    {server.notes && (
                      <div className="italic text-muted-foreground/70 pt-1 border-t border-dashed border-border mt-2 line-clamp-1">
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
            onError={(msg) => addToast("error", "Erro", msg)}
          />
        )}

        {isRecargaOpen && rechargingServer && (
          <RecargaServidorModal
            server={rechargingServer}
            onClose={() => setIsRecargaOpen(false)}
            onSuccess={() => {
              setIsRecargaOpen(false);
              addToast(
                "success",
                "Recarga realizada",
                "Créditos adicionados com sucesso.",
              );
              fetchServers();
            }}
            onError={(msg) => addToast("error", "Erro na recarga", msg)} // ✅ Adicionado
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
    blue: "text-sky-500 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20",
    green:
      "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber:
      "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    purple:
      "text-purple-500 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
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
function IconMoney() {
  return <CreditCard className="w-4 h-4" />;
}
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
function IconRestore() {
  return <RefreshCcw className="w-4 h-4" />;
}
function IconDetails() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}
function IconChat() {
  return <MessageCircle className="w-4 h-4" />;
}

// Ícone LIGADO (Verde, com raio)
function IconPlug() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#38bdf8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconPlugOff() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
        stroke="#94a3b8"
      />
      <path
        d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        stroke="#94a3b8"
      />
      <line x1="4" y1="4" x2="20" y2="20" stroke="#f87171" strokeWidth="2" />
    </svg>
  );
}
function IconSync() {
  return <RefreshCcw className="w-4 h-4" />;
}
function IconCardCusto() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#34d399"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
function IconCardSaldo() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#38bdf8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}
function IconCardPainel() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#94a3b8"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
function IconCardDns() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a78bfa"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
