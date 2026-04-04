"use client";

import React, { useEffect, useState, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { getCurrentTenantId } from "@/lib/tenant";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// --- TIPOS ---
type AppFieldType = "date" | "mac" | "device_key" | "email" | "password" | "url" | "obs";

type AppField = {
  id: string;
  type: AppFieldType;
};

// Label fixo derivado do tipo — usado no card e no export
const FIELD_LABELS: Record<AppFieldType, string> = {
  date:       "Vencimento",
  mac:        "Device ID (MAC)",
  device_key: "Device Key",
  email:      "E-mail",
  password:   "Senha",
  url:        "URL",
  obs:        "Obs",
};

// Ícone visual por tipo
const FIELD_ICONS: Record<AppFieldType, string> = {
  date:       "📅",
  mac:        "🔌",
  device_key: "🔑",
  email:      "✉️",
  password:   "🔒",
  url:        "🔗",
  obs:        "📝",
};

// Ordem de exibição no construtor
const ALL_FIELD_TYPES: AppFieldType[] = ["date", "mac", "device_key", "email", "password", "url", "obs"];

type AppData = {
  id: string;
  tenant_id: string;      // ✅ Precisamos saber a origem do App
  base_app_id?: string;   // ✅ ID do App Global caso seja um override
  name: string;
  info_url: string | null;
  is_active: boolean;
  fields_config: AppField[];
  integration_type?: string | null;
};

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

function normalizeApiUrl(url: string) {
  if (!url) return "";
  let s = url.trim().replace(/\/+$/, ""); 
  // Não deixa passar scripts maliciosos
  if (s.toLowerCase().startsWith("javascript:")) return ""; 
  if (s && !s.startsWith("http")) {
    s = "https://" + s; 
  }
  return s;
}
export default function AppManagerPage() {
const [apps, setApps] = useState<AppData[]>([]);
const [myTenantId, setMyTenantId] = useState<string | null>(null); // ✅ Guarda seu próprio ID
const [search, setSearch] = useState("");
const [loading, setLoading] = useState(true);
const [isModalOpen, setIsModalOpen] = useState(false);
const [saving, setSaving] = useState(false);

    // ✅ trava scroll da página por trás quando modal abre (mantém posição e evita “vazar” no mobile)
  const modalScrollYRef = useRef(0);

  useEffect(() => {
    if (!isModalOpen) return;
    if (typeof window === "undefined") return;

    const body = document.body;
    const html = document.documentElement;

    const scrollY = window.scrollY || window.pageYOffset || 0;
    modalScrollYRef.current = scrollY;

    // guarda estilos anteriores (pra restaurar certinho)
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevHtmlOverflow = html.style.overflow;

    // trava
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    // cleanup ao fechar
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;

      window.scrollTo(0, modalScrollYRef.current || 0);
    };
  }, [isModalOpen]);

  // Estado do APP em Edição
const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formFields, setFormFields] = useState<AppField[]>([]);
  const [formIntegration, setFormIntegration] = useState<string>("");
  const dragIndexRef = useRef<number | null>(null);
  

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
      setMyTenantId(tid); // ✅ Armazena para usar no botão salvar/deletar

      // 1. Carrega Apps via RPC inteligente (Bypassa RLS com segurança)
      const { data: appsData, error: appsError } = await supabaseBrowser
        .rpc("get_my_visible_apps")
        .order("name", { ascending: true });


      if (appsError) throw appsError;

const formattedApps = (appsData || [])
  .map((app) => ({
    ...app,
    fields_config: Array.isArray(app.fields_config) ? app.fields_config : [],
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

setApps(formattedApps);

    } catch (error: any) {
      addToast("error", "Erro ao carregar dados", error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // ✅ Busca aplicada (nome / url / campos / servidor parceria)
  const filteredApps = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return apps;

    return apps.filter((a) => {
      const name = String(a.name ?? "").toLowerCase();
      const url = String(a.info_url ?? "").toLowerCase();

      const fields = Array.isArray(a.fields_config) ? a.fields_config : [];
const fieldsText = fields
        .map((f) => `${FIELD_LABELS[f.type] ?? ""} ${f.type ?? ""}`)
        .join(" ")
        .toLowerCase();

      return (
        name.includes(q) ||
        url.includes(q) ||
        fieldsText.includes(q)
      );
    });
  }, 

[search, apps]);
  // --- MANIPULAÇÃO DO MODAL ---
function openNew() {
    setEditingId(null);
    setFormName("");
    setFormUrl("");
    setFormFields([]);
    setFormIntegration("");
    setIsModalOpen(true);
  }

function openEdit(app: AppData) {
    setEditingId(app.id);
    setFormName(app.name);
    setFormUrl(app.info_url || "");
    setFormFields(JSON.parse(JSON.stringify(app.fields_config)));
    setFormIntegration(app.integration_type || "");
    setIsModalOpen(true);
  }

  // --- MANIPULAÇÃO DOS CAMPOS DINÂMICOS ---
  // ✅ Helper para criar IDs curtos (ex: f_abc12)
  const generateShortId = () => "f_" + Math.random().toString(36).substring(2, 7);

 function addField(type: AppFieldType) {
    setFormFields((prev) => [...prev, { id: generateShortId(), type }]);
  }

  function removeField(id: string) {
    setFormFields((prev) => prev.filter((f) => f.id !== id));
  }

  // updateField removido — label não é mais editável



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
  const safeUrl = normalizeApiUrl(formUrl); // ✅ Limpa a URL e impede XSS

  const insertPayload = {
    tenant_id: tid,
    name: formName.trim(),
    info_url: safeUrl || null,
    fields_config: formFields,
    integration_type: formIntegration || null,
  };

  const editingApp = apps.find(a => a.id === editingId);
  const isEditingGlobal = editingApp && editingApp.tenant_id !== tid;

  if (editingId) {
    if (isEditingGlobal) {
      // 🟢 É UM OVERRIDE! Ele tá editando um Global, cria um local apontando pro pai
      const { error } = await supabaseBrowser.from("apps").insert({
        ...insertPayload,
        base_app_id: editingId
      });
      if (error) throw error;
      addToast("success", "Personalizado", "Cópia local criada com sucesso!");
    } else {
      // 🔵 ATUALIZAÇÃO NORMAL (App dele mesmo)
      const updatePayload = {
        name: formName.trim(),
        info_url: formUrl?.trim() ? formUrl.trim() : null,
        fields_config: formFields,
        integration_type: formIntegration || null,
      };
      const { error } = await supabaseBrowser
        .from("apps")
        .update(updatePayload)
        .eq("id", editingId)
        .eq("tenant_id", tid);
      if (error) throw error;
      addToast("success", "Atualizado", "Aplicativo atualizado com sucesso.");
    }
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

    const appToDelete = apps.find(a => a.id === id);
    const isGlobal = appToDelete && appToDelete.tenant_id !== tid;

    if (isGlobal) {
      // 🟢 Ocultar Global (Cria Tombstone)
      const { error } = await supabaseBrowser.from("apps").insert({
        tenant_id: tid,
        base_app_id: id,
        name: appToDelete.name,
        is_hidden: true,
        fields_config: []
      });
      if (error) throw error;
    } else {
      if (appToDelete?.base_app_id) {
        // 🔵 Deletar Override (Só oculta o override, mantendo a proteção contra o Global)
        const { error } = await supabaseBrowser.from("apps").update({ is_hidden: true }).eq("id", id).eq("tenant_id", tid);
        if (error) throw error;
      } else {
        // 🔴 Deletar App Próprio Definitivamente
        const { error } = await supabaseBrowser.from("apps").delete().eq("id", id).eq("tenant_id", tid);
        if (error) throw error;
      }
    }

    addToast("success", "Removido", "Aplicativo removido da sua lista.");
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
          <div className="flex flex-wrap gap-1 pt-0.5">
            {app.integration_type && (
              <span className="inline-flex items-center text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                ⚡ {app.integration_type === "GERENCIAAPP" ? "GerenciaApp" : app.integration_type}
              </span>
            )}
            {app.tenant_id !== myTenantId && (
              <span className="inline-flex items-center text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 border border-slate-200 dark:border-white/10 px-2 py-0.5 rounded-full">
                🔒 Herdado
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {app.tenant_id === myTenantId && (
            <>
              {/* Botão Editar (Âmbar) */}
              <button
                onClick={() => openEdit(app)}
                className="p-1.5 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-lg transition-all"
                title="Editar"
              >
                <IconEdit />
              </button>

              {/* Botão Excluir (Rose/Red) */}
              <button
                onClick={() => handleDelete(app.id)}
                className="p-1.5 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20 rounded-lg transition-all"
                title="Excluir"
              >
                <IconTrash />
              </button>
            </>
          )}
        </div>
      </div>

      {app.info_url && (
        <a
          href={app.info_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-500 hover:underline truncate max-w-[200px] block mb-3"
        >
          🌐 {app.info_url}
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
                {FIELD_ICONS[field.type]} {FIELD_LABELS[field.type]}
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

{/* ✅ Toasts em overlay (não ocupam espaço no topo) */}
<div className="fixed inset-x-0 top-2 z-[999999] px-3 sm:px-6 pointer-events-none">
  <div className="pointer-events-auto">
    <ToastNotifications toasts={toasts} removeToast={removeToast} />
  </div>
</div>

{/* ✅ ConfirmUI separado (modal/backdrop clicável) */}
{ConfirmUI}


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
{/* ✅ BARRA DE BUSCA (padrão Clientes) */}
<div className="px-3 sm:px-0">
  <div className="md:p-4 md:bg-white dark:md:bg-[#161b22] md:border md:border-slate-200 dark:md:border-white/10 md:rounded-xl md:sticky md:top-4 z-20">
    <div className="flex items-center gap-2">
      <Input
        placeholder="Buscar aplicativo (nome, url, campos, servidor...)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {search.trim() ? (
        <button
          onClick={() => setSearch("")}
          className="h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-xs font-bold text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
          title="Limpar busca"
        >
          Limpar
        </button>
      ) : null}
    </div>
  </div>
</div>

      {/* LISTAGEM */}
      {loading ? (
        <div className="text-center py-10 text-slate-400">Carregando aplicativos...</div>
      ) : filteredApps.length === 0 ? (
        <div className="text-center py-10 text-slate-400 bg-slate-50 dark:bg-white/5 rounded-xl border border-dashed border-slate-300 dark:border-white/10">
          {apps.length === 0
            ? 'Nenhum aplicativo cadastrado. Clique em "Novo Aplicativo" para começar.'
            : search.trim()
              ? `Nenhum aplicativo encontrado para "${search.trim()}".`
              : "Nenhum aplicativo para exibir."}
        </div>
      ) : (
        <div className="px-3 sm:px-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {filteredApps.map((app) => renderAppCard(app))}
          </div>
          <div className="h-24 md:h-20" />
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
      {isModalOpen && (
        <div
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-hidden overscroll-contain"
  onClick={() => setIsModalOpen(false)}
>
          <div className="w-full max-w-lg sm:max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            
            {/* HEADER MODAL */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                {editingId ? "Editar Aplicativo" : "Novo Aplicativo"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors">✕</button>
            </div>

            {/* BODY MODAL */}
            <div
  className="p-6 overflow-y-auto space-y-6 overscroll-contain"
  style={{ WebkitOverflowScrolling: "touch" }}
>
              
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

              {/* INTEGRAÇÃO — só visível para apps próprios (não herdados) */}
              {(!editingId || apps.find(a => a.id === editingId)?.tenant_id === myTenantId) && (
                <div>
                  <Label>Integração automática</Label>
                  <select
                    value={formIntegration}
                    onChange={(e) => setFormIntegration(e.target.value)}
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
                  >
                    <option value="">Sem integração</option>
                    <option value="GERENCIAAPP">GerenciaApp</option>
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1">
                    Quando configurado, habilita automação ao criar clientes.
                  </p>
                </div>
              )}

              

              {/* CONSTRUTOR DE CAMPOS */}
              <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <h3 className="text-xs font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">
    Campos Personalizados
  </h3>

  {/* Botões — um por tipo, some quando já adicionado */}
  <div className="flex flex-wrap gap-2 sm:justify-end">
    {ALL_FIELD_TYPES.map((type) => {
      const alreadyAdded = formFields.some((f) => f.type === type);
      return (
        <button
          key={type}
          onClick={() => addField(type)}
          disabled={alreadyAdded}
          className={`text-xs px-2 py-1 border rounded font-bold transition-colors flex items-center gap-1
            ${alreadyAdded
              ? "opacity-30 cursor-not-allowed bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
            }`}
        >
          {FIELD_ICONS[type]} + {FIELD_LABELS[type]}
        </button>
      );
    })}
  </div>
</div>

                <div className="space-y-2">
                  {formFields.length === 0 && (
                    <div className="text-center py-4 text-slate-400 text-xs italic border border-dashed border-slate-300 dark:border-white/10 rounded-lg">
                      Nenhum campo extra definido. O app usará apenas o campo "Nome" ou "Usuário".
                    </div>
                  )}

                  {formFields.map((field, index) => (
                    <div
                      key={field.id}
                      draggable
                      onDragStart={() => { dragIndexRef.current = index; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        const from = dragIndexRef.current;
                        if (from === null || from === index) return;
                        setFormFields((prev) => {
                          const next = [...prev];
                          const [moved] = next.splice(from, 1);
                          next.splice(index, 0, moved);
                          return next;
                        });
                        dragIndexRef.current = null;
                      }}
                      onDragEnd={() => { dragIndexRef.current = null; }}
                      className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg cursor-default select-none"
                    >
                      <span
                        className="text-slate-300 dark:text-white/20 hover:text-slate-500 dark:hover:text-white/50 cursor-grab active:cursor-grabbing transition-colors text-sm px-0.5"
                        title="Arrastar para reordenar"
                      >
                        ⠿
                      </span>
                      <span className="text-base">{FIELD_ICONS[field.type]}</span>
                      <span className="flex-1 text-sm font-medium text-slate-700 dark:text-white/80">
                        {FIELD_LABELS[field.type]}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
                        #{index + 1}
                      </span>
                      <button
                        onClick={() => removeField(field.id)}
                        className="w-8 h-8 flex items-center justify-center text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
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

function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }
