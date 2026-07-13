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
  is_active?: boolean;
  stepsCount?: number;
  isSystem?: boolean;
  systemKind?: "start" | "success" | "escalate";
};

export type FlowLink =
  | { kind: "menu"; from: string; to: string; option: number }
  | { kind: "next"; from: string; to: string }
  | { kind: "ok"; from: string; to: string }
  | { kind: "fail"; from: string; to: string };

type Pos = { x: number; y: number };
type Port = "in" | "out_menu" | "out_next" | "out_ok" | "out_fail";

const NODE_W = 176;
const NODE_H = 96;
const POS_KEY = "bot_flow_canvas_pos_v2";

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

const CHILD_GAP_Y = NODE_H + 28;
const CHILD_GAP_X = 260;

/** Coloca filhos em coluna à direita do pai, sem sobrepor */
function layoutChildrenOf(
  parentId: string,
  pos: Record<string, Pos>,
  nodes: CanvasNode[]
) {
  const children = nodes
    .filter((n) => !n.isSystem && n.parent_id === parentId)
    .sort((a, b) => a.option_number - b.option_number);
  if (!children.length) return;
  const parentPos = pos[parentId] || { x: 320, y: 100 };
  const totalH = (children.length - 1) * CHILD_GAP_Y;
  const startY = Math.max(24, parentPos.y + NODE_H / 2 - totalH / 2 - NODE_H / 2);
  children.forEach((c, i) => {
    pos[c.id] = {
      x: parentPos.x + CHILD_GAP_X,
      y: startY + i * CHILD_GAP_Y,
    };
  });
}

/** Layout limpo: Início → menus raiz → Sucesso / Márcio no fim */
function defaultLayout(nodes: CanvasNode[]): Record<string, Pos> {
  const roots = nodes
    .filter((n) => !n.isSystem && !n.parent_id)
    .sort((a, b) => a.option_number - b.option_number);
  const midY = Math.max(200, 40 + ((roots.length - 1) * 120) / 2);
  const pos: Record<string, Pos> = {
    __start__: { x: 48, y: midY },
    __success__: { x: 900, y: 48 },
    __escalate__: { x: 900, y: midY + 100 },
  };
  roots.forEach((n, i) => {
    pos[n.id] = { x: 320, y: 48 + i * 120 };
  });
  // filhos por pai, em coluna (nunca um em cima do outro)
  const parentIds = new Set(
    nodes.filter((n) => n.parent_id).map((n) => n.parent_id as string)
  );
  parentIds.forEach((pid) => layoutChildrenOf(pid, pos, nodes));

  nodes.filter((n) => !n.isSystem && !pos[n.id]).forEach((n, i) => {
    pos[n.id] = { x: 560, y: 48 + i * CHILD_GAP_Y };
  });
  return pos;
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
    if (!n.parent_id) {
      links.push({ kind: "menu", from: "__start__", to: n.id, option: n.option_number });
    } else if (byId.has(n.parent_id)) {
      links.push({ kind: "menu", from: n.parent_id, to: n.id, option: n.option_number });
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

/** IDs visíveis conforme o foco (visão limpa vs drill-down) */
function visibleNodeIds(
  all: CanvasNode[],
  focusId: string | null,
  showAll: boolean
): Set<string> {
  const ids = new Set<string>(["__start__", "__success__", "__escalate__"]);
  if (showAll) {
    all.forEach((n) => ids.add(n.id));
    return ids;
  }
  // overview: só raízes
  if (!focusId || focusId.startsWith("__")) {
    all.filter((n) => !n.isSystem && !n.parent_id).forEach((n) => ids.add(n.id));
    return ids;
  }
  // foco: nó + filhos diretos + ancestrais até a raiz
  ids.add(focusId);
  all.filter((n) => n.parent_id === focusId).forEach((n) => ids.add(n.id));
  let cur = all.find((n) => n.id === focusId);
  while (cur?.parent_id) {
    ids.add(cur.parent_id);
    cur = all.find((n) => n.id === cur!.parent_id);
  }
  // destinos de redirect / resolve do foco
  const f = all.find((n) => n.id === focusId);
  if (f?.redirect_to_node_id) ids.add(f.redirect_to_node_id);
  if (f?.on_resolved_target && !f.on_resolved_target.startsWith("__")) ids.add(f.on_resolved_target);
  if (f?.on_not_resolved_target && !f.on_not_resolved_target.startsWith("__")) ids.add(f.on_not_resolved_target);
  return ids;
}

function linkTouchesFocus(link: FlowLink, focusId: string | null, showAll: boolean): boolean {
  if (showAll) return true;
  if (!focusId || focusId.startsWith("__")) {
    // overview: só Início → raízes
    return link.kind === "menu" && link.from === "__start__";
  }
  return link.from === focusId || link.to === focusId;
}

type Props = {
  nodes: CanvasNode[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  onEdit: (id: string) => void;
  onCreateNode: () => void;
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

  const showAll = !!linking;
  const visibleIds = useMemo(
    () => visibleNodeIds(allNodes, focusId, showAll),
    [allNodes, focusId, showAll]
  );
  const visibleNodes = useMemo(
    () => allNodes.filter((n) => visibleIds.has(n.id)),
    [allNodes, visibleIds]
  );
  const visibleLinks = useMemo(() => {
    const list = allLinks.filter(
      (l) =>
        visibleIds.has(l.from) &&
        visibleIds.has(l.to) &&
        linkTouchesFocus(l, focusId, showAll)
    );
    return list;
  }, [allLinks, visibleIds, focusId, showAll]);

  useEffect(() => {
    const saved = loadPositions();
    const base = defaultLayout(allNodes);
    // posições salvas só para raízes/sistema — filhos sempre relayout
    const merged = { ...base };
    for (const n of allNodes) {
      if (n.isSystem || !n.parent_id) {
        if (saved[n.id]) merged[n.id] = saved[n.id];
      }
    }
    // re-aplica colunas de filhos com base nos pais (evita stack um em cima do outro)
    const parentIds = new Set(
      allNodes.filter((n) => n.parent_id).map((n) => n.parent_id as string)
    );
    parentIds.forEach((pid) => layoutChildrenOf(pid, merged, allNodes));

    for (const n of allNodes) {
      if (!merged[n.id]) {
        merged[n.id] = { x: 560, y: 48 };
      }
    }
    setPositions(merged);
    savePositions(merged);
  }, [allNodes.map((n) => n.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ao focar um menu, reorganiza os filhos em coluna à direita
  useEffect(() => {
    if (!focusId || focusId.startsWith("__")) return;
    setPositions((prev) => {
      const next = { ...prev };
      layoutChildrenOf(focusId, next, allNodes);
      // se o foco tem pai, mantém pai e irmãos organizados também
      const self = allNodes.find((n) => n.id === focusId);
      if (self?.parent_id) {
        layoutChildrenOf(self.parent_id, next, allNodes);
      }
      savePositions(next);
      return next;
    });
  }, [focusId, allNodes]);

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

  const boardH = Math.max(480, ...Object.values(positions).map((p) => p.y + NODE_H + 100));
  const boardW = Math.max(980, ...Object.values(positions).map((p) => p.x + NODE_W + 100));

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
              ? "Linha selecionada · clique em Apagar (ou tecla Del) · Esc cancela"
              : linking
                ? "Ligando… clique na bolinha à esquerda do destino"
                : focusId && !focusId.startsWith("__")
                  ? "Foco no nó · clique na linha pra selecionar/apagar · duplo clique = editar"
                  : "Clique na linha pra selecionar · Apagar remove a ligação"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {linking && (
            <button type="button" onClick={() => setLinking(null)} className="text-[10px] px-2 py-1 rounded-lg border border-border hover:bg-muted">
              Cancelar
            </button>
          )}
          {focusId && !linking && (
            <button type="button" onClick={() => onFocus(null)} className="text-[10px] px-2 py-1 rounded-lg border border-border hover:bg-muted">
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
          >
            <Plus className="w-3.5 h-3.5" /> Nó
          </button>
        </div>
      </div>

      {/* Legenda de cores no topo do chart */}
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
        <span className="text-[10px] opacity-80 ml-auto hidden sm:inline">
          clique na linha = selecionar · Del / Apagar = remover
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
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
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
                    strokeWidth={selected ? 4 : 2.5}
                    strokeOpacity={selected ? 1 : 0.85}
                    markerEnd={`url(#arr-${link.kind})`}
                  />
                  {/* área clicável larga */}
                  <path d={edgePath(a.x, a.y, b.x, b.y)} fill="none" stroke="transparent" strokeWidth={20} />
                  <circle
                    cx={mx}
                    cy={my}
                    r={selected ? 14 : 11}
                    fill={selected ? LINK_COLORS[link.kind] : "hsl(var(--card))"}
                    stroke={LINK_COLORS[link.kind]}
                    strokeWidth={1.5}
                  />
                  <text
                    x={mx}
                    y={my + 3.5}
                    textAnchor="middle"
                    fontSize="9"
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
                  if (!isSys) onFocus(n.id);
                  else onFocus(null);
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
