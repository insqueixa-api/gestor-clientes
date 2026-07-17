// app/components/whatsapp/BotMenuTreeEditor.tsx
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight, ChevronDown, Plus, Trash2, Save, X, Tag,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/app/admin/HookuseConfirm";
import BotFlowCanvas, { FlowPortLegend, type CanvasNode, type FlowLink } from "./BotFlowCanvas";

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

type MenuStep = {
  id: string;
  node_id: string;
  step_order: number;
  message_text: string;
  // null/undefined = mensagem universal (todos os servidores)
  server?: string | null;
  is_active?: boolean;
};
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
      { label: "{dns_servidor}", desc: "DNS aleatória (evita a 1ª cadastrada)" },
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

type CreateLinkKind = "menu" | "next" | "ok" | "fail";

// ── Modal: criar nó já conectado ao focado (ou menu principal) ───────────────
function CreateNodeModal({
  onClose,
  onCreate,
  asChildOf,
}: {
  onClose: () => void;
  onCreate: (name: string, slug: string, linkKind: CreateLinkKind) => Promise<void>;
  /** Nó focado — novo nó será ligado a ele */
  asChildOf: { id: string; label: string } | null;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkKind, setLinkKind] = useState<CreateLinkKind>("menu");

  useEffect(() => { if (!slugEdited) setSlug(slugify(name)); }, [name, slugEdited]);

  const hasFocus = !!asChildOf;

  // ✅ "Continuar" (redirect_to_node_id) removido daqui de propósito — é o
  // mesmo mecanismo do campo "Ir para outro menu" já disponível no editor do
  // nó, só que confundia aparecer como uma 4ª opção separada nesse momento
  // de criação. Continua acessível depois, editando o nó.
  const LINK_OPTIONS: { value: CreateLinkKind; color: string; title: string; desc: string }[] = [
    { value: "menu", color: "bg-violet-500", title: "Menu (opção filha)", desc: "Aparece como escolha 1–8 dentro deste nó" },
    { value: "ok", color: "bg-emerald-500", title: "Resolveu", desc: "Se o cliente disser que resolveu (1) → este nó" },
    { value: "fail", color: "bg-amber-500", title: "Não resolveu", desc: "Se não resolveu (2) → este nó" },
  ];

  return (
    <ModalShell
      title={hasFocus ? `Novo nó a partir de “${asChildOf!.label}”` : "Novo menu principal"}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>Cancelar</button>
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await onCreate(name, slug, hasFocus ? linkKind : "menu");
              } finally {
                setSaving(false);
              }
            }}
            disabled={!name.trim() || (!hasFocus && !slug.trim()) || saving}
            className={btnPrimary}
          >
            <Save className="w-3.5 h-3.5" /> {saving ? "Criando..." : "Criar e conectar"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Nome (aparece no WhatsApp)</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={hasFocus ? "Ex: Tela preta" : "Ex: Problema técnico"}
            className={inputCls}
          />
        </div>

        {hasFocus ? (
          <div>
            <label className={labelCls}>Como liga em “{asChildOf!.label}”?</label>
            <div className="mt-2 space-y-2">
              {LINK_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                    linkKind === o.value
                      ? "border-violet-500/50 bg-violet-500/10"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="linkKind"
                    className="mt-1"
                    checked={linkKind === o.value}
                    onChange={() => setLinkKind(o.value)}
                  />
                  <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${o.color}`} />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">{o.title}</span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className={labelCls}>Slug técnico (interno)</label>
            <input
              value={slug}
              onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
              className={`${inputCls} font-mono`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Menu principal (coluna 2). Depois clique nele e use + para criar opções ligadas.
            </p>
          </div>
        )}
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
  const { confirm } = useConfirm();
  const alertError = (msg: string) =>
    confirm({
      title: "Erro",
      subtitle: msg,
      tone: "rose",
      confirmText: "OK",
      cancelText: "",
    });
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [flatNodes, setFlatNodes] = useState<MenuNode[]>([]);
  const [allSteps, setAllSteps] = useState<MenuStep[]>([]);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  /** Modal textos padrão: start = Início/saudação; end = Sucesso/Márcio */
  const [flowSettingsOpen, setFlowSettingsOpen] = useState<null | "start" | "end">(null);
  const [showFlowAdvanced, setShowFlowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flowSettings, setFlowSettings] = useState<FlowSettings | null>(null);
  const [flowSaving, setFlowSaving] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    | { type: "create_node"; asChild: boolean }
    | { type: "delete"; node: TreeNode }
    | null
  >(null);
  /** Força o canvas a mostrar todos os nós (após criar, etc.) */
  const [canvasShowAll, setCanvasShowAll] = useState(false);

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

  function nextOptionNumber(parentId: string | null, forFlowTarget = false): number {
    const siblings = flatNodes.filter((n) =>
      parentId ? n.parent_id === parentId : !n.parent_id
    );
    if (forFlowTarget) {
      // fora de 1–8 pra não roubar número de opção do menu do cliente
      const max = siblings.reduce((m, n) => Math.max(m, Number(n.option_number) || 0), 10);
      return Math.max(11, max + 1);
    }
    const used = new Set(siblings.map((s) => s.option_number));
    for (let i = 1; i <= 8; i++) {
      if (!used.has(i)) return i;
    }
    return 1;
  }

  /**
   * Cria nó e já conecta no focado:
   * - menu → filho real (parent_id), aparece no WhatsApp como opção
   * - next/ok/fail → filho de layout (parent_id) + flag link_target_only
   *   (NÃO vira opção de menu nem pluga no Início; só fio ciano/verde/âmbar)
   */
  async function handleCreateNode(name: string, slug: string, linkKind: CreateLinkKind) {
    const focusIsReal = !!(focusId && !focusId.startsWith("__"));
    const fromId = focusIsReal ? focusId! : null;

    // Sempre amarra no focado quando houver (hierarquia correta no canvas)
    const parentId = fromId;
    const isFlowTarget = !!(fromId && linkKind !== "menu");

    const body: any = {
      action: "create_node",
      parent_id: parentId,
      option_number: nextOptionNumber(parentId, isFlowTarget),
      label: name.trim(),
      keywords: [],
      requires_account_check: false,
      special_actions: isFlowTarget ? ["link_target_only"] : [],
    };
    // slug só em menu principal (sem pai)
    if (!parentId) {
      body.slug = slugify(slug || name);
    }

    const r = await callApi(body);
    setModal(null);

    if (r?.error) {
      alertError(r.error);
      return;
    }

    const created = r?.node;
    if (!created?.id) {
      await loadTree();
      return;
    }

    // Fios de fluxo no nó de origem
    if (fromId && linkKind === "next") {
      await callApi({
        action: "update_node",
        id: fromId,
        redirect_to_node_id: created.id,
        ask_resolution: false,
        on_resolved_target: null,
        on_not_resolved_target: null,
      });
    } else if (fromId && linkKind === "ok") {
      await callApi({
        action: "update_node",
        id: fromId,
        ask_resolution: true,
        redirect_to_node_id: null,
        on_resolved_target: created.id,
      });
    } else if (fromId && linkKind === "fail") {
      await callApi({
        action: "update_node",
        id: fromId,
        ask_resolution: true,
        redirect_to_node_id: null,
        on_not_resolved_target: created.id,
      });
    }
    // linkKind === "menu": já está com parent_id = fromId (fio roxo pai→filho)

    await loadTree();

    setCanvasShowAll(true);
    setFocusId(fromId || created.id);

    setSelectedNode({
      ...created,
      children: [],
      steps: [],
      keywords: created.keywords || [],
      special_actions: created.special_actions || [],
      closing_message: created.closing_message ?? null,
      transfer_situation_label: created.transfer_situation_label ?? null,
      applies_to_servers: created.applies_to_servers ?? null,
      is_active: created.is_active !== false,
    } as TreeNode);
    setEditOpen(true);
  }

  async function handleDelete(node: TreeNode) {
    await callApi({ action: "delete_node", id: node.id });
    setModal(null);
    setSelectedNode((sel) => (sel?.id === node.id ? null : sel));
    setFocusId((id) => (id === node.id ? null : id));
    setEditOpen(false);
    loadTree();
  }

  const canvasNodes: CanvasNode[] = useMemo(() => {
    return flatNodes.map((n) => ({
      id: n.id,
      label: n.label,
      parent_id: n.parent_id || null,
      option_number: n.option_number,
      special_actions: n.special_actions || [],
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
      await callApi({
        action: "update_node",
        id: link.to,
        parent_id: null,
        option_number: Math.min(8, Math.max(1, maxNum + 1)),
      });
      await loadTree();
      return;
    }
    if (link.kind === "next") {
      await callApi({ action: "update_node", id: link.from, redirect_to_node_id: null });
      await loadTree();
      return;
    }
    // ok / fail: o motor redesenha sucesso/escalar se ask_resolution continuar true.
    // Apagar qualquer uma das duas desliga o "perguntar se resolveu" por completo.
    if (link.kind === "ok" || link.kind === "fail") {
      await callApi({
        action: "update_node",
        id: link.from,
        ask_resolution: false,
        on_resolved_target: null,
        on_not_resolved_target: null,
        closing_message: null,
      });
      await loadTree();
    }
  }

  /** Troca o option_number do nó com quem já ocupa o número escolhido
   * (ou apenas atribui, se ninguém tiver esse número ainda). */
  async function handleReorder(node: TreeNode, newNumber: number) {
    const siblings = flatNodes.filter(
      (n) =>
        (n.parent_id || null) === (node.parent_id || null) &&
        n.id !== node.id &&
        !(n.special_actions || []).includes("link_target_only")
    );
    const occupant = siblings.find((n) => n.option_number === newNumber);

    if (occupant) {
      await callApi({ action: "update_node", id: occupant.id, option_number: node.option_number });
    }
    await callApi({ action: "update_node", id: node.id, option_number: newNumber });
    await loadTree();
  }

  /** Move o nó pra dentro de outro menu (ou pra raiz, se newParentId for null) —
   * a posição (1–8) é escolhida automaticamente entre os novos irmãos. */
  async function handleMoveParent(node: TreeNode, newParentId: string | null) {
    const siblings = flatNodes.filter(
      (n) =>
        (n.parent_id || null) === (newParentId || null) &&
        n.id !== node.id &&
        !(n.special_actions || []).includes("link_target_only")
    );
    const used = new Set(siblings.map((s) => s.option_number));
    let nextNumber = 1;
    for (let i = 1; i <= 8; i++) {
      if (!used.has(i)) {
        nextNumber = i;
        break;
      }
    }
    await callApi({ action: "update_node", id: node.id, parent_id: newParentId, option_number: nextNumber });
    await loadTree();
  }

  function resolveTreeNode(id: string): TreeNode | null {
    const find = (list: TreeNode[]): TreeNode | null => {
      for (const n of list) {
        if (n.id === id) return n;
        const c = find(n.children);
        if (c) return c;
      }
      return null;
    };
    const found = find(tree);
    if (found) return found;
    const raw = flatNodes.find((n) => n.id === id);
    if (!raw) return null;
    return {
      ...raw,
      children: flatNodes
        .filter((c) => c.parent_id === raw.id)
        .map((c) => ({ ...c, children: [], steps: allSteps.filter((s) => s.node_id === c.id) })),
      steps: allSteps.filter((s) => s.node_id === raw.id),
    };
  }

  function openEdit(id: string) {
    // Nós do sistema → textos padrão (mesmo modal/hook dos outros)
    if (id === "__start__") {
      setFlowSettingsOpen("start");
      setShowFlowAdvanced(false);
      return;
    }
    if (id === "__success__" || id === "__escalate__") {
      setFlowSettingsOpen("end");
      setShowFlowAdvanced(false);
      return;
    }
    const node = resolveTreeNode(id);
    if (!node) return;
    setSelectedNode(node);
    setFocusId(id);
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
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
        setFlowSettingsOpen(null);
      }
    } catch (e: any) {
      setFlowError(e?.message || "Erro ao salvar");
    } finally {
      setFlowSaving(false);
    }
  }

  const flowFocus = flowSettingsOpen; // "start" | "end"

  return (
    <div className="space-y-4">
    <div className="border border-border rounded-xl overflow-hidden flex flex-col min-h-[580px] w-full">
      {loading ? (
        <p className="text-xs text-muted-foreground p-4">Carregando fluxo…</p>
      ) : (
        <BotFlowCanvas
          nodes={canvasNodes}
          focusId={focusId}
          onFocus={(id) => {
            setFocusId(id);
            if (id) setCanvasShowAll(false);
          }}
          onEdit={openEdit}
          forceShowAll={canvasShowAll}
          onForceShowAllChange={setCanvasShowAll}
          onCreateNode={() => {
            // Com nó focado → pergunta o tipo de ligação; sem foco → menu principal
            const asChild = !!(focusId && !focusId.startsWith("__"));
            setModal({ type: "create_node", asChild });
          }}
          onCreateChild={
            focusId && !focusId.startsWith("__")
              ? () => setModal({ type: "create_node", asChild: true })
              : undefined
          }
          focusLabel={
            focusId && !focusId.startsWith("__")
              ? flatNodes.find((n) => n.id === focusId)?.label
              : undefined
          }
          onLink={handleCanvasLink}
          onUnlink={handleCanvasUnlink}
        />
      )}
    </div>

    {/* Duplo clique em Início / Sucesso / Márcio → textos padrão */}
    {flowSettingsOpen && (
      <ModalShell
        title={
          flowFocus === "start"
            ? "▶ Início — textos de entrada"
            : "Sucesso / Márcio — textos de saída"
        }
        wide
        onClose={() => setFlowSettingsOpen(null)}
        footer={
          <>
            <button type="button" onClick={() => setFlowSettingsOpen(null)} className={btnGhost}>
              Cancelar
            </button>
            <button type="button" onClick={() => void saveFlowSettings()} disabled={flowSaving || !flowSettings} className={btnPrimary}>
              <Save className="w-3.5 h-3.5" /> {flowSaving ? "Salvando..." : "Salvar"}
            </button>
          </>
        }
      >
        <div className="relative">
          <div className="absolute top-0 right-0 z-10 hidden sm:block">
            <FlowPortLegend />
          </div>
          <div className="sm:pr-28 space-y-4">
            {!flowSettings ? (
              <p className="text-xs text-muted-foreground">{flowError || "Carregando…"}</p>
            ) : (
              <>
                {flowError && (
                  <p className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{flowError}</p>
                )}

                {/* Início → saudação em destaque */}
                {flowFocus === "start" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
                      <label className={labelCls}>Saudação (1ª mensagem, depois do Início)</label>
                      <textarea
                        autoFocus
                        value={flowSettings.greeting_message}
                        onChange={(e) => setFlowSettings((s) => s ? { ...s, greeting_message: e.target.value } : s)}
                        rows={4}
                        className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFlowAdvanced((v) => !v)}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {showFlowAdvanced ? "▾" : "▸"} Textos de “não entendi” (opcional)
                    </button>
                    {showFlowAdvanced && (
                      <div className="space-y-2 pl-2 border-l-2 border-border">
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
                  </div>
                )}

                {/* Sucesso / Márcio → textos de encerramento */}
                {flowFocus === "end" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                      <label className={labelCls}>✅ Quando deu certo (Sucesso)</label>
                      <textarea
                        autoFocus
                        value={flowSettings.success_message}
                        onChange={(e) => setFlowSettings((s) => s ? { ...s, success_message: e.target.value } : s)}
                        rows={3}
                        className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2"
                      />
                    </div>
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                      <label className={labelCls}>🙋 Quando não resolveu / bot desiste (Márcio)</label>
                      <textarea
                        value={flowSettings.escalate_message}
                        onChange={(e) => setFlowSettings((s) => s ? { ...s, escalate_message: e.target.value } : s)}
                        rows={3}
                        className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Quando o cliente pediu pra falar com você (0 / humano)</label>
                      <textarea
                        value={flowSettings.human_requested_message}
                        onChange={(e) => setFlowSettings((s) => s ? { ...s, human_requested_message: e.target.value } : s)}
                        rows={2}
                        className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </ModalShell>
    )}

    {/* Duplo clique no nó normal → modal de edição */}
    {editOpen && selectedNode && (
      <ModalShell
        title={`Editar: ${selectedNode.label}`}
        wide
        onClose={closeEdit}
        footer={
          <>
            <button type="button" onClick={() => setModal({ type: "delete", node: selectedNode })} className={btnDanger}>
              Excluir
            </button>
            <button type="button" onClick={closeEdit} className={btnGhost}>
              Fechar
            </button>
          </>
        }
      >
        <div className="relative">
          <div className="absolute top-0 right-0 z-10 hidden sm:block">
            <FlowPortLegend />
          </div>
          <div className="sm:pr-28">
            <NodeEditor
              key={selectedNode.id}
              node={selectedNode}
              isLeaf={selectedNode.children.length === 0}
              allNodes={flatNodes}
              defaultSuccessMessage={flowSettings?.success_message || "Que bom! Fico feliz que resolveu 😊"}
              onReorder={(newNumber) => handleReorder(selectedNode, newNumber)}
              onMoveParent={(newParentId) => handleMoveParent(selectedNode, newParentId)}
              onSave={async (fields) => {
                setSaving(true);
                const r = await callApi({ action: "update_node", id: selectedNode.id, ...fields });
                if (r?.error) {
                  setSaving(false);
                  alertError(r.error);
                  throw new Error(r.error);
                }
              }}
              onSaveSteps={async (payload) => {
                const r = await callApi({ action: "set_steps", node_id: selectedNode.id, ...payload });
                if (r?.error) {
                  setSaving(false);
                  alertError(r.error);
                  throw new Error(r.error);
                }
                setSaving(false);
                await loadTree();
                closeEdit();
              }}
              onDelete={() => setModal({ type: "delete", node: selectedNode })}
              saving={saving}
              hideDelete
            />
          </div>
        </div>
      </ModalShell>
    )}

    {modal?.type === "create_node" && (
      <CreateNodeModal
        onClose={() => setModal(null)}
        asChildOf={
          modal.asChild && focusId && !focusId.startsWith("__")
            ? {
                id: focusId,
                label: flatNodes.find((n) => n.id === focusId)?.label || "nó",
              }
            : null
        }
        onCreate={(name, slug, linkKind) => handleCreateNode(name, slug, linkKind)}
      />
    )}
    {modal?.type === "delete" && (
      <ConfirmDeleteModal
        label={modal.node.label}
        onClose={() => setModal(null)}
        onConfirm={async () => {
          await handleDelete(modal.node);
          setEditOpen(false);
        }}
      />
    )}
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

// ── Seletor em árvore (substitui <select> plano de nós) ──────────────────────
// ✅ Antes listava TODOS os nós soltos, sem hierarquia — achar "Quero renovar
// agora" no meio de raízes e folhas misturadas ficava confuso. Aqui o pai
// aparece com um <> pra expandir/colapsar os filhos; ao abrir mais uma
// camada, os níveis acima ficam em negrito (indicando que têm algo aberto
// embaixo) e o nível mais fundo visível fica normal — mesmo efeito visual
// pedido: negrito cresce conforme você desce na árvore.
function findAncestorIds(nodes: MenuNode[], nodeId: string | null | undefined): string[] {
  if (!nodeId) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids: string[] = [];
  let cur = byId.get(nodeId)?.parent_id || null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    ids.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parent_id || null;
  }
  return ids;
}

function TreeSelect({
  nodes, value, onChange, noneLabel, disabled,
}: {
  nodes: MenuNode[];
  value: string;
  onChange: (id: string) => void;
  noneLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const byParent = useMemo(() => {
    const map = new Map<string, MenuNode[]>();
    for (const n of nodes) {
      const key = n.parent_id || "__root__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    for (const list of map.values()) list.sort((a, b) => a.option_number - b.option_number);
    return map;
  }, [nodes]);

  const selectedNode = nodes.find((n) => n.id === value) || null;

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openDropdown() {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of findAncestorIds(nodes, value || null)) next.add(id);
      return next;
    });
    setOpen(true);
  }

  function renderLevel(parentKey: string, depth: number): React.ReactNode {
    const list = byParent.get(parentKey) || [];
    return list.map((n) => {
      const hasChildren = (byParent.get(n.id) || []).length > 0;
      const isExpanded = expanded.has(n.id);
      const isBold = hasChildren && isExpanded;
      return (
        <div key={n.id}>
          <div className="flex items-center gap-1 rounded-md hover:bg-muted px-1 py-1" style={{ paddingLeft: 4 + depth * 16 }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleExpand(n.id); }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title={isExpanded ? "Recolher" : "Expandir"}
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-3.5 h-3.5 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => { onChange(n.id); setOpen(false); }}
              className={`text-xs flex-1 truncate text-left ${isBold ? "font-semibold text-foreground" : "text-foreground"} ${n.id === value ? "text-violet-500" : ""}`}
            >
              {n.label}
            </button>
          </div>
          {hasChildren && isExpanded && renderLevel(n.id, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className={`${inputCls} text-left flex items-center justify-between gap-2 disabled:opacity-50`}
      >
        <span className="truncate">{selectedNode ? selectedNode.label : noneLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-2xl p-1">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full text-left text-xs rounded-md hover:bg-muted px-2 py-1.5 ${value === "" ? "text-violet-500" : "text-muted-foreground"}`}
          >
            {noneLabel}
          </button>
          {renderLevel("__root__", 0)}
        </div>
      )}
    </div>
  );
}

type StepsMode = "universal" | "individual";
type StepsSavePayload = { steps: string[]; variants?: { server: string; is_active: boolean; steps: string[] }[] };
type ActiveStepRef = { scope: string; index: number };

// ── Lista de mensagens (textareas + adicionar) reutilizada tanto no modo
// universal quanto em cada um dos 3 blocos por servidor no modo individual ──
function StepsListEditor({
  scope, steps, onChange, activeStep, setActiveStep, textareaRefs,
}: {
  scope: string;
  steps: string[];
  onChange: (steps: string[]) => void;
  activeStep: ActiveStepRef;
  setActiveStep: (s: ActiveStepRef) => void;
  textareaRefs: { current: Record<string, HTMLTextAreaElement | null> };
}) {
  return (
    <div className="space-y-2 mt-1.5">
      {steps.map((s, i) => (
        <div
          key={i}
          className={`border rounded-lg p-2 space-y-1 ${activeStep.scope === scope && activeStep.index === i ? "border-violet-500/50" : "border-border"}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Msg {i + 1}</span>
            <button type="button" onClick={() => onChange(steps.filter((_, idx) => idx !== i))} className="text-rose-500">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            ref={(el) => { textareaRefs.current[`${scope}-${i}`] = el; }}
            value={s}
            onFocus={() => setActiveStep({ scope, index: i })}
            onChange={(e) => onChange(steps.map((p, idx) => idx === i ? e.target.value : p))}
            className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5"
            rows={3}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => { onChange([...steps, ""]); setActiveStep({ scope, index: steps.length }); }}
        className="flex items-center gap-1 text-[11px] text-violet-500"
      >
        <Plus className="w-3 h-3" /> Outra mensagem
      </button>
    </div>
  );
}

function NodeEditor({
  node, isLeaf, allNodes, defaultSuccessMessage, onSave, onSaveSteps, onDelete, onReorder, onMoveParent, saving, hideDelete,
}: {
  node: TreeNode; isLeaf: boolean;
  allNodes: MenuNode[];
  defaultSuccessMessage: string;
  onSave: (fields: any) => void | Promise<void>;
  onSaveSteps: (payload: StepsSavePayload) => void | Promise<void>;
  onDelete: () => void;
  onReorder?: (newNumber: number) => Promise<void>;
  onMoveParent?: (newParentId: string | null) => Promise<void>;
  saving: boolean;
  hideDelete?: boolean;
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

  // ✅ Modo derivado do dado: se algum step já tem "server" preenchido, o nó
  // foi salvo em modo Individual — abre já nesse modo. Senão, Universal.
  const [stepsMode, setStepsMode] = useState<StepsMode>(
    node.steps.some((s) => s.server) ? "individual" : "universal"
  );
  const [universalSteps, setUniversalSteps] = useState<string[]>(
    node.steps.filter((s) => !s.server).map((s) => s.message_text)
  );
  const [serverSteps, setServerSteps] = useState<Record<string, { active: boolean; steps: string[] }>>(() => {
    const base: Record<string, { active: boolean; steps: string[] }> = {};
    SERVER_OPTIONS.forEach((s) => { base[s.value] = { active: true, steps: [] }; });
    node.steps.forEach((s) => {
      if (s.server && base[s.server]) {
        base[s.server].steps.push(s.message_text);
        if (s.is_active === false) base[s.server].active = false;
      }
    });
    return base;
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [activeStep, setActiveStep] = useState<ActiveStepRef>({ scope: "universal", index: 0 });

const otherNodes = allNodes.filter((n) => n.id !== node.id);
  const [reordering, setReordering] = useState(false);
  const [movingParent, setMovingParent] = useState(false);

  // Irmãos reais (mesmo pai, excluindo alvos de fluxo sem número de menu)
  const menuSiblings = allNodes.filter(
    (n) =>
      (n.parent_id || null) === (node.parent_id || null) &&
      n.id !== node.id &&
      !(n.special_actions || []).includes("link_target_only")
  );
  const takenNumbers = new Map(menuSiblings.map((n) => [n.option_number, n.label]));
  const isMenuNode = !(node.special_actions || []).includes("link_target_only");

  // ✅ Candidatos válidos pra "mover pra outro menu": qualquer nó, exceto
  // descendentes do próprio (evitaria criar um ciclo pai→filho→...→pai).
  function isDescendantOfSelf(candidateId: string): boolean {
    let cur = allNodes.find((n) => n.id === candidateId);
    const seen = new Set<string>();
    while (cur) {
      if (cur.id === node.id) return true;
      if (!cur.parent_id || seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = allNodes.find((n) => n.id === cur!.parent_id);
    }
    return false;
  }
  const parentCandidates = otherNodes.filter((n) => !isDescendantOfSelf(n.id));

  function toggleAction(value: string) {
    setSpecialActions((prev) => prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]);
  }

  function toggleServer(value: string) {
    setAppliesToServers((prev) => prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]);
  }

  function getStepsForScope(scope: string): string[] {
    return scope === "universal" ? universalSteps : serverSteps[scope]?.steps || [];
  }

  function setStepsForScope(scope: string, next: string[]) {
    if (scope === "universal") setUniversalSteps(next);
    else setServerSteps((prev) => ({ ...prev, [scope]: { ...prev[scope], steps: next } }));
  }

  function insertTagAt(scope: string, stepIndex: number, tag: string) {
    const list = getStepsForScope(scope);
    if (list.length === 0) {
      setStepsForScope(scope, [tag]);
      setActiveStep({ scope, index: 0 });
      return;
    }
    const idx = Math.min(stepIndex, list.length - 1);
    const el = textareaRefs.current[`${scope}-${idx}`];
    if (!el) {
      setStepsForScope(scope, list.map((s, i) => i === idx ? s + tag : s));
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const newText = text.substring(0, start) + tag + text.substring(end);
    setStepsForScope(scope, list.map((s, i) => i === idx ? newText : s));
    setTimeout(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); }, 0);
  }

  async function saveAll() {
    let actions = [...specialActions];
    if (redirectTo) {
      actions = actions.filter((a) => a !== "redirecionar_instalacao");
    }
    const effectiveAsk = redirectTo ? false : askResolution;
    await onSave({
      label,
      keywords: keywordsText.split(",").map((k) => k.trim()).filter(Boolean),
      special_actions: actions,
      closing_message: effectiveAsk ? (closingMsg.trim() || null) : null,
      transfer_situation_label: transferLabel.trim() || null,
      applies_to_servers: appliesToServers,
      is_active: isActive,
      redirect_to_node_id: redirectTo || null,
      on_resolved_target: null,
      on_not_resolved_target: null,
      ask_resolution: effectiveAsk,
    });

    if (stepsMode === "universal") {
      await onSaveSteps({ steps: universalSteps.filter((s) => s.trim()) });
    } else {
      const variants = Object.entries(serverSteps).map(([server, v]) => ({
        server,
        is_active: v.active,
        steps: v.steps.filter((s) => s.trim()),
      }));
      await onSaveSteps({ steps: [], variants });
    }
  }

  return (
    <div className="space-y-4">
      {!hideDelete && (
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground truncate">Editando: {node.label}</h4>
          <button onClick={onDelete} className="text-rose-500 hover:text-rose-400 shrink-0" title="Excluir">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      <div>
        <label className={labelCls}>Nome (o que o cliente vê no menu)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </div>

      {isMenuNode && onReorder && (
        <div>
          <label className={labelCls}>Posição no menu</label>
          <select
            value={node.option_number}
            disabled={reordering}
            onChange={async (e) => {
              const newNumber = Number(e.target.value);
              if (newNumber === node.option_number) return;
              setReordering(true);
              try {
                await onReorder(newNumber);
              } finally {
                setReordering(false);
              }
            }}
            className={inputCls}
          >
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
                {takenNumbers.has(n) && n !== node.option_number ? ` — troca com "${takenNumbers.get(n)}"` : ""}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">
            Escolher um número já usado troca a posição com quem está lá.
          </p>
        </div>
      )}

      {onMoveParent && (
        <div>
          <label className={labelCls}>Menu pai (mover pra outro lugar)</label>
          <TreeSelect
            nodes={parentCandidates}
            value={node.parent_id || ""}
            disabled={movingParent}
            onChange={async (id) => {
              const newParentId = id || null;
              if ((newParentId || null) === (node.parent_id || null)) return;
              setMovingParent(true);
              try {
                await onMoveParent(newParentId);
              } finally {
                setMovingParent(false);
              }
            }}
            noneLabel="— Nenhum (menu principal) —"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Move este item pra dentro de outro menu (ou pra raiz). A posição (1–8) é escolhida automaticamente no novo lugar.
          </p>
        </div>
      )}

      {/* Mensagens — o centro do editor */}
      {!specialActions.includes("free_text_rag") && (
        <div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className={labelCls}>{isLeaf ? "Mensagens que o bot envia" : "Texto antes das sub-opções (opcional)"}</label>
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              <button
                type="button"
                onClick={() => setStepsMode("universal")}
                className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors ${stepsMode === "universal" ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              >
                Todos os servidores
              </button>
              <button
                type="button"
                onClick={() => setStepsMode("individual")}
                className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors ${stepsMode === "individual" ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              >
                Individual
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowVars((v) => !v)}
            className="mt-1 text-[10px] text-violet-500 hover:underline"
          >
            {showVars ? "ocultar variáveis" : "inserir variável"}
          </button>
          {showVars && (
            <div className="mt-1.5 mb-2">
              <VariablePanel onInsert={(tag) => insertTagAt(activeStep.scope, activeStep.index, tag)} />
            </div>
          )}

          {stepsMode === "universal" ? (
            <StepsListEditor
              scope="universal"
              steps={universalSteps}
              onChange={setUniversalSteps}
              activeStep={activeStep}
              setActiveStep={setActiveStep}
              textareaRefs={textareaRefs}
            />
          ) : (
            <div className="space-y-3 mt-2">
              {SERVER_OPTIONS.map((srv) => (
                <div key={srv.value} className="border border-border rounded-xl p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-foreground">{srv.label}</span>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={serverSteps[srv.value]?.active ?? true}
                        onChange={(e) =>
                          setServerSteps((prev) => ({ ...prev, [srv.value]: { ...prev[srv.value], active: e.target.checked } }))
                        }
                      />
                      Ativo
                    </label>
                  </div>
                  <StepsListEditor
                    scope={srv.value}
                    steps={serverSteps[srv.value]?.steps || []}
                    onChange={(next) => setServerSteps((prev) => ({ ...prev, [srv.value]: { ...prev[srv.value], steps: next } }))}
                    activeStep={activeStep}
                    setActiveStep={setActiveStep}
                    textareaRefs={textareaRefs}
                  />
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                Servidor sem nenhuma mensagem (ou marcado como inativo) fica em silêncio nesse nó — o cliente não recebe nada daqui.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Depois das mensagens — só 2 escolhas simples */}
      {isLeaf && (
        <div className="space-y-3 border border-border rounded-xl p-3">
          <p className="text-[11px] font-medium text-foreground">Depois dessas mensagens…</p>

          <div>
            <label className={labelCls}>Ir para outro menu (opcional)</label>
            <TreeSelect
              nodes={otherNodes}
              value={redirectTo}
              onChange={(id) => {
                setRedirectTo(id);
                if (id) setAskResolution(false);
              }}
              noneLabel="Nenhum — encerra ou pergunta se resolveu"
            />
          </div>

          {!redirectTo && (
            <>
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={askResolution}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAskResolution(checked);
                    // ✅ Preenche com o texto padrão de sucesso (mesmo que "vazio" já usaria
                    // em tempo de execução) só pra poupar de digitar do zero — o Márcio
                    // ajusta as 2-3 palavras que mudam por nó (ex: "resolveu" → "voltou a
                    // funcionar") em vez de escrever a frase inteira toda vez.
                    if (checked && !closingMsg.trim()) setClosingMsg(defaultSuccessMessage);
                  }}
                />
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