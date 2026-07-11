"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronRight, ChevronDown, Plus, Trash2, Save, X, Settings2,
  MessageSquare, ShieldCheck, Sparkles, ArrowUp, ArrowDown, Eye,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser"; // ajuste o caminho se for diferente no seu projeto

type MenuNode = {
  id: string;
  parent_id: string | null;
  slug: string | null;
  option_number: number;
  label: string;
  keywords: string[];
  requires_account_check: boolean;
  special_action: string | null;
  closing_message: string | null;
  transfer_situation_label: string | null;
  is_active: boolean;
};

type MenuStep = { id: string; node_id: string; step_order: number; message_text: string };

type TreeNode = MenuNode & { children: TreeNode[]; steps: MenuStep[] };

const SPECIAL_ACTIONS = [
  { value: "", label: "Nenhuma (mostra submenu ou passos)" },
  { value: "check_vencimento_servidor", label: "⚙️ Checar vencimento/servidor" },
  { value: "verificar_cloudflare", label: "⚙️ Verificar Cloudflare" },
  { value: "free_text_rag", label: "✨ Texto livre → RAG" },
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

export default function BotMenuTreeEditor() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  async function addRootCategory() {
    const label = prompt("Nome da nova categoria principal (ex: Assuntos Pessoais):");
    if (!label) return;
    const slug = prompt("Slug técnico (sem espaços, ex: pessoal):") || label.toLowerCase().replace(/\s+/g, "_");
    const maxNum = tree.reduce((m, n) => Math.max(m, n.option_number), 0);
    setSaving(true);
    await callApi({ action: "create_node", parent_id: null, slug, option_number: maxNum + 1, label, keywords: [], requires_account_check: false });
    setSaving(false);
    loadTree();
  }

  async function addChild(parent: TreeNode) {
    const label = prompt("Texto da opção (ex: Canal travando / buffering):");
    if (!label) return;
    const maxNum = parent.children.reduce((m, n) => Math.max(m, n.option_number), 0);
    setSaving(true);
    await callApi({ action: "create_node", parent_id: parent.id, option_number: maxNum + 1, label, keywords: [] });
    setSaving(false);
    loadTree();
    setExpanded((prev) => new Set(prev).add(parent.id));
  }

  async function deleteNode(node: TreeNode) {
    if (!confirm(`Excluir "${node.label}" e tudo dentro dele? Essa ação não pode ser desfeita.`)) return;
    setSaving(true);
    await callApi({ action: "delete_node", id: node.id });
    setSaving(false);
    setSelectedNode(null);
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
  <span title="Checa conta/servidor">
    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
  </span>
)}
{node.special_action && (
  <span title={node.special_action}>
    <Settings2 className="w-3.5 h-3.5 text-amber-500" />
  </span>
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
            <button
              onClick={() => addChild(node)}
              className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-400 pl-8 py-1"
            >
              <Plus className="w-3 h-3" /> Adicionar opção aqui
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 h-[600px]">
      {/* Coluna esquerda: árvore */}
      <div className="border border-border rounded-xl p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Árvore de Atendimento</h3>
          <button onClick={addRootCategory} className="flex items-center gap-1 text-xs bg-violet-600 text-white px-2 py-1 rounded-lg hover:bg-violet-500">
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

      {/* Coluna direita: editor do nó selecionado */}
      <div className="border border-border rounded-xl p-4 overflow-y-auto">
        {selectedNode ? (
          <NodeEditor
            key={selectedNode.id}
            node={selectedNode}
            isLeaf={selectedNode.children.length === 0}
            onSave={async (fields) => { setSaving(true); await callApi({ action: "update_node", id: selectedNode.id, ...fields }); setSaving(false); loadTree(); }}
            onSaveSteps={async (steps) => { setSaving(true); await callApi({ action: "set_steps", node_id: selectedNode.id, steps }); setSaving(false); loadTree(); }}
            onDelete={() => deleteNode(selectedNode)}
            saving={saving}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Selecione um item da árvore à esquerda pra editar.</p>
        )}
      </div>
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
  const [specialAction, setSpecialAction] = useState(node.special_action || "");
  const [closingMsg, setClosingMsg] = useState(node.closing_message || "");
  const [transferLabel, setTransferLabel] = useState(node.transfer_situation_label || "");
  const [isActive, setIsActive] = useState(node.is_active);
  const [steps, setSteps] = useState<string[]>(node.steps.map((s) => s.message_text));
  const [showPreview, setShowPreview] = useState(false);

  function saveAll() {
    onSave({
      label,
      keywords: keywordsText.split(",").map((k) => k.trim()).filter(Boolean),
      requires_account_check: requiresCheck,
      special_action: specialAction || null,
      closing_message: closingMsg || null,
      transfer_situation_label: transferLabel || null,
      is_active: isActive,
    });
    if (isLeaf) onSaveSteps(steps.filter((s) => s.trim()));
  }

  return (
    <div className="space-y-3">
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
            ? [...steps.filter(Boolean), specialAction ? `[ação dinâmica: ${specialAction}]` : null].filter(Boolean).join("\n\n")
            : `Entendido! Me conta mais:\n(as opções filhas aparecem aqui)`}
        </div>
      )}

      <div>
        <label className="text-[11px] text-muted-foreground">Texto da opção</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full text-sm bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
      </div>

      <div>
        <label className="text-[11px] text-muted-foreground">Palavras-chave (separadas por vírgula)</label>
        <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="travando, travou, buffer" className="w-full text-sm bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
      </div>

      {!node.parent_id && (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={requiresCheck} onChange={(e) => setRequiresCheck(e.target.checked)} />
          Checar conta/servidor antes de mostrar as opções
        </label>
      )}

      <div>
        <label className="text-[11px] text-muted-foreground">Ação especial</label>
        <select value={specialAction} onChange={(e) => setSpecialAction(e.target.value)} className="w-full text-sm bg-background border border-border rounded-lg px-2 py-1.5 mt-1">
          {SPECIAL_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>

      {isLeaf && specialAction !== "free_text_rag" && (
        <div>
          <label className="text-[11px] text-muted-foreground flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Passos sequenciais</label>
          <div className="space-y-2 mt-1">
            {steps.map((s, i) => (
              <div key={i} className="flex gap-1">
                <textarea
                  value={s}
                  onChange={(e) => setSteps((prev) => prev.map((p, idx) => idx === i ? e.target.value : p))}
                  className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5"
                  rows={3}
                />
                <button onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-500"><X className="w-3.5 h-3.5" /></button>
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
            <label className="text-[11px] text-muted-foreground">Mensagem de encerramento (se o cliente disser que resolveu)</label>
            <textarea value={closingMsg} onChange={(e) => setClosingMsg(e.target.value)} rows={2} className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Situação (aparece no resumo de transferência, se não resolver)</label>
            <input value={transferLabel} onChange={(e) => setTransferLabel(e.target.value)} className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 mt-1" />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Ativo
      </label>

      <button onClick={saveAll} disabled={saving} className="flex items-center gap-1 text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-500 disabled:opacity-50">
        <Save className="w-3.5 h-3.5" /> {saving ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}