"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";

// ============================================================
// TIPOS
// ============================================================
type SaasTenant = {
  id: string;
  name: string;
  slug: string;
  tenant_active: boolean;
  created_at: string;
  role: "SUPERADMIN" | "MASTER" | "USER";
  expires_at: string | null;
  license_active: boolean;
  is_trial: boolean;
  credit_balance: number;
  parent_tenant_id: string | null;
  license_status: "ACTIVE" | "TRIAL" | "EXPIRED" | "ARCHIVED" | "INACTIVE";
};

type Transaction = {
  id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
  ref_tenant_id: string | null;
};

const BILLING_TZ = "America/Sao_Paulo";

function formatDate(input?: string | null) {
  if (!input) return "--";
  return new Date(input).toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}

function formatDateTime(input?: string | null) {
  if (!input) return "--";
  return new Date(input).toLocaleString("pt-BR", { timeZone: BILLING_TZ });
}

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ============================================================
// BADGES
// ============================================================
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    TRIAL:    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
    EXPIRED:  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    ARCHIVED: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-white/40",
    INACTIVE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  };
  const label: Record<string, string> = {
    ACTIVE: "Ativo", TRIAL: "Trial", EXPIRED: "Expirado", ARCHIVED: "Arquivado", INACTIVE: "Inativo",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${map[status] ?? map.INACTIVE}`}>
      {label[status] ?? status}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    SUPERADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
    MASTER:     "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    USER:       "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${map[role] ?? map.USER}`}>
      {role}
    </span>
  );
}

// ============================================================
// PÁGINA PRINCIPAL
// ============================================================
export default function GestaoSaasPage() {
  const [tenants, setTenants] = useState<SaasTenant[]>([]);
  const [myRole, setMyRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Modais
  const [showNew, setShowNew] = useState(false);
  const [renewTarget, setRenewTarget] = useState<SaasTenant | null>(null);
  const [creditsTarget, setCreditsTarget] = useState<SaasTenant | null>(null);
  const [historyTarget, setHistoryTarget] = useState<SaasTenant | null>(null);

  const addToast = (type: "success" | "error", title: string, msg?: string) => {
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    setToasts(p => [...p, { id, type, title, message: msg, durationMs: 5000 }]);
  };
  const removeToast = (id: number) => setToasts(p => p.filter(t => t.id !== id));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [roleRes, tenantsRes] = await Promise.all([
        supabaseBrowser.rpc("saas_my_role"),
        supabaseBrowser.from("vw_saas_tenants").select("*").order("created_at", { ascending: false }),
      ]);
      setMyRole(roleRes.data ?? "");
      setTenants((tenantsRes.data as SaasTenant[]) ?? []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar", e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleArchive = async (t: SaasTenant) => {
    if (!confirm(`Arquivar "${t.name}"? O acesso será suspenso.`)) return;
    const { error } = await supabaseBrowser.rpc("saas_archive_tenant", { p_tenant_id: t.id });
    if (error) addToast("error", "Erro", error.message);
    else { addToast("success", "Arquivado", `${t.name} foi arquivado.`); loadData(); }
  };

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.role?.toLowerCase().includes(search.toLowerCase())
  );

  // Stats
  const stats = {
    total:   tenants.filter(t => t.role !== "SUPERADMIN").length,
    active:  tenants.filter(t => t.license_status === "ACTIVE" && t.role !== "SUPERADMIN").length,
    trial:   tenants.filter(t => t.license_status === "TRIAL").length,
    expired: tenants.filter(t => t.license_status === "EXPIRED").length,
  };

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-0 md:px-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-800 dark:text-white">
            Gestão SaaS
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Rede de tenants · {myRole}</p>
        </div>
        {(myRole === "SUPERADMIN" || myRole === "MASTER") && (
          <button
            onClick={() => setShowNew(true)}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
          >
            <span className="text-base leading-none mb-0.5">+</span>
            Novo Tenant
          </button>
        )}
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 sm:px-0 md:px-4">
        {[
          { label: "Total",    value: stats.total,   color: "text-slate-700 dark:text-white",        bg: "bg-white dark:bg-[#161b22]" },
          { label: "Ativos",   value: stats.active,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-white dark:bg-[#161b22]" },
          { label: "Trial",    value: stats.trial,   color: "text-sky-600 dark:text-sky-400",         bg: "bg-white dark:bg-[#161b22]" },
          { label: "Expirados",value: stats.expired, color: "text-rose-600 dark:text-rose-400",       bg: "bg-white dark:bg-[#161b22]" },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{s.label}</div>
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* BUSCA */}
      <div className="px-3 sm:px-0 md:px-4">
        <div className="relative">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar tenant, role..."
            className="w-full h-10 px-3 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
        </div>
      </div>

      {/* TABELA */}
      <div className="px-3 sm:px-0 md:px-4">
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-slate-400 animate-pulse">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-slate-400">Nenhum tenant encontrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100 dark:border-white/5">
                  <tr>
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Validade</th>
                    <th className="px-4 py-3">Créditos</th>
                    <th className="px-4 py-3">Criado em</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {filtered.map(t => {
                    const days = daysUntil(t.expires_at);
                    const isSelf = t.role === "SUPERADMIN";
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">

                        {/* TENANT */}
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-800 dark:text-white">{t.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{t.slug}</div>
                        </td>

                        {/* ROLE */}
                        <td className="px-4 py-3">
                          <RoleBadge role={t.role} />
                        </td>

                        {/* STATUS */}
                        <td className="px-4 py-3">
                          <StatusBadge status={t.license_status} />
                        </td>

                        {/* VALIDADE */}
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <span className="text-xs text-purple-500 font-bold">∞ Permanente</span>
                          ) : t.expires_at ? (
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-slate-700 dark:text-white">{formatDate(t.expires_at)}</span>
                              {days !== null && (
                                <span className={`text-[10px] font-bold ${days < 0 ? "text-rose-500" : days <= 7 ? "text-amber-500" : "text-slate-400"}`}>
                                  {days < 0 ? `Expirou há ${Math.abs(days)}d` : days === 0 ? "Expira hoje" : `${days}d restantes`}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">--</span>
                          )}
                        </td>

                        {/* CRÉDITOS */}
                        <td className="px-4 py-3">
                          {isSelf ? (
                            <span className="text-xs text-purple-500 font-bold">∞</span>
                          ) : (
                            <span className={`text-sm font-bold ${t.credit_balance > 0 ? "text-slate-700 dark:text-white" : "text-slate-400"}`}>
                              {t.credit_balance}
                            </span>
                          )}
                        </td>

                        {/* CRIADO EM */}
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDate(t.created_at)}
                        </td>

                        {/* AÇÕES */}
                        <td className="px-4 py-3">
                          {!isSelf && (
                            <div className="flex items-center gap-1.5 justify-end flex-wrap">
                              <button
                                onClick={() => setRenewTarget(t)}
                                className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-[10px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition"
                              >
                                Renovar
                              </button>
                              <button
                                onClick={() => setCreditsTarget(t)}
                                className="px-2.5 py-1 rounded bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 text-[10px] font-bold hover:bg-sky-100 dark:hover:bg-sky-500/20 transition"
                              >
                                Créditos
                              </button>
                              <button
                                onClick={() => setHistoryTarget(t)}
                                className="px-2.5 py-1 rounded bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60 text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-white/15 transition"
                              >
                                Histórico
                              </button>
                              {t.license_status !== "ARCHIVED" && (
                                <button
                                  onClick={() => handleArchive(t)}
                                  className="px-2.5 py-1 rounded bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400 text-[10px] font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition"
                                >
                                  Arquivar
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* MODAIS */}
      {showNew && (
        <NewTenantModal
          myRole={myRole}
          onClose={() => setShowNew(false)}
          onSuccess={() => { setShowNew(false); loadData(); addToast("success", "Tenant criado!", "Novo tenant provisionado com sucesso."); }}
          onError={(m) => addToast("error", "Erro", m)}
        />
      )}

      {renewTarget && (
        <RenewModal
          tenant={renewTarget}
          myRole={myRole}
          onClose={() => setRenewTarget(null)}
          onSuccess={() => { setRenewTarget(null); loadData(); addToast("success", "Renovado!", "Licença renovada com sucesso."); }}
          onError={(m) => addToast("error", "Erro", m)}
        />
      )}

      {creditsTarget && (
        <CreditsModal
          tenant={creditsTarget}
          myRole={myRole}
          onClose={() => setCreditsTarget(null)}
          onSuccess={() => { setCreditsTarget(null); loadData(); addToast("success", "Créditos enviados!", "Saldo atualizado."); }}
          onError={(m) => addToast("error", "Erro", m)}
        />
      )}

      {historyTarget && (
        <HistoryModal
          tenant={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}

// ============================================================
// MODAL: NOVO TENANT
// ============================================================
function NewTenantModal({ myRole, onClose, onSuccess, onError }: {
  myRole: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "MASTER" as "MASTER" | "USER",
    trial_days: 7,
    credits_initial: 0,
  });

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.password) {
      onError("Preencha todos os campos obrigatórios.");
      return;
    }
    if (form.password.length < 8) {
      onError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/saas/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.hint || data.error || "Falha ao criar tenant.");
      onSuccess();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <h3 className="font-bold text-lg text-slate-800 dark:text-white">Novo Tenant</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Nome */}
          <div>
            <FieldLabel>Nome do Tenant *</FieldLabel>
            <FieldInput
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: João Revendas"
              autoFocus
            />
          </div>

          {/* Email + Senha */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>E-mail *</FieldLabel>
              <FieldInput
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="joao@email.com"
              />
            </div>
            <div>
              <FieldLabel>Senha *</FieldLabel>
              <FieldInput
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Mín. 8 caracteres"
              />
            </div>
          </div>

          {/* Role */}
          <div>
            <FieldLabel>Papel (Role)</FieldLabel>
            <div className="flex gap-2 mt-1">
              {(myRole === "SUPERADMIN" ? ["MASTER", "USER"] : ["MASTER", "USER"]).map(r => (
                <button
                  key={r}
                  onClick={() => setForm({ ...form, role: r as any })}
                  className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-all ${form.role === r
                    ? r === "MASTER"
                      ? "bg-amber-500 border-amber-500 text-white"
                      : "bg-slate-700 border-slate-700 text-white"
                    : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              {form.role === "MASTER" ? "Pode criar outros tenants e gerenciar sua própria rede." : "Acesso limitado ao painel, sem gestão de rede."}
            </p>
          </div>

          {/* Trial + Créditos */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Período Trial (dias)</FieldLabel>
              <FieldInput
                type="number"
                min={0}
                value={form.trial_days}
                onChange={e => setForm({ ...form, trial_days: Number(e.target.value) })}
              />
              <p className="text-[10px] text-slate-400 mt-1">0 = sem trial, acesso imediato</p>
            </div>
            <div>
              <FieldLabel>Créditos Iniciais</FieldLabel>
              <FieldInput
                type="number"
                min={0}
                value={form.credits_initial}
                onChange={e => setForm({ ...form, credits_initial: Number(e.target.value) })}
              />
              <p className="text-[10px] text-slate-400 mt-1">Saldo inicial de créditos</p>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-lg p-3 text-xs text-slate-500 space-y-1">
            <div className="font-bold text-slate-600 dark:text-white/60 text-[10px] uppercase mb-2">Resumo</div>
            <div>👤 Usuário: <strong>{form.email || "--"}</strong></div>
            <div>🏢 Tenant: <strong>{form.name || "--"}</strong></div>
            <div>🎭 Role: <strong>{form.role}</strong></div>
            <div>⏱️ Trial: <strong>{form.trial_days > 0 ? `${form.trial_days} dias` : "Sem trial"}</strong></div>
            <div>💳 Créditos: <strong>{form.credits_initial}</strong></div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
          <button onClick={onClose} className="text-slate-500 font-bold text-xs uppercase hover:text-slate-800 dark:hover:text-white">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-xl text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50 shadow-lg shadow-emerald-900/20"
          >
            {saving ? "Criando..." : "Criar Tenant"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: RENOVAR LICENÇA
// ============================================================
function RenewModal({ tenant, myRole, onClose, onSuccess, onError }: {
  tenant: SaasTenant;
  myRole: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(30);

  const creditsNeeded = Math.ceil(days / 30);
  const isSuperadmin = myRole === "SUPERADMIN";

  const handleRenew = async () => {
    setSaving(true);
    const { error } = await supabaseBrowser.rpc("saas_renew_license", {
      p_tenant_id: tenant.id,
      p_days: days,
      p_description: `Renovação de ${days} dias`,
    });
    setSaving(false);
    if (error) onError(error.message);
    else onSuccess();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <h3 className="font-bold text-base text-slate-800 dark:text-white">Renovar Licença</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-center">
            <div className="font-bold text-slate-800 dark:text-white">{tenant.name}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Vence em: {tenant.expires_at ? `${formatDate(tenant.expires_at)}` : "Sem data"}
            </div>
          </div>

          {/* Quick select */}
          <div>
            <FieldLabel>Período de renovação</FieldLabel>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {[7, 15, 30, 60, 90, 180, 365].map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${days === d ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500"}`}
                >
                  {d}d
                </button>
              ))}
              <div className="col-span-1">
                <FieldInput
                  type="number"
                  min={1}
                  value={days}
                  onChange={e => setDays(Number(e.target.value))}
                  className="text-center"
                />
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg p-3 text-sm text-center">
            {isSuperadmin ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-bold">Renovação gratuita (Superadmin)</span>
            ) : (
              <>
                <div className="text-slate-500 text-xs mb-1">Créditos necessários</div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{creditsNeeded}</div>
                <div className="text-xs text-slate-400">crédito{creditsNeeded > 1 ? "s" : ""} para {days} dias</div>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
          <button onClick={onClose} className="text-slate-500 font-bold text-xs uppercase">Cancelar</button>
          <button
            onClick={handleRenew}
            disabled={saving}
            className="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-xl text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50"
          >
            {saving ? "Renovando..." : `Renovar ${days} dias`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: TRANSFERIR CRÉDITOS
// ============================================================
function CreditsModal({ tenant, myRole, onClose, onSuccess, onError }: {
  tenant: SaasTenant;
  myRole: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(10);
  const [description, setDescription] = useState("Recarga de créditos");

  const handleTransfer = async () => {
    if (amount <= 0) { onError("Valor deve ser maior que zero."); return; }
    setSaving(true);
    const { error } = await supabaseBrowser.rpc("saas_transfer_credits", {
      p_to_tenant_id: tenant.id,
      p_amount: amount,
      p_description: description,
    });
    setSaving(false);
    if (error) onError(error.message);
    else onSuccess();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-sm bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <h3 className="font-bold text-base text-slate-800 dark:text-white">Enviar Créditos</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-center">
            <div className="font-bold text-slate-800 dark:text-white">{tenant.name}</div>
            <div className="text-xs text-slate-400 mt-0.5">Saldo atual: <strong>{tenant.credit_balance}</strong> créditos</div>
          </div>

          <div>
            <FieldLabel>Quantidade de créditos</FieldLabel>
            <div className="grid grid-cols-4 gap-2 mt-1 mb-2">
              {[5, 10, 30, 50].map(v => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${amount === v ? "bg-sky-500 border-sky-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500"}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <FieldInput
              type="number"
              min={1}
              value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              className="text-center"
            />
          </div>

          <div>
            <FieldLabel>Descrição (opcional)</FieldLabel>
            <FieldInput
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Recarga mensal"
            />
          </div>

          <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-400">Saldo após envio</div>
            <div className="text-2xl font-bold text-sky-600 dark:text-sky-400">{tenant.credit_balance + amount}</div>
            <div className="text-xs text-slate-400">créditos</div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
          <button onClick={onClose} className="text-slate-500 font-bold text-xs uppercase">Cancelar</button>
          <button
            onClick={handleTransfer}
            disabled={saving}
            className="px-6 py-2.5 bg-sky-600 text-white font-bold rounded-xl text-xs uppercase hover:bg-sky-500 transition disabled:opacity-50"
          >
            {saving ? "Enviando..." : `Enviar ${amount} créditos`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: HISTÓRICO DE TRANSAÇÕES
// ============================================================
function HistoryModal({ tenant, onClose }: { tenant: SaasTenant; onClose: () => void }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabaseBrowser
        .from("saas_credit_transactions")
        .select("id, type, amount, description, created_at, ref_tenant_id")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setTransactions((data as Transaction[]) ?? []);
      setLoading(false);
    };
    fetch();
  }, [tenant.id]);

  const typeStyle: Record<string, string> = {
    CREDIT: "text-emerald-600 dark:text-emerald-400",
    DEBIT:  "text-rose-600 dark:text-rose-400",
    GRANT:  "text-purple-600 dark:text-purple-400",
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <div>
            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Histórico de Créditos</h3>
            <p className="text-xs text-slate-400">{tenant.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-slate-400 animate-pulse">Carregando...</div>
          ) : transactions.length === 0 ? (
            <div className="py-10 text-center text-slate-400">Nenhuma transação encontrada.</div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-400 sticky top-0">
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
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono">{formatDateTime(tx.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold uppercase ${typeStyle[tx.type] ?? "text-slate-500"}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 font-bold text-sm ${typeStyle[tx.type] ?? "text-slate-500"}`}>
                      {tx.amount > 0 ? "+" : ""}{tx.amount}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{tx.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 rounded-lg bg-slate-800 text-white font-bold text-xs uppercase">Fechar</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// COMPONENTES AUXILIARES
// ============================================================
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">{children}</label>;
}

function FieldInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors ${className}`}
    />
  );
}
