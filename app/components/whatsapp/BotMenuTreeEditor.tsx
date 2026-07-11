"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight, ChevronDown, Plus, Trash2, Save, X, MessageSquare,
  ShieldCheck, Sparkles, ArrowUp, ArrowDown, Eye, Tag,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type MenuNode = {
  id: string;
  parent_id: string | null;
  slug: string | null;
  option_number: number;
  label: string;
  keywords: string[];
  requires_account_check: boolean;
  special_actions: string[];
  closing_message: string | null;
  transfer_situation_label: string | null;
  is_active: boolean;
};

type MenuStep = { id: string; node_id: string; step_order: number; message_text: string };
type TreeNode = MenuNode & { children: TreeNode[]; steps: MenuStep[] };

const SPECIAL_ACTIONS = [
  { value: "check_servidor_vencimento", label: "🔌 Checar servidor offline / vencimento", desc: "Se detectar problema, responde direto e nem mostra as opções." },
  { value: "check_renovacao_recente", label: "💳 Checar renovação automática recente", desc: "Se já tiver pagamento confirmado, responde direto (sem pedir comprovante)." },
  { value: "verificar_cloudflare", label: "☁️ Verificar Cloudflare", desc: "Checa instabilidade externa em tempo real." },
  { value: "gerar_link_portal", label: "🔗 Gerar link do portal", desc: "Disponibiliza a variável {link_pagamento}." },
  { value: "consultar_precos", label: "💰 Consultar tabela de preços", desc: "Disponibiliza a variável {tabela_precos}." },
  { value: "recomendar_app", label: "📱 Recomendar aplicativo", desc: "Disponibiliza a variável {apps_recomendados}." },
  { value: "free_text_rag", label: "✨ Texto livre → RAG", desc: "Fallback: busca no bot_knowledge quando nada mais se aplica." },
  { value: "escalar_imediatamente", label: "🙋 Escalar imediatamente", desc: "Transfere pro Márcio na hora, sem mostrar opções nem passos." },
];

// Reaproveita o mesmo conjunto de variáveis da página de mensagens, filtrado
// pro que faz sentido num atendimento de bot + as 2 novas específicas daqui.
const TAG_GROUPS = [
  {
    title: "👤 Dados do Cliente",
    color: "bg-sky-500/10 text-sky-500",
    tags: [
      { label: "{primeiro_nome}", desc: "Primeiro nome" },
      { label: "{nome_completo}", desc: "Nome completo" },
      { label: "{saudacao_tempo}", desc: "Bom dia / Boa tarde / Boa noite" },
    ],
  },
  {
    title: "🖥️ Acesso e Servidor",
    color: "bg-emerald-500/10 text-emerald-500",
    tags: [
      { label: "{usuario_app}", desc: "Usuário" },
      { label: "{senha_app}", desc: "Senha" },
      { label: "{plano_nome}", desc: "Plano" },
      { label: "{telas_qtd}", desc: "Qtd. de telas" },
      { label: "{servidor_nome}", desc: "Nome do servidor" },
    ],
  },
  {
    title: "📅 Vencimento",
    color: "bg-rose-500/10 text-rose-500",
    tags: [
      { label: "{data_vencimento}", desc: "Data (DD/MM/AAAA)" },
      { label: "{dias_para_vencimento}", desc: "Dias restantes" },
      { label: "{dias_atraso}", desc: "Dias de atraso" },
    ],
  },
  {
    title: "💰 Financeiro (requer ação especial marcada)",
    color: "bg-amber-500/10 text-amber-500",
    tags: [
      { label: "{link_pagamento}", desc: "Requer: Gerar link do portal" },
      { label: "{tabela_precos}", desc: "Requer: Consultar tabela de preços" },
      { label: "{apps_recomendados}", desc: "Requer: Recomendar aplicativo" },
      { label: "{valor_fatura}", desc: "Valor da renovação" },
      { label: "{moeda_cliente}", desc: "BRL/USD/EUR" },
    ],
  },
];

function buildTree(nodes: MenuNode[], steps: MenuStep[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [], steps: steps.filter((s) => s.node_id === n.id) }));
  const roots: TreeNode[] = [];
  nodes.forEach((n) => {
    const t = map.get(n.id)!;
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children.push(t);
    else if (!n.parent_id) roots.push(t);
  });
  return roots.sort((a, b) => a.option_number - b.option_number);
}

async function authHeader() {
  const { data: { session } } = await supabaseBrowser.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function slugify(text: string) {
  return text.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s_-]/g, "").replace(/\s+/g, "_");
}

// ── Modal base — mesmo padrão visual do EditorModal/PreviewModal ────────────
function ModalShell({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div className={`w-full h-full sm:h-auto ${wide ? "max-w-2xl" : "max-w-lg"} bg-card border-0 sm:border border-border rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[85vh]`}>
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-border flex justify-between items-center shrink-0">
          <h3 className="font-medium text-foreground truncate pr-4 text-base sm:text-lg">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 p-4 sm:p-5 overflow-y-auto custom-scrollbar">{children}</div>
        {footer && <div className="px-4 py-3 sm:px-5 sm:py-4 border-t border-border flex justify-end gap-2 bg-card shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

const btnPrimary = "px-4 py-2.5 sm:py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs shadow-lg shadow-violet-900/20 transition-transform active:scale-95 uppercase flex items-center justify-center gap-2 disabled:opacity-50";
const btnGhost = "px-4 py-2.5 sm:py-2 rounded-lg border border-border text-muted-foreground font-medium text-xs hover:bg-muted transition-colors uppercase";
const btnDanger = "px-4 py-2.5 sm:py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs uppercase transition-transform active:scale-95";
const inputCls = "w-full text-sm bg-background border border-border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-violet-500/40";
const labelCls = "text-[11px] font-medium text-muted-foreground";

// ── Modal: criar categoria principal ────────────────────────────────────────
function CreateCategoryModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, slug: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!slugEdited) setSlug(slugify(name)); }, [name, slugEdited]);

  return (
    <ModalShell
      title="Nova categoria principal"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>Cancelar</button>
          <button
            onClick={async () => { setSaving(true); await onCreate(name, slug); setSaving(false); }}
            disabled={!name.trim() || !slug.trim() || saving}
            className={btnPrimary}
          >
            <Save className="w-3.5 h-3.5" /> {saving ? "Criando..." : "Criar categoria"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Nome da categoria (aparece no WhatsApp do cliente)</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Problema técnico" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Slug técnico (identificador interno)</label>
          <input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }} className={`${inputCls} font-mono`} />
          <p className="text-[10px] text-muted-foreground mt-1">Preenchido automaticamente pelo nome — pode alterar se quiser.</p>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Modal: criar/editar opção (filho de qualquer nível) ─────────────────────
function CreateOptionModal({ onClose, onCreate }: { onClose: () => void; onCreate: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell
      title="Nova opção"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>Cancelar</button>
          <button onClick={async () => { setSaving(true); await onCreate(label); setSaving(false); }} disabled={!label.trim() || saving} className={btnPrimary}>
            <Save className="w-3.5 h-3.5" /> {saving ? "Criando..." : "Criar opção"}
          </button>
        </>
      }
    >
      <div>
        <label className={labelCls}>Texto da opção (aparece no WhatsApp)</label>
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Canal travando / buffering" className={inputCls} />
      </div>
    </ModalShell>
  );
}

// ── Modal: confirmar exclusão ────────────────────────────────────────────────
function ConfirmDeleteModal({ label, onClose, onConfirm }: { label: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <ModalShell
      title="Excluir item"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>Cancelar</button>
          <button onClick={async () => { setDeleting(true); await onConfirm(); }} disabled={deleting} className={btnDanger}>
            {deleting ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </>
      }
    >
      <p className="text-sm text-foreground">
        Tem certeza que quer excluir <strong>"{label}"</strong>?
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        Se essa opção tiver filhos ou passos cadastrados, tudo será excluído junto. Essa ação não pode ser desfeita.
      </p>
    </ModalShell>
  );
}

export default function BotMenuTreeEditor() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<{ type: "create_category" } | { type: "create_option"; parent: TreeNode } | { type: "delete"; node: TreeNode } | null>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whatsapp/bot/menu-tree", { headers });
      const json = await res.json();
      if (json.ok) setTree(buildTree(json.nodes, json.steps));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function callApi(body: any) {
    const headers = await authHeader();
    const res = await fetch("/api/whatsapp/bot/menu-tree", { method: "POST", headers, body: JSON.stringify(body) });
    return res.json();
  }

  async function handleCreateCategory(name: string, slug: string) {
    const maxNum = tree.reduce((m, n) => Math.max(m, n.option_number), 0);
    await callApi({ action: "create_node", parent_id: null, slug, option_number: maxNum + 1, label: name, keywords: [], requires_account_check: false, special_actions: [] });
    setModal(null);
    loadTree();
  }

  async function handleCreateOption(parent: TreeNode, label: string) {
    const maxNum = parent.children.reduce((m, n) => Math.max(m, n.option_number), 0);
    await callApi({ action: "create_node", parent_id: parent.id, option_number: maxNum + 1, label, keywords: [], special_actions: [] });
    setModal(null);
    loadTree();
    setExpanded((prev) => new Set(prev).add(parent.id));
  }

  async function handleDelete(node: TreeNode) {
    await callApi({ action: "delete_node", id: node.id });
    setModal(null);
    setSelectedNode((sel) => (sel?.id === node.id ? null : sel));
    loadTree();
  }

  async function move(node: TreeNode, siblings: TreeNode[], direction: -1 | 1) {
    const idx = siblings.findIndex((s) => s.id === node.id);
    const swapWith = siblings[idx + direction];
    if (!swapWith) return;
    setSaving(true);
    await Promise.all([
      callApi({ action: "reorder_node", id: node.id, option_number: swapWith.option_number }),
      callApi({ action: "reorder_node", id: swapWith.id, option_number: node.option_number }),
    ]);
    setSaving(false);
    loadTree();
  }

  function renderNode(node: TreeNode, siblings: TreeNode[], depth: number) {
    const isLeaf = node.children.length === 0;
    const isExpanded = expanded.has(node.id);
    const NUMBER_EMOJI = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

    return (
      <div key={node.id} style={{ marginLeft: depth * 20 }}>
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-muted/60 transition-colors ${selectedNode?.id === node.id ? "bg-violet-500/10 border border-violet-500/30" : ""}`}
          onClick={() => setSelectedNode(node)}
        >
          <button onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }} className="text-muted-foreground">
            {isLeaf ? <MessageSquare className="w-3.5 h-3.5" /> : isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <span className="text-xs font-mono text-muted-foreground">{NUMBER_EMOJI[node.option_number] || node.option_number}</span>
          <span className="text-sm text-foreground flex-1">{node.label}</span>
          {node.requires_account_check && (
            <span title="Checa conta/servidor"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /></span>
          )}
          {(node.special_actions || []).length > 0 && (
            <span title={node.special_actions.join(", ")} className="text-[10px] text-amber-500">{node.special_actions.length} ação(ões)</span>
          )}
          {isLeaf && node.steps.length > 0 && <span className="text-[10px] text-muted-foreground">{node.steps.length} passo(s)</span>}
          {!node.is_active && <span className="text-[10px] text-rose-500">inativo</span>}
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); move(node, siblings, -1); }} className="text-muted-foreground hover:text-foreground"><ArrowUp className="w-3 h-3" /></button>
            <button onClick={(e) => { e.stopPropagation(); move(node, siblings, 1); }} className="text-muted-foreground hover:text-foreground"><ArrowDown className="w-3 h-3" /></button>
          </div>
        </div>
        {isExpanded && (
          <div>
            {node.children.map((c) => renderNode(c, node.children, depth + 1))}
            <button onClick={() => setModal({ type: "create_option", parent: node })} className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-400 pl-8 py-1">
              <Plus className="w-3 h-3" /> Adicionar opção aqui
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:h-[600px]">
      <div className="border border-border rounded-xl p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Árvore de Atendimento</h3>
          <button onClick={() => setModal({ type: "create_category" })} className="flex items-center gap-1 text-xs bg-violet-600 text-white px-2 py-1 rounded-lg hover:bg-violet-500">
            <Plus className="w-3.5 h-3.5" /> Nova categoria
          </button>
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : tree.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma categoria cadastrada ainda. Clique em "Nova categoria" pra começar.</p>
        ) : (
          tree.map((n) => renderNode(n, tree, 0))
        )}
      </div>

      <div className="border border-border rounded-xl p-4 overflow-y-auto">
        {selectedNode ? (
          <NodeEditor
            key={selectedNode.id}
            node={selectedNode}
            isLeaf={selectedNode.children.length === 0}
            onSave={async (fields) => { setSaving(true); await callApi({ action: "update_node", id: selectedNode.id, ...fields }); setSaving(false); loadTree(); }}
            onSaveSteps={async (steps) => { setSaving(true); await callApi({ action: "set_steps", node_id: selectedNode.id, steps }); setSaving(false); loadTree(); }}
            onDelete={() => setModal({ type: "delete", node: selectedNode })}
            saving={saving}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Selecione um item da árvore à esquerda pra editar.</p>
        )}
      </div>

      {modal?.type === "create_category" && (
        <CreateCategoryModal onClose={() => setModal(null)} onCreate={handleCreateCategory} />
      )}
      {modal?.type === "create_option" && (
        <CreateOptionModal onClose={() => setModal(null)} onCreate={(label) => handleCreateOption(modal.parent, label)} />
      )}
      {modal?.type === "delete" && (
        <ConfirmDeleteModal label={modal.node.label} onClose={() => setModal(null)} onConfirm={() => handleDelete(modal.node)} />
      )}
    </div>
  );
}

// ── Painel de variáveis clicáveis (mesmo mecanismo do insertTag da página de mensagens) ──
function TagPicker({ onInsert }: { onInsert: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-400">
        <Tag className="w-3 h-3" /> Inserir variável
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 w-72 max-h-72 overflow-y-auto bg-card border border-border rounded-xl shadow-2xl p-2">
          {TAG_GROUPS.map((group) => (
            <div key={group.title} className="mb-2">
              <p className={`text-[10px] font-semibold px-2 py-1 rounded ${group.color}`}>{group.title}</p>
              {group.tags.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => { onInsert(t.label); setOpen(false); }}
                  className="w-full text-left px-2 py-1 rounded hover:bg-muted transition-colors"
                >
                  <span className="text-xs font-mono text-foreground">{t.label}</span>
                  <span className="text-[10px] text-muted-foreground block">{t.desc}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeEditor({
  node, isLeaf, onSave, onSaveSteps, onDelete, saving,
}: {
  node: TreeNode; isLeaf: boolean;
  onSave: (fields: any) => void;
  onSaveSteps: (steps: string[]) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [label, setLabel] = useState(node.label);
  const [keywordsText, setKeywordsText] = useState((node.keywords || []).join(", "));
  const [requiresCheck, setRequiresCheck] = useState(node.requires_account_check);
  const [specialActions, setSpecialActions] = useState<string[]>(node.special_actions || []);
  const [closingMsg, setClosingMsg] = useState(node.closing_message || "");
  const [transferLabel, setTransferLabel] = useState(node.transfer_situation_label || "");
  const [isActive, setIsActive] = useState(node.is_active);
  const [steps, setSteps] = useState<string[]>(node.steps.map((s) => s.message_text));
  const [showPreview, setShowPreview] = useState(false);
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  function toggleAction(value: string) {
    setSpecialActions((prev) => prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]);
  }

  function insertTagAt(stepIndex: number, tag: string) {
    const el = textareaRefs.current[stepIndex];
    if (!el) {
      setSteps((prev) => prev.map((s, i) => i === stepIndex ? s + tag : s));
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const newText = text.substring(0, start) + tag + text.substring(end);
    setSteps((prev) => prev.map((s, i) => i === stepIndex ? newText : s));
    setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
  }

  function saveAll() {
    onSave({
      label,
      keywords: keywordsText.split(",").map((k) => k.trim()).filter(Boolean),
      requires_account_check: requiresCheck,
      special_actions: specialActions,
      closing_message: closingMsg || null,
      transfer_situation_label: transferLabel || null,
      is_active: isActive,
    });
    if (isLeaf) onSaveSteps(steps.filter((s) => s.trim()));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Editando: {node.label}</h4>
        <div className="flex gap-2">
          <button onClick={() => setShowPreview(!showPreview)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Eye className="w-3.5 h-3.5" /> Prévia
          </button>
          <button onClick={onDelete} className="text-rose-500 hover:text-rose-400"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      {showPreview && (
        <div className="bg-muted border border-border rounded-lg p-3 text-xs whitespace-pre-wrap">
          {isLeaf
            ? [...steps.filter(Boolean), specialActions.length ? `[ações: ${specialActions.join(", ")}]` : null].filter(Boolean).join("\n\n")
            : `Entendido! Me conta mais:\n(as opções filhas aparecem aqui)`}
        </div>
      )}

      <div>
        <label className={labelCls}>Texto da opção</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>Palavras-chave (separadas por vírgula)</label>
        <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="travando, travou, buffer" className={inputCls} />
      </div>

      {!node.parent_id && (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={requiresCheck} onChange={(e) => setRequiresCheck(e.target.checked)} />
          Identificar a conta primeiro (pergunta automaticamente se houver mais de uma)
        </label>
      )}

      <div>
        <label className={labelCls}>Ações especiais (pode marcar mais de uma)</label>
        <div className="space-y-1.5 mt-1.5">
          {SPECIAL_ACTIONS.map((a) => (
            <label key={a.value} className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={specialActions.includes(a.value)} onChange={() => toggleAction(a.value)} />
              <span>
                <span className="block">{a.label}</span>
                <span className="block text-[10px] text-muted-foreground">{a.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {isLeaf && !specialActions.includes("free_text_rag") && (
        <div>
          <label className={labelCls}>Passos sequenciais</label>
          <div className="space-y-2 mt-1">
            {steps.map((s, i) => (
              <div key={i} className="border border-border rounded-lg p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Passo {i + 1}</span>
                  <div className="flex items-center gap-2">
                    <TagPicker onInsert={(tag) => insertTagAt(i, tag)} />
                    <button onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-500"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <textarea
                  ref={(el) => { textareaRefs.current[i] = el; }}
                  value={s}
                  onChange={(e) => setSteps((prev) => prev.map((p, idx) => idx === i ? e.target.value : p))}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5"
                  rows={3}
                />
              </div>
            ))}
            <button onClick={() => setSteps((prev) => [...prev, ""])} className="flex items-center gap-1 text-[11px] text-violet-500">
              <Plus className="w-3 h-3" /> Adicionar passo
            </button>
          </div>
        </div>
      )}

      {isLeaf && (
        <>
          <div>
            <label className={labelCls}>Mensagem de encerramento (se o cliente disser que resolveu)</label>
            <textarea value={closingMsg} onChange={(e) => setClosingMsg(e.target.value)} rows={2} className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
          </div>
          <div>
            <label className={labelCls}>Situação (aparece no resumo de transferência, se não resolver)</label>
            <input value={transferLabel} onChange={(e) => setTransferLabel(e.target.value)} className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Ativo
      </label>

      <button onClick={saveAll} disabled={saving} className={btnPrimary}>
        <Save className="w-3.5 h-3.5" /> {saving ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}