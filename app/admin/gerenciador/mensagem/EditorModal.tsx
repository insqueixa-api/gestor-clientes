"use client";
// app/admin/gerenciador/mensagem/EditorModal.tsx
// Extraído de page.tsx (15/08/2026) — modal de criar/editar mensagem, o mais
// pesado (form completo: variáveis, imagem, variações com IA), carrega via
// next/dynamic só quando abre.
import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import { useConfirm } from "@/hooks/useConfirm";
import {
  type MessageTemplate,
  PROTECTED_TEMPLATES,
  MESSAGE_CATEGORIES,
  getTemplateCategory,
} from "./shared";

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
      {
        label: "{dns_servidor}",
        desc: "DNS aleatória do servidor (evita a 1ª cadastrada)",
      },
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
      {
        label: "{tabela_precos}",
        desc: "Tabela de preços do cliente (todos os períodos), texto pronto",
      },
      { label: "{valor_fatura}", desc: "Valor da renovação" },
      { label: "{moeda_cliente}", desc: "BRL/USD/EUR" },
      {
        label: "{cupom_frase}",
        desc: "Frase pronta com o cupom elegível do cliente (só contas BRL) — some sozinha se não houver nenhum",
      },
      {
        label: "{pendencia_detalhe}",
        desc: "Lista as pendências financeiras em aberto (app + data + valor) — vazia se não houver nenhuma",
      },
      {
        label: "{pix_copia_cola}",
        desc: "Código PIX copia-e-cola automático (gateway online)",
      },

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

export default function EditorModal({
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
  const tenantId = useTenantId();
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

  // ✅ Variações da mensagem (sorteadas aleatoriamente no envio automático)
  const [variants, setVariants] = useState<{ id: string; content: string }[]>(
    [],
  );
  // ✅ Guarda o último texto de cada variação já confirmado no banco (via
  // carregamento, "Salvar variação" individual, ou "Atualizar Modelo") — usado
  // só pra decidir se o botão "Salvar variação" aparece (só quando o texto em
  // tela difere do que está salvo). Não usado pra nada além disso.
  const [originalVariants, setOriginalVariants] = useState<
    Record<string, string>
  >({});
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [savingVariantId, setSavingVariantId] = useState<string | null>(null);
  const { confirm: confirmVariant } = useConfirm();

  useEffect(() => {
    if (!templateToEdit?.id) return;
    (async () => {
      setVariantsLoading(true);
      const { data } = await supabaseBrowser
        .from("message_template_variants")
        .select("id, content")
        .eq("template_id", templateToEdit.id)
        .order("created_at", { ascending: true });
      setVariants(data || []);
      setOriginalVariants(
        Object.fromEntries((data || []).map((v) => [v.id, v.content])),
      );
      setVariantsLoading(false);
    })();
  }, [templateToEdit?.id]);

  async function handleAddVariant() {
    if (!templateToEdit?.id) return;
    const tid = tenantId;
    if (!tid) return;
    const { data, error } = await supabaseBrowser
      .from("message_template_variants")
      .insert({
        tenant_id: tid,
        template_id: templateToEdit.id,
        content: content || "",
      })
      .select("id, content")
      .single();
    if (error) {
      onError(error.message);
      return;
    }
    setVariants((prev) => [...prev, data]);
    setOriginalVariants((prev) => ({ ...prev, [data.id]: data.content }));
  }

  // ✅ Gera uma variação com IA (Gemini) a partir do texto principal —
  // mantém as variáveis {tag} usadas, reescreve o resto livremente. A
  // rota já valida que nenhuma variável some antes de responder.
  const [generatingVariant, setGeneratingVariant] = useState(false);

  async function handleGenerateVariantWithAI() {
    if (!templateToEdit?.id) return;
    if (!content.trim()) {
      onError("Escreva a mensagem principal antes de gerar uma variação.");
      return;
    }
    setGeneratingVariant(true);
    try {
      const tid = tenantId;
      if (!tid) throw new Error("Sessão inválida.");

      const { data: sessionData } = await supabaseBrowser.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/whatsapp/generate-variant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id: tid, content }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao gerar variação com IA.");
      }

      const { data, error } = await supabaseBrowser
        .from("message_template_variants")
        .insert({
          tenant_id: tid,
          template_id: templateToEdit.id,
          content: json.content,
        })
        .select("id, content")
        .single();
      if (error) throw error;

      setVariants((prev) => [...prev, data]);
      setOriginalVariants((prev) => ({ ...prev, [data.id]: data.content }));
    } catch (e: any) {
      onError(e.message || "Falha ao gerar variação com IA.");
    } finally {
      setGeneratingVariant(false);
    }
  }

  async function handleSaveVariant(id: string, text: string) {
    if (!text.trim()) {
      onError("A variação não pode ficar vazia.");
      return;
    }
    setSavingVariantId(id);
    const { error } = await supabaseBrowser
      .from("message_template_variants")
      .update({ content: text })
      .eq("id", id);
    setSavingVariantId(null);
    if (error) {
      onError(error.message);
      return;
    }
    setOriginalVariants((prev) => ({ ...prev, [id]: text }));
  }

  async function handleDeleteVariant(id: string) {
    const ok = await confirmVariant({
      title: "Excluir variação?",
      subtitle: "Essa variação deixa de ser sorteada nos envios automáticos.",
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Cancelar",
    });
    if (!ok) return;
    const { error } = await supabaseBrowser
      .from("message_template_variants")
      .delete()
      .eq("id", id);
    if (error) {
      onError(error.message);
      return;
    }
    setVariants((prev) => prev.filter((v) => v.id !== id));
    setOriginalVariants((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

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
      onError("Preencha o nome e o conteúdo da mensagem.");
      return;
    }
    // ✅ Mesma validação do "Salvar variação" individual, mas em bloco —
    // antes disso "Atualizar Modelo" só gravava nome/conteúdo/categoria e
    // ignorava por completo o texto editado nas variações, que só ia pro
    // banco se cada uma fosse salva com o botão próprio antes de fechar o
    // modal (perdendo silenciosamente qualquer edição não salva individual).
    const emptyIdx = variants.findIndex((v) => !v.content.trim());
    if (emptyIdx !== -1) {
      onError(`A variação ${emptyIdx + 1} não pode ficar vazia.`);
      return;
    }
    setLoading(true);
    try {
      const tid = tenantId;
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

      // ✅ Salva junto TODAS as variações (não só a que teve "Salvar
      // variação" clicado individualmente) — cada uma já tem id real (a
      // variação só entra em `variants` depois de já ter sido inserida no
      // banco, seja carregada, seja criada via "+ Adicionar"/"Gerar com IA").
      if (variants.length > 0) {
        const results = await Promise.all(
          variants.map((v) =>
            supabaseBrowser
              .from("message_template_variants")
              .update({ content: v.content })
              .eq("id", v.id),
          ),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
        setOriginalVariants(
          Object.fromEntries(variants.map((v) => [v.id, v.content])),
        );
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
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 animate-in fade-in duration-200">
      <div
        className="w-full max-w-5xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[86vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 sm:px-4 sm:py-3 border-b border-border flex justify-between items-center bg-transparent">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-lg">
              <Pencil className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-medium text-foreground">
                {templateToEdit ? "Editar Mensagem" : "Criar Nova Mensagem"}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* MOBILE: Variáveis como filtro acima do conteúdo */}
          <div className="lg:hidden border-b border-border bg-card">
            <div className="p-2.5">
              <button
                type="button"
                onClick={() => setMobileTagsOpen((v) => !v)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-transparent text-foreground/90 font-medium text-xs flex items-center justify-between"
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
                <div className="mt-2 rounded-xl border border-border bg-card overflow-hidden">
                  <div className="p-2.5 border-b border-border bg-transparent">
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
                      className="mt-2 w-full h-9 px-2.5 rounded-lg border border-border bg-card text-xs text-foreground/90 outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div className="max-h-[32vh] overflow-y-auto p-2.5 space-y-1.5 custom-scrollbar bg-transparent">
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
                          className={`text-left px-2.5 py-2 rounded-lg border border-border hover:brightness-95 hover:shadow-sm active:scale-95 transition-all flex flex-col group ${tag.color} bg-card`}
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
          <div className="flex-1 p-2.5 sm:p-4 flex flex-col gap-3.5 overflow-y-auto custom-scrollbar lg:border-r border-border">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground uppercase mb-1 tracking-wider">
                Nome do Modelo (Identificação interna)
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Cobrança 3 dias antes..."
                readOnly={isProtected} // 🔒 Trava a edição do nome
                className={`w-full h-9 px-3 border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500 transition-colors font-medium ${
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
              <label className="block text-[10px] font-medium text-muted-foreground uppercase mb-1 tracking-wider">
                Categoria da Mensagem
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-9 px-3 border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500 transition-colors font-medium bg-transparent border-border"
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
                  className="w-full h-full min-h-[180px] sm:min-h-[240px] p-3 sm:p-4 bg-transparent border border-border rounded-lg text-foreground/90 outline-none focus:border-emerald-500 transition-colors resize-none leading-relaxed text-xs font-mono shadow-inner"
                />
              </div>
            </div>

            {/* ✅ Variações da mensagem — sorteadas aleatoriamente junto com o texto acima nos envios automáticos */}
            {templateToEdit?.id ? (
              <div className="border-t border-border pt-3.5">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Variações desta mensagem
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    {variants.length} variação
                    {variants.length === 1 ? "" : "ões"}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">
                  No envio automático, o sistema sorteia aleatoriamente entre o
                  texto acima e as variações abaixo — reduz o padrão repetitivo
                  que o WhatsApp pode identificar como disparo em massa.
                </p>

                {variantsLoading ? (
                  <div className="text-xs text-muted-foreground py-4">
                    Carregando variações...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {variants.map((v, idx) => (
                      <div
                        key={v.id}
                        className="rounded-lg border border-border p-2.5 bg-transparent"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Variação {idx + 1}
                          </span>
                          <button
                            onClick={() => handleDeleteVariant(v.id)}
                            className="flex items-center justify-center w-7 h-7 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all"
                            title="Excluir variação"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <textarea
                          value={v.content}
                          onChange={(e) => {
                            const text = e.target.value;
                            setVariants((prev) =>
                              prev.map((x) =>
                                x.id === v.id ? { ...x, content: text } : x,
                              ),
                            );
                          }}
                          className="w-full min-h-[96px] p-2.5 bg-transparent border border-border rounded-lg text-foreground/90 outline-none focus:border-emerald-500 transition-colors resize-none text-xs font-mono"
                        />
                        {(v.content !== (originalVariants[v.id] ?? "") ||
                          savingVariantId === v.id) && (
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={() => handleSaveVariant(v.id, v.content)}
                              disabled={savingVariantId === v.id}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-[11px] font-medium disabled:opacity-50 transition-colors"
                            >
                              {savingVariantId === v.id
                                ? "Salvando..."
                                : "Salvar variação"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2.5 flex flex-col sm:flex-row gap-1.5">
                  <button
                    onClick={handleGenerateVariantWithAI}
                    disabled={generatingVariant}
                    className="flex-1 h-9 rounded-lg border border-dashed border-violet-500/40 text-violet-500 text-xs font-medium hover:bg-violet-500/10 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    title="A IA reescreve a mensagem principal mantendo as variáveis usadas"
                  >
                    {generatingVariant
                      ? "Gerando com IA..."
                      : "✨ Gerar variação com IA"}
                  </button>
                  <button
                    onClick={handleAddVariant}
                    className="flex-1 h-9 rounded-lg border border-dashed border-emerald-500/40 text-emerald-500 text-xs font-medium hover:bg-emerald-500/10 transition-colors"
                  >
                    + Adicionar variação em branco
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border pt-4 text-[10px] text-muted-foreground">
                💡 Salve esta mensagem primeiro para poder cadastrar variações
                que serão sorteadas nos envios automáticos.
              </div>
            )}
          </div>

          {/* DESKTOP: Variáveis na lateral (sem mudar lógica) */}
          <div className="hidden lg:flex w-[340px] bg-card flex-col">
            <div className="p-3 border-b border-border bg-transparent">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                🏷️ Variáveis Disponíveis
              </h3>
              <p className="text-[10px] text-muted-foreground mt-1">
                Clique para inserir no texto
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar bg-transparent">
              {TAG_GROUPS.map((group, idx) => {
                const isOpen = openDesktopGroups.includes(idx);
                return (
                  <div
                    key={idx}
                    className="bg-card rounded-lg border border-border overflow-hidden transition-all shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => toggleDesktopGroup(idx)}
                      className={`w-full flex items-center justify-between p-2.5 text-left transition-colors ${isOpen ? "bg-transparent border-b border-border" : "hover:bg-muted/30"}`}
                    >
                      <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {group.title}
                      </h4>
                      <span className="text-muted-foreground text-xs">
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="p-2.5 grid grid-cols-1 gap-1.5 bg-transparent">
                        {group.tags.map((tag) => (
                          <button
                            key={tag.label}
                            onClick={() => insertTag(tag.label)}
                            className={`text-left px-2.5 py-2 rounded-lg border border-border hover:brightness-95 hover:shadow-sm active:scale-95 transition-all flex flex-col group ${group.color} bg-card`}
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

        <div className="px-3 py-2.5 sm:px-4 sm:py-3 border-t border-border bg-transparent flex justify-between items-center gap-2">
          <div className="text-[11px] text-muted-foreground hidden sm:block">
            Dica: Use <strong>{`{saudacao_tempo}`}</strong> para enviar "Bom
            dia" automático.
          </div>
          <div className="flex gap-1.5 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg border border-border text-muted-foreground font-medium text-[11px] hover:bg-muted transition-colors uppercase tracking-wider"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 sm:flex-none px-5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-[11px] shadow-lg shadow-emerald-900/20 transition-transform active:scale-95 flex items-center justify-center gap-1.5 uppercase tracking-wider disabled:opacity-50"
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
