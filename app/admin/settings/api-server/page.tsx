"use client";
import { Pencil, RefreshCcw } from "lucide-react";

import { useEffect, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, {
  ToastMessage,
} from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import NovaIntegracaoModal from "./nova_integracao_modal";
import AppIntegracaoModal from "./app_integracao_modal";

type IntegrationRow = {
  id: string;
  tenant_id: string;

  provider: string; // 'NATV'
  integration_name: string;

  owner_id: number | null;
  owner_username: string | null;
  credits_last_known: number | null;
  credits_last_sync_at: string | null;

  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
};

type AppIntegration = {
  id: string;
  tenant_id: string;
  app_name: string;
  label: string;
  login_email: string | null;
  login_password: string | null;
  api_url: string | null;
  pin?: string | null;
  is_active: boolean;
  created_at: string;
};

export default function ApiServerPage() {
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  type ActiveTab = "servidores" | "aplicativos";
  const [activeTab, setActiveTab] = useState<ActiveTab>("servidores");
  const [appList, setAppList] = useState<AppIntegration[]>([]);
  const [editingApp, setEditingApp] = useState<AppIntegration | null>(null);
  const [showTypeChooser, setShowTypeChooser] = useState(false);
  const [isModalAppOpen, setIsModalAppOpen] = useState(false);

  const { confirm, ConfirmUI } = useConfirm();
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

  async function fetchData() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();

      if (!tenantId) {
        setLoading(false);
        return;
      }

      const [srvRes, appRes] = await Promise.all([
        supabaseBrowser
          .from("vw_server_integrations")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("app_integrations")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
      ]);

      if (srvRes.error) throw srvRes.error;
      if (appRes.error) throw appRes.error;
      setIntegrations((srvRes.data as IntegrationRow[]) || []);
      setAppList((appRes.data as AppIntegration[]) || []);
    } catch (e: any) {
      addToast(
        "error",
        "Erro ao carregar",
        e?.message ?? "Falha ao carregar dados.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatNumber = (n: number | null | undefined) =>
    new Intl.NumberFormat("pt-BR").format(Number(n ?? 0));

  function providerLabel(p: string) {
    const u = String(p || "").toUpperCase();
    if (u === "NATV") return "NaTV";
    if (u === "FAST") return "Fast";
    if (u === "ELITE") return "Elite";
    return u || "--";
  }

  const [editingIntegration, setEditingIntegration] = useState<{
    id: string;
    provider: string;
    integration_name: string | null;
    is_active: boolean | null;
  } | null>(null);

  async function handleSync(row: IntegrationRow) {
    try {
      const provider = String(row.provider || "").toUpperCase();

      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;
      const authHeaders = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      // ── ELITE: fluxo via extensão ──────────────────────────────────────────
      if (provider === "ELITE") {
        addToast(
          "success",
          "Sincronizando",
          "Validando Elite e buscando saldo...",
        );

        // 1. Busca as credenciais na rota
        const credRes = await fetch("/api/integrations/elite/sync", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            integration_id: row.id,
            action: "get_credentials",
          }),
        });
        const credJson = await credRes.json().catch(() => ({}));
        if (!credRes.ok || !credJson?.ok)
          throw new Error(credJson?.error || "Falha ao buscar credenciais.");

        const { baseUrl, username, password } = credJson.credentials;

        // 2. Dispara a extensão e aguarda a resposta
        const extResult = await new Promise<{
          ok: boolean;
          saldo?: string;
          loggedUser?: string;
          error?: string;
        }>((resolve) => {
          const handler = (event: Event) => {
            window.removeEventListener(
              "UNIGESTOR_INTEGRATION_RESPONSE",
              handler,
            );
            resolve((event as CustomEvent).detail);
          };
          window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", handler);
          window.dispatchEvent(
            new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
              detail: { action: "ELITE_SYNC", baseUrl, username, password },
            }),
          );
        });

        if (!extResult?.ok)
          throw new Error(
            extResult?.error || "A extensão não retornou o saldo.",
          );

        // 3. Salva o saldo no banco
        const saveRes = await fetch("/api/integrations/elite/sync", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            integration_id: row.id,
            action: "save_sync",
            saldo: extResult.saldo,
            loggedUser: extResult.loggedUser,
          }),
        });
        const saveJson = await saveRes.json().catch(() => ({}));
        if (!saveRes.ok || !saveJson?.ok)
          throw new Error(saveJson?.error || "Falha ao salvar saldo.");

        addToast(
          "success",
          "OK",
          saveJson?.message || "Saldo Elite sincronizado.",
        );
        fetchData();
        return;
      }

      // ── NATV / FAST: fluxo direto ──────────────────────────────────────────
      const url =
        provider === "FAST"
          ? "/api/integrations/fast/sync"
          : "/api/integrations/natv/sync";

      addToast(
        "success",
        "Sincronizando",
        `Validando ${providerLabel(provider)} e buscando saldo...`,
      );

      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ integration_id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok)
        throw new Error(json?.error || "Falha ao sincronizar.");

      addToast("success", "OK", json?.message || "Sincronizado.");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Falha ao sincronizar.");
    }
  }

  async function handleDelete(row: IntegrationRow) {
    const ok = await confirm({
      title: "Remover integração?",
      subtitle: `Deseja remover a integração "${row.integration_name}" (${providerLabel(row.provider)})?`,
      tone: "rose",
      confirmText: "Remover",
      cancelText: "Voltar",
      details: [
        "A integração será removida do UniGestor.",
        "Isso não remove clientes no painel do servidor.",
      ],
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser
        .from("server_integrations")
        .delete()
        .eq("id", row.id);

      if (error) throw error;

      addToast("success", "Removido", "Integração removida com sucesso.");
      fetchData();
    } catch (e: any) {
      addToast(
        "error",
        "Erro ao remover",
        e?.message ?? "Falha ao remover integração.",
      );
    }
  }

  function appLabel(a: string) {
    const u = String(a || "").toUpperCase();
    if (u === "GERENCIAAPP") return "GerenciaApp";
    return a || "--";
  }

  async function handleAppDelete(row: AppIntegration) {
    const ok = await confirm({
      title: "Remover integração?",
      subtitle: `Deseja remover "${row.label}" (${appLabel(row.app_name)})?`,
      tone: "rose",
      confirmText: "Remover",
      cancelText: "Voltar",
      details: ["A integração será removida do UniGestor."],
    });
    if (!ok) return;
    try {
      const { error } = await supabaseBrowser
        .from("app_integrations")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", "Removido", "Integração de aplicativo removida.");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro ao remover", e?.message ?? "Falha.");
    }
  }

  async function handleAppToggle(row: AppIntegration) {
    try {
      const { error } = await supabaseBrowser
        .from("app_integrations")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
      addToast("success", row.is_active ? "Desativada" : "Ativada");
      fetchData();
    } catch (e: any) {
      addToast("error", "Erro", e?.message ?? "Falha.");
    }
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* Topo */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
              API de Integrações
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <div className="relative">
            <button
              onClick={() => setShowTypeChooser((v) => !v)}
              className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
              type="button"
            >
              <span>+</span> Nova Integração
            </button>

            {showTypeChooser && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden">
                <button
                  onClick={() => {
                    setShowTypeChooser(false);
                    setEditingIntegration(null);
                    setIsModalOpen(true);
                  }}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-foreground/90 hover:bg-muted/50 dark:hover:bg-card/5 flex items-center gap-2 border-b border-border"
                >
                  🖥️ Servidor
                </button>
                <button
                  onClick={() => {
                    setShowTypeChooser(false);
                    setEditingApp(null);
                    setIsModalAppOpen(true);
                  }}
                  className="w-full px-4 py-3 text-left text-sm font-medium text-foreground/90 hover:bg-muted/50 dark:hover:bg-card/5 flex items-center gap-2"
                >
                  📱 Aplicativo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-card border border-border rounded-xl w-fit shadow-sm">
        {(["servidores", "aplicativos"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-xs font-medium uppercase tracking-wider transition-all ${
              activeTab === tab
                ? "bg-emerald-600 text-white shadow"
                : "text-muted-foreground dark:text-muted-foreground hover:text-foreground/90 dark:hover:text-white"
            }`}
          >
            {tab === "servidores"
              ? `🖥️ Servidores (${integrations.length})`
              : `📱 Aplicativos (${appList.length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="p-12 text-center text-muted-foreground/80 dark:text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando integrações...
        </div>
      )}

      {activeTab === "servidores" && (
        <>
          {!loading && integrations.length === 0 && (
            <div className="p-12 text-center text-muted-foreground/80 dark:text-white/30 bg-card rounded-xl border border-dashed border-border">
              Nenhuma integração de servidor cadastrada.
            </div>
          )}
          {!loading && integrations.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
              {integrations.map((row) => (
                <div
                  key={row.id}
                  className="rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card border-border hover:border-emerald-500/30"
                >
                  <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-muted/50">
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <h2
                          className="text-base font-medium truncate text-foreground/90 tracking-tight"
                          title={row.integration_name}
                        >
                          {row.integration_name}
                        </h2>

                        <span className="inline-flex items-center text-[10px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2.5 py-0.5 rounded-full uppercase">
                          {providerLabel(row.provider)}
                        </span>

                        {!row.is_active && (
                          <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
                            Inativa
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <IconActionBtn
                        title="Editar"
                        tone="amber"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingIntegration({
                            id: row.id,
                            provider: row.provider,
                            integration_name: row.integration_name,
                            is_active: row.is_active,
                          });
                          setIsModalOpen(true);
                        }}
                      >
                        <IconEdit />
                      </IconActionBtn>

                      <IconActionBtn
                        title="Testar/Sync"
                        tone="blue"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSync(row);
                        }}
                      >
                        <IconSync />
                      </IconActionBtn>

                      <IconActionBtn
                        title="Remover"
                        tone="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(row);
                        }}
                      >
                        <IconTrash />
                      </IconActionBtn>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          👤 Usuário
                        </span>
                        <span className="font-medium text-foreground/90">
                          {row.owner_username ?? "--"}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          🆔 Owner ID
                        </span>
                        <span className="font-medium text-foreground/90">
                          {row.owner_id ?? "--"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 sm:border-l sm:pl-4 border-border">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          🧾 Créditos
                        </span>
                        <span
                          className={`font-medium px-2 py-0.5 rounded-lg text-xs ${
                            (row.credits_last_known ?? 0) > 10
                              ? "text-emerald-400 bg-emerald-500/10"
                              : "text-rose-500 bg-rose-500/10"
                          }`}
                        >
                          {row.credits_last_known == null
                            ? "--"
                            : formatNumber(row.credits_last_known)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          ⏱ Último sync
                        </span>
                        <span className="font-medium text-foreground/90">
                          {row.credits_last_sync_at
                            ? new Date(row.credits_last_sync_at).toLocaleString(
                                "pt-BR",
                              )
                            : "--"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isModalOpen && (
            <NovaIntegracaoModal
              integration={editingIntegration}
              onClose={() => {
                setIsModalOpen(false);
                setEditingIntegration(null);
              }}
              onSuccess={() => {
                setIsModalOpen(false);
                setEditingIntegration(null);
                addToast("success", "Salvo", "Integração salva com sucesso.");
                fetchData();
              }}
              onError={(msg) => addToast("error", "Erro", msg)}
            />
          )}
        </>
      )}

      {activeTab === "aplicativos" && (
        <>
          {!loading && appList.length === 0 && (
            <div className="p-12 text-center text-muted-foreground/80 dark:text-white/30 bg-card rounded-xl border border-dashed border-border">
              Nenhuma integração de aplicativo cadastrada.
            </div>
          )}
          {!loading && appList.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
              {appList.map((row) => (
                <div
                  key={row.id}
                  className="rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-card border-border hover:border-emerald-500/30"
                >
                  <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-border bg-muted/50">
                    <div className="flex items-center gap-2 min-w-0 pr-3">
                      <h2 className="text-base font-medium truncate text-foreground/90 tracking-tight">
                        {row.label}
                      </h2>
                      <span className="inline-flex items-center text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2.5 py-0.5 rounded-full uppercase">
                        {appLabel(row.app_name)}
                      </span>
                      {!row.is_active && (
                        <span className="inline-flex items-center text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
                          Inativa
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <IconActionBtn
                        title="Editar"
                        tone="amber"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingApp(row);
                          setIsModalAppOpen(true);
                        }}
                      >
                        <IconEdit />
                      </IconActionBtn>
                      <IconActionBtn
                        title={row.is_active ? "Desativar" : "Ativar"}
                        tone={row.is_active ? "red" : "green"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAppToggle(row);
                        }}
                      >
                        {row.is_active ? <IconPause /> : <IconPlay />}
                      </IconActionBtn>
                      <IconActionBtn
                        title="Remover"
                        tone="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAppDelete(row);
                        }}
                      >
                        <IconTrash />
                      </IconActionBtn>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 text-sm space-y-2">
                    {row.api_url && (
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-muted-foreground shrink-0">
                          🔗 URL
                        </span>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <a
                            href={row.api_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-sky-400 hover:underline truncate max-w-[180px]"
                            title={row.api_url}
                          >
                            {row.api_url.replace(/^https?:\/\//, "")}
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              navigator.clipboard.writeText(row.api_url!)
                            }
                            className="shrink-0 p-1 rounded hover:bg-black/20 dark:hover:bg-card/10 text-muted-foreground/80 hover:text-sky-500 transition-colors"
                            title="Copiar URL"
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                    {row.login_email && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          📧 Login
                        </span>
                        <span className="font-medium text-foreground/90">
                          {row.login_email}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {isModalAppOpen && (
        <AppIntegracaoModal
          integration={editingApp}
          onCloseAction={() => {
            setIsModalAppOpen(false);
            setEditingApp(null);
          }}
          onSuccessAction={() => {
            setIsModalAppOpen(false);
            setEditingApp(null);
            addToast("success", "Salvo", "Integração salva.");
            fetchData();
          }}
          onErrorAction={(msg) => addToast("error", "Erro", msg)}
        />
      )}
      {ConfirmUI}

      <div className="h-24 md:h-20" />

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

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
    blue: "text-sky-500 dark:text-sky-400 bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20 dark:hover:bg-sky-500/20",
    green:
      "text-emerald-400 bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20",
    amber:
      "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20",
    purple:
      "text-purple-400 bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20 dark:hover:bg-purple-500/20",
    red: "text-rose-400 bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-500/20 dark:hover:bg-rose-500/20",
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

function IconTrash() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function IconSync() {
  return <RefreshCcw className="w-4 h-4" />;
}
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconPause() {
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
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}
function IconPlay() {
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
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
