// app/components/whatsapp/BotMenuTreeEditor.tsx
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight, ChevronDown, Plus, Trash2, Save, X, Tag,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import BotFlowCanvas, { type CanvasNode, type FlowLink } from "./BotFlowCanvas";

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

const SPECIAL_ACTIONS = [
  { value: "check_renovacao_recente", label: "Já renovou no portal?", desc: "Responde se o pagamento automático já entrou." },
  { value: "escalar_imediatamente", label: "Passar pro Márcio na hora", desc: "Encerra o bot e te chama." },
  { value: "coletar_relato_e_escalar", label: "Pedir relato e passar pro Márcio", desc: "Manda o texto dos passos e transfere." },
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
  const [allSteps, setAllSteps] = useState<MenuStep[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFlowSettings, setShowFlowSettings] = useState(false);
  const [showFlowAdvanced, setShowFlowAdvanced] = useState(false);
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
        const nodes: MenuNode[] = json.nodes || [];
        const steps: MenuStep[] = json.steps || [];
        setFlatNodes(nodes);
        setAllSteps(steps);
        const t = buildTree(nodes, steps);
        setTree(t);
        setSelectedNode((sel) => {
          if (!sel) return null;
          // re-resolve seleção após reload
          const find = (list: TreeNode[]): TreeNode | null => {
            for (const n of list) {
              if (n.id === sel.id) return n;
              const c = find(n.children);
              if (c) return c;
            }
            return null;
          };
          return find(t);
        });
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

  async function callApi(body: any) {
    const headers = await authHeader();
    const res = await fetch("/api/whatsapp/bot/menu-tree", { method: "POST", headers, body: JSON.stringify(body) });
    return res.json();
  }

  async function handleCreateCategory(name: string, slug: string) {
    const maxNum = flatNodes.filter((n) => !n.parent_id).reduce((m, n) => Math.max(m, n.option_number), 0);
    await callApi({ action: "create_node", parent_id: null, slug, option_number: maxNum + 1, label: name, keywords: [], requires_account_check: false, special_actions: [] });
    setModal(null);
    loadTree();
  }

  async function handleCreateOption(parent: TreeNode, label: string) {
    const maxNum = parent.children.reduce((m, n) => Math.max(m, n.option_number), 0);
    await callApi({ action: "create_node", parent_id: parent.id, option_number: maxNum + 1, label, keywords: [], special_actions: [] });
    setModal(null);
    loadTree();
  }

  async function handleDelete(node: TreeNode) {
    await callApi({ action: "delete_node", id: node.id });
    setModal(null);
    setSelectedNode((sel) => (sel?.id === node.id ? null : sel));
    loadTree();
  }

  const canvasNodes: CanvasNode[] = useMemo(() => {
    return flatNodes.map((n) => ({
      id: n.id,
      label: n.label,
      parent_id: n.parent_id,
      option_number: n.option_number,
      redirect_to_node_id: n.redirect_to_node_id,
      on_resolved_target: n.on_resolved_target,
      on_not_resolved_target: n.on_not_resolved_target,
      ask_resolution: n.ask_resolution,
      closing_message: n.closing_message,
      is_active: n.is_active,
      stepsCount: allSteps.filter((s) => s.node_id === n.id).length,
    }));
  }, [flatNodes, allSteps]);

  async function handleCanvasLink(payload: {
    fromId: string;
    port: "out_menu" | "out_next" | "out_ok" | "out_fail";
    toId: string;
  }) {
    const { fromId, port, toId } = payload;
    // Sistema → só menu (início vira raiz)
    if (fromId === "__start__") {
      if (toId.startsWith("__")) return;
      const to = flatNodes.find((n) => n.id === toId);
      if (!to) return;
      const maxNum = flatNodes.filter((n) => !n.parent_id && n.id !== toId).reduce((m, n) => Math.max(m, n.option_number), 0);
      await callApi({
        action: "update_node",
        id: toId,
        parent_id: null,
        option_number: to.parent_id ? maxNum + 1 : to.option_number,
      });
      loadTree();
      return;
    }
    if (fromId.startsWith("__")) return;
    if (toId === "__start__") return;

    if (port === "out_menu") {
      if (toId.startsWith("__")) return;
      const siblings = flatNodes.filter((n) => n.parent_id === fromId && n.id !== toId);
      const maxNum = siblings.reduce((m, n) => Math.max(m, n.option_number), 0);
      const nextNum = Math.min(8, maxNum + 1) || 1;
      await callApi({ action: "update_node", id: toId, parent_id: fromId, option_number: nextNum });
      loadTree();
      return;
    }

    if (port === "out_next") {
      if (toId.startsWith("__")) return;
      await callApi({
        action: "update_node",
        id: fromId,
        redirect_to_node_id: toId,
        ask_resolution: false,
        on_resolved_target: null,
        on_not_resolved_target: null,
      });
      loadTree();
      return;
    }

    if (port === "out_ok") {
      const target = toId === "__success__" ? null : toId === "__escalate__" ? "__escalate__" : toId;
      await callApi({
        action: "update_node",
        id: fromId,
        ask_resolution: true,
        redirect_to_node_id: null,
        on_resolved_target: target, // null = sucesso global
      });
      loadTree();
      return;
    }

    if (port === "out_fail") {
      const target = toId === "__escalate__" ? null : toId === "__success__" ? "__success__" : toId;
      await callApi({
        action: "update_node",
        id: fromId,
        ask_resolution: true,
        redirect_to_node_id: null,
        on_not_resolved_target: target, // null = escalar global
      });
      loadTree();
    }
  }

  async function handleCanvasUnlink(link: FlowLink) {
    if (link.kind === "menu") {
      // desliga: vira nó raiz (sem pai)
      const roots = flatNodes.filter((n) => !n.parent_id && n.id !== link.to);
      const maxNum = roots.reduce((m, n) => Math.max(m, n.option_number), 0);
      await callApi({ action: "update_node", id: link.to, parent_id: null, option_number: maxNum + 1 });
      loadTree();
      return;
    }
    if (link.kind === "next") {
      await callApi({ action: "update_node", id: link.from, redirect_to_node_id: null });
      loadTree();
      return;
    }
    if (link.kind === "ok") {
      await callApi({ action: "update_node", id: link.from, on_resolved_target: null });
      // se não tem fail custom e não quer mais resolveu, limpa ask só se ambos null
      const node = flatNodes.find((n) => n.id === link.from);
      if (node && !node.on_not_resolved_target && !node.closing_message) {
        await callApi({ action: "update_node", id: link.from, ask_resolution: false });
      }
      loadTree();
      return;
    }
    if (link.kind === "fail") {
      await callApi({ action: "update_node", id: link.from, on_not_resolved_target: null });
      const node = flatNodes.find((n) => n.id === link.from);
      if (node && !node.on_resolved_target && !node.closing_message) {
        await callApi({ action: "update_node", id: link.from, ask_resolution: false });
      }
      loadTree();
    }
  }

  function selectById(id: string | null) {
    if (!id) {
      setSelectedNode(null);
      return;
    }
    const find = (list: TreeNode[]): TreeNode | null => {
      for (const n of list) {
        if (n.id === id) return n;
        const c = find(n.children);
        if (c) return c;
      }
      return null;
    };
    // se não estiver na árvore (ex: órfão), monta TreeNode mínimo a partir do flat
    const found = find(tree);
    if (found) {
      setSelectedNode(found);
      return;
    }
    const raw = flatNodes.find((n) => n.id === id);
    if (raw) {
      setSelectedNode({
        ...raw,
        children: flatNodes.filter((c) => c.parent_id === raw.id).map((c) => ({ ...c, children: [], steps: allSteps.filter((s) => s.node_id === c.id) })),
        steps: allSteps.filter((s) => s.node_id === raw.id),
      });
    }
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
      {/* Textos padrão — só o essencial à vista */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFlowSettings((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <div className="text-left">
            <h3 className="text-sm font-semibold text-foreground">Textos padrão do bot</h3>
            <p className="text-[11px] text-muted-foreground">Saudação, sucesso e quando passa pro Márcio</p>
          </div>
          {showFlowSettings ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showFlowSettings && flowSettings && (
          <div className="p-4 space-y-3 border-t border-border">
            {flowError && (
              <p className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{flowError}</p>
            )}
            {([
              ["greeting_message", "Saudação (1ª mensagem)"],
              ["success_message", "Quando deu certo"],
              ["escalate_message", "Quando não resolveu / bot desiste"],
              ["human_requested_message", "Quando pediu pra falar com você"],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className={labelCls}>{label}</label>
                <textarea
                  value={flowSettings[key]}
                  onChange={(e) => setFlowSettings((s) => s ? { ...s, [key]: e.target.value } : s)}
                  rows={2}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setShowFlowAdvanced((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showFlowAdvanced ? "▾" : "▸"} Textos de “não entendi” (opcional)
            </button>
            {showFlowAdvanced && (
              <div className="space-y-2 pl-1 border-l-2 border-border">
                {([
                  ["invalid_retry_message_1", "Não entendi (1ª vez)"],
                  ["invalid_retry_message_2", "Não entendi (2ª vez)"],
                  ["menu_invalid_intro_1", "Não entendi no submenu (1ª)"],
                  ["menu_invalid_intro_2", "Não entendi no submenu (2ª)"],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className={labelCls}>{label}</label>
                    <textarea
                      value={flowSettings[key]}
                      onChange={(e) => setFlowSettings((s) => s ? { ...s, [key]: e.target.value } : s)}
                      rows={2}
                      className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1"
                    />
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => void saveFlowSettings()} disabled={flowSaving} className={btnPrimary}>
              <Save className="w-3.5 h-3.5" /> {flowSaving ? "Salvando..." : "Salvar textos"}
            </button>
          </div>
        )}
        {showFlowSettings && !flowSettings && (
          <div className="p-4 text-xs text-muted-foreground border-t border-border">
            {flowError || "Carregando…"}
          </div>
        )}
      </div>

    <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 min-h-[560px]">
      <div className="border border-border rounded-xl overflow-hidden flex flex-col min-h-[520px]">
        {loading ? (
          <p className="text-xs text-muted-foreground p-4">Carregando fluxo…</p>
        ) : (
          <BotFlowCanvas
            nodes={canvasNodes}
            selectedId={selectedNode?.id ?? null}
            onSelect={selectById}
            onCreateNode={() => setModal({ type: "create_category" })}
            onLink={handleCanvasLink}
            onUnlink={handleCanvasUnlink}
          />
        )}
      </div>

      <div className="border border-border rounded-xl p-4 overflow-y-auto max-h-[70vh]">
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
          <div className="text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Como usar o canvas</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Clique <strong>+ Nó</strong> para criar</li>
              <li>Arraste os cartões pra organizar</li>
              <li>Clique numa bolinha <strong>à direita</strong> (saída)</li>
              <li>Depois clique na bolinha <strong>à esquerda</strong> do destino (entrada)</li>
              <li>Clique numa <strong>linha</strong> e em Desligar pra remover</li>
            </ol>
            <p className="text-[10px] pt-2">Roxo = menu · Ciano = continuar · Verde = resolveu · Âmbar = não resolveu</p>
          </div>
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
  const [askResolution, setAskResolution] = useState<boolean>(
    !node.redirect_to_node_id && (
      node.ask_resolution === true || !!(node.closing_message || node.on_resolved_target || node.on_not_resolved_target)
    )
  );
  const [appliesToServers, setAppliesToServers] = useState<string[]>(
    node.applies_to_servers === null || node.applies_to_servers === undefined
      ? SERVER_OPTIONS.map((s) => s.value)
      : node.applies_to_servers
  );
  const [isActive, setIsActive] = useState(node.is_active);
  const [steps, setSteps] = useState<string[]>(node.steps.map((s) => s.message_text));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const otherNodes = allNodes.filter((n) => n.id !== node.id);

  function toggleAction(value: string) {
    setSpecialActions((prev) => prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]);
  }

  function toggleServer(value: string) {
    setAppliesToServers((prev) => prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]);
  }

  function insertTagAt(stepIndex: number, tag: string) {
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
    let actions = [...specialActions];
    if (redirectTo) {
      actions = actions.filter((a) => a !== "redirecionar_instalacao");
    }
    const effectiveAsk = redirectTo ? false : askResolution;
    onSave({
      label,
      keywords: keywordsText.split(",").map((k) => k.trim()).filter(Boolean),
      special_actions: actions,
      closing_message: effectiveAsk ? (closingMsg.trim() || null) : null,
      transfer_situation_label: transferLabel.trim() || null,
      applies_to_servers: appliesToServers,
      is_active: isActive,
      redirect_to_node_id: redirectTo || null,
      // Padrão fixo no UI: resolveu → sucesso global; não → escalar.
      on_resolved_target: null,
      on_not_resolved_target: null,
      ask_resolution: effectiveAsk,
    });
    onSaveSteps(steps.filter((s) => s.trim()));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground truncate">Editando: {node.label}</h4>
        <button onClick={onDelete} className="text-rose-500 hover:text-rose-400 shrink-0" title="Excluir">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label className={labelCls}>Nome (o que o cliente vê no menu)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </div>

      {/* Mensagens — o centro do editor */}
      {!specialActions.includes("free_text_rag") && (
        <div>
          <label className={labelCls}>{isLeaf ? "Mensagens que o bot envia" : "Texto antes das sub-opções (opcional)"}</label>
          <button
            type="button"
            onClick={() => setShowVars((v) => !v)}
            className="ml-2 text-[10px] text-violet-500 hover:underline"
          >
            {showVars ? "ocultar variáveis" : "inserir variável"}
          </button>
          {showVars && (
            <div className="mt-1.5 mb-2">
              <VariablePanel onInsert={(tag) => insertTagAt(activeStepIndex, tag)} />
            </div>
          )}
          <div className="space-y-2 mt-1.5">
            {steps.map((s, i) => (
              <div key={i} className={`border rounded-lg p-2 space-y-1 ${activeStepIndex === i ? "border-violet-500/50" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Msg {i + 1}</span>
                  <button type="button" onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-500"><X className="w-3.5 h-3.5" /></button>
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
            <button type="button" onClick={() => { setSteps((prev) => [...prev, ""]); setActiveStepIndex(steps.length); }} className="flex items-center gap-1 text-[11px] text-violet-500">
              <Plus className="w-3 h-3" /> Outra mensagem
            </button>
          </div>
        </div>
      )}

      {/* Depois das mensagens — só 2 escolhas simples */}
      {isLeaf && (
        <div className="space-y-3 border border-border rounded-xl p-3">
          <p className="text-[11px] font-medium text-foreground">Depois dessas mensagens…</p>

          <div>
            <label className={labelCls}>Ir para outro menu (opcional)</label>
            <select
              value={redirectTo}
              onChange={(e) => {
                setRedirectTo(e.target.value);
                if (e.target.value) setAskResolution(false);
              }}
              className={inputCls}
            >
              <option value="">Nenhum — encerra ou pergunta se resolveu</option>
              {otherNodes.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </div>

          {!redirectTo && (
            <>
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input type="checkbox" checked={askResolution} onChange={(e) => setAskResolution(e.target.checked)} />
                Perguntar se resolveu (1 = sim, 2 = não)
              </label>
              {askResolution && (
                <div className="space-y-2 pl-1">
                  <div>
                    <label className={labelCls}>Se resolveu — mensagem (vazio = texto padrão)</label>
                    <textarea value={closingMsg} onChange={(e) => setClosingMsg(e.target.value)} rows={2} className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
                  </div>
                  <div>
                    <label className={labelCls}>Se não resolveu — nota pra você no monitor</label>
                    <input value={transferLabel} onChange={(e) => setTransferLabel(e.target.value)} placeholder="ex: Tela preta após reset" className={inputCls} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Avançado — tudo o resto */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40"
        >
          <span>Avançado (palavras-chave, ações, servidor)</span>
          {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {showAdvanced && (
          <div className="p-3 space-y-3 border-t border-border">
            <div>
              <label className={labelCls}>Palavras-chave (vírgula)</label>
              <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="travando, buffer" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Ações</label>
              <div className="space-y-1.5 mt-1">
                {SPECIAL_ACTIONS.map((a) => (
                  <label key={a.value} className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={specialActions.includes(a.value)} onChange={() => toggleAction(a.value)} />
                    <span>
                      <span className="block text-foreground">{a.label}</span>
                      <span className="block text-[10px] text-muted-foreground">{a.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Só para servidores</label>
              <div className="flex flex-wrap gap-3 mt-1">
                {SERVER_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={appliesToServers.includes(s.value)} onChange={() => toggleServer(s.value)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Ativo
            </label>
          </div>
        )}
      </div>

      {!showAdvanced && (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Ativo
        </label>
      )}

      <button onClick={saveAll} disabled={saving} className={btnPrimary}>
        <Save className="w-3.5 h-3.5" /> {saving ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}