"use client";
// app/admin/gerenciador/mensagem/page.tsx
import { X, Pencil, MessageCircle } from "lucide-react";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, {
  ToastMessage,
} from "@/app/admin/ToastNotifications";

// --- ÍCONES (ADICIONAR/SUBSTITUIR NO TOPO) ---
function IconEye() {
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
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEdit() {
  return <Pencil className="w-4 h-4" />;
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
function IconX() {
  return <X className="w-4 h-4" />;
}
function IconImage() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
function IconUpload() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// --- DEFINIÇÃO DAS TAGS (REORGANIZADO) ---
const TAG_GROUPS = [
  {
    title: "🤖 Automação Inteligente & Prazos",
    color: "bg-indigo-500/10 text-indigo-500",
    tags: [
      { label: "{saudacao_tempo}", desc: "Bom dia / Boa tarde / Boa noite" },
      {
        label: "{dias_desde_cadastro}",
        desc: "Dias como cliente (Ex: 45 dias)",
      },
      { label: "{dias_para_vencimento}", desc: "Dias restantes (Ex: 5 dias)" },
      { label: "{dias_atraso}", desc: "Dias de atraso (Ex: 2 dias)" },
      { label: "{hoje_data}", desc: "Data atual (DD/MM/AAAA)" },
      { label: "{hoje_dia_semana}", desc: "Ex: Sexta-feira" },
      { label: "{hora_agora}", desc: "Hora do envio (HH:MM)" },
    ],
  },
  {
    title: "👤 Dados do Cliente",
    color: "bg-sky-500/10 text-sky-500",
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
    color: "bg-emerald-500/10 text-emerald-500",
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
    color: "bg-rose-500/10 text-rose-500",
    tags: [
      { label: "{data_vencimento}", desc: "Data exata (DD/MM/AAAA)" },
      { label: "{hora_vencimento}", desc: "Hora exata (HH:MM)" },
      { label: "{dia_da_semana_venc}", desc: "Ex: Segunda-feira" },
    ],
  },
  {
    title: "🏢 Dados da Revenda",
    color: "bg-purple-500/10 text-purple-500",
    tags: [
      { label: "{revenda_nome}", desc: "Nome do Revendedor" },
      {
        label: "{usuario_revenda}",
        desc: "Usuário no Painel (server_username)",
      }, // ✅ NOVO
      { label: "{revenda_site}", desc: "Link Painel (panel_web_url)" },
      { label: "{revenda_telegram}", desc: "Telegram (panel_telegram_group)" },
      { label: "{revenda_dns}", desc: "Lista DNS (dns)" },
    ],
  },
  {
    title: "💰 Financeiro",
    color: "bg-amber-500/10 text-amber-500",
    tags: [
      { label: "{venda_creditos}", desc: "Qtd. de Créditos da Última Recarga" },
      { label: "{link_pagamento}", desc: "Link Área do Cliente / Fatura" },
      { label: "{pin_cliente}", desc: "PIN da Área do Cliente (4 dígitos)" },
      { label: "{valor_fatura}", desc: "Valor da renovação" },
      { label: "{moeda_cliente}", desc: "BRL/USD/EUR" },
      { label: "{pix_copia_cola}", desc: "Código PIX copia-e-cola automático (gateway online)" },

      // ✅ PIX Manual
      { label: "{pix_manual_cnpj}", desc: "Chave PIX (tipo CNPJ)" },
      { label: "{pix_manual_cpf}", desc: "Chave PIX (tipo CPF)" },
      { label: "{pix_manual_email}", desc: "Chave PIX (tipo E-mail)" },
      { label: "{pix_manual_phone}", desc: "Chave PIX (tipo Telefone)" },
      { label: "{pix_manual_aleatoria}", desc: "Chave PIX Aleatória" },

      // ✅ Transferência Internacional Manual
      { label: "{transfer_iban}", desc: "Código IBAN (Conta Int.)" },
      { label: "{transfer_swift}", desc: "Código SWIFT/BIC (Conta Int.)" },
    ],
  },
];

// --- Nomes Protegidos pelo Sistema ---
const PROTECTED_TEMPLATES = ["Pagamento Realizado", "Teste - Boas-vindas"];

// --- TIPOS ---
type MessageTemplate = {
  id: string;
  name: string;
  content: string;
  updated_at: string;
  is_system_default: boolean;
  image_url: string | null;
  category?: string | null;
};

// ✅ Categorias do Sistema
const MESSAGE_CATEGORIES = [
  "Cliente IPTV",
  "Vencimentos",
  "Promoções",
  "Manutenção",
  "Fidelidade",
  "Geral",
];

// ✅ Reconhecedor Automático Simplificado
function getTemplateCategory(msg: MessageTemplate) {
  if (msg.category && msg.category !== "Geral") return msg.category;
  if (msg.name === "Pagamento Realizado" || msg.name === "Teste - Boas-vindas")
    return "Cliente IPTV";
  return "Geral";
}

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
  const [selectedTemplate, setSelectedTemplate] =
    useState<MessageTemplate | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (type: "success" | "error", title: string, msg?: string) => {
    const id = Date.now();
    setToasts((p) => [...p, { id, type, title, message: msg }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  };
  const removeToast = (id: number) =>
    setToasts((p) => p.filter((t) => t.id !== id));

  async function loadMessages() {
    setLoading(true);
    const tid = await getCurrentTenantId();

    if (!tid) {
      setLoading(false);
      return;
    }

    // ✅ Acesso total, sem travas
    const { data, error } = await supabaseBrowser
      .from("message_templates")
      .select(
        "id, name, content, updated_at, is_system_default, image_url, category",
      )
      .eq("tenant_id", tid)
      .order("is_system_default", { ascending: false });

    if (error) {
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
    if (!confirm("Tem certeza que deseja excluir este modelo permanentemente?"))
      return;

    const tid = await getCurrentTenantId();
    if (!tid) return;

    // ✅ Encontra o template para ver se tem imagem
    const tpl = messages.find((m) => m.id === id);
    if (tpl?.image_url) {
      try {
        const oldPath = tpl.image_url.split("/chat_media/")[1];
        if (oldPath) {
          await supabaseBrowser.storage.from("chat_media").remove([oldPath]);
        }
      } catch (e) {}
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
      setShowPreview(false);
    }
  }

  // Filtro + Ordenação (A–Z) — só visual, não muda regra do banco
  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = !q
      ? messages
      : messages.filter((m) => {
          const name = String(m.name ?? "").toLowerCase();
          const content = String(m.content ?? "").toLowerCase();
          return name.includes(q) || content.includes(q);
        });

    // A–Z (case-insensitive / pt-BR)
    return [...filtered].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR", {
        sensitivity: "base",
      }),
    );
  }, [messages, search]);

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* Topo (padrão admin) */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-medium text-foreground tracking-tight truncate">
              Mensagens
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={() => {
              setSelectedTemplate(null);
              setShowEditor(true);
            }}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="text-base md:text-lg leading-none mb-0.5">+</span>{" "}
            Nova Mensagem
          </button>
        </div>
      </div>

      {/* Barra de Busca (padrão admin) */}
      <div
        className="p-0 px-3 sm:px-0 md:p-4 bg-transparent md:bg-card border-0 md:border md:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-4 md:mb-6 md:sticky md:top-4 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden md:block text-xs font-medium uppercase text-muted-foreground tracking-wider">
          Busca
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar modelo (nome ou conteúdo)..."
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
            />

            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
                title="Limpar busca"
                aria-label="Limpar busca"
              >
                <IconX />
              </button>
            )}
          </div>

          <button
            onClick={() => setSearch("")}
            className="hidden md:inline-flex h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-sm font-medium hover:bg-rose-500/20 transition-colors items-center justify-center gap-2"
          >
            <IconX /> Limpar
          </button>
        </div>
      </div>

      {/* LISTA DE MENSAGENS (LISTA COM SELEÇÃO + AÇÕES À DIREITA) */}
      {loading ? (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-none sm:rounded-xl border border-border font-medium">
          Carregando modelos...
        </div>
      ) : filteredMessages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-card border border-dashed border-border rounded-none sm:rounded-2xl">
          <div className="w-16 h-16 bg-transparent border border-border rounded-full flex items-center justify-center mb-4 text-3xl">
            <MessageCircle className="w-4 h-4" />
          </div>
          <h3 className="text-lg font-medium text-foreground/90">
            Nenhum modelo encontrado
          </h3>
          <p className="text-sm text-foreground/70 mt-1">
            Crie um novo modelo ou ajuste sua busca.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(() => {
            // Função auxiliadora para renderizar os blocos separados
            const renderGroup = (
              title: string,
              icon: string,
              items: MessageTemplate[],
            ) => {
              if (items.length === 0) return null;
              return (
                <div className="bg-card border-y sm:border border-border rounded-none sm:rounded-xl shadow-sm overflow-hidden">
                  <div className="px-3 sm:px-5 py-3 border-b border-border flex items-center justify-between bg-transparent">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg">{icon}</span>
                      <h2 className="text-sm font-medium text-foreground/90 truncate">
                        {title}
                      </h2>
<span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-xs font-medium">
                        {items.length}
                      </span>
                    </div>
                    <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider hidden sm:block">
                      Selecione para destacar
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:gap-[1px] bg-transparent border border-border">
                    {items.map((msg) => {
                      const isSelected = selectedTemplate?.id === msg.id;
                      const isProtected =
                        msg.is_system_default ||
                        PROTECTED_TEMPLATES.includes(msg.name);

                      return (
                        <div
                          key={msg.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedTemplate(msg)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setSelectedTemplate(msg);
                          }}
                          className={[
                            "w-full flex items-center justify-between gap-2 px-3 sm:px-5 py-3 transition-colors cursor-pointer bg-card",
                            isSelected
                              ? "bg-emerald-500/10"
                              : "hover:bg-muted/30",
                          ].join(" ")}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={[
                                  "inline-flex w-2 h-2 rounded-full shrink-0",
                                  isSelected
                                    ? "bg-emerald-500"
                                    : "bg-muted",
                                ].join(" ")}
                              />
                              <h3
                                className="font-medium text-foreground text-sm sm:text-base truncate"
                                title={msg.name}
                              >
                                {msg.name}
                              </h3>
                            </div>
                            <div className="mt-1 text-[10px] sm:text-xs text-muted-foreground ml-4">
                              Atualizado:{" "}
                              {new Date(msg.updated_at).toLocaleDateString(
                                "pt-BR",
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTemplate(msg);
                                setShowPreview(true);
                              }}
                              className="flex items-center justify-center w-8 h-8 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 transition-all"
                              title="Ver"
                            >
                              <IconEye />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTemplate(msg);
                                setShowEditor(true);
                              }}
                              className="flex items-center justify-center w-8 h-8 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all"
                              title="Editar"
                            >
                              <IconEdit />
                            </button>
                            {!isProtected && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(msg.id);
                                }}
                                className="flex items-center justify-center w-8 h-8 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all"
                                title="Excluir"
                              >
                                <IconTrash />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            };

            return (
              <>
                {MESSAGE_CATEGORIES.map((cat) => {
                  let items = filteredMessages.filter(
                    (m) => getTemplateCategory(m) === cat,
                  );
                  if (items.length === 0) return null;

                  // Título dinâmico
                  let displayTitle = cat === "Cliente IPTV" ? "Clientes" : cat;

                  // Ícones
                  let icon = "💬";
                  if (cat === "Cliente IPTV") icon = "📺";
                  else if (cat === "Vencimentos") icon = "📅";
                  else if (cat === "Promoções") icon = "🎉";
                  else if (cat === "Manutenção") icon = "⚙️";
                  else if (cat === "Fidelidade") icon = "⭐";

                  return (
                    <div key={cat}>
                      {renderGroup(displayTitle, icon, items)}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}

      {/* Espaço fixo pós-lista */}
      <div className="h-24 md:h-20" />

      {/* MODAL EDITOR (CRIAR/EDITAR) */}
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

      {/* MODAL PREVIEW (VISUALIZAR) */}
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
  // ✅ NOVO: Estado para dar o feedback visual de "Copiado"
  const [copied, setCopied] = useState(false);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full h-full sm:h-auto max-w-lg bg-card border-0 sm:border border-border rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[80vh]">
        {/* Cabeçalho */}
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-border flex justify-between items-center bg-transparent shrink-0">
          <h3 className="font-medium text-foreground truncate pr-4 text-base sm:text-lg">
            {template.name}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

{/* Conteúdo da Mensagem */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto custom-scrollbar bg-muted/20 border border-border">
          <div className="flex flex-col gap-4 whitespace-pre-wrap text-sm text-muted-foreground font-mono leading-relaxed bg-card p-3 sm:p-4 rounded-xl border border-border shadow-sm min-h-full">
            {/* ✅ PREVIEW DA IMAGEM SE HOUVER */}
            {template.image_url && (
              <div className="relative w-full max-w-sm mx-auto bg-transparent border border-border rounded-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={template.image_url}
                  alt="Imagem da mensagem"
                  className="w-full h-auto object-cover"
                />
              </div>
            )}
            <div>{template.content}</div>
          </div>
        </div>

        {/* Rodapé e Botões (AGORA COM O BOTÃO DE COPIAR) */}
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-border flex justify-end gap-2 bg-card shrink-0">
          {/* ✅ NOVO: BOTÃO DE COPIAR */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(template.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000); // Volta ao normal após 2 segundos
            }}
className={`flex-1 sm:flex-none px-4 py-2.5 sm:py-2 rounded-lg border font-medium text-xs transition-colors uppercase flex items-center justify-center gap-1.5 ${
              copied
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-border text-foreground/90 hover:bg-muted"
            }`}
          >
            {copied ? (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Copiado!
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copiar
              </>
            )}
          </button>

          <button
            onClick={onClose}
            className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 rounded-lg border border-border text-muted-foreground font-medium text-xs hover:bg-muted transition-colors uppercase"
          >
            Fechar
          </button>

          <button
            onClick={onEdit}
            className="flex-1 sm:flex-none px-6 py-2.5 sm:py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs shadow-lg shadow-amber-900/20 transition-transform active:scale-95 uppercase flex items-center justify-center gap-2"
          >
            ✏️ Editar Modelo
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
  const [category, setCategory] = useState(
    templateToEdit ? getTemplateCategory(templateToEdit) : "Geral",
  ); // ✅ Inicia com a categoria certa

  // ✅ Controle de Grupos Minimizados (inicia tudo fechado/vazio)
  const [openDesktopGroups, setOpenDesktopGroups] = useState<number[]>([]);
  const toggleDesktopGroup = (idx: number) => {
    setOpenDesktopGroups((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx],
    );
  };

  // ✅ NOVO: Controle de Imagem
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    templateToEdit?.image_url || null,
  );
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ✅ Motor de Compressão Frontend (Gera JPEGs super leves)
  async function compressImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 800; // Resolução ideal para WhatsApp
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height && width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          } else if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error("Falha na compressão"));
            },
            "image/jpeg",
            0.75,
          ); // 75% de Qualidade
        };
        img.onerror = (e) => reject(e);
      };
      reader.onerror = (e) => reject(e);
    });
  }

  // ✅ Descobre se o template aberto é bloqueado para troca de nome
  const isProtected =
    templateToEdit?.is_system_default ||
    (templateToEdit?.name && PROTECTED_TEMPLATES.includes(templateToEdit.name));

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
        textareaRef.current.setSelectionRange(
          start + tag.length,
          start + tag.length,
        );
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

      let finalImageUrl = templateToEdit?.image_url || null;

      // 1. Se o usuário deletou a foto antiga
      if (!previewUrl && templateToEdit?.image_url) {
        const oldPath = templateToEdit.image_url.split("/chat_media/")[1];
        if (oldPath)
          await supabaseBrowser.storage.from("chat_media").remove([oldPath]);
        finalImageUrl = null;
      }

      // 2. Se o usuário escolheu uma nova foto
      if (imageFile) {
        const compressedBlob = await compressImage(imageFile);
        const fileName = `${Date.now()}-${imageFile.name.replace(/[^a-zA-Z0-9.-]/g, "")}.jpg`;
        const filePath = `${tid}/templates/${fileName}`;

        const { error: uploadErr } = await supabaseBrowser.storage
          .from("chat_media")
          .upload(filePath, compressedBlob, {
            contentType: "image/jpeg",
            upsert: true,
          });

        if (uploadErr)
          throw new Error(
            "Falha ao fazer upload da imagem: " + uploadErr.message,
          );

        const { data: pubData } = supabaseBrowser.storage
          .from("chat_media")
          .getPublicUrl(filePath);
        finalImageUrl = pubData.publicUrl;

        // Limpa a foto anterior do banco se existia
        if (templateToEdit?.image_url) {
          const oldPath = templateToEdit.image_url.split("/chat_media/")[1];
          if (oldPath)
            await supabaseBrowser.storage.from("chat_media").remove([oldPath]);
        }
      }

      const payload = {
        tenant_id: tid,
        name,
        content,
        category, // ✅ Salva a categoria no banco
        image_url: finalImageUrl,
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
        const { error } = await supabaseBrowser
          .from("message_templates")
          .insert(payload);

        if (error) throw error;
      }

      onSuccess();
    } catch (error: any) {
      onError(error.message || "Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Uso direto do TAG_GROUPS sem burocracia
  const filteredMobileTags = useMemo(() => {
    const all = TAG_GROUPS.flatMap((group) =>
      group.tags.map((tag) => ({
        ...tag,
        groupTitle: group.title,
        color: group.color,
      })),
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
    <div className="fixed inset-0 z-[99999] flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div
        className="w-full h-full sm:h-auto max-w-6xl bg-card border-0 sm:border border-border rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[100dvh] sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border flex justify-between items-center bg-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-xl">
              <Pencil className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-foreground">
                {templateToEdit ? "Editar Mensagem" : "Criar Nova Mensagem"}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* MOBILE: Variáveis como filtro acima do conteúdo */}
          <div className="lg:hidden border-b border-border bg-card">
            <div className="p-3">
              <button
                type="button"
                onClick={() => setMobileTagsOpen((v) => !v)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-transparent text-foreground/90 font-medium text-xs flex items-center justify-between"
              >
<span className="flex items-center gap-2">
                  🏷️ Variáveis
                  <span className="text-[10px] font-medium text-muted-foreground/60">
                    (toque para {mobileTagsOpen ? "fechar" : "abrir"})
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {mobileTagsOpen ? "▲" : "▼"}
                </span>
              </button>

              {mobileTagsOpen && (
                <div className="mt-3 rounded-xl border border-border bg-card overflow-hidden">
                  <div className="p-3 border-b border-border bg-transparent">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                      🏷️ Variáveis Disponíveis
                    </h3>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Toque para inserir no texto
                    </p>

                    <input
                      value={mobileTagsQuery}
                      onChange={(e) => setMobileTagsQuery(e.target.value)}
                      placeholder="Filtrar (ex: vencimento, pix, primeiro_nome...)"
                      className="mt-3 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm text-foreground/90 outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div className="max-h-[38vh] overflow-y-auto p-3 space-y-2 custom-scrollbar bg-transparent">
                    {filteredMobileTags.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-6 text-center">
                        Nenhuma variável encontrada.
                      </div>
                    ) : (
                      filteredMobileTags.map((tag) => (
                        <button
                          key={tag.label}
                          onClick={() => {
                            insertTag(tag.label);
                            setMobileTagsOpen(false);
                          }}
                          className={`text-left px-3 py-2.5 rounded-lg border border-border hover:brightness-95 hover:shadow-sm active:scale-95 transition-all flex flex-col group ${tag.color} bg-card`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium tracking-tight">
                              {tag.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60 font-medium truncate">
                              {tag.groupTitle}
                            </span>
                          </div>
                          <span className="text-[10px] opacity-60 group-hover:opacity-100 mt-0.5 font-medium">
                            {tag.desc}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 p-3 sm:p-6 flex flex-col gap-5 overflow-y-auto custom-scrollbar lg:border-r border-border">
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5 tracking-wider">
                Nome do Modelo (Identificação interna)
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Cobrança 3 dias antes..."
                readOnly={isProtected} // 🔒 Trava a edição do nome
className={`w-full h-12 px-4 border rounded-xl text-foreground outline-none focus:border-emerald-500 transition-colors font-medium ${
                  isProtected
                    ? "bg-transparent border-border border-dashed text-muted-foreground cursor-not-allowed"
                    : "bg-transparent border-border"
                }`}
                autoFocus={!isProtected}
              />
              {isProtected && (
                <p className="text-[10px] text-sky-500 mt-2 font-medium flex items-center gap-1">
                  🔒 Este é um modelo fundamental do sistema. O nome não pode
                  ser alterado, apenas o seu conteúdo.
                </p>
              )}
            </div>

            {/* ✅ NOVO: Seletor de Categoria */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase mb-1.5 tracking-wider">
                Categoria da Mensagem
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-12 px-4 border rounded-xl text-foreground outline-none focus:border-emerald-500 transition-colors font-medium bg-transparent border-border"
              >
                {MESSAGE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 flex flex-col">
              <div className="flex justify-between items-end mb-2">
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Conteúdo da Mensagem
                </label>

                {/* ✅ BOTÃO E INPUT OCULTO PARA IMAGEM */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setImageFile(file);
                      setPreviewUrl(URL.createObjectURL(file));
                    }
                  }}
                />
                {!previewUrl && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 text-[11px] font-medium hover:bg-sky-500/20 transition-colors"
                  >
                    <IconUpload /> Adicionar Imagem
                  </button>
                )}
              </div>

              {/* ✅ PREVIEW DA IMAGEM UPLOADADA */}
              {previewUrl && (
                <div className="relative mb-3 w-max group animate-in fade-in zoom-in-95 duration-200">
                  <div className="w-24 h-24 rounded-lg overflow-hidden border border-border shadow-sm relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <IconImage />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setPreviewUrl(null);
                      setImageFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-500/10 text-rose-500 shadow-md flex items-center justify-center hover:scale-110 transition-transform"
                    title="Remover Imagem"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="flex-1 relative group">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Olá {primeiro_nome}, sua fatura..."
                  className="w-full h-full min-h-[220px] sm:min-h-[300px] p-4 sm:p-5 bg-transparent border border-border rounded-xl text-foreground/90 outline-none focus:border-emerald-500 transition-colors resize-none leading-relaxed text-sm font-mono shadow-inner"
                />
              </div>
            </div>
          </div>

          {/* DESKTOP: Variáveis na lateral (sem mudar lógica) */}
          <div className="hidden lg:flex w-96 bg-card flex-col">
            <div className="p-4 border-b border-border bg-transparent">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                🏷️ Variáveis Disponíveis
              </h3>
              <p className="text-[10px] text-muted-foreground mt-1">
                Clique para inserir no texto
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-transparent">
              {TAG_GROUPS.map((group, idx) => {
                const isOpen = openDesktopGroups.includes(idx);
                return (
                  <div
                    key={idx}
                    className="bg-card rounded-xl border border-border overflow-hidden transition-all shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => toggleDesktopGroup(idx)}
                      className={`w-full flex items-center justify-between p-3 text-left transition-colors ${isOpen ? "bg-transparent border-b border-border" : "hover:bg-muted/30"}`}
                    >
                      <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {group.title}
                      </h4>
                      <span className="text-muted-foreground text-xs">
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="p-3 grid grid-cols-1 gap-2 bg-transparent">
{group.tags.map((tag) => (
                          <button
                            key={tag.label}
                            onClick={() => insertTag(tag.label)}
                            className={`text-left px-3 py-2.5 rounded-lg border border-border hover:brightness-95 hover:shadow-sm active:scale-95 transition-all flex flex-col group ${group.color} bg-card`}
                          >
                            <span className="text-xs font-medium tracking-tight">
                              {tag.label}
                            </span>
                            <span className="text-[10px] opacity-60 group-hover:opacity-100 mt-0.5 font-medium">
                              {tag.desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border bg-transparent flex justify-between items-center">
          <div className="text-xs text-muted-foreground hidden sm:block">
            💡 Dica: Use <strong>{`{saudacao_tempo}`}</strong> para enviar "Bom
            dia" automático.
          </div>
          <div className="flex gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-6 py-3 rounded-xl border border-border text-muted-foreground font-medium text-xs hover:bg-muted transition-colors uppercase tracking-wider"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 sm:flex-none px-8 py-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-xs shadow-lg shadow-emerald-900/20 transition-transform active:scale-95 flex items-center justify-center gap-2 uppercase tracking-wider disabled:opacity-50"
            >
              {loading
                ? "Salvando..."
                : templateToEdit
                  ? "Atualizar Modelo"
                  : "Salvar Modelo"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
