// app/components/whatsapp/BotMenuTreeEditor.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight, ChevronDown, Plus, Trash2, Save, X, MessageSquare,
  ShieldCheck, Sparkles, ArrowUp, ArrowDown, Eye, Tag,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ACCOUNT_DEPENDENT_ACTIONS, ACCOUNT_DEPENDENT_VARS } from "@/lib/whatsapp/bot-menu";

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
  applies_to_servers: string[] | null;
  is_active: boolean;
  redirect_to_node_id?: string | null;
  on_resolved_target?: string | null;
  on_not_resolved_target?: string | null;
  ask_resolution?: boolean | null;
  invalid_retry_message_1?: string | null;
  invalid_retry_message_2?: string | null;
};

type FlowSettings = {
  greeting_message: string;
  success_message: string;
  escalate_message: string;
  human_requested_message: string;
  invalid_retry_message_1: string;
  invalid_retry_message_2: string;
  menu_invalid_intro_1: string;
  menu_invalid_intro_2: string;
};

// ✅ Enum fechado do sistema — os únicos providers de servidor suportados.
const SERVER_OPTIONS = [
  { value: "NATV", label: "NaTV" },
  { value: "FAST", label: "Fast" },
  { value: "ELITE", label: "Elite" },
];

type MenuStep = { id: string; node_id: string; step_order: number; message_text: string };
type TreeNode = MenuNode & { children: TreeNode[]; steps: MenuStep[] };

// ✅ "Redirecionar pra Nova Instalação" saiu: use "Continuar em outro fluxo"
// (redirect_to_node_id) e ligue em qualquer nó — instalação, renovação, etc.
// Legado redirecionar_instalacao ainda funciona no backend se já estiver salvo.
const SPECIAL_ACTIONS = [
  { value: "check_renovacao_recente", label: "💳 Checar renovação automática recente", desc: "Se já tiver pagamento confirmado, responde direto (sem pedir comprovante)." },
  { value: "escalar_imediatamente", label: "🙋 Escalar imediatamente", desc: "Transfere pro Márcio na hora, sem mostrar opções nem passos." },
  { value: "coletar_relato_e_escalar", label: "📝 Coletar relato e escalar", desc: "Manda a mensagem pedindo o relato e já transfere na sequência — não espera resposta." },
];

const FLOW_TARGET_SPECIAL = [
  { value: "", label: "— Padrão do sistema —" },
  { value: "__success__", label: "✅ Mensagem de sucesso global" },
  { value: "__escalate__", label: "🙋 Escalar (mensagem global)" },
  { value: "__end__", label: "⏹ Encerrar sem mensagem extra" },
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
    title: "💰 Financeiro (resolvido automaticamente se usado no texto)",
    color: "bg-amber-500/10 text-amber-500",
    tags: [
      { label: "{link_pagamento}", desc: "Gera o link do portal na hora" },
      { label: "{tabela_precos}", desc: "Busca a tabela de preços na hora" },
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
  // ✅ "0" (atalho reservado, ex: Assuntos Pessoais) sempre por último —
  // mesmo critério usado no texto real do menu (renderChildrenMenu).
  return roots.sort((a, b) => {
    if (a.option_number === 0) return 1;
    if (b.option_number === 0) return -1;
    return a.option_number - b.option_number;
  });
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
  const [flatNodes, setFlatNodes] = useState<MenuNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFlowSettings, setShowFlowSettings] = useState(false);
  const [flowSettings, setFlowSettings] = useState<FlowSettings | null>(null);
  const [flowSaving, setFlowSaving] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "create_category" } | { type: "create_option"; parent: TreeNode } | { type: "delete"; node: TreeNode } | null>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whatsapp/bot/menu-tree", { headers });
      const json = await res.json();
      if (json.ok) {
        setFlatNodes(json.nodes || []);
        setTree(buildTree(json.nodes, json.steps));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFlowSettings = useCallback(async () => {
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whatsapp/bot/flow-settings", { headers });
      const json = await res.json();
      if (json.ok) setFlowSettings(json.settings);
      else setFlowError(json.error || "Falha ao carregar mensagens globais");
    } catch (e: any) {
      setFlowError(e?.message || "Falha ao carregar mensagens globais");
    }
  }, []);

  useEffect(() => { loadTree(); loadFlowSettings(); }, [loadTree, loadFlowSettings]);

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
    // ✅ "0" (falar com humano) e "9" (voltar ao menu) são fixos — nunca
    // participam de troca de posição. Sem isso, mover o vizinho pra baixo/
    // cima tentaria jogar ele pro número reservado (a API rejeita essa
    // metade da troca, mas a outra metade já teria ido — resultando em
    // dois nós com o mesmo número).
    const RESERVED = [0, 9];
    if (RESERVED.includes(node.option_number) || RESERVED.includes(swapWith.option_number)) return;
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
    // ✅ requires_account_check nunca é salvo pelo editor (nem lido pelo motor
    // de roteamento) — quem decide de verdade se o nó precisa de conta é a
    // presença de uma ação especial "dependente de conta" OU o uso de
    // {link_pagamento}/{tabela_precos} no texto dos passos (essas duas
    // viraram automáticas, sem checkbox — mesma regra do backend em
    // nodeNeedsAccount, lib/whatsapp/bot-menu.ts).
    const stepsTextForBadge = (node.steps || []).map((s) => s.message_text).join(" ");
    const needsAccount =
      (node.special_actions || []).some((a) => ACCOUNT_DEPENDENT_ACTIONS.includes(a)) ||
      ACCOUNT_DEPENDENT_VARS.some((v) => stepsTextForBadge.includes(v));

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
          {needsAccount && (
            <span title="Checa conta/servidor (derivado das ações especiais)"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /></span>
          )}
          {(node.special_actions || []).length > 0 && (
            <span title={node.special_actions.join(", ")} className="text-[10px] text-amber-500">{node.special_actions.length} ação(ões)</span>
          )}
          {node.redirect_to_node_id && (
            <span title="Continua em outro fluxo" className="text-[10px] text-violet-500">↪️</span>
          )}
          {/* ✅ null = universal (todos marcados), não mostra selo nenhum.
              Lista com todos os 3 também é universal na prática — só mostra
              selo quando é de fato restrito (parcial ou "nenhum"). */}
          {node.applies_to_servers !== null && node.applies_to_servers !== undefined && node.applies_to_servers.length < SERVER_OPTIONS.length && (
            <span
              title={node.applies_to_servers.length === 0 ? "Não aparece pra nenhum servidor — confira as marcações" : `Só aparece pra clientes de: ${node.applies_to_servers.join(", ")}`}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${node.applies_to_servers.length === 0 ? "text-rose-500 bg-rose-500/10 border-rose-500/20" : "text-sky-500 bg-sky-500/10 border-sky-500/20"}`}
            >
              {node.applies_to_servers.length === 0 ? "nenhum servidor" : node.applies_to_servers.join("/")}
            </span>
          )}
          {isLeaf && node.steps.length > 0 && <span className="text-[10px] text-muted-foreground">{node.steps.length} passo(s)</span>}
          {!node.is_active && <span className="text-[10px] text-rose-500">inativo</span>}
          {node.option_number !== 0 && (
            <div className="flex items-center gap-1">
              <button onClick={(e) => { e.stopPropagation(); move(node, siblings, -1); }} className="text-muted-foreground hover:text-foreground"><ArrowUp className="w-3 h-3" /></button>
              <button onClick={(e) => { e.stopPropagation(); move(node, siblings, 1); }} className="text-muted-foreground hover:text-foreground"><ArrowDown className="w-3 h-3" /></button>
            </div>
          )}
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

  async function saveFlowSettings() {
    if (!flowSettings) return;
    setFlowSaving(true);
    setFlowError(null);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whatsapp/bot/flow-settings", {
        method: "POST",
        headers,
        body: JSON.stringify(flowSettings),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFlowError(json.error || "Erro ao salvar");
      } else {
        setFlowSettings(json.settings);
      }
    } catch (e: any) {
      setFlowError(e?.message || "Erro ao salvar");
    } finally {
      setFlowSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Mensagens globais reutilizáveis (saudação, sucesso, escala, retry) */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFlowSettings((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <div className="text-left">
            <h3 className="text-sm font-semibold text-foreground">Mensagens globais do fluxo</h3>
            <p className="text-[11px] text-muted-foreground">Saudação, sucesso, escalonamento e “não entendi” — reutilizadas em todos os nós</p>
          </div>
          {showFlowSettings ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showFlowSettings && flowSettings && (
          <div className="p-4 space-y-3 border-t border-border">
            {flowError && (
              <p className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{flowError}</p>
            )}
            {([
              ["greeting_message", "Saudação (antes do menu principal)"],
              ["success_message", "Mensagem de sucesso (quando resolveu)"],
              ["escalate_message", "Escalonamento (bot desistiu / não resolveu)"],
              ["human_requested_message", "Cliente pediu humano (0 / “falar com Márcio”)"],
              ["invalid_retry_message_1", "Menu raiz — 1ª resposta inválida (intro)"],
              ["invalid_retry_message_2", "Menu raiz — 2ª resposta inválida (intro, antes de escalar)"],
              ["menu_invalid_intro_1", "Submenu — 1ª resposta inválida (intro)"],
              ["menu_invalid_intro_2", "Submenu — 2ª resposta inválida (intro, antes de escalar)"],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className={labelCls}>{label}</label>
                <textarea
                  value={flowSettings[key]}
                  onChange={(e) => setFlowSettings((s) => s ? { ...s, [key]: e.target.value } : s)}
                  rows={key === "greeting_message" ? 3 : 2}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1"
                />
              </div>
            ))}
            <button onClick={() => void saveFlowSettings()} disabled={flowSaving} className={btnPrimary}>
              <Save className="w-3.5 h-3.5" /> {flowSaving ? "Salvando..." : "Salvar mensagens globais"}
            </button>
          </div>
        )}
        {showFlowSettings && !flowSettings && (
          <div className="p-4 text-xs text-muted-foreground border-t border-border">
            {flowError || "Carregando… Se a tabela não existir, rode docs/sql/bot_flow_graph.sql no Supabase."}
          </div>
        )}
      </div>

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
            allNodes={flatNodes}
            onSave={async (fields) => { setSaving(true); const r = await callApi({ action: "update_node", id: selectedNode.id, ...fields }); setSaving(false); if (r?.error) alert(r.error); loadTree(); }}
            onSaveSteps={async (steps) => { setSaving(true); await callApi({ action: "set_steps", node_id: selectedNode.id, steps }); setSaving(false); loadTree(); }}
            onDelete={() => setModal({ type: "delete", node: selectedNode })}
            saving={saving}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Selecione um item da árvore à esquerda pra editar. Use as ligações (continuar em / se resolveu) para reutilizar fluxos sem copiar texto.</p>
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
    </div>
  );
}

// ── Painel de variáveis clicáveis (mesmo mecanismo do insertTag da página de mensagens) ──
// ✅ Painel de variáveis sempre visível, mesmo padrão do admin/mensagens
// (grupos colapsáveis com cards clicáveis) — em vez de esconder atrás de um
// clique num dropdown, os grupos ficam ali, só fechados por padrão pra não
// ocupar espaço demais. Insere na textarea que estiver "ativa" (a última
// focada), rastreada pelo NodeEditor.
function VariablePanel({ onInsert }: { onInsert: (tag: string) => void }) {
  const [openGroups, setOpenGroups] = useState<number[]>([]);
  function toggleGroup(idx: number) {
    setOpenGroups((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]));
  }
  return (
    <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div className="px-2.5 py-1.5 bg-muted/30 flex items-center gap-1.5">
        <Tag className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Variáveis — clique pra inserir</span>
      </div>
      {TAG_GROUPS.map((group, idx) => {
        const isOpen = openGroups.includes(idx);
        return (
          <div key={group.title}>
            <button
              type="button"
              onClick={() => toggleGroup(idx)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left transition-colors ${isOpen ? "bg-muted/40" : "hover:bg-muted/20"}`}
            >
              <span className="text-[10px] font-semibold text-foreground">{group.title}</span>
              <span className="text-[9px] text-muted-foreground">{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div className="p-2 grid grid-cols-2 gap-1.5 bg-background/40">
                {group.tags.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => onInsert(t.label)}
                    className={`text-left px-2 py-1.5 rounded-lg border border-border hover:brightness-95 active:scale-95 transition-all ${group.color}`}
                  >
                    <span className="block text-[10px] font-mono font-medium">{t.label}</span>
                    <span className="block text-[9px] opacity-70 mt-0.5">{t.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NodeEditor({
  node, isLeaf, allNodes, onSave, onSaveSteps, onDelete, saving,
}: {
  node: TreeNode; isLeaf: boolean;
  allNodes: MenuNode[];
  onSave: (fields: any) => void;
  onSaveSteps: (steps: string[]) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [label, setLabel] = useState(node.label);
  const [keywordsText, setKeywordsText] = useState((node.keywords || []).join(", "));
  const [specialActions, setSpecialActions] = useState<string[]>(node.special_actions || []);
  const [closingMsg, setClosingMsg] = useState(node.closing_message || "");
  const [transferLabel, setTransferLabel] = useState(node.transfer_situation_label || "");
  const [redirectTo, setRedirectTo] = useState(node.redirect_to_node_id || "");
  const [onResolved, setOnResolved] = useState(node.on_resolved_target || "");
  const [onNotResolved, setOnNotResolved] = useState(node.on_not_resolved_target || "");
  const [askResolution, setAskResolution] = useState<boolean>(
    node.ask_resolution === true || !!(node.closing_message || node.on_resolved_target || node.on_not_resolved_target)
  );
  const [invalidRetry1, setInvalidRetry1] = useState(node.invalid_retry_message_1 || "");
  const [invalidRetry2, setInvalidRetry2] = useState(node.invalid_retry_message_2 || "");
  // ✅ null (nunca restringido) carrega como TUDO marcado — representa
  // visualmente "funciona em todos os servidores", igual o usuário espera
  // ver ao abrir um item que nunca foi restringido.
  const [appliesToServers, setAppliesToServers] = useState<string[]>(
    node.applies_to_servers === null || node.applies_to_servers === undefined
      ? SERVER_OPTIONS.map((s) => s.value)
      : node.applies_to_servers
  );
  const [isActive, setIsActive] = useState(node.is_active);
  const [steps, setSteps] = useState<string[]>(node.steps.map((s) => s.message_text));
  const [showPreview, setShowPreview] = useState(false);
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  // ✅ Qual passo recebe a variável quando clicada no painel — a última
  // textarea que ganhou foco. Sem isso, um painel único (em vez de um por
  // passo) não saberia onde inserir.
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const otherNodes = allNodes.filter((n) => n.id !== node.id);

  function toggleAction(value: string) {
    setSpecialActions((prev) => prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]);
  }

  function toggleServer(value: string) {
    setAppliesToServers((prev) => prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]);
  }

  function insertTagAt(stepIndex: number, tag: string) {
    // ✅ Sem nenhum passo ainda, cria um novo já com a variável em vez de
    // não fazer nada (não existe textarea nenhuma pra focar/inserir).
    if (steps.length === 0) {
      setSteps([tag]);
      setActiveStepIndex(0);
      return;
    }
    const idx = Math.min(stepIndex, steps.length - 1);
    const el = textareaRefs.current[idx];
    if (!el) {
      setSteps((prev) => prev.map((s, i) => i === idx ? s + tag : s));
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const newText = text.substring(0, start) + tag + text.substring(end);
    setSteps((prev) => prev.map((s, i) => i === idx ? newText : s));
    setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
  }

  function saveAll() {
    // Remove legado redirecionar_instalacao se o usuário escolheu redirect genérico
    let actions = [...specialActions];
    if (redirectTo) {
      actions = actions.filter((a) => a !== "redirecionar_instalacao");
    }
    // Redirect tem prioridade no motor: se há destino, não grava ask_resolution
    // (evita config confusa no banco — “perguntar se resolveu” só vale sem redirect).
    const effectiveAsk = redirectTo ? false : askResolution;
    onSave({
      label,
      keywords: keywordsText.split(",").map((k) => k.trim()).filter(Boolean),
      special_actions: actions,
      closing_message: closingMsg || null,
      transfer_situation_label: transferLabel || null,
      applies_to_servers: appliesToServers,
      is_active: isActive,
      redirect_to_node_id: redirectTo || null,
      on_resolved_target: effectiveAsk ? (onResolved || null) : null,
      on_not_resolved_target: effectiveAsk ? (onNotResolved || null) : null,
      ask_resolution: effectiveAsk,
      invalid_retry_message_1: invalidRetry1.trim() || null,
      invalid_retry_message_2: invalidRetry2.trim() || null,
    });
    onSaveSteps(steps.filter((s) => s.trim()));
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
          {[
            ...steps.filter(Boolean),
            !isLeaf ? "Entendido! Me conta mais:\n(as opções filhas aparecem aqui)" : null,
            isLeaf && specialActions.length ? `[ações: ${specialActions.join(", ")}]` : null,
          ].filter(Boolean).join("\n\n")}
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

      <div>
        <label className={labelCls}>Aplica-se a (deixe tudo desmarcado = todos os servidores)</label>
        <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5">
          Marque um ou mais se essa opção só fizer sentido pra clientes de um servidor específico
          (ex: código de ativação diferente por servidor). O bot já sabe a qual servidor o cliente
          pertence e só mostra essa opção pra quem bate — mesmo que outra opção use o mesmo número.
        </p>
        <div className="flex flex-wrap gap-3">
          {SERVER_OPTIONS.map((s) => (
            <label key={s.value} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
              <input type="checkbox" checked={appliesToServers.includes(s.value)} onChange={() => toggleServer(s.value)} />
              {s.label}
            </label>
          ))}
        </div>
      </div>

{!specialActions.includes("free_text_rag") && (
        <div>
          <label className={labelCls}>{isLeaf ? "Passos sequenciais" : "Mensagens antes de mostrar as opções filhas (opcional)"}</label>
          <div className="mt-1.5 mb-2">
            <VariablePanel onInsert={(tag) => insertTagAt(activeStepIndex, tag)} />
          </div>
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={i} className={`border rounded-lg p-2 space-y-1 transition-colors ${activeStepIndex === i ? "border-violet-500/50" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Passo {i + 1}</span>
                  <button onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-500"><X className="w-3.5 h-3.5" /></button>
                </div>
                <textarea
                  ref={(el) => { textareaRefs.current[i] = el; }}
                  value={s}
                  onFocus={() => setActiveStepIndex(i)}
                  onChange={(e) => setSteps((prev) => prev.map((p, idx) => idx === i ? e.target.value : p))}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5"
                  rows={3}
                />
              </div>
            ))}
            <button onClick={() => { setSteps((prev) => [...prev, ""]); setActiveStepIndex(steps.length); }} className="flex items-center gap-1 text-[11px] text-violet-500">
              <Plus className="w-3 h-3" /> Adicionar passo
            </button>
          </div>
        </div>
      )}

      {/* Ligações estilo n8n — saída deste nó → outro nó / sucesso / escalar */}
      {isLeaf && (
        <div className="border border-violet-500/30 bg-violet-500/5 rounded-xl p-3 space-y-3">
          <p className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">Ligações de fluxo (entradas/saídas)</p>
          <div>
            <label className={labelCls}>Após os passos, continuar em outro fluxo</label>
            <select
              value={redirectTo}
              onChange={(e) => setRedirectTo(e.target.value)}
              className={`${inputCls} font-normal`}
            >
              <option value="">— Não (fica neste nó / pergunta resolveu) —</option>
              {otherNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.label}{n.slug ? ` (${n.slug})` : ""}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Substitui o antigo “Redirecionar pra Nova Instalação”. Vários nós podem apontar pro mesmo destino.
              Se preencher isto, o bot <strong>não</strong> pergunta “resolveu 1/2” neste nó — vai direto ao destino.
            </p>
            {(node.special_actions || []).includes("redirecionar_instalacao") && !redirectTo && (
              <p className="text-[10px] text-amber-600 mt-1">Este nó ainda tem a action legada “redirecionar_instalacao”. Escolha um destino acima e salve pra migrar.</p>
            )}
          </div>

          {!redirectTo && (
          <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
            <input type="checkbox" checked={askResolution} onChange={(e) => setAskResolution(e.target.checked)} />
            Perguntar se resolveu (1 / 2) depois dos passos
          </label>
          )}

          {askResolution && !redirectTo && (
            <>
              <div>
                <label className={labelCls}>Se resolveu (1) →</label>
                <select value={onResolved} onChange={(e) => setOnResolved(e.target.value)} className={inputCls}>
                  {FLOW_TARGET_SPECIAL.map((o) => (
                    <option key={o.value || "def"} value={o.value}>{o.label}</option>
                  ))}
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>↪️ Ir para: {n.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">Padrão = mensagem de encerramento abaixo, ou sucesso global se vazia.</p>
              </div>
              <div>
                <label className={labelCls}>Mensagem se resolveu (opcional — sobrescreve a global)</label>
                <textarea value={closingMsg} onChange={(e) => setClosingMsg(e.target.value)} rows={2} className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1" placeholder="Vazio = usa mensagem de sucesso global" />
              </div>
              <div>
                <label className={labelCls}>Se NÃO resolveu (2) →</label>
                <select value={onNotResolved} onChange={(e) => setOnNotResolved(e.target.value)} className={inputCls}>
                  {FLOW_TARGET_SPECIAL.map((o) => (
                    <option key={o.value || "def2"} value={o.value}>{o.label}</option>
                  ))}
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>↪️ Ir para: {n.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">Padrão = escalar com mensagem global.</p>
              </div>
              <div>
                <label className={labelCls}>Situação (resumo no monitor se escalar)</label>
                <input value={transferLabel} onChange={(e) => setTransferLabel(e.target.value)} className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
              </div>
            </>
          )}
        </div>
      )}

      {!isLeaf && (
        <div className="border border-border rounded-xl p-3 space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground">Resposta inválida neste submenu (opcional)</p>
          <div>
            <label className={labelCls}>1ª vez que digitar errado (intro)</label>
            <input value={invalidRetry1} onChange={(e) => setInvalidRetry1(e.target.value)} placeholder="Vazio = usa global" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>2ª vez (intro)</label>
            <input value={invalidRetry2} onChange={(e) => setInvalidRetry2(e.target.value)} placeholder="Vazio = usa global" className={inputCls} />
          </div>
        </div>
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