"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
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
  // Perfil de contato
  responsible_name: string | null;
  contact_email: string | null;
  phone_e164: string | null;
  whatsapp_username: string | null;
  notes: string | null;
  // Auth
  auth_email: string | null;
  last_sign_in_at: string | null;
};

type Transaction = {
  id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
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
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

// ============================================================
// BADGES
// ============================================================
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${map[status] ?? map.INACTIVE}`}>
      {label[status] ?? status}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    SUPERADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200 dark:border-purple-500/20",
    MASTER:     "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
    USER:       "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60 border-slate-200 dark:border-white/10",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${map[role] ?? map.USER}`}>
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
  const [roleFilter, setRoleFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Modais
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState<SaasTenant | null>(null);
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
        supabaseBrowser
          .from("vw_saas_tenants")
          .select("*")
          .order("created_at", { ascending: false }),
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

  // Filtros
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return tenants.filter(t => {
      if (roleFilter !== "Todos" && t.role !== roleFilter) return false;
      if (statusFilter !== "Todos" && t.license_status !== statusFilter) return false;
      if (q) {
        const hay = [t.name, t.slug, t.responsible_name, t.auth_email, t.whatsapp_username, t.phone_e164, t.role]
          .join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tenants, search, roleFilter, statusFilter]);

  // Stats (exclui o próprio superadmin)
  const others = tenants.filter(t => t.role !== "SUPERADMIN");
  const stats = {
    total:   others.length,
    active:  others.filter(t => t.license_status === "ACTIVE").length,
    trial:   others.filter(t => t.license_status === "TRIAL").length,
    expired: others.filter(t => t.license_status === "EXPIRED").length,
  };

  const canManage = myRole === "SUPERADMIN" || myRole === "MASTER";

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-0 md:px-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-800 dark:text-white">
            Gestão SaaS
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Rede de tenants · <span className="font-bold text-slate-500 dark:text-white/50">{myRole}</span></p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowNew(true)}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
          >
            <span className="text-base leading-none">+</span>
            Novo Tenant
          </button>
        )}
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 sm:px-0 md:px-4">
        {[
          { label: "Total",    value: stats.total,   color: "text-slate-700 dark:text-white" },
          { label: "Ativos",   value: stats.active,  color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Trial",    value: stats.trial,   color: "text-sky-600 dark:text-sky-400" },
          { label: "Expirados",value: stats.expired, color: "text-rose-600 dark:text-rose-400" },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{s.label}</div>
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* FILTROS */}
      <div className="px-3 sm:px-0 md:px-4">
        <div className="p-0 md:p-4 bg-transparent md:bg-white md:dark:bg-[#161b22] border-0 md:border md:border-slate-200 md:dark:border-white/10 rounded-none md:rounded-xl shadow-none md:shadow-sm md:sticky md:top-4 z-20">
          <div className="hidden md:block text-xs font-bold uppercase text-slate-400 dark:text-white/40 tracking-wider mb-3">Filtros</div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Busca */}
            <div className="flex-1 min-w-[200px] relative">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar tenant, contato, whatsapp..."
                className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500">
                  <IconX />
                </button>
              )}
            </div>

            {/* Role filter */}
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50"
            >
              <option value="Todos">Role (Todos)</option>
              <option value="MASTER">Master</option>
              <option value="USER">User</option>
            </select>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50"
            >
              <option value="Todos">Status (Todos)</option>
              <option value="ACTIVE">Ativo</option>
              <option value="TRIAL">Trial</option>
              <option value="EXPIRED">Expirado</option>
              <option value="ARCHIVED">Arquivado</option>
            </select>

            <button
              onClick={() => { setSearch(""); setRoleFilter("Todos"); setStatusFilter("Todos"); }}
              className="h-10 px-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-bold hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors hidden md:flex items-center gap-1.5"
            >
              <IconX /> Limpar
            </button>
          </div>
        </div>
      </div>

      {/* LISTA */}
      <div className="px-3 sm:px-0 md:px-4">
        <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden">

          {/* Header da lista */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-800 dark:text-white">
              Tenants
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold">
                {filtered.length}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-400 animate-pulse">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-slate-400">Nenhum tenant encontrado.</div>
          ) : (
            <>
              {/* TABELA DESKTOP */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100 dark:border-white/5">
                    <tr>
                      <th className="px-4 py-3">Tenant / Contato</th>
                      <th className="px-4 py-3">WhatsApp</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Validade</th>
                      <th className="px-4 py-3">Créditos</th>
                      <th className="px-4 py-3">Último acesso</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {filtered.map(t => (
                      <TenantRow
                        key={t.id}
                        t={t}
                        canManage={canManage}
                        isSelf={t.role === "SUPERADMIN"}
                        onEdit={() => setEditTarget(t)}
                        onRenew={() => setRenewTarget(t)}
                        onCredits={() => setCreditsTarget(t)}
                        onHistory={() => setHistoryTarget(t)}
                        onArchive={() => handleArchive(t)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* CARDS MOBILE */}
              <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map(t => (
                  <TenantCard
                    key={t.id}
                    t={t}
                    canManage={canManage}
                    isSelf={t.role === "SUPERADMIN"}
                    onEdit={() => setEditTarget(t)}
                    onRenew={() => setRenewTarget(t)}
                    onCredits={() => setCreditsTarget(t)}
                    onHistory={() => setHistoryTarget(t)}
                    onArchive={() => handleArchive(t)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* MODAIS */}
      {showNew && (
        <TenantFormModal
          mode="new"
          myRole={myRole}
          onClose={() => setShowNew(false)}
          onSuccess={() => { setShowNew(false); loadData(); addToast("success", "Tenant criado!", "Novo tenant provisionado com sucesso."); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}

      {editTarget && (
        <TenantFormModal
          mode="edit"
          tenant={editTarget}
          myRole={myRole}
          onClose={() => setEditTarget(null)}
          onSuccess={() => { setEditTarget(null); loadData(); addToast("success", "Atualizado!", "Perfil salvo."); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}

      {renewTarget && (
        <RenewModal
          tenant={renewTarget}
          myRole={myRole}
          onClose={() => setRenewTarget(null)}
          onSuccess={() => { setRenewTarget(null); loadData(); addToast("success", "Renovado!", "Licença renovada."); }}
          onError={m => addToast("error", "Erro", m)}
        />
      )}

      {creditsTarget && (
        <CreditsModal
          tenant={creditsTarget}
          onClose={() => setCreditsTarget(null)}
          onSuccess={() => { setCreditsTarget(null); loadData(); addToast("success", "Créditos enviados!"); }}
          onError={m => addToast("error", "Erro", m)}
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
// LINHA DA TABELA DESKTOP
// ============================================================
function TenantRow({ t, canManage, isSelf, onEdit, onRenew, onCredits, onHistory, onArchive }: {
  t: SaasTenant; canManage: boolean; isSelf: boolean;
  onEdit: () => void; onRenew: () => void; onCredits: () => void;
  onHistory: () => void; onArchive: () => void;
}) {
  const days = daysUntil(t.expires_at);
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">

      {/* TENANT / CONTATO */}
      <td className="px-4 py-3">
        <div className="font-bold text-slate-800 dark:text-white">{t.name}</div>
        {t.responsible_name && t.responsible_name !== t.name && (
          <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5">{t.responsible_name}</div>
        )}
        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{t.auth_email || t.contact_email || "—"}</div>
      </td>

      {/* WHATSAPP */}
      <td className="px-4 py-3">
        {t.whatsapp_username ? (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">@{t.whatsapp_username}</span>
        ) : t.phone_e164 ? (
          <span className="text-xs font-mono text-slate-500">{t.phone_e164}</span>
        ) : (
          <span className="text-slate-300 dark:text-white/20 text-xs">—</span>
        )}
      </td>

      {/* ROLE */}
      <td className="px-4 py-3"><RoleBadge role={t.role} /></td>

      {/* STATUS */}
      <td className="px-4 py-3"><StatusBadge status={t.license_status} /></td>

      {/* VALIDADE */}
      <td className="px-4 py-3">
        {isSelf ? (
          <span className="text-xs text-purple-500 font-bold">∞</span>
        ) : t.expires_at ? (
          <div className="flex flex-col">
            <span className="text-xs font-medium text-slate-700 dark:text-white">{formatDate(t.expires_at)}</span>
            {days !== null && (
              <span className={`text-[10px] font-bold ${days < 0 ? "text-rose-500" : days <= 7 ? "text-amber-500" : "text-slate-400"}`}>
                {days < 0 ? `Expirou há ${Math.abs(days)}d` : days === 0 ? "Expira hoje" : `${days}d restantes`}
              </span>
            )}
          </div>
        ) : <span className="text-slate-400 text-xs">—</span>}
      </td>

      {/* CRÉDITOS */}
      <td className="px-4 py-3">
        {isSelf ? (
          <span className="text-xs font-bold text-purple-500">∞</span>
        ) : (
          <span className={`text-sm font-bold ${t.credit_balance > 0 ? "text-slate-700 dark:text-white" : "text-slate-400"}`}>
            {t.credit_balance}
          </span>
        )}
      </td>

      {/* ÚLTIMO ACESSO */}
      <td className="px-4 py-3 text-xs text-slate-400">{formatDate(t.last_sign_in_at)}</td>

      {/* AÇÕES */}
      <td className="px-4 py-3">
        {!isSelf && canManage && (
          <div className="flex items-center justify-end gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
            <ActionBtn title="Editar perfil" tone="amber" onClick={onEdit}><IconEdit /></ActionBtn>
            <ActionBtn title="Renovar licença" tone="green" onClick={onRenew}><IconRefresh /></ActionBtn>
            <ActionBtn title="Enviar créditos" tone="blue" onClick={onCredits}><IconCoins /></ActionBtn>
            <ActionBtn title="Histórico" tone="slate" onClick={onHistory}><IconClock /></ActionBtn>
            {t.license_status !== "ARCHIVED" && (
              <ActionBtn title="Arquivar" tone="red" onClick={onArchive}><IconTrash /></ActionBtn>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ============================================================
// CARD MOBILE
// ============================================================
function TenantCard({ t, canManage, isSelf, onEdit, onRenew, onCredits, onHistory, onArchive }: {
  t: SaasTenant; canManage: boolean; isSelf: boolean;
  onEdit: () => void; onRenew: () => void; onCredits: () => void;
  onHistory: () => void; onArchive: () => void;
}) {
  const days = daysUntil(t.expires_at);
  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-slate-800 dark:text-white truncate">{t.name}</div>
          {t.responsible_name && t.responsible_name !== t.name && (
            <div className="text-xs text-slate-500 truncate">{t.responsible_name}</div>
          )}
          <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
            {t.auth_email || t.contact_email || "—"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <RoleBadge role={t.role} />
          <StatusBadge status={t.license_status} />
        </div>
      </div>

      {/* Infos */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-2">
          <div className="text-[9px] font-bold uppercase text-slate-400 mb-0.5">WhatsApp</div>
          <div className="font-medium text-emerald-600 dark:text-emerald-400 truncate">
            {t.whatsapp_username ? `@${t.whatsapp_username}` : t.phone_e164 || "—"}
          </div>
        </div>
        <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-2">
          <div className="text-[9px] font-bold uppercase text-slate-400 mb-0.5">Créditos</div>
          <div className={`font-bold ${isSelf ? "text-purple-500" : "text-slate-700 dark:text-white"}`}>
            {isSelf ? "∞" : t.credit_balance}
          </div>
        </div>
        <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-2">
          <div className="text-[9px] font-bold uppercase text-slate-400 mb-0.5">Validade</div>
          <div className="font-medium text-slate-700 dark:text-white">
            {isSelf ? "∞" : t.expires_at ? formatDate(t.expires_at) : "—"}
          </div>
          {!isSelf && days !== null && (
            <div className={`text-[9px] font-bold ${days < 0 ? "text-rose-500" : days <= 7 ? "text-amber-500" : "text-slate-400"}`}>
              {days < 0 ? `Expirou há ${Math.abs(days)}d` : `${days}d restantes`}
            </div>
          )}
        </div>
        <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-2">
          <div className="text-[9px] font-bold uppercase text-slate-400 mb-0.5">Último acesso</div>
          <div className="font-medium text-slate-700 dark:text-white">{formatDate(t.last_sign_in_at)}</div>
        </div>
      </div>

      {/* Ações */}
      {!isSelf && canManage && (
        <div className="flex flex-wrap gap-2">
          <button onClick={onEdit} className="flex-1 min-w-[80px] py-2 rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 text-[11px] font-bold border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 transition flex items-center justify-center gap-1.5">
            <IconEdit size={13} /> Editar
          </button>
          <button onClick={onRenew} className="flex-1 min-w-[80px] py-2 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-[11px] font-bold border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 transition flex items-center justify-center gap-1.5">
            <IconRefresh size={13} /> Renovar
          </button>
          <button onClick={onCredits} className="flex-1 min-w-[80px] py-2 rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 text-[11px] font-bold border border-sky-200 dark:border-sky-500/20 hover:bg-sky-100 transition flex items-center justify-center gap-1.5">
            <IconCoins size={13} /> Créditos
          </button>
          <button onClick={onHistory} className="flex-1 min-w-[80px] py-2 rounded-lg bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60 text-[11px] font-bold border border-slate-200 dark:border-white/10 hover:bg-slate-200 transition flex items-center justify-center gap-1.5">
            <IconClock size={13} /> Histórico
          </button>
          {t.license_status !== "ARCHIVED" && (
            <button onClick={onArchive} className="flex-1 min-w-[80px] py-2 rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400 text-[11px] font-bold border border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 transition flex items-center justify-center gap-1.5">
              <IconTrash size={13} /> Arquivar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MODAL: NOVO TENANT / EDITAR PERFIL
// ============================================================
function TenantFormModal({ mode, tenant, myRole, onClose, onSuccess, onError }: {
  mode: "new" | "edit";
  tenant?: SaasTenant;
  myRole: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name:               tenant?.name ?? "",
    email:              tenant?.auth_email ?? tenant?.contact_email ?? "",
    password:           "",
    role:               (tenant?.role === "USER" ? "USER" : "MASTER") as "MASTER" | "USER",
    trial_days:         7,
    credits_initial:    0,
    responsible_name:   tenant?.responsible_name ?? "",
    phone_e164:         tenant?.phone_e164 ?? "",
    whatsapp_username:  tenant?.whatsapp_username ?? "",
    notes:              tenant?.notes ?? "",
  });

  const update = (k: keyof typeof form, v: any) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (mode === "new" && (!form.name || !form.email || !form.password)) {
      onError("Preencha nome, e-mail e senha."); return;
    }
    if (mode === "new" && form.password.length < 8) {
      onError("Senha deve ter pelo menos 8 caracteres."); return;
    }

    setSaving(true);
    try {
      if (mode === "new") {
        const res = await fetch("/api/saas/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.hint || data.error || "Falha ao criar tenant.");
      } else {
        // Edição: apenas atualiza o perfil
        const { error } = await supabaseBrowser.rpc("saas_update_profile", {
          p_tenant_id:         tenant!.id,
          p_responsible_name:  form.responsible_name || null,
          p_email:             form.email || null,
          p_phone_e164:        form.phone_e164 || null,
          p_whatsapp_username: form.whatsapp_username || null,
          p_notes:             form.notes || null,
        });
        if (error) throw new Error(error.message);
      }
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
      <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5 shrink-0">
          <h3 className="font-bold text-lg text-slate-800 dark:text-white">
            {mode === "new" ? "Novo Tenant" : `Editar: ${tenant?.name}`}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">

          {/* Seção: Conta */}
          <SectionTitle>Dados da Conta</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <FieldLabel>Nome do Tenant *</FieldLabel>
              <FieldInput value={form.name} onChange={e => update("name", e.target.value)} placeholder="Ex: João Revendas" disabled={mode === "edit"} autoFocus />
            </div>
            <div>
              <FieldLabel>E-mail *</FieldLabel>
              <FieldInput type="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="joao@email.com" disabled={mode === "edit"} />
            </div>
            {mode === "new" && (
              <div>
                <FieldLabel>Senha *</FieldLabel>
                <FieldInput type="password" value={form.password} onChange={e => update("password", e.target.value)} placeholder="Mín. 8 caracteres" />
              </div>
            )}
          </div>

          {/* Role (só no novo) */}
          {mode === "new" && (
            <>
              <div>
                <FieldLabel>Papel (Role)</FieldLabel>
                <div className="flex gap-2 mt-1">
                  {["MASTER", "USER"].map(r => (
                    <button
                      key={r}
                      onClick={() => update("role", r)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-all ${form.role === r
                        ? r === "MASTER" ? "bg-amber-500 border-amber-500 text-white" : "bg-slate-700 border-slate-700 text-white"
                        : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Trial (dias)</FieldLabel>
                  <FieldInput type="number" min={0} value={form.trial_days} onChange={e => update("trial_days", Number(e.target.value))} />
                  <p className="text-[10px] text-slate-400 mt-1">0 = sem trial</p>
                </div>
                <div>
                  <FieldLabel>Créditos Iniciais</FieldLabel>
                  <FieldInput type="number" min={0} value={form.credits_initial} onChange={e => update("credits_initial", Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          {/* Seção: Contato */}
          <SectionTitle>Contato</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <FieldLabel>Nome do Responsável</FieldLabel>
              <FieldInput value={form.responsible_name} onChange={e => update("responsible_name", e.target.value)} placeholder="Nome completo do responsável" />
            </div>
            <div>
              <FieldLabel>Telefone (com DDI)</FieldLabel>
              <FieldInput
                value={form.phone_e164}
                onChange={e => update("phone_e164", e.target.value)}
                placeholder="+5521999999999"
              />
            </div>
            <div>
              <FieldLabel>WhatsApp Username</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">@</span>
                <FieldInput
                  value={form.whatsapp_username}
                  onChange={e => update("whatsapp_username", e.target.value.replace("@", ""))}
                  placeholder="usuario"
                  className="pl-7"
                />
              </div>
            </div>
            <div className="col-span-2">
              <FieldLabel>Observações Internas</FieldLabel>
              <textarea
                value={form.notes}
                onChange={e => update("notes", e.target.value)}
                placeholder="Notas sobre este tenant..."
                rows={2}
                className="w-full px-3 py-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors resize-none"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="text-slate-500 font-bold text-xs uppercase hover:text-slate-800 dark:hover:text-white">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-xl text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50 shadow-lg shadow-emerald-900/20"
          >
            {saving ? "Salvando..." : mode === "new" ? "Criar Tenant" : "Salvar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: RENOVAR
// ============================================================
function RenewModal({ tenant, myRole, onClose, onSuccess, onError }: {
  tenant: SaasTenant; myRole: string;
  onClose: () => void; onSuccess: () => void; onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(30);
  const creditsNeeded = Math.ceil(days / 30);
  const isSuperadmin = myRole === "SUPERADMIN";

  const handleRenew = async () => {
    setSaving(true);
    const { error } = await supabaseBrowser.rpc("saas_renew_license", {
      p_tenant_id: tenant.id, p_days: days, p_description: `Renovação de ${days} dias`,
    });
    setSaving(false);
    if (error) onError(error.message); else onSuccess();
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
            <div className="text-xs text-slate-400 mt-0.5">Vence em: {tenant.expires_at ? formatDate(tenant.expires_at) : "Sem data"}</div>
          </div>
          <div>
            <FieldLabel>Período de renovação</FieldLabel>
            <div className="grid grid-cols-4 gap-2 mt-1 mb-2">
              {[7, 15, 30, 60, 90, 180, 365].slice(0, 4).map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${days === d ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500"}`}>
                  {d}d
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[90, 180, 365].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${days === d ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500"}`}>
                  {d}d
                </button>
              ))}
              <FieldInput type="number" min={1} value={days} onChange={e => setDays(Number(e.target.value))} className="text-center" />
            </div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg p-3 text-center">
            {isSuperadmin ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-bold text-sm">Renovação gratuita (Superadmin)</span>
            ) : (
              <>
                <div className="text-xs text-slate-400 mb-1">Créditos necessários</div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{creditsNeeded}</div>
                <div className="text-xs text-slate-400">para {days} dias</div>
              </>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
          <button onClick={onClose} className="text-slate-500 font-bold text-xs uppercase">Cancelar</button>
          <button onClick={handleRenew} disabled={saving}
            className="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-xl text-xs uppercase hover:bg-emerald-500 transition disabled:opacity-50">
            {saving ? "Renovando..." : `Renovar ${days} dias`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: CRÉDITOS
// ============================================================
function CreditsModal({ tenant, onClose, onSuccess, onError }: {
  tenant: SaasTenant; onClose: () => void; onSuccess: () => void; onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(10);
  const [description, setDescription] = useState("Recarga de créditos");

  const handleTransfer = async () => {
    if (amount <= 0) { onError("Valor deve ser maior que zero."); return; }
    setSaving(true);
    const { error } = await supabaseBrowser.rpc("saas_transfer_credits", {
      p_to_tenant_id: tenant.id, p_amount: amount, p_description: description,
    });
    setSaving(false);
    if (error) onError(error.message); else onSuccess();
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
            <FieldLabel>Quantidade</FieldLabel>
            <div className="grid grid-cols-4 gap-2 mt-1 mb-2">
              {[5, 10, 30, 50].map(v => (
                <button key={v} onClick={() => setAmount(v)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${amount === v ? "bg-sky-500 border-sky-500 text-white" : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500"}`}>
                  {v}
                </button>
              ))}
            </div>
            <FieldInput type="number" min={1} value={amount} onChange={e => setAmount(Number(e.target.value))} className="text-center" />
          </div>
          <div>
            <FieldLabel>Descrição</FieldLabel>
            <FieldInput value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Recarga mensal" />
          </div>
          <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 rounded-lg p-3 text-center">
            <div className="text-xs text-slate-400">Saldo após envio</div>
            <div className="text-2xl font-bold text-sky-600 dark:text-sky-400">{tenant.credit_balance + amount}</div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-3">
          <button onClick={onClose} className="text-slate-500 font-bold text-xs uppercase">Cancelar</button>
          <button onClick={handleTransfer} disabled={saving}
            className="px-6 py-2.5 bg-sky-600 text-white font-bold rounded-xl text-xs uppercase hover:bg-sky-500 transition disabled:opacity-50">
            {saving ? "Enviando..." : `Enviar ${amount} créditos`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// MODAL: HISTÓRICO
// ============================================================
function HistoryModal({ tenant, onClose }: { tenant: SaasTenant; onClose: () => void }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabaseBrowser
      .from("saas_credit_transactions")
      .select("id, type, amount, description, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setTransactions((data as Transaction[]) ?? []); setLoading(false); });
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
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono">{formatDateTime(tx.created_at)}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-bold uppercase ${typeStyle[tx.type] ?? "text-slate-500"}`}>{tx.type}</span></td>
                    <td className={`px-4 py-3 font-bold text-sm ${typeStyle[tx.type] ?? "text-slate-500"}`}>{tx.amount > 0 ? "+" : ""}{tx.amount}</td>
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
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 -mb-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">{children}</span>
      <div className="flex-1 h-px bg-slate-100 dark:bg-white/5" />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">{children}</label>;
}

function FieldInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

function ActionBtn({ children, title, tone, onClick }: {
  children: React.ReactNode; title: string;
  tone: "amber" | "green" | "blue" | "slate" | "red";
  onClick: () => void;
}) {
  const colors = {
    amber: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-100",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100",
    blue:  "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20 hover:bg-sky-100",
    slate: "text-slate-600 dark:text-white/60 bg-slate-100 dark:bg-white/10 border-slate-200 dark:border-white/10 hover:bg-slate-200",
    red:   "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-100",
  };
  return (
    <button onClick={onClick} title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}>
      {children}
    </button>
  );
}

// ============================================================
// ÍCONES
// ============================================================
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>; }
function IconEdit({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconRefresh({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function IconCoins({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>; }
function IconClock({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconTrash({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
