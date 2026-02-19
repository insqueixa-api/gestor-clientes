"use client";

import { useEffect, useState } from "react";
import type { ReactNode, MouseEvent } from "react";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import NovaIntegracaoModal from "./nova_integracao_modal";

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

export default function ApiServerPage() {
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

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


  async function fetchData() {
    try {
      setLoading(true);
      const tenantId = await getCurrentTenantId();
      if (!tenantId) return;

      const { data, error } = await supabaseBrowser
        .from("vw_server_integrations")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setIntegrations((data as IntegrationRow[]) || []);
    } catch (e: any) {
      console.error(e);
      addToast("error", "Erro ao carregar", e?.message ?? "Falha ao carregar dados.");
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

const url =
  provider === "FAST"
    ? "/api/integrations/fast/sync"
    : provider === "elite"
    ? "/api/integrations/elite/sync"
    : "/api/integrations/natv/sync";


    addToast(
      "success",
      "Sincronizando",
      `Validando ${providerLabel(provider)} e buscando saldo...`
    );

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integration_id: row.id }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Falha ao sincronizar.");
    }

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
        "Isso não remove clientes no painel do provedor.",
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
      addToast("error", "Erro ao remover", e?.message ?? "Falha ao remover integração.");
    }
  }

  return (
    <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">
      {/* Topo */}
      <div className="flex items-center justify-between gap-2 pb-0 mb-2">
        <div className="min-w-0 text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
            API Servidor
          </h1>

        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
        <button
          onClick={() => {
            setEditingIntegration(null);
            setIsModalOpen(true);
          }}
          className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
          type="button"
        >
          <span>+</span> Nova Integração
        </button>

        </div>
      </div>

      {loading && (
        <div className="p-12 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5">
          Carregando integrações...
        </div>
      )}

      {!loading && integrations.length === 0 && (
        <div className="p-12 text-center text-slate-400 dark:text-white/30 bg-white dark:bg-[#161b22] rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          Nenhuma integração cadastrada.
        </div>
      )}

      {!loading && integrations.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-5">
          {integrations.map((row) => (
            <div
              key={row.id}
              className="rounded-none sm:rounded-xl overflow-hidden shadow-sm border flex flex-col transition-all bg-white dark:bg-[#161b22] border-slate-200 dark:border-white/10 hover:border-emerald-500/30"
            >
              <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2
                      className="text-base font-bold truncate text-slate-700 dark:text-white tracking-tight"
                      title={row.integration_name}
                    >
                      {row.integration_name}
                    </h2>

                    <span className="inline-flex items-center text-[10px] font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 px-2.5 py-0.5 rounded-full uppercase">
                      {providerLabel(row.provider)}
                    </span>

                    {!row.is_active && (
                      <span className="inline-flex items-center text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 px-2.5 py-0.5 rounded-full uppercase">
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
                    <span className="text-slate-500 dark:text-white/50">👤 Usuário</span>
                    <span className="font-bold text-slate-700 dark:text-white">
                      {row.owner_username ?? "--"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">🆔 Owner ID</span>
                    <span className="font-bold text-slate-700 dark:text-white">
                      {row.owner_id ?? "--"}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 sm:border-l sm:pl-4 border-slate-100 dark:border-white/5">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">🧾 Créditos</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded-lg text-xs ${
                        (row.credits_last_known ?? 0) > 10
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : "text-rose-500 bg-rose-500/10"
                      }`}
                    >
                      {row.credits_last_known == null ? "--" : formatNumber(row.credits_last_known)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-white/50">⏱ Último sync</span>
                    <span className="font-medium text-slate-700 dark:text-white">
                      {row.credits_last_sync_at
                        ? new Date(row.credits_last_sync_at).toLocaleString("pt-BR")
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

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function IconSync() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
function IconEdit() {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
