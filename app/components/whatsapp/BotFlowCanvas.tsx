// app/components/whatsapp/BotFlowCanvas.tsx
// Canvas full-width: visão limpa (Início → menu → Sucesso/Márcio).
// Clique num nó = foca filhos/linhas. Bolinha de ligar = mostra tudo.
// Duplo clique = editar (callback).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Unlink } from "lucide-react";

export type CanvasNode = {
  id: string;
  label: string;
  parent_id: string | null;
  option_number: number;
  redirect_to_node_id?: string | null;
  on_resolved_target?: string | null;
  on_not_resolved_target?: string | null;
  ask_resolution?: boolean | null;
  closing_message?: string | null;
  special_actions?: string[];
  is_active?: boolean;
  stepsCount?: number;
  isSystem?: boolean;
  systemKind?: "start" | "success" | "escalate";
};

function isLinkTargetOnly(n: CanvasNode): boolean {
  return (n.special_actions || []).includes("link_target_only");
}

export type FlowLink =
  | { kind: "menu"; from: string; to: string; option: number }
  | { kind: "next"; from: string; to: string }
  | { kind: "ok"; from: string; to: string }
  | { kind: "fail"; from: string; to: string };

type Pos = { x: number; y: number };
type Port = "in" | "out_menu" | "out_next" | "out_ok" | "out_fail";

const NODE_W = 168;
const NODE_H = 78;
const POS_KEY = "bot_flow_canvas_pos_v4";

const SYSTEM_NODES: CanvasNode[] = [
  { id: "__start__", label: "▶ Início", parent_id: null, option_number: 0, isSystem: true, systemKind: "start" },
  { id: "__success__", label: "✅ Sucesso", parent_id: null, option_number: 0, isSystem: true, systemKind: "success" },
  { id: "__escalate__", label: "🙋 Márcio", parent_id: null, option_number: 0, isSystem: true, systemKind: "escalate" },
];

function loadPositions(): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePositions(p: Record<string, Pos>) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch { /* ignore */ }
}

/**
 * Layout completo (Exibir tudo / foco profundo) — 6 colunas:
 *  0 Início | 1 Menu | 2 Filhos | 3 Netos | 4 Bisnetos+ | 5 Sucesso/Márcio
 */
const COL_GAP = 210;
const COL_X = [40, 40 + COL_GAP, 40 + COL_GAP * 2, 40 + COL_GAP * 3, 40 + COL_GAP * 4, 40 + COL_GAP * 5] as const;

/**
 * Visão geral (nada clicado) — só 3 colunas, compacta, sem vazio no meio:
 *  Início | Menus principais | Sucesso + Márcio
 */
const OVERVIEW_X = {
  start: 48,
  menu: 300,
  end: 620,
} as const;

const ROW_GAP = NODE_H + 12;
const TOP_Y = 36;

function depthOfNode(id: string, byId: Map<string, CanvasNode>): number {
  let d = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    d++;
    cur = byId.get(cur.parent_id);
  }
  return d;
}

/** depth 0 menu | 1 filhos | 2 netos | 3+ bisnetos */
function depthToCol(depth: number): number {
  if (depth <= 0) return 1;
  if (depth === 1) return 2;
  if (depth === 2) return 3;
  return 4;
}

function sortNodesInCol(nodes: CanvasNode[], byId: Map<string, CanvasNode>, allNodes: CanvasNode[]) {
  const rootOrder = new Map<string, number>();
  allNodes
    .filter((n) => !n.isSystem && !n.parent_id)
    .sort((a, b) => a.option_number - b.option_number)
    .forEach((n, i) => rootOrder.set(n.id, i));

  function rootKey(n: CanvasNode): number {
    let cur: CanvasNode | undefined = n;
    const seen = new Set<string>();
    while (cur?.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
    }
    return rootOrder.get(cur?.id || n.id) ?? 999;
  }

  return [...nodes].sort(
    (a, b) =>
      rootKey(a) - rootKey(b) ||
      a.option_number - b.option_number ||
      a.label.localeCompare(b.label)
  );
}

/** Visão inicial: Início à esquerda (centro da lista), menus no meio, finais à direita perto */
function overviewLayout(nodes: CanvasNode[]): Record<string, Pos> {
  // Só menu principal real (parent null e não é só destino de fluxo)
  const roots = nodes
    .filter((n) => !n.isSystem && !n.parent_id && !isLinkTargetOnly(n))
    .sort((a, b) => a.option_number - b.option_number);

  const pos: Record<string, Pos> = {};
  roots.forEach((n, i) => {
    pos[n.id] = { x: OVERVIEW_X.menu, y: TOP_Y + i * ROW_GAP };
  });

  const firstY = roots.length ? pos[roots[0].id].y : TOP_Y;
  const lastY = roots.length ? pos[roots[roots.length - 1].id].y : TOP_Y;
  const midY = (firstY + lastY) / 2;

  // Início alinhado ao meio da coluna de menus (não embaixo)
  pos.__start__ = { x: OVERVIEW_X.start, y: midY };
  pos.__success__ = { x: OVERVIEW_X.end, y: firstY };
  pos.__escalate__ = { x: OVERVIEW_X.end, y: Math.max(firstY + ROW_GAP * 2, lastY) };

  return pos;
}

/**
 * Grade completa por profundidade (Exibir tudo / drill-down).
 */
function columnLayout(nodes: CanvasNode[], onlyIds?: Set<string> | null): Record<string, Pos> {
  const byId = new Map(nodes.filter((n) => !n.isSystem).map((n) => [n.id, n]));
  const data = nodes.filter((n) => !n.isSystem && (!onlyIds || onlyIds.has(n.id)));

  const cols: CanvasNode[][] = [[], [], [], [], [], []];
  for (const n of data) {
    cols[depthToCol(depthOfNode(n.id, byId))].push(n);
  }

  for (let c = 1; c <= 4; c++) {
    cols[c] = sortNodesInCol(cols[c], byId, nodes);
  }

  const pos: Record<string, Pos> = {};
  let maxY = TOP_Y;

  for (let c = 1; c <= 4; c++) {
    cols[c].forEach((n, i) => {
      const y = TOP_Y + i * ROW_GAP;
      pos[n.id] = { x: COL_X[c], y };
      maxY = Math.max(maxY, y + NODE_H);
    });
  }

  // Início no meio da coluna de menus (se houver raízes na col 1)
  const roots = cols[1];
  const midY =
    roots.length > 0
      ? (pos[roots[0].id].y + pos[roots[roots.length - 1].id].y) / 2
      : Math.max(TOP_Y, (maxY + TOP_Y) / 2 - NODE_H / 2);

  pos.__start__ = { x: COL_X[0], y: midY };
  pos.__success__ = { x: COL_X[5], y: TOP_Y };
  pos.__escalate__ = { x: COL_X[5], y: Math.max(TOP_Y + ROW_GAP * 2, midY) };

  return pos;
}

function defaultLayout(nodes: CanvasNode[]): Record<string, Pos> {
  return columnLayout(nodes, null);
}

/** Layout reverso: predecessores nas colunas de conteúdo, só o destino clicado no fim */
function reverseLayout(
  targetId: "__success__" | "__escalate__",
  predIds: string[],
  nodes: CanvasNode[]
): Record<string, Pos> {
  const only = new Set(predIds);
  const pos = columnLayout(nodes, only);
  const midY = Math.max(
    TOP_Y,
    predIds.length > 0 ? TOP_Y + ((Math.min(predIds.length, 6) - 1) * ROW_GAP) / 2 : TOP_Y + ROW_GAP
  );
  if (targetId === "__success__") {
    pos.__success__ = { x: COL_X[5], y: midY };
    delete pos.__escalate__;
  } else {
    pos.__escalate__ = { x: COL_X[5], y: midY };
    delete pos.__success__;
  }
  return pos;
}

/** Lista nós que apontam para um destino (rota reversa) */
function predecessorsOf(targetId: string, nodes: CanvasNode[], links: FlowLink[]): string[] {
  const set = new Set<string>();
  for (const l of links) {
    if (l.to === targetId) set.add(l.from);
  }
  // se for sucesso/escalar implícito via ask_resolution
  if (targetId === "__success__" || targetId === "__escalate__") {
    for (const n of nodes) {
      if (n.isSystem) continue;
      const showRes =
        n.ask_resolution === true ||
        (n.ask_resolution !== false &&
          !!(n.closing_message?.trim() || n.on_resolved_target || n.on_not_resolved_target));
      if (!showRes) continue;
      if (targetId === "__success__") {
        const t = resolveTarget(n.on_resolved_target, "__success__");
        if (t === "__success__") set.add(n.id);
      } else {
        const t = resolveTarget(n.on_not_resolved_target, "__escalate__");
        if (t === "__escalate__") set.add(n.id);
      }
    }
  }
  // inclui ancestrais de cada predecessor
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of [...set]) {
    let cur = byId.get(id);
    while (cur?.parent_id) {
      set.add(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
  }
  return [...set];
}

function resolveTarget(raw: string | null | undefined, fallback: string): string {
  if (!raw || raw === "__default__") return fallback;
  return raw;
}

function buildLinks(nodes: CanvasNode[]): FlowLink[] {
  const links: FlowLink[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const n of nodes) {
    if (n.isSystem) continue;
    const parentId = n.parent_id && String(n.parent_id).trim() ? String(n.parent_id) : null;

    // Menu roxo: só opções reais de menu — NUNCA destino de continuar/ok/fail
    // e NUNCA plugar submenu no Início (só raízes com parent null).
    if (!isLinkTargetOnly(n)) {
      if (!parentId) {
        links.push({ kind: "menu", from: "__start__", to: n.id, option: n.option_number });
      } else if (byId.has(parentId)) {
        links.push({ kind: "menu", from: parentId, to: n.id, option: n.option_number });
      }
    }

    if (n.redirect_to_node_id && byId.has(n.redirect_to_node_id)) {
      links.push({ kind: "next", from: n.id, to: n.redirect_to_node_id });
    }
    const showRes =
      n.ask_resolution === true ||
      (n.ask_resolution !== false &&
        !!(n.closing_message?.trim() || n.on_resolved_target || n.on_not_resolved_target));
    if (showRes) {
      links.push({ kind: "ok", from: n.id, to: resolveTarget(n.on_resolved_target, "__success__") });
      links.push({ kind: "fail", from: n.id, to: resolveTarget(n.on_not_resolved_target, "__escalate__") });
    }
  }
  return links;
}

function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

const PORT_COLORS: Record<string, string> = {
  out_menu: "#8b5cf6",
  out_next: "#06b6d4",
  out_ok: "#22c55e",
  out_fail: "#f59e0b",
};

const LINK_COLORS: Record<FlowLink["kind"], string> = {
  menu: "#8b5cf6",
  next: "#06b6d4",
  ok: "#22c55e",
  fail: "#f59e0b",
};

/** IDs visíveis conforme o foco (visão limpa vs drill-down vs reverso) */
function visibleNodeIds(
  all: CanvasNode[],
  focusId: string | null,
  showAll: boolean,
  links: FlowLink[]
): Set<string> {
  if (showAll) {
    const ids = new Set<string>(["__start__", "__success__", "__escalate__"]);
    all.forEach((n) => ids.add(n.id));
    return ids;
  }

  // overview: Início + raízes de menu reais + finais
  if (!focusId) {
    const ids = new Set<string>(["__start__", "__success__", "__escalate__"]);
    all
      .filter((n) => !n.isSystem && !n.parent_id && !isLinkTargetOnly(n))
      .forEach((n) => ids.add(n.id));
    return ids;
  }

  // Sucesso OU Márcio (só um): rota reversa — quem chega NESTE destino
  if (focusId === "__success__" || focusId === "__escalate__") {
    const ids = new Set<string>([focusId]); // NÃO inclui o outro final
    predecessorsOf(focusId, all, links).forEach((id) => ids.add(id));
    // Início ajuda a ler o caminho, sem o outro endpoint
    ids.add("__start__");
    return ids;
  }

  if (focusId === "__start__") {
    const ids = new Set<string>(["__start__", "__success__", "__escalate__"]);
    all
      .filter((n) => !n.isSystem && !n.parent_id && !isLinkTargetOnly(n))
      .forEach((n) => ids.add(n.id));
    return ids;
  }

  // foco normal: nó + filhos + netos + ancestrais
  const ids = new Set<string>(["__start__"]);
  ids.add(focusId);
  const children = all.filter((n) => n.parent_id === focusId);
  children.forEach((n) => {
    ids.add(n.id);
    all.filter((g) => g.parent_id === n.id).forEach((g) => ids.add(g.id));
  });
  let cur = all.find((n) => n.id === focusId);
  while (cur?.parent_id) {
    ids.add(cur.parent_id);
    cur = all.find((n) => n.id === cur!.parent_id);
  }
  const f = all.find((n) => n.id === focusId);
  if (f?.redirect_to_node_id) ids.add(f.redirect_to_node_id);

  // destinos de resolução: só os que este nó realmente usa
  if (
    f &&
    (f.ask_resolution === true ||
      (f.ask_resolution !== false &&
        !!(f.closing_message?.trim() || f.on_resolved_target || f.on_not_resolved_target)))
  ) {
    ids.add(resolveTarget(f.on_resolved_target, "__success__"));
    ids.add(resolveTarget(f.on_not_resolved_target, "__escalate__"));
  } else {
    if (f?.on_resolved_target) ids.add(resolveTarget(f.on_resolved_target, "__success__"));
    if (f?.on_not_resolved_target) ids.add(resolveTarget(f.on_not_resolved_target, "__escalate__"));
  }
  return ids;
}

function linkTouchesFocus(
  link: FlowLink,
  focusId: string | null,
  showAll: boolean,
  visibleIds: Set<string>
): boolean {
  if (showAll) return true;
  if (!focusId) {
    return link.kind === "menu" && link.from === "__start__";
  }
  if (focusId === "__start__") {
    return link.kind === "menu" && link.from === "__start__";
  }
  // reverso: SOMENTE fios que chegam no destino clicado (não no outro)
  if (focusId === "__success__" || focusId === "__escalate__") {
    if (link.to === focusId) return true;
    // hierarquia entre predecessores (menu pai→filho), sem fios pro outro final
    if (link.to === "__success__" || link.to === "__escalate__") return false;
    return (
      link.kind === "menu" &&
      visibleIds.has(link.from) &&
      visibleIds.has(link.to)
    );
  }
  // foco normal: linhas ligadas ao foco ou entre a subárvore visível
  // mas se o fio vai a Sucesso/Márcio, só se o destino estiver visível (já filtrado)
  return (
    link.from === focusId ||
    link.to === focusId ||
    (visibleIds.has(link.from) && visibleIds.has(link.to))
  );
}

type Props = {
  nodes: CanvasNode[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  onEdit: (id: string) => void;
  onCreateNode: () => void;
  /** Cria filho do nó focado (botão extra) */
  onCreateChild?: () => void;
  focusLabel?: string;
  forceShowAll?: boolean;
  onForceShowAllChange?: (v: boolean) => void;
  onLink: (payload: {
    fromId: string;
    port: Exclude<Port, "in">;
    toId: string;
  }) => Promise<void> | void;
  onUnlink: (link: FlowLink) => Promise<void> | void;
};

export default function BotFlowCanvas({
  nodes: dataNodes,
  focusId,
  onFocus,
  onEdit,
  onCreateNode,
  onCreateChild,
  focusLabel,
  forceShowAll: forceShowAllProp,
  onForceShowAllChange,
  onLink,
  onUnlink,
}: Props) {
  const allNodes = useMemo(() => [...SYSTEM_NODES, ...dataNodes], [dataNodes]);
  const allLinks = useMemo(() => buildLinks(allNodes), [allNodes]);

  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [linking, setLinking] = useState<{ fromId: string; port: Exclude<Port, "in"> } | null>(null);
  const [drag, setDrag] = useState<{ id: string; ox: number; oy: number } | null>(null);
  /** Identidade estável da linha (não índice — índice muda com o foco) */
  const [selectedLinkKey, setSelectedLinkKey] = useState<string | null>(null);
  const [forceShowAllLocal, setForceShowAllLocal] = useState(false);
  const forceShowAll = forceShowAllProp ?? forceShowAllLocal;
  useEffect(() => {
    if (typeof forceShowAllProp === "boolean") setForceShowAllLocal(forceShowAllProp);
  }, [forceShowAllProp]);
  const setForceShowAll = (v: boolean) => {
    setForceShowAllLocal(v);
    onForceShowAllChange?.(v);
  };

  const showAll = forceShowAll || !!linking;
  const visibleIds = useMemo(
    () => visibleNodeIds(allNodes, focusId, showAll, allLinks),
    [allNodes, focusId, showAll, allLinks]
  );
  const visibleNodes = useMemo(
    () => allNodes.filter((n) => visibleIds.has(n.id)),
    [allNodes, visibleIds]
  );
  const visibleLinks = useMemo(() => {
    return allLinks.filter(
      (l) =>
        visibleIds.has(l.from) &&
        visibleIds.has(l.to) &&
        linkTouchesFocus(l, focusId, showAll, visibleIds)
    );
  }, [allLinks, visibleIds, focusId, showAll]);

  // Visão geral = 3 colunas compactas; Exibir tudo / foco = grade por profundidade
  useEffect(() => {
    if (forceShowAll) {
      setPositions(columnLayout(allNodes, null));
      return;
    }
    if (!focusId) {
      setPositions(overviewLayout(allNodes));
      return;
    }
    if (focusId === "__success__" || focusId === "__escalate__") {
      const preds = predecessorsOf(focusId, allNodes, allLinks).filter((id) => !id.startsWith("__"));
      setPositions(reverseLayout(focusId, preds, allNodes));
      return;
    }
    if (focusId === "__start__") {
      setPositions(overviewLayout(allNodes));
      return;
    }
    // foco num menu/filho: colunas por profundidade só com o ramo visível
    const vis = visibleNodeIds(allNodes, focusId, false, allLinks);
    setPositions(columnLayout(allNodes, vis));
  }, [allNodes.map((n) => n.id).join(","), focusId, forceShowAll, allLinks]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePos = useCallback((id: string, x: number, y: number) => {
    setPositions((prev) => {
      const next = { ...prev, [id]: { x: Math.max(0, x), y: Math.max(0, y) } };
      savePositions(next);
      return next;
    });
  }, []);

  function portXY(nodeId: string, port: Port): { x: number; y: number } {
    const p = positions[nodeId] || { x: 0, y: 0 };
    if (port === "in") return { x: p.x, y: p.y + NODE_H / 2 };
    if (port === "out_menu") return { x: p.x + NODE_W, y: p.y + 24 };
    if (port === "out_next") return { x: p.x + NODE_W, y: p.y + 44 };
    if (port === "out_ok") return { x: p.x + NODE_W, y: p.y + 64 };
    return { x: p.x + NODE_W, y: p.y + 84 };
  }

  function onPortClick(e: React.MouseEvent, nodeId: string, port: Port) {
    e.stopPropagation();
    if (port === "in") {
      if (!linking) return;
      if (linking.fromId === nodeId) {
        setLinking(null);
        return;
      }
      void onLink({ fromId: linking.fromId, port: linking.port, toId: nodeId });
      setLinking(null);
      return;
    }
    if (linking?.fromId === nodeId && linking.port === port) {
      setLinking(null);
      return;
    }
    setLinking({ fromId: nodeId, port });
    setSelectedLinkKey(null);
  }

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    if ((e.target as HTMLElement).closest("[data-port]")) return;
    const p = positions[id] || { x: 0, y: 0 };
    setDrag({ id, ox: e.clientX - p.x, oy: e.clientY - p.y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onNodePointerMove(e: React.PointerEvent) {
    if (!drag) return;
    updatePos(drag.id, e.clientX - drag.ox, e.clientY - drag.oy);
  }

  function onNodePointerUp() {
    setDrag(null);
  }

  function linkKey(link: FlowLink): string {
    return `${link.kind}:${link.from}:${link.to}`;
  }

  const selectedLink = useMemo(
    () => (selectedLinkKey ? visibleLinks.find((l) => linkKey(l) === selectedLinkKey) ?? null : null),
    [selectedLinkKey, visibleLinks]
  );

  // Delete / Backspace remove a linha selecionada
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selectedLinkKey) return;
      if (e.key === "Escape") {
        setSelectedLinkKey(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const link = visibleLinks.find((l) => linkKey(l) === selectedLinkKey);
        if (!link) return;
        e.preventDefault();
        void onUnlink(link);
        setSelectedLinkKey(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLinkKey, visibleLinks, onUnlink]);

  const boardH = Math.max(420, ...Object.values(positions).map((p) => p.y + NODE_H + 80));
  const boardW = Math.max(COL_X[5] + NODE_W + 64, ...Object.values(positions).map((p) => p.x + NODE_W + 64));

  // posição do botão flutuante "Apagar" no meio da linha selecionada
  const deleteBtnPos = useMemo(() => {
    if (!selectedLink) return null;
    const fromPort =
      selectedLink.kind === "menu"
        ? "out_menu"
        : selectedLink.kind === "next"
          ? "out_next"
          : selectedLink.kind === "ok"
            ? "out_ok"
            : "out_fail";
    const a = portXY(selectedLink.from, fromPort as Port);
    const b = portXY(selectedLink.to, "in");
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }, [selectedLink, positions]);

  return (
    <div className="flex flex-col h-full min-h-[560px] w-full">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0 bg-card/50">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Fluxo de atendimento</h3>
          <p className="text-[10px] text-muted-foreground truncate">
            {selectedLink
              ? "Linha selecionada · Apagar ou Del"
              : linking
                ? "Ligando… clique na entrada do destino"
                : forceShowAll
                  ? "Mapa completo · clique num nó pra focar"
                  : focusId === "__success__" || focusId === "__escalate__"
                    ? "Rota reversa · quem chega neste destino"
                    : focusId && !focusId.startsWith("__")
                      ? "Foco no nó · filhos/netos à direita · Sucesso/Márcio fixos no fim"
                      : "Visão geral · Exibir tudo = mapa completo"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {linking && (
            <button type="button" onClick={() => setLinking(null)} className="text-[10px] px-2 py-1 rounded-lg border border-border hover:bg-muted">
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setForceShowAll(!forceShowAll);
              if (!forceShowAll) onFocus(null);
            }}
            className={`text-[10px] px-2.5 py-1 rounded-lg border font-medium transition-colors ${
              forceShowAll
                ? "bg-violet-600 text-white border-violet-600"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {forceShowAll ? "Sair do mapa completo" : "Exibir tudo"}
          </button>
          {(focusId || forceShowAll) && !linking && (
            <button
              type="button"
              onClick={() => {
                setForceShowAll(false);
                onFocus(null);
              }}
              className="text-[10px] px-2 py-1 rounded-lg border border-border hover:bg-muted"
            >
              Visão geral
            </button>
          )}
          {selectedLink && (
            <button
              type="button"
              onClick={() => {
                void onUnlink(selectedLink);
                setSelectedLinkKey(null);
              }}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-500 shadow-sm"
            >
              <Unlink className="w-3.5 h-3.5" /> Apagar ligação
            </button>
          )}
          <button
            type="button"
            onClick={onCreateNode}
            className="flex items-center gap-1 text-xs bg-violet-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-violet-500"
            title={
              focusId && !focusId.startsWith("__")
                ? `Criar filho de “${focusLabel || "nó focado"}”`
                : "Criar menu principal (coluna 2)"
            }
          >
            <Plus className="w-3.5 h-3.5" />{" "}
            {focusId && !focusId.startsWith("__") ? "Filho" : "Menu"}
          </button>
          {onCreateChild && focusId && !focusId.startsWith("__") && (
            <button
              type="button"
              onClick={onCreateChild}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-violet-500/40 text-violet-600 hover:bg-violet-500/10"
            >
              <Plus className="w-3 h-3" /> Filho de “{(focusLabel || "…").slice(0, 18)}”
            </button>
          )}
        </div>
      </div>

      {/* Legenda de cores + colunas */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 border-b border-border bg-muted/30 text-[11px] text-muted-foreground shrink-0">
        <span className="font-medium text-foreground/80">Saídas:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> menu
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> continuar
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> resolveu
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> não
        </span>
        <span className="hidden md:inline text-[10px] opacity-70 border-l border-border pl-3 ml-1">
          {forceShowAll || (focusId && !focusId.startsWith("__"))
            ? "Colunas: Início → Menu → Filhos → Netos → Bisnetos → Fim"
            : "Visão geral: Início → Menus → Sucesso/Márcio  ·  Exibir tudo = mapa completo"}
        </span>
        <span className="text-[10px] opacity-80 ml-auto hidden sm:inline">
          linha = selecionar · Del = apagar
        </span>
      </div>

      <div
        className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] [background-size:18px_18px]"
        onClick={() => {
          if (!linking) onFocus(null);
          setLinking(null);
          setSelectedLinkKey(null);
        }}
      >
        <div style={{ width: boardW, height: boardH, position: "relative" }}>
          <svg className="absolute inset-0 pointer-events-none" width={boardW} height={boardH}>
            <defs>
              {(["menu", "next", "ok", "fail"] as const).map((k) => (
                <marker key={k} id={`arr-${k}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill={LINK_COLORS[k]} />
                </marker>
              ))}
            </defs>
            {visibleLinks.map((link) => {
              const fromPort =
                link.kind === "menu" ? "out_menu" : link.kind === "next" ? "out_next" : link.kind === "ok" ? "out_ok" : "out_fail";
              const a = portXY(link.from, fromPort as Port);
              const b = portXY(link.to, "in");
              const key = linkKey(link);
              const selected = selectedLinkKey === key;
              const label =
                link.kind === "menu" ? String(link.option) : link.kind === "next" ? "→" : link.kind === "ok" ? "ok" : "não";
              // Início → menus: número perto do card (evita pilha 1–8 no meio)
              const fromStart = link.from === "__start__" && link.kind === "menu";
              const t = fromStart ? 0.82 : 0.5;
              const mx = a.x + (b.x - a.x) * t;
              const my = a.y + (b.y - a.y) * t;
              const badgeR = fromStart ? (selected ? 10 : 8) : selected ? 12 : 10;
              return (
                <g
                  key={key}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedLinkKey(key);
                    setLinking(null);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setSelectedLinkKey(key);
                    void onUnlink(link);
                    setSelectedLinkKey(null);
                  }}
                >
                  <path
                    d={edgePath(a.x, a.y, b.x, b.y)}
                    fill="none"
                    stroke={LINK_COLORS[link.kind]}
                    strokeWidth={selected ? 3.5 : fromStart ? 1.75 : 2.25}
                    strokeOpacity={selected ? 1 : fromStart ? 0.55 : 0.8}
                    markerEnd={`url(#arr-${link.kind})`}
                  />
                  <path d={edgePath(a.x, a.y, b.x, b.y)} fill="none" stroke="transparent" strokeWidth={18} />
                  <circle
                    cx={mx}
                    cy={my}
                    r={badgeR}
                    fill={selected ? LINK_COLORS[link.kind] : "hsl(var(--card))"}
                    stroke={LINK_COLORS[link.kind]}
                    strokeWidth={1.25}
                  />
                  <text
                    x={mx}
                    y={my + 3}
                    textAnchor="middle"
                    fontSize={fromStart ? "8" : "9"}
                    fill={selected ? "#fff" : LINK_COLORS[link.kind]}
                    className="pointer-events-none select-none"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Botão flutuante em cima da linha selecionada */}
          {selectedLink && deleteBtnPos && (
            <button
              type="button"
              className="absolute z-30 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-500 border-2 border-background"
              style={{
                left: deleteBtnPos.x,
                top: deleteBtnPos.y + 18,
                transform: "translateX(-50%)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!selectedLink) return;
                void onUnlink(selectedLink);
                setSelectedLinkKey(null);
              }}
            >
              <Unlink className="w-3.5 h-3.5" /> Apagar
            </button>
          )}

          {visibleNodes.map((n) => {
            const p = positions[n.id] || { x: 0, y: 0 };
            const focused = focusId === n.id;
            const isSys = !!n.isSystem;
            const bg =
              n.systemKind === "start"
                ? "bg-sky-500/15 border-sky-500/50"
                : n.systemKind === "success"
                  ? "bg-emerald-500/15 border-emerald-500/50"
                  : n.systemKind === "escalate"
                    ? "bg-amber-500/15 border-amber-500/50"
                    : focused
                      ? "bg-violet-500/15 border-violet-500/60 shadow-md"
                      : "bg-card border-border";

            return (
              <div
                key={n.id}
                className={`absolute rounded-2xl border-2 shadow-sm select-none ${bg} ${drag?.id === n.id ? "z-20" : "z-10"}`}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                onPointerDown={(e) => onNodePointerDown(e, n.id)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onClick={(e) => {
                  e.stopPropagation();
                  setForceShowAll(false);
                  // Início / Sucesso / Márcio também recebem foco (reverso nos dois últimos)
                  onFocus(n.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  // Início / Sucesso / Márcio → textos padrão; demais → editar nó
                  onEdit(n.id);
                }}
              >
                {(!isSys || n.systemKind !== "start") && (
                  <button
                    type="button"
                    data-port="in"
                    title="Entrada"
                    onClick={(e) => onPortClick(e, n.id, "in")}
                    className={`absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-background ${
                      linking ? "bg-violet-500 ring-2 ring-violet-400/40 scale-110" : "bg-slate-400"
                    } hover:scale-125 transition-transform z-10`}
                  />
                )}

                <div className="px-3 py-2.5 h-full flex flex-col justify-center pointer-events-none">
                  <p className="text-xs font-semibold text-foreground truncate leading-tight">{n.label}</p>
                  {!isSys && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {n.stepsCount ? `${n.stepsCount} msg` : "sem texto"}
                      {focused ? " · focado" : ""}
                    </p>
                  )}
                  {isSys && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {n.systemKind === "start" && "entrada do cliente"}
                      {n.systemKind === "success" && "quando deu certo"}
                      {n.systemKind === "escalate" && "passa pra você"}
                    </p>
                  )}
                  <p className="text-[9px] text-muted-foreground/80 mt-0.5">
                    {isSys ? "duplo clique = textos" : "duplo clique = editar"}
                  </p>
                </div>

                {/* Legenda das bolinhas abaixo do nó (só se tem saídas e está focado ou ligando) */}
                {(!isSys || n.systemKind === "start") && (focused || linking?.fromId === n.id || showAll) && (
                  <div className="absolute left-0 right-0 -bottom-5 flex justify-center gap-2 pointer-events-none">
                    {(n.systemKind === "start"
                      ? [{ p: "out_menu" as const, t: "menu" }]
                      : [
                          { p: "out_menu" as const, t: "menu" },
                          { p: "out_next" as const, t: "→" },
                          { p: "out_ok" as const, t: "ok" },
                          { p: "out_fail" as const, t: "não" },
                        ]
                    ).map(({ p: port, t }) => (
                      <span key={port} className="text-[8px] font-medium" style={{ color: PORT_COLORS[port] }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {(!isSys || n.systemKind === "start") && (
                  <div className="absolute -right-2 top-0 bottom-0 flex flex-col justify-center gap-1.5 py-1">
                    {(n.systemKind === "start"
                      ? (["out_menu"] as const)
                      : (["out_menu", "out_next", "out_ok", "out_fail"] as const)
                    ).map((port) => {
                      const active = linking?.fromId === n.id && linking.port === port;
                      const title =
                        port === "out_menu"
                          ? "Menu / opção"
                          : port === "out_next"
                            ? "Continuar"
                            : port === "out_ok"
                              ? "Resolveu"
                              : "Não resolveu";
                      return (
                        <button
                          key={port}
                          type="button"
                          data-port={port}
                          title={title}
                          onClick={(e) => onPortClick(e, n.id, port)}
                          className={`w-3.5 h-3.5 rounded-full border-2 border-background hover:scale-125 transition-transform ${
                            active ? "ring-2 ring-offset-1 ring-violet-400 scale-125" : ""
                          }`}
                          style={{ background: PORT_COLORS[port] }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Legenda pra colar no modal de edição (canto superior direito) */
export function FlowPortLegend() {
  return (
    <div className="text-[10px] space-y-1 text-right">
      <p className="font-semibold text-muted-foreground mb-1">Saídas</p>
      <p><span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1.5 align-middle" />menu</p>
      <p><span className="inline-block w-2 h-2 rounded-full bg-cyan-500 mr-1.5 align-middle" />continuar</p>
      <p><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />resolveu</p>
      <p><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5 align-middle" />não</p>
    </div>
  );
}
