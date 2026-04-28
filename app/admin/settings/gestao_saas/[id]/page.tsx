"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";


type SaasTenant = {
  id: string; name: string; role: string;
  expires_at: string | null; license_active: boolean; is_trial: boolean;
  credit_balance: number; license_status: string;
  whatsapp_sessions: number;          // ✅ NOVO
  financial_control_enabled?: boolean; // ✅ NOVO - Controle Financeiro
  responsible_name: string | null; contact_email: string | null;
  phone_e164: string | null; whatsapp_username: string | null;
  parent_tenant_id: string | null;
  active_modules?: string[];           // ✅ Módulos Ativos adicionados
  custom_monthly_price?: number | null; // ✅ Preço Acordado adicionado
};

type Transaction = {
  id: string; type: string; amount: number; description: string; created_at: string;
};

const BILLING_TZ = "America/Sao_Paulo";
function fmtDate(s?: string | null) {
  if (!s) return "--";
  return new Date(s).toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}
function fmtDateTime(s?: string | null) {
  if (!s) return "--";
  return new Date(s).toLocaleString("pt-BR", { timeZone: BILLING_TZ });
}
function daysUntil(s?: string | null) {
  if (!s) return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
    TRIAL:    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400 border-sky-200 dark:border-sky-500/20",
    EXPIRED:  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/20",
    ARCHIVED: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-white/40 border-slate-200 dark:border-white/10",
    INACTIVE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
  };
  const label: Record<string, string> = {
    ACTIVE: "Ativo", TRIAL: "Trial", EXPIRED: "Expirado", ARCHIVED: "Arquivado", INACTIVE: "Inativo",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${map[status] ?? map.INACTIVE}`}>
      {label[status] ?? status}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    MASTER: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
    USER:   "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60 border-slate-200 dark:border-white/10",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border whitespace-nowrap ${map[role] ?? map.USER}`}>
      {role}
    </span>
  );
}

function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconBack() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>; }

export default function GestaoSaasDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

const [master, setMaster] = useState<(SaasTenant & { _networkCount?: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabaseBrowser
        .from("vw_saas_tenants")
        .select("*");

      const all = (data as SaasTenant[]) ?? [];
      const thisMaster = all.find(t => t.id === id) ?? null;

      // Conta filhos sem expor quem são (só o número)
      const networkCount = all.filter(t => t.parent_tenant_id === id).length;

      setMaster(thisMaster ? { ...thisMaster, _networkCount: networkCount } : null);
      setLoading(false);
    }
    load();
    void loadHistory();
  }, [id]);

  async function loadHistory() {
    setLoadingHistory(true);
    const { data } = await supabaseBrowser
      .from("saas_credit_transactions")
      .select("id, type, amount, description, created_at")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    setTransactions((data as Transaction[]) ?? []);
    setLoadingHistory(false);
  }

  const typeLabel: Record<string, string> = {
    purchase:       "Compra",
    consume:        "Consumo",
    grant:          "Recebido",
    refund:         "Reembolso",
    session_add:    "Sessão Adicionada",
    session_remove: "Sessão Removida",
    module_update:  "Perfil Atualizado",
  };
  const typeStyle: Record<string, string> = {
    purchase:       "text-sky-600 dark:text-sky-400",
    consume:        "text-rose-600 dark:text-rose-400",
    grant:          "text-emerald-600 dark:text-emerald-400",
    refund:         "text-purple-600 dark:text-purple-400",
    session_add:    "text-emerald-600 dark:text-emerald-400",
    session_remove: "text-amber-600 dark:text-amber-400",
    module_update:  "text-slate-600 dark:text-white/60",
  };

  if (loading) return (
    <div className="p-10 text-center text-slate-400 animate-pulse">Carregando...</div>
  );

  if (!master) return (
    <div className="p-10 text-center text-slate-400">Revenda não encontrada.</div>
  );

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0 pt-2 sm:pt-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.back()}
            className="h-9 w-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors shrink-0"
          >
            <IconBack />
          </button>
          <div className="min-w-0 text-left">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
              {master.name}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Rede do Revendedor
            </p>
          </div>
        </div>
        
      </div>

      {/* INFO DO MASTER */}
      <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl p-4 shadow-sm sm:mx-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-9 gap-4 text-sm items-start">
          
          <div className="flex flex-col items-center text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Status</div>
            <StatusBadge status={master.license_status} />
          </div>
          
          <div className="flex flex-col items-center text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Validade</div>
            <div className="font-medium text-slate-700 dark:text-white">{fmtDate(master.expires_at)}</div>
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Mensalidade</div>
            <div className="font-bold text-emerald-600 dark:text-emerald-400">
              {master.custom_monthly_price !== null && master.custom_monthly_price !== undefined 
                ? `R$ ${Number(master.custom_monthly_price).toFixed(2).replace(".", ",")}` 
                : <span className="text-slate-400 font-normal italic text-[10px]">Tabela Padrão</span>}
            </div>
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Créditos</div>
            <div className="font-bold text-emerald-600 dark:text-emerald-400">
              {Number(master.credit_balance).toFixed(1).replace(".0", "")}
            </div>
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Sessões WA</div>
            {master.active_modules?.length === 1 && master.active_modules.includes("financeiro") ? (
               <span className="text-xs font-bold text-slate-300 dark:text-white/20">N/A</span>
            ) : (
              <span className="text-xs font-bold text-slate-700 dark:text-white">{master.whatsapp_sessions ?? 1}</span>
            )}
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Módulos</div>
            <div className="flex flex-wrap justify-center items-center mx-auto gap-1.5">
              {master.active_modules?.includes("iptv") && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold shadow-sm bg-sky-500 border-sky-500 text-white shadow-sky-900/20" title="Módulo IPTV Ativo">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/>
                    <polyline points="17 2 12 7 7 2"/>
                  </svg>
                  IPTV
                </span>
              )}
              {master.active_modules?.includes("saas") && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold shadow-sm bg-violet-500 border-violet-500 text-white shadow-violet-900/20" title="Módulo SaaS Ativo">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                  SaaS
                </span>
              )}
              {master.active_modules?.includes("financeiro") && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold shadow-sm bg-emerald-500 border-emerald-500 text-white shadow-emerald-900/20" title="Módulo Financeiro Ativo">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  Financeiro
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Na Rede</div>
            <div className="font-bold text-slate-700 dark:text-white">
              {master._networkCount ?? 0}
            </div>
          </div>

          <div className="flex flex-col items-center text-center min-w-0">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">E-mail</div>
            <div className="text-xs text-slate-500 dark:text-white/50 truncate w-full" title={master.contact_email || ""}>
              {master.contact_email || "—"}
            </div>
          </div>

          {/* ✅ WhatsApp Restaurado */}
          <div className="flex flex-col items-center text-center min-w-0">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">WhatsApp</div>
            {master.whatsapp_username ? (
              <a href={`https://wa.me/${master.whatsapp_username.replace(/\D/g, '')}`}
                target="_blank" rel="noreferrer"
                className="text-xs text-emerald-600 dark:text-emerald-500/80 font-medium truncate hover:underline flex items-center justify-center gap-1 w-full"
                title={`@${master.whatsapp_username}`}>
                @{master.whatsapp_username}
              </a>
            ) : (
              <div className="text-xs text-slate-500 dark:text-white/50 truncate w-full">—</div>
            )}
          </div>

        </div>
      </div>
      

      {/* ✅ HISTÓRICO INLINE */}
      <div className="bg-white dark:bg-[#161b22] border-y sm:border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-hidden transition-colors sm:mx-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
            Histórico
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-500/10 text-slate-600 dark:text-white/50 text-xs font-bold">
              {transactions.length}
            </span>
          </div>
        </div>

        {loadingHistory ? (
          <div className="py-16 text-center text-slate-400 animate-pulse">Carregando histórico...</div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-slate-400 dark:text-white/30 text-sm">
            Nenhuma movimentação encontrada.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[500px]">
              <thead className="bg-slate-50 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 border-b border-slate-100 dark:border-white/5">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Valor</th>
                  <th className="px-4 py-3">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {transactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono whitespace-nowrap">
                      {fmtDateTime(tx.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${typeStyle[tx.type] ?? "text-slate-500"}`}>
                        {typeLabel[tx.type] ?? tx.type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 font-bold text-sm whitespace-nowrap ${typeStyle[tx.type] ?? "text-slate-500"}`}>
                      {Number(tx.amount) > 0 ? "+" : ""}{Number(tx.amount).toFixed(1).replace(".0", "")}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-white/50">
                      {tx.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="h-24 md:h-20" />
          </div>
        )}
      </div>
      
    </div>
  );
}