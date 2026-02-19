"use client";

import { useEffect, useState, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { getCurrentTenantId } from "@/lib/tenant";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// --- TIPOS ---
type AppField = {
  id: string;       
  label: string;    
  type: "text" | "date" | "link";
  placeholder?: string;
};

type AppData = {
  id: string;
  name: string;
  info_url: string | null;
  is_active: boolean;
  fields_config: AppField[];
  partner_server_id?: string | null;
  cost_type?: "paid" | "free" | "partnership";
};

type ServerOption = { id: string; name: string };

// --- COMPONENTES UI ---
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">{children}</label>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

// --- PÁGINA ---
export default function AppManagerPage() {
  const [apps, setApps] = useState<AppData[]>([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estado do APP em Edição
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formFields, setFormFields] = useState<AppField[]>([]);
  
  // Novos Estados
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [costType, setCostType] = useState<"paid" | "free" | "partnership">("paid");

  // --- TOAST (COM AUTO-CLOSE CORRIGIDO) ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  const { confirm: confirmDialog, ConfirmUI } = useConfirm();

  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    const durationMs = 5000; // 5 segundos padrão
    
    // Adiciona o toast na tela
    setToasts((prev) => [...prev, { id, type, title, message, durationMs }]);

    // ✅ CORREÇÃO: Agenda a remoção automática
    setTimeout(() => {
        removeToast(id);
    }, durationMs);
  };

  // --- CARREGAR DADOS ---
  async function loadData() {
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      if (!tid) return;

      // 1. Carrega Apps
const { data: appsData, error: appsError } = await supabaseBrowser
  .from("apps")
  .select("*")
  .eq("tenant_id", tid)
  .order("name", { ascending: true });


      if (appsError) throw appsError;

const costPriority: Record<string, number> = {
  partnership: 0,
  free: 1,
  paid: 2,
};

const { confirm, ConfirmUI } = useConfirm();

const formattedApps = (appsData || [])
  .map((app) => ({
    ...app,
    fields_config: Array.isArray(app.fields_config) ? app.fields_config : [],
    cost_type: app.cost_type || "paid",
  }))
  .sort((a, b) => {
    const costDiff =
      (costPriority[a.cost_type ?? "paid"] ?? 99) -
      (costPriority[b.cost_type ?? "paid"] ?? 99);

    // primeiro ordena pelo tipo
    if (costDiff !== 0) return costDiff;

    // depois alfabético (pt-BR bonito)
    return a.name.localeCompare(b.name, "pt-BR", {
      sensitivity: "base",
    });
  });

      setApps(formattedApps);

      // 2. Carrega Servidores
      const { data: srvData } = await supabaseBrowser
        .from("servers")
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_archived", false);

      if (srvData) {
        setServers(srvData.map((s: any) => ({ id: s.id, name: s.name })));
      }

    } catch (error: any) {
      addToast("error", "Erro ao carregar dados", error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // ✅ +++ Agrupamento PRO (Parcerias / Gratuitos / Pagos)
const groupedApps = {
  partnership: apps.filter((a) => (a.cost_type ?? "paid") === "partnership"),
  free: apps.filter((a) => (a.cost_type ?? "paid") === "free"),
  paid: apps.filter((a) => (a.cost_type ?? "paid") === "paid"),
};


  // --- MANIPULAÇÃO DO MODAL ---
  function openNew() {
    setEditingId(null);
    setFormName("");
    setFormUrl("");
    setFormFields([]); 
    setSelectedServerId("");
    setCostType("paid");
    setIsModalOpen(true);
  }

  function openEdit(app: AppData) {
    setEditingId(app.id);
    setFormName(app.name);
    setFormUrl(app.info_url || "");
    setFormFields(JSON.parse(JSON.stringify(app.fields_config))); 
    setSelectedServerId(app.partner_server_id || "");
    setCostType(app.cost_type || "paid");
    setIsModalOpen(true);
  }

  // --- MANIPULAÇÃO DOS CAMPOS DINÂMICOS ---
  function addField() {
    setFormFields((prev) => [
      ...prev,
      { id: globalThis.crypto.randomUUID(), label: "", type: "text" },

    ]);
  }

  // ✅ NOVO: Botão Rápido para Vencimento
  function addExpirationField() {
    setFormFields((prev) => [
      ...prev,
      { id: globalThis.crypto.randomUUID(), label: "Vencimento", type: "date" },

    ]);
  }

  function removeField(id: string) {
    setFormFields((prev) => prev.filter((f) => f.id !== id));
  }

  function updateField(id: string, key: keyof AppField, value: string) {
    setFormFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [key]: value } : f))
    );
  }

  // --- LOGICA DE PARCERIA ---
  function handleServerChange(serverId: string) {
      setSelectedServerId(serverId);
      if (!serverId && costType === "partnership") {
          setCostType("paid");
      }
  }

  // --- SALVAR ---
  async function handleSave() {
    if (!formName.trim()) {
      addToast("error", "Nome obrigatório", "O aplicativo precisa de um nome.");
      return;
    }

    setSaving(true);
try {
  const tid = await getCurrentTenantId();
  if (!tid) {
    addToast("error", "Tenant inválido", "Não foi possível identificar o tenant atual.");
    return;
  }

  // Payload base (insert)
  const insertPayload = {
    tenant_id: tid,
    name: formName.trim(),
    info_url: formUrl?.trim() ? formUrl.trim() : null,
    fields_config: formFields,
    partner_server_id: selectedServerId || null,
    cost_type: costType ?? "paid",
  };

  if (editingId) {
    // ✅ UPDATE: NÃO manda tenant_id (tenant é imutável)
    const updatePayload = {
      name: formName.trim(),
      info_url: formUrl?.trim() ? formUrl.trim() : null,
      fields_config: formFields,
      partner_server_id: selectedServerId || null,
      cost_type: costType ?? "paid",
    };

    // ✅ trava por id + tenant_id
    const { error } = await supabaseBrowser
      .from("apps")
      .update(updatePayload)
      .eq("id", editingId)
      .eq("tenant_id", tid);

    if (error) throw error;
    addToast("success", "Atualizado", "Aplicativo atualizado com sucesso.");
  } else {
    const { error } = await supabaseBrowser.from("apps").insert(insertPayload);
    if (error) throw error;
    addToast("success", "Criado", "Aplicativo criado com sucesso.");
  }

  setIsModalOpen(false);
  loadData();
} catch (e: any) {
  addToast("error", "Erro ao salvar", e?.message ?? "Erro inesperado.");
} finally {
  setSaving(false);
}

  }

async function handleDelete(id: string) {
  const ok = await confirmDialog({
    tone: "rose",
    title: "Excluir aplicativo?",
    subtitle: "Isso pode afetar clientes que usam este app.",
    details: ["Essa ação não pode ser desfeita."],
    confirmText: "Excluir",
    cancelText: "Voltar",
  });

  if (!ok) return;

  try {
    const tid = await getCurrentTenantId();
    if (!tid) {
      addToast("error", "Tenant inválido", "Não foi possível identificar o tenant atual.");
      return;
    }

    const { error } = await supabaseBrowser
      .from("apps")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tid);

    if (error) throw error;

    addToast("success", "Removido", "Aplicativo excluído.");
    loadData();
  } catch (e: any) {
    addToast("error", "Erro", e?.message ?? "Erro inesperado.");
  }
}

// ✅ Render único do Card (pra reutilizar nos 3 grupos)
function renderAppCard(app: AppData) {
  return (
    <div
      key={app.id}
      className="group bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-all relative"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="space-y-1">
          <h3 className="font-bold text-lg text-slate-800 dark:text-white leading-none">{app.name}</h3>

          <div className="flex flex-wrap gap-2 text-[10px]">
            {app.cost_type === "free" && (
              <span className="text-emerald-600 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                GRÁTIS
              </span>
            )}

            {app.cost_type === "partnership" && (
              <span className="text-purple-600 font-bold bg-purple-500/10 px-1.5 py-0.5 rounded">
                PARCERIA
              </span>
            )}

            {(app.cost_type ?? "paid") === "paid" && (
              <span className="text-rose-600 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                PAGO
              </span>
            )}

            {app.partner_server_id && (
              <span className="text-slate-400 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
                {servers.find((s) => s.id === app.partner_server_id)?.name || "Servidor Desconhecido"}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => openEdit(app)}
            className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
            title="Editar"
          >
            ✏️
          </button>
          <button
            onClick={() => handleDelete(app.id)}
            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
            title="Excluir"
          >
            🗑️
          </button>
        </div>
      </div>

      {app.info_url && (
        <a
          href={app.info_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-500 hover:underline truncate max-w-[200px] block mb-3"
        >
          🔗 {app.info_url}
        </a>
      )}

      <div className="pt-3 border-t border-slate-100 dark:border-white/5 space-y-1">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Campos exigidos:</p>

        <div className="flex flex-wrap gap-1">
          {app.fields_config.length > 0 ? (
            app.fields_config.map((field, idx) => (
              <span
                key={idx}
                className="px-2 py-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded text-[10px] text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1"
              >
                {field.label} {field.type === "date" && "📅"}
              </span>
            ))
          ) : (
            <span className="text-[10px] text-slate-400 italic">Apenas nome (padrão)</span>
          )}
        </div>
      </div>
    </div>
  );
}


return (
  <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

<div className="relative z-[999999]">
  <ToastNotifications toasts={toasts} removeToast={removeToast} />
  {ConfirmUI}
</div>


      {/* HEADER DA PÁGINA (padrão Clientes) */}
<div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
  <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate text-slate-800 dark:text-white">
    Aplicativos
  </h1>

  <button
    onClick={openNew}
    className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
  >
    <span className="text-base leading-none">+</span>
    Novo Aplicativo
  </button>
</div>


      {/* LISTAGEM */}
      {loading ? (
        <div className="text-center py-10 text-slate-400">Carregando aplicativos...</div>
      ) : apps.length === 0 ? (
        <div className="text-center py-10 text-slate-400 bg-slate-50 dark:bg-white/5 rounded-xl border border-dashed border-slate-300 dark:border-white/10">
          Nenhum aplicativo cadastrado. Clique em "Novo Aplicativo" para começar.
        </div>
      ) : (
  <div className="space-y-6">

    {/* PARCERIAS */}
    {groupedApps.partnership.length > 0 && (
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible">
        <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">Parcerias</h2>
            <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
              {groupedApps.partnership.length}
            </span>
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-purple-600 dark:text-purple-400">
            partnership
          </span>
        </div>

        <div className="p-3 sm:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {groupedApps.partnership.map((app) => renderAppCard(app))}
          </div>
        </div>
      </div>
    )}

    {/* GRATUITOS */}
    {groupedApps.free.length > 0 && (
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible">
        <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">Gratuitos</h2>
            <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
              {groupedApps.free.length}
            </span>
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            free
          </span>
        </div>

        <div className="p-3 sm:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {groupedApps.free.map((app) => renderAppCard(app))}
          </div>
        </div>
      </div>
    )}

    {/* PAGOS */}
    {groupedApps.paid.length > 0 && (
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible">
        <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">Pagos</h2>
            <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
              {groupedApps.paid.length}
            </span>
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-rose-600 dark:text-rose-400">
            paid
          </span>
        </div>

        <div className="p-3 sm:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {groupedApps.paid.map((app) => renderAppCard(app))}
          </div>
        </div>
      </div>
    )}

    {/* espaço fixo pra não cortar popups */}
    <div className="h-24 md:h-20" />
  </div>
)}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setIsModalOpen(false)}>
          <div className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            
            {/* HEADER MODAL */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                {editingId ? "Editar Aplicativo" : "Novo Aplicativo"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors">✕</button>
            </div>

            {/* BODY MODAL */}
            <div className="p-6 overflow-y-auto space-y-6">
              
              {/* DADOS BÁSICOS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Nome do Aplicativo</Label>
                  <Input 
                    placeholder="Ex: DuplexPlay, IBO..." 
                    value={formName} 
                    onChange={(e) => setFormName(e.target.value)} 
                    autoFocus 
                  />
                </div>
                <div>
                  <Label>URL de Configuração (Global)</Label>
                  <Input 
                    placeholder="https://..." 
                    value={formUrl} 
                    onChange={(e) => setFormUrl(e.target.value)} 
                  />
                </div>
              </div>

              {/* PARCERIA E CUSTO */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
                  <div>
                      <Label>Parceria com Servidor?</Label>
                      <Select 
                        value={selectedServerId} 
                        onChange={(e) => handleServerChange(e.target.value)}
                      >
                          <option value="">Não (Nenhum)</option>
                          {servers.map(srv => (
                              <option key={srv.id} value={srv.id}>{srv.name}</option>
                          ))}
                      </Select>
                  </div>
                  <div>
                      <Label>Aplicativo Gratuíto?</Label>
                      <Select 
                        value={costType} 
                        onChange={(e) => setCostType(e.target.value as any)}
                      >
                          <option value="paid">Não (Pago)</option>
                          <option value="free">Sim (Gratuito)</option>
                          {selectedServerId && <option value="partnership">Parceria</option>}
                      </Select>
                  </div>
              </div>

              {/* CONSTRUTOR DE CAMPOS */}
              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">
                    Campos Personalizados
                  </h3>
                  
                  {/* ✅ BOTÕES DE ADIÇÃO */}
                  <div className="flex gap-2">
                    <button 
                      onClick={addExpirationField}
                      className="text-xs px-2 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded font-bold hover:bg-amber-500/20 transition-colors flex items-center gap-1"
                      title="Adicionar campo de vencimento automaticamente"
                    >
                      <span>📅</span> + Vencimento
                    </button>
                    <button 
                      onClick={addField}
                      className="text-xs px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded font-bold hover:bg-emerald-500/20 transition-colors"
                    >
                      + Campo Livre
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {formFields.length === 0 && (
                    <div className="text-center py-4 text-slate-400 text-xs italic border border-dashed border-slate-300 dark:border-white/10 rounded-lg">
                      Nenhum campo extra definido. O app usará apenas o campo "Nome" ou "Usuário".
                    </div>
                  )}

                  {formFields.map((field, index) => (
                    <div key={field.id} className="flex gap-2 items-center animate-in slide-in-from-left-2 duration-200">
                      <div className="w-6 flex items-center justify-center text-xs text-slate-400 font-mono">
                        #{index + 1}
                      </div>
                      <div className="flex-1">
                        <Input 
                          placeholder="Nome do campo (Ex: MAC, Device Key)" 
                          value={field.label}
                          onChange={(e) => updateField(field.id, "label", e.target.value)}
                        />
                      </div>
                      <div className="w-32">
                        <select 
                          className="w-full h-10 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50"
                          value={field.type}
                          onChange={(e) => updateField(field.id, "type", e.target.value as any)}
                        >
                          <option value="text">Texto</option>
                          <option value="date">Data</option>
                        </select>
                      </div>
                      <button 
                        onClick={() => removeField(field.id)}
                        className="w-10 h-10 flex items-center justify-center text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                        title="Remover campo"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* FOOTER MODAL */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-2 rounded-b-xl">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-sm font-bold transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow-lg disabled:opacity-50 transition-all"
              >
                {saving ? "Salvando..." : "Salvar Configuração"}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}