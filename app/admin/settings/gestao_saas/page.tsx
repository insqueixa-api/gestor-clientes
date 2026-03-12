"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { 
  Users, UserPlus, CreditCard, History, Trash2, 
  ShieldCheck, Calendar, Search, Filter, X, 
  ArrowUpRight, RefreshCw, MoreVertical, LayoutGrid
} from "lucide-react";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";

// --- TIPOS ---
type SaasRole = 'superadmin' | 'master' | 'admin' | 'user';

type TenantRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  role: SaasRole;
  balance: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};

// --- COMPONENTE PRINCIPAL ---
function GestaoSaasContent() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("Todos");
  
  // Modais
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);
  const [isCreditsModalOpen, setIsCreditsModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Carregar dados (Unindo Licenças, Créditos e Roles)
  async function loadData() {
    setLoading(true);
    try {
      const { data, error } = await supabaseBrowser
        .from('saas_licenses')
        .select(`
          id, tenant_id, tenant_name, expires_at, is_active, created_at,
          saas_credits(balance),
          saas_roles(role)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((r: any) => ({
        id: r.id,
        tenant_id: r.tenant_id,
        tenant_name: r.tenant_name || "Sem Nome",
        role: r.saas_roles?.[0]?.role || 'user',
        balance: r.saas_credits?.[0]?.balance || 0,
        expires_at: r.expires_at,
        is_active: r.is_active,
        created_at: r.created_at
      }));

      setRows(mapped);
    } catch (err: any) {
      addToast("error", "Erro ao carregar", err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  // Filtros
  const filtered = useMemo(() => {
    return rows.filter(r => {
      const matchSearch = r.tenant_name.toLowerCase().includes(search.toLowerCase()) || 
                          r.tenant_id.includes(search);
      const matchRole = roleFilter === "Todos" || r.role === roleFilter;
      return matchSearch && matchRole;
    });
  }, [rows, search, roleFilter]);

  function addToast(type: "success" | "error", title: string, message?: string) {
    setToasts(prev => [...prev, { id: Date.now(), type, title, message }]);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0f141a] p-4 sm:p-8 transition-colors">
      
      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <LayoutGrid className="text-emerald-500" /> Gestão da Rede SaaS
          </h1>
          <p className="text-slate-500 dark:text-white/40 text-sm">Controle de inquilinos, licenças e distribuição de créditos.</p>
        </div>
        
        <button 
          onClick={() => setIsNewTenantModalOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-95"
        >
          <UserPlus size={18} /> Novo Usuário / Rede
        </button>
      </div>

      {/* FILTROS RÁPIDOS */}
      <div className="max-w-7xl mx-auto mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar por nome ou ID..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl outline-none focus:border-emerald-500 transition-all text-sm"
          />
        </div>
        <select 
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="px-4 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl outline-none text-sm"
        >
          <option value="Todos">Todos os Níveis</option>
          <option value="master">Master (Revendedor)</option>
          <option value="admin">Admin</option>
          <option value="user">Usuário Comum</option>
        </select>
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase">Total</span>
          <span className="text-lg font-black text-emerald-700 dark:text-emerald-400">{filtered.length}</span>
        </div>
      </div>

      {/* TABELA */}
      <div className="max-w-7xl mx-auto bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-white/5 text-[11px] font-bold uppercase text-slate-500 dark:text-white/40 tracking-wider">
                <th className="px-6 py-4">Inquilino (Tenant)</th>
                <th className="px-6 py-4">Nível de Acesso</th>
                <th className="px-6 py-4 text-center">Créditos</th>
                <th className="px-6 py-4">Expiração</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
              {loading ? (
                <tr><td colSpan={5} className="p-12 text-center animate-pulse text-slate-400">Sincronizando com o banco...</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="group hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-700 dark:text-white">{r.tenant_name}</span>
                      <span className="text-[10px] font-mono text-slate-400 uppercase">{r.tenant_id}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase border ${
                      r.role === 'superadmin' ? 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400' :
                      r.role === 'master' ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400' :
                      'bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-white/60'
                    }`}>
                      {r.role === 'superadmin' && <ShieldCheck size={12} />}
                      {r.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center font-black text-slate-700 dark:text-white/90">
                    {r.role === 'superadmin' ? '∞' : r.balance}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-white/50">
                      <Calendar size={14} />
                      {r.expires_at ? new Date(r.expires_at).toLocaleDateString('pt-BR') : 'Vitalício'}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => { setSelectedTenant(r); setIsCreditsModalOpen(true); }}
                        className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition"
                        title="Adicionar Créditos"
                      >
                        <CreditCard size={16} />
                      </button>
                      <button className="p-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition">
                        <History size={16} />
                      </button>
                      <button className="p-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ToastNotifications toasts={toasts} removeToast={(id) => setToasts(t => t.filter(x => x.id !== id))} />

      {/* MODAL: NOVO TENANT (Simulado) */}
      {isNewTenantModalOpen && (
        <ModalSaaS title="Criar Nova Conta na Rede" onClose={() => setIsNewTenantModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase block mb-1">Nome do Responsável / Empresa</label>
              <input className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm" placeholder="Ex: João da Silva Master" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase block mb-1">Nível de Role</label>
                <select className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm">
                  <option value="master">Master</option>
                  <option value="admin">Admin</option>
                  <option value="user">Usuário</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase block mb-1">Créditos Iniciais (Trial)</label>
                <input type="number" defaultValue={10} className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm" />
              </div>
            </div>
            <div className="pt-4 flex gap-3">
              <button onClick={() => setIsNewTenantModalOpen(false)} className="flex-1 py-3 text-slate-500 font-bold text-sm">Cancelar</button>
              <button className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-900/20">Criar Tenant</button>
            </div>
          </div>
        </ModalSaaS>
      )}

      {/* MODAL: ADICIONAR CRÉDITOS */}
      {isCreditsModalOpen && selectedTenant && (
        <ModalSaaS title={`Recarregar Rede: ${selectedTenant.tenant_name}`} onClose={() => setIsCreditsModalOpen(false)}>
          <div className="space-y-6">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-between">
              <div className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Saldo Atual</div>
              <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{selectedTenant.balance}</div>
            </div>
            
            <div>
              <label className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase block mb-1">Quantidade para Enviar</label>
              <input type="number" autoFocus className="w-full p-4 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-xl font-bold text-center" placeholder="0" />
            </div>

            <div className="bg-amber-50 dark:bg-amber-500/5 p-4 rounded-xl border border-amber-200 dark:border-amber-500/20 flex gap-3">
              <ArrowUpRight className="text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                Ao enviar créditos, eles serão descontados da sua conta global (se aplicável) e renovarão o acesso do inquilino por mais 30 dias automaticamente.
              </p>
            </div>

            <button className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-500 transition shadow-xl shadow-emerald-900/30">
              Confirmar Transferência <RefreshCw size={18} />
            </button>
          </div>
        </ModalSaaS>
      )}
    </div>
  );
}

// Sub-componente Modal
function ModalSaaS({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#0f141a] border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition text-slate-400"><X size={20} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export default function GestaoSaas() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 animate-pulse">Carregando infraestrutura SaaS...</div>}>
      <GestaoSaasContent />
    </Suspense>
  );
}