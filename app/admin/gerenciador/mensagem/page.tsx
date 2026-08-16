"use client";
// app/admin/gerenciador/mensagem/page.tsx
import { X, Pencil, MessageCircle, Trash2 } from "lucide-react";

import { useState, useRef, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import {
  type MessageTemplate,
  MESSAGE_CATEGORIES,
  PROTECTED_TEMPLATES,
  getTemplateCategory,
} from "./shared";

// ✅ Carregamento sob demanda (15/08/2026) — EditorModal (o mais pesado,
// ~780 linhas: form completo + variações com IA) e PreviewModal só
// carregam quando o admin realmente abre um deles.
const EditorModal = dynamic(() => import("./EditorModal"), { ssr: false });
const PreviewModal = dynamic(() => import("./PreviewModal"), { ssr: false });

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
  return <Trash2 className="w-4 h-4" />;
}
function IconX() {
  return <X className="w-4 h-4" />;
}
// ✅ Rótulo e ícone de exibição por categoria (usado no filtro e nos grupos)
function getCategoryDisplay(cat: string) {
  if (cat === "Cliente IPTV") return { label: "Clientes", icon: "📺" };
  if (cat === "Vencimentos") return { label: "Vencimentos", icon: "📅" };
  if (cat === "Promoções") return { label: "Promoções", icon: "🎉" };
  if (cat === "Manutenção") return { label: "Manutenção", icon: "⚙️" };
  if (cat === "Fidelidade") return { label: "Fidelidade", icon: "⭐" };
  return { label: cat, icon: "💬" };
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function MessagesPage() {
  const tenantId = useTenantId();
  const [messages, setMessages] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todos");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { confirm } = useConfirm();

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
    const tid = tenantId;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Deletar Mensagem
  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Excluir modelo?",
      subtitle: "Tem certeza que deseja excluir este modelo permanentemente?",
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    const tid = tenantId;
    if (!tid) return;

    // ✅ Encontra o template para ver se tem imagem
    const tpl = messages.find((m) => m.id === id);
    if (tpl?.image_url) {
      try {
        const oldPath = tpl.image_url.split("/chat_media/")[1];
        if (oldPath) {
          await supabaseBrowser.storage.from("chat_media").remove([oldPath]);
        }
      } catch {}
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

    const filtered = messages.filter((m) => {
      if (
        categoryFilter !== "Todos" &&
        getTemplateCategory(m) !== categoryFilter
      )
        return false;

      if (q) {
        const name = String(m.name ?? "").toLowerCase();
        const content = String(m.content ?? "").toLowerCase();
        if (!name.includes(q) && !content.includes(q)) return false;
      }

      return true;
    });

    // A–Z (case-insensitive / pt-BR)
    return [...filtered].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR", {
        sensitivity: "base",
      }),
    );
  }, [messages, search, categoryFilter]);

  // Só mostra no filtro as categorias que realmente têm modelo cadastrado
  const availableCategories = useMemo(() => {
    const used = new Set(messages.map((m) => getTemplateCategory(m)));
    return MESSAGE_CATEGORIES.filter((cat) => used.has(cat));
  }, [messages]);

  const hasActiveFilters = categoryFilter !== "Todos";

  function clearFilters() {
    setSearch("");
    setCategoryFilter("Todos");
  }

  return (
    <div className="space-y-4 pt-0 pb-4 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* Topo (padrão admin) */}
      <div className="flex items-center justify-between gap-2 mb-1.5 px-3 sm:px-0">
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
            className="h-8 md:h-9 px-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-xs shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-1.5 whitespace-nowrap"
          >
            <span className="text-sm md:text-base leading-none mb-0.5">+</span>{" "}
            Nova Mensagem
          </button>
        </div>
      </div>

      {/* Barra de Busca (padrão admin) */}
      <div
        className="p-0 px-3 sm:px-0 md:p-3 bg-transparent md:bg-card border-0 md:border md:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-2 md:space-y-3 mb-3 md:mb-4 md:sticky md:top-3 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden md:block text-xs font-medium uppercase text-muted-foreground tracking-wider">
          Filtros Rápidos
        </div>

        {/* MOBILE (somente): busca + botão abrir painel */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar modelo (nome ou conteúdo)..."
              className="w-full h-9 px-2.5 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
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
            onClick={() => setMobileFiltersOpen((v) => !v)}
            className={`h-9 px-2.5 rounded-lg border font-medium text-xs transition-colors ${
              hasActiveFilters
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title="Filtros"
          >
            Filtros
          </button>
        </div>

        {/* DESKTOP (somente): tudo na mesma linha */}
        <div className="hidden md:flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar modelo (nome ou conteúdo)..."
              className="w-full h-9 px-2.5 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
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

          <div className="w-[180px]">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full h-9 px-2.5 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
            >
              <option value="Todos">Categoria (Todas)</option>
              {availableCategories.map((cat) => {
                const { label, icon } = getCategoryDisplay(cat);
                return (
                  <option key={cat} value={cat}>
                    {icon} {label}
                  </option>
                );
              })}
            </select>
          </div>

          <button
            onClick={clearFilters}
            className="h-9 px-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-xs font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-1.5"
          >
            <IconX /> Limpar
          </button>
        </div>

        {/* Painel de filtros no mobile */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-1 p-2.5 rounded-xl border border-border bg-transparent space-y-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full h-9 px-2.5 bg-transparent border border-border rounded-lg text-xs text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors"
            >
              <option value="Todos">Categoria (Todas)</option>
              {availableCategories.map((cat) => {
                const { label, icon } = getCategoryDisplay(cat);
                return (
                  <option key={cat} value={cat}>
                    {icon} {label}
                  </option>
                );
              })}
            </select>

            <button
              onClick={() => {
                clearFilters();
                setMobileFiltersOpen(false);
              }}
              className="w-full h-9 px-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-xs font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-1.5"
            >
              <IconX /> Limpar
            </button>
          </div>
        )}
      </div>

      {/* LISTA DE MENSAGENS (LISTA COM SELEÇÃO + AÇÕES À DIREITA) */}
      {loading ? (
        <div className="p-8 text-center text-muted-foreground animate-pulse bg-card rounded-none sm:rounded-xl border border-border font-medium text-sm">
          Carregando modelos...
        </div>
      ) : filteredMessages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 bg-card border border-dashed border-border rounded-none sm:rounded-2xl">
          <div className="w-12 h-12 bg-transparent border border-border rounded-full flex items-center justify-center mb-3 text-2xl">
            <MessageCircle className="w-4 h-4" />
          </div>
          <h3 className="text-base font-medium text-foreground/90">
            Nenhum modelo encontrado
          </h3>
          <p className="text-xs text-foreground/70 mt-1">
            Crie um novo modelo ou ajuste sua busca.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
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
                  <div className="px-3 sm:px-4 py-2.5 border-b border-border flex items-center justify-between bg-transparent">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base">{icon}</span>
                      <h2 className="text-sm font-medium text-foreground/90 truncate">
                        {title}
                      </h2>
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[11px] font-medium">
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
                            "w-full flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 transition-colors cursor-pointer bg-card",
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
                                  isSelected ? "bg-emerald-500" : "bg-muted",
                                ].join(" ")}
                              />
                              <h3
                                className="font-medium text-foreground text-sm truncate"
                                title={msg.name}
                              >
                                {msg.name}
                              </h3>
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground ml-4">
                              Atualizado:{" "}
                              {new Date(msg.updated_at).toLocaleDateString(
                                "pt-BR",
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTemplate(msg);
                                setShowPreview(true);
                              }}
                              className="flex items-center justify-center w-7 h-7 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 transition-all"
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
                              className="flex items-center justify-center w-7 h-7 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-all"
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
                                className="flex items-center justify-center w-7 h-7 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all"
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
                  const items = filteredMessages.filter(
                    (m) => getTemplateCategory(m) === cat,
                  );
                  if (items.length === 0) return null;

                  const { label: displayTitle, icon } = getCategoryDisplay(cat);

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
      <div className="h-14 md:h-12" />

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
