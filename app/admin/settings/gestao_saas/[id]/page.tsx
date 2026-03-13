"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { createPortal } from "react-dom";

type SaasTenant = {
  id: string; name: string; role: string;
  expires_at: string | null; license_active: boolean; is_trial: boolean;
  credit_balance: number; license_status: string;
  responsible_name: string | null; contact_email: string | null;
  phone_e164: string | null; whatsapp_username: string | null;
  parent_tenant_id: string | null;
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

  const [master, setMaster] = useState<SaasTenant | null>(null);
  const [children, setChildren] = useState<SaasTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
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
      const network = all.filter(t => t.parent_tenant_id === id);
      network.sort((a, b) => a.name.localeCompare(b.name));

      setMaster(thisMaster);
      setChildren(network);
      setLoading(false);
    }
    load();
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
    purchase: "Compra", consume: "Consumo", grant: "Recebido", refund: "Reembolso",
  };
  const typeStyle: Record<string, string> = {
    purchase: "text-sky-600 dark:text-sky-400",
    consume:  "text-rose-600 dark:text-rose-400",
    grant:    "text-emerald-600 dark:text-emerald-400",
    refund:   "text-purple-600 dark:text-purple-400",
  };

  if (loading) return (
    <div className="p-10 text-center text-slate-400 animate-pulse">Carregando...</div>
  );

  if (!master) return (
    <div className="p-10 text-center text-slate-400">Revenda não encontrada.</div>
  );

  return (
    <div className="space-y-6 pt-0 pb-28 sm:pb-32 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a]">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-3 px-3 sm:px-0 pt-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.back()}
            className="h-9 w-9 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-center text-slate-500 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors shrink-0"
          >
            <IconBack />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-800 dark:text-white truncate">{master.name}</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Rede do revendedor · <span className="font-bold">{children.length}</span> associado{children.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowHistory(true); void loadHistory(); }}
          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 text-xs font-bold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors shrink-0"
        >
          <IconClock /> Histórico
        </button>
      </div>

      {/* INFO DO MASTER */}
      <div className="mx-3 sm:mx-0 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Status</div>
            <StatusBadge status={master.license_status} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Validade</div>
            <div className="font-medium text-slate-700 dark:text-white">{fmtDate(master.expires_at)}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">Créditos</div>
            <div className="font-bold text-emerald-600 dark:text-emerald-400">{master.credit_balance}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">E-mail</div>
            <div className="text-xs text-slate-500 dark:text-white/50 truncate" title={master.contact_email || ""}>
              {master.contact_email || "—"}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">WhatsApp</div>
            <div className="text-xs text-emerald-600 dark:text-emerald-500/80 font-medium truncate">
              {master.whatsapp_username ? `@${master.whatsapp_username}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* TABELA READ-ONLY */}
      <div className="mx-3 sm:mx-0 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="text-sm font-bold text-slate-800 dark:text-white">
            Rede
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold">
              {children.length}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 dark:text-white/30 font-medium uppercase tracking-wider">Somente leitura</span>
        </div>

        {children.length === 0 ? (
          <div className="py-16 text-center text-slate-400 dark:text-white/30 text-sm">
            Nenhum associado nesta rede.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[600px]">
              <thead className="bg-slate-50 dark:bg-white/5 text-xs uppercase tracking-wider text-slate-500 dark:text-white/40 font-bold border-b border-slate-100 dark:border-white/5">
                <tr>
                  <th className="px-4 py-3">Revenda / Contato</th>
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Validade</th>
                  <th className="px-4 py-3">Créditos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {children.map(t => {
                  const days = daysUntil(t.expires_at);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-700 dark:text-white truncate">{t.name}</div>
                        {t.whatsapp_username && (
                          <div className="text-xs text-emerald-600 dark:text-emerald-500/80">@{t.whatsapp_username}</div>
                        )}
                        <div className="text-[10px] text-slate-400 font-mono">{t.contact_email || "—"}</div>
                      </td>
                      <td className="px-4 py-3"><RoleBadge role={t.role} /></td>
                      <td className="px-4 py-3"><StatusBadge status={t.license_status} /></td>
                      <td className="px-4 py-3">
                        {t.expires_at ? (
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-slate-700 dark:text-white">{fmtDate(t.expires_at)}</span>
                            {days !== null && (
                              <span className={`text-[10px] font-bold ${days < 0 ? "text-rose-500" : days <= 7 ? "text-amber-500" : "text-slate-400"}`}>
                                {days < 0 ? `Expirou há ${Math.abs(days)}d` : days === 0 ? "Expira hoje" : `${days}d restantes`}
                              </span>
                            )}
                          </div>
                        ) : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-bold ${t.credit_balance > 0 ? "text-slate-700 dark:text-white" : "text-slate-400 dark:text-white/30"}`}>
                          {t.credit_balance}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ✅ Spacer do Rodapé corrigido (dentro do fluxo principal) */}
      <div className="h-24 md:h-20 shrink-0" />

      {/* MODAL HISTÓRICO */}
      {showHistory && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[80dvh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white">Histórico de Créditos</h3>
                <p className="text-xs text-slate-400">{master.name}</p>
              </div>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white"><IconX /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingHistory ? (
                <div className="py-10 text-center text-slate-400 animate-pulse">Carregando...</div>
              ) : transactions.length === 0 ? (
                <div className="py-10 text-center text-slate-400">Nenhuma transação.</div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-400 sticky top-0 border-b border-slate-100 dark:border-white/5">
                    <tr>
                      <th className="px-4 py-3">Data</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Valor</th>
                      <th className="px-4 py-3">Descrição</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {transactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                        <td className="px-4 py-3 text-xs text-slate-500 font-mono">{fmtDateTime(tx.created_at)}</td>
                        <td className="px-4 py-3"><span className={`text-xs font-bold ${typeStyle[tx.type] ?? "text-slate-500"}`}>{typeLabel[tx.type] ?? tx.type}</span></td>
                        <td className={`px-4 py-3 font-bold text-sm ${typeStyle[tx.type] ?? "text-slate-500"}`}>{tx.amount > 0 ? "+" : ""}{tx.amount}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-white/50">{tx.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end shrink-0">
              <button onClick={() => setShowHistory(false)} className="px-5 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white font-bold text-sm hover:bg-slate-200 dark:hover:bg-white/20 transition">Fechar</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}