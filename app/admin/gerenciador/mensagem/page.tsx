"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";

// --- ÍCONES (ADICIONAR/SUBSTITUIR NO TOPO) ---
function IconEye() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }

// --- DEFINIÇÃO DAS TAGS (REORGANIZADO) ---
const TAG_GROUPS = [
  {
    title: "🤖 Automação Inteligente & Prazos",
    color: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400",
    tags: [
      { label: "{saudacao_tempo}", desc: "Bom dia / Boa tarde / Boa noite" },
      { label: "{dias_desde_cadastro}", desc: "Dias como cliente (Ex: 45 dias)" },
      { label: "{dias_para_vencimento}", desc: "Dias restantes (Ex: 5 dias)" },
      { label: "{dias_atraso}", desc: "Dias de atraso (Ex: 2 dias)" },
      { label: "{hoje_data}", desc: "Data atual (DD/MM/AAAA)" },
      { label: "{hoje_dia_semana}", desc: "Ex: Sexta-feira" },
      { label: "{hora_agora}", desc: "Hora do envio (HH:MM)" },
    ],
  },
  {
    title: "👤 Dados do Cliente",
    color: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
    tags: [
      { label: "{saudacao}", desc: "Sr., Sra. (name_prefix)" },
      { label: "{primeiro_nome}", desc: "Primeiro nome (Ex: João)" },
      { label: "{nome_completo}", desc: "Nome completo (display_name)" },
      { label: "{whatsapp}", desc: "Celular (whatsapp_username)" },
      { label: "{observacoes}", desc: "Notas (notes)" },
      { label: "{data_cadastro}", desc: "Data registro (created_at)" },
    ],
  },
  {
    title: "🖥️ Acesso e Servidor",
    color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
    tags: [
      { label: "{usuario_app}", desc: "Usuário (server_username)" },
      { label: "{senha_app}", desc: "Senha (server_password)" },
      { label: "{plano_nome}", desc: "Plano (plan_label)" },
      { label: "{telas_qtd}", desc: "Telas (screens)" },
      { label: "{tecnologia}", desc: "Tecnologia (technology)" },
      { label: "{servidor_nome}", desc: "Nome do Servidor" },
    ],
  },
  {
    title: "📅 Dados da Assinatura (Datas)",
    color: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
    tags: [
      { label: "{data_vencimento}", desc: "Data exata (DD/MM/AAAA)" },
      { label: "{hora_vencimento}", desc: "Hora exata (HH:MM)" },
      { label: "{dia_da_semana_venc}", desc: "Ex: Segunda-feira" },
    ],
  },
  {
    title: "🏢 Dados da Revenda",
    color: "bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400",
    tags: [
      { label: "{revenda_nome}", desc: "Nome Painel (name)" },
      { label: "{revenda_site}", desc: "Link Painel (panel_web_url)" },
      { label: "{revenda_telegram}", desc: "Telegram (panel_telegram_group)" },
      { label: "{revenda_dns}", desc: "Lista DNS (dns)" },
    ],
  },
{
  title: "💰 Financeiro",
  color: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  tags: [
    { label: "{link_pagamento}", desc: "Link Área do Cliente / Fatura" }, // ✅ Link do token (/renew?t=...)
    { label: "{pin_cliente}", desc: "PIN da Área do Cliente (4 dígitos)" }, // ✅ NOVO: logo após o link
    { label: "{pix_copia_cola}", desc: "Código Pix (Auto)" },
    { label: "{chave_pix_manual}", desc: "Chave manual cadastrada" },
    { label: "{valor_fatura}", desc: "Valor da renovação" },
  ],
},

];

// --- TIPOS ---
type MessageTemplate = {
  id: string;
  name: string;
  content: string;
  updated_at: string;
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function MessagesPage() {
  const [messages, setMessages] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modais
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (type: "success" | "error", title: string, msg?: string) => {
    const id = Date.now();
    setToasts((p) => [...p, { id, type, title, message: msg }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  };
  const removeToast = (id: number) => setToasts((p) => p.filter((t) => t.id !== id));

  // Carregar Mensagens
  async function loadMessages() {
    setLoading(true);
    const tid = await getCurrentTenantId();
    if (!tid) return;

    const { data, error } = await supabaseBrowser
      .from("message_templates")
      .select("id, name, content, updated_at")
      .eq("tenant_id", tid)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error(error);
      addToast("error", "Erro ao carregar", error.message);
    } else {
      setMessages(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadMessages();
  }, []);

  // Deletar Mensagem
  async function handleDelete(id: string) {
    if (!confirm("Tem certeza que deseja excluir este modelo permanentemente?")) return;

    const tid = await getCurrentTenantId();
    if (!tid) {
      setLoading(false);
      return;
    }

    const { error } = await supabaseBrowser
      .from("message_templates")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tid);
    if (error) addToast("error", "Erro ao excluir", error.message);
    else {
      addToast("success", "Excluído", "Modelo removido.");
      loadMessages();
      setShowPreview(false); // Fecha preview se estiver aberto
    }
  }

// Filtro + Ordenação (A–Z) — só visual, não muda regra do banco
const filteredMessages = useMemo(() => {
  const q = search.trim().toLowerCase();

  const filtered = !q
    ? messages
    : messages.filter((m) => String(m.name ?? "").toLowerCase().includes(q));

  // A–Z (case-insensitive / pt-BR)
  return [...filtered].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR", { sensitivity: "base" })
  );
}, [messages, search]);


return (
  <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">

    {/* --- TOPO (PADRÃO CLIENTE) --- */}
    <div className="flex items-center justify-between gap-2 pb-0 mb-2">
      {/* Título (Esquerda) */}
      <div className="min-w-0 text-left">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
          Mensagens
        </h1>
      </div>

      {/* Ações (Direita) */}
      <div className="flex items-center gap-2 justify-end shrink-0">
        
        {/* Busca Larga */}
        <div className="relative w-40 sm:w-64">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar..."
            className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-emerald-500/50 text-slate-700 dark:text-white"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-rose-500">
              <IconX />
            </button>
          )}
        </div>

        {/* Botão Novo (Verde com texto) */}
        <button
          onClick={() => {
            setSelectedTemplate(null);
            setShowEditor(true);
          }}
          className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
        >
          <span className="text-lg leading-none mb-0.5">+</span> 
          <span className="hidden sm:inline">Nova Mensagem</span>
          <span className="sm:hidden">Novo</span>
        </button>
      </div>
    </div>

    {/* --- LISTA DE MENSAGENS (LINHA ÚNICA) --- */}
    {loading ? (
      <div className="p-12 text-center text-slate-400 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/5">
        Carregando modelos...
      </div>
    ) : filteredMessages.length === 0 ? (
      <div className="p-12 text-center bg-white dark:bg-[#161b22] rounded-xl border border-dashed border-slate-300 dark:border-white/10">
        <div className="text-4xl mb-2">💬</div>
        <h3 className="text-slate-500 dark:text-white/60 font-bold">Nenhum modelo encontrado</h3>
      </div>
    ) : (
      <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden">
        
        {/* Cabeçalho da Lista (Opcional, igual Cliente) */}
        <div className="px-3 sm:px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex items-center justify-between text-xs font-bold uppercase text-slate-500 dark:text-white/40">
           <div>Nome do Modelo</div>
           <div>Ações</div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-white/5">
          {filteredMessages.map((msg) => (
            <div 
              key={msg.id} 
              className="group flex items-center justify-between p-3 sm:px-5 sm:py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              {/* LADO ESQUERDO: Nome e Data */}
              <div className="flex flex-col min-w-0 pr-3">
                <span 
                  className="font-semibold text-slate-700 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors cursor-pointer text-sm sm:text-base"
                  onClick={() => { setSelectedTemplate(msg); setShowEditor(true); }}
                >
                  {msg.name}
                </span>
                <span className="text-[10px] sm:text-xs text-slate-400 dark:text-white/40 mt-0.5 font-medium">
                  Atualizado: {new Date(msg.updated_at).toLocaleDateString("pt-BR")}
                </span>
              </div>

              {/* LADO DIREITO: Botões na mesma linha */}
              <div className="flex items-center gap-2 shrink-0">
                
                {/* Botão Ver (Azul) */}
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedTemplate(msg); setShowPreview(true); }}
                  className="p-1.5 rounded-lg border border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-500/20 transition-all"
                  title="Visualizar"
                >
                  <IconEye />
                </button>

                {/* Botão Editar (Âmbar) */}
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedTemplate(msg); setShowEditor(true); }}
                  className="p-1.5 rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-all"
                  title="Editar"
                >
                  <IconEdit />
                </button>

                {/* Botão Excluir (Vermelho) */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(msg.id); }}
                  className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-all"
                  title="Excluir"
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* Espaço fixo no final */}
    <div className="h-24 md:h-20" />

    {/* MODAIS */}
    {showEditor && (
      <EditorModal
        templateToEdit={selectedTemplate}
        onClose={() => setShowEditor(false)}
        onSuccess={() => {
          setShowEditor(false);
          loadMessages();
          addToast("success", "Salvo", "Modelo salvo com sucesso.");
        }}
        onError={(msg) => addToast("error", "Erro", msg)}
      />
    )}

    {showPreview && selectedTemplate && (
      <PreviewModal
        template={selectedTemplate}
        onClose={() => setShowPreview(false)}
        onEdit={() => {
          setShowPreview(false);
          setShowEditor(true);
        }}
      />
    )}

    <div className="relative z-[999999]">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />
    </div>
  </div>
);
}

// ============================================================================
// MODAL DE VISUALIZAÇÃO (PREVIEW)
// ============================================================================
function PreviewModal({
  template,
  onClose,
  onEdit,
}: {
  template: MessageTemplate;
  onClose: () => void;
  onEdit: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <h3 className="font-bold text-slate-800 dark:text-white truncate pr-4">{template.name}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar bg-slate-50/50 dark:bg-black/20">
          <div className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300 font-mono leading-relaxed bg-white dark:bg-[#0d1117] p-4 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
            {template.content}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 dark:border-white/5 flex justify-end gap-2 bg-white dark:bg-[#161b22]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-xs hover:bg-slate-50 dark:hover:bg-white/5 transition-colors uppercase"
          >
            Fechar
          </button>
          <button
            onClick={onEdit}
            className="px-6 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-lg shadow-amber-500/20 transition-transform active:scale-95 uppercase flex items-center gap-2"
          >
            ✏️ Editar Modelo
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================================
// MODAL EDITOR
// ============================================================================
function EditorModal({
  templateToEdit,
  onClose,
  onSuccess,
  onError,
}: {
  templateToEdit?: MessageTemplate | null;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(templateToEdit?.name || "");
  const [content, setContent] = useState(templateToEdit?.content || "");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // MOBILE tags (novo)
  const [mobileTagsOpen, setMobileTagsOpen] = useState(false);
  const [mobileTagsQuery, setMobileTagsQuery] = useState("");

  const insertTag = (tag: string) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;
    const newText = text.substring(0, start) + tag + text.substring(end);
    setContent(newText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start + tag.length, start + tag.length);
      }
    }, 0);
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      alert("Preencha o nome e o conteúdo da mensagem.");
      return;
    }
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      if (!tid) throw new Error("Sessão inválida.");

      const payload = {
        tenant_id: tid,
        name,
        content,
        updated_at: new Date().toISOString(),
      };

      if (templateToEdit?.id) {
        const { error } = await supabaseBrowser
          .from("message_templates")
          .update(payload)
          .eq("id", templateToEdit.id)
          .eq("tenant_id", tid);

        if (error) throw error;
      } else {
        const { error } = await supabaseBrowser.from("message_templates").insert(payload);

        if (error) throw error;
      }

      onSuccess();
    } catch (error: any) {
      console.error(error);
      onError(error.message || "Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  };

  const filteredMobileTags = useMemo(() => {
    const all = TAG_GROUPS.flatMap((group) =>
      group.tags.map((tag) => ({
        ...tag,
        groupTitle: group.title,
        color: group.color,
      }))
    );

    const q = mobileTagsQuery.trim().toLowerCase();
    if (!q) return all;

    return all.filter((t) => {
      const hay = `${t.label} ${t.desc} ${t.groupTitle}`.toLowerCase();
      return hay.includes(q);
    });
  }, [mobileTagsQuery]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-6xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-xl">
              📝
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                {templateToEdit ? "Editar Mensagem" : "Criar Nova Mensagem"}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          
          {/* Editor */}
          <div className="flex-1 p-6 flex flex-col gap-5 overflow-y-auto custom-scrollbar lg:border-r border-slate-100 dark:border-white/5">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-white/50 uppercase mb-1.5 tracking-wider">
                Nome do Modelo (Identificação interna)
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Cobrança 3 dias antes..."
                className="w-full h-12 px-4 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-slate-800 dark:text-white outline-none focus:border-emerald-500 transition-colors font-medium"
                autoFocus
              />
            </div>

            {/* --- MOBILE: ACCORDION DE VARIÁVEIS (INSERIDO AQUI) --- */}
            <div className="lg:hidden">
              <button
                type="button"
                onClick={() => setMobileTagsOpen(!mobileTagsOpen)}
                className={`w-full h-10 px-4 rounded-xl border flex items-center justify-between transition-all ${
                    mobileTagsOpen 
                    ? "bg-slate-100 dark:bg-white/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" 
                    : "bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-700 dark:text-white"
                }`}
              >
                <span className="font-bold text-xs flex items-center gap-2">
                  🏷️ Inserir Variáveis
                </span>
                <span className={`text-[10px] transition-transform ${mobileTagsOpen ? "rotate-180" : ""}`}>
                  ▼
                </span>
              </button>

              {/* Conteúdo que abre ao clicar (Acordeão) */}
              {mobileTagsOpen && (
                <div className="mt-2 p-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 animate-in slide-in-from-top-2 duration-200">
                  <input
                    value={mobileTagsQuery}
                    onChange={(e) => setMobileTagsQuery(e.target.value)}
                    placeholder="Filtrar variável..."
                    className="w-full h-9 px-3 mb-2 rounded-lg bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 text-xs outline-none focus:border-emerald-500/50"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="max-h-[160px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {filteredMobileTags.length === 0 ? (
                       <div className="text-center py-2 text-xs text-slate-400">Nenhuma variável encontrada.</div>
                    ) : (
                       filteredMobileTags.map((tag) => (
                        <button
                          key={tag.label}
                          type="button"
                          onClick={() => insertTag(tag.label)}
                          className="w-full text-left px-3 py-2 rounded-md bg-white dark:bg-white/5 border border-slate-100 dark:border-white/5 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 flex items-center justify-between group"
                        >
                          <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">{tag.label}</span>
                          <span className="text-[9px] text-slate-400 truncate ml-2 max-w-[120px]">{tag.desc}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* --- FIM DO MOBILE ACCORDION --- */}

            <div className="flex-1 flex flex-col">
              <label className="block text-xs font-bold text-slate-500 dark:text-white/50 uppercase mb-1.5 tracking-wider">
                Conteúdo da Mensagem
              </label>
              <div className="flex-1 relative group">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Olá {primeiro_nome}, sua fatura..."
                  className="w-full h-full min-h-[300px] p-5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-slate-700 dark:text-white outline-none focus:border-emerald-500 transition-colors resize-none leading-relaxed text-sm font-mono shadow-inner"
                />
              </div>
            </div>
          </div>

          {/* DESKTOP: Variáveis na lateral (sem mudar lógica) */}
          <div className="hidden lg:flex w-96 bg-white dark:bg-[#161b22] flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5">
              <h3 className="text-xs font-bold text-slate-600 dark:text-white uppercase tracking-widest flex items-center gap-2">
                🏷️ Variáveis Disponíveis
              </h3>
              <p className="text-[10px] text-slate-400 mt-1">Clique para inserir no texto</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-slate-50/30 dark:bg-black/10">
              {TAG_GROUPS.map((group, idx) => (
                <div key={idx}>
                  <h4 className="text-[10px] font-bold text-slate-400 dark:text-white/40 mb-2 uppercase flex items-center gap-2 tracking-wider ml-1">
                    {group.title}
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {group.tags.map((tag) => (
                      <button
                        key={tag.label}
                        onClick={() => insertTag(tag.label)}
                        className={`text-left px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/5 hover:brightness-95 hover:shadow-sm active:scale-95 transition-all flex flex-col group ${group.color} bg-white dark:bg-[#1c2128]`}
                      >
                        <span className="font-mono text-xs font-bold tracking-tight">{tag.label}</span>
                        <span className="text-[10px] opacity-60 group-hover:opacity-100 mt-0.5 font-medium">
                          {tag.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-between items-center">
          <div className="text-xs text-slate-400 hidden sm:block">
            💡 Dica: Use <strong>{`{saudacao_tempo}`}</strong> para enviar "Bom dia" automático.
          </div>
          <div className="flex gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-6 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 font-bold text-xs hover:bg-white dark:hover:bg-white/10 transition-colors uppercase tracking-wider"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 sm:flex-none px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-900/20 transition-transform active:scale-95 flex items-center justify-center gap-2 uppercase tracking-wider disabled:opacity-50"
            >
              {loading ? "Salvando..." : templateToEdit ? "Atualizar Modelo" : "Salvar Modelo"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
