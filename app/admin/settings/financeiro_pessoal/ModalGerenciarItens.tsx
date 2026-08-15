"use client";
// app/admin/settings/financeiro_pessoal/ModalGerenciarItens.tsx
// Extraído de page.tsx (14/08/2026) — aberto de dentro do ModalTransacao
// ("gerenciar contas"/"gerenciar categorias"); carrega via next/dynamic só
// quando abre.
import { useState } from "react";
import {
  Modal as SharedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/components/ui/Modal";
import { useConfirm } from "@/hooks/useConfirm";
import { IconEdit, IconTrash } from "./shared";

const ICONES_DISPONIVEIS = [
  "🏦",
  "💳",
  "💵",
  "🪙",
  "💰",
  "🏧",
  "💸",
  "📊",
  "🔐",
  "🤝",
  "🟣",
  "🟠",
  "🟢",
  "🔴",
  "⭐",
  "🌟",
  "📱",
  "💻",
  "🛒",
  "🏥",
  "🚗",
  "📚",
  "🏖️",
  "🏠",
  "💡",
  "🍔",
  "🐶",
  "👗",
  "📦",
  "📈",
  "🎮",
  "✈️",
  "🎵",
  "🍕",
  "☕",
  "🏋️",
  "💊",
  "📺",
  "🎁",
  "⚡",
  "🌮",
  "🎓",
  "👶",
  "🐱",
  "🚌",
  "⛽",
  "🔧",
  "🌿",
  "🎭",
  "🏃",
  "🍺",
  "🛍️",
  "🎯",
  "🏡",
  "💈",
  "📷",
  "🎸",
  "🧴",
  "🐾",
  "🌈",
];

export default function ModalGerenciarItens({
  title,
  items,
  onExcluir,
  onEditar,
  onClose,
  addToast,
  groupByTipo,
  contarUso,
}: {
  title: string;
  items: any[];
  onExcluir: (id: string) => Promise<void>;
  onEditar: (id: string, nome: string, icone: string) => Promise<void>;
  onClose: () => void;
  addToast: any;
  groupByTipo?: boolean;
  contarUso?: (id: string) => Promise<number>;
}) {
  const { confirm, ConfirmUI } = useConfirm();
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editIcone, setEditIcone] = useState("");
  const [salvando, setSalvando] = useState(false);

  const receitas = items.filter(
    (i) => i.tipo === "RECEITA" || i.tipo === "AMBOS",
  );
  const despesas = items.filter(
    (i) => i.tipo === "DESPESA" || i.tipo === "AMBOS",
  );

  function abrirEdicao(it: any) {
    setEditandoId(it.id);
    setEditNome(it.nome);
    setEditIcone(it.icone);
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setEditNome("");
    setEditIcone("");
  }

  async function handleSalvarEdicao(id: string) {
    if (!editNome.trim()) return;
    setSalvando(true);
    try {
      await onEditar(id, editNome.trim(), editIcone);
      addToast("success", "Salvo", "Item atualizado com sucesso.");
      cancelarEdicao();
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  function renderItem(it: any) {
    return (
      <div
        key={it.id}
        className="rounded-lg border border-border overflow-hidden"
      >
        <div className="flex items-center justify-between p-3 bg-transparent">
          <span className="text-sm font-medium">
            {it.icone} {it.nome}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                editandoId === it.id ? cancelarEdicao() : abrirEdicao(it)
              }
              className={`p-1.5 rounded-lg transition-colors ${editandoId === it.id ? "text-emerald-500 bg-emerald-500/10" : "text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10"}`}
              title="Editar"
            >
              <IconEdit />
            </button>
            <button
              onClick={async () => {
                const uso = contarUso ? await contarUso(it.id) : 0;
                const ok = await confirm({
                  title: "Excluir Item",
                  subtitle: `Tem certeza que deseja excluir '${it.nome}'?`,
                  tone: "rose",
                  icon: "🗑️",
                  confirmText: "Sim, excluir",
                  details:
                    uso > 0
                      ? [
                          `${uso} lançamento${uso > 1 ? "s" : ""} usa${uso > 1 ? "m" : ""} este item — ${uso > 1 ? "eles" : "ele"} não ${uso > 1 ? "serão apagados" : "será apagado"}, mas ficará${uso > 1 ? "ão" : ""} sem essa referência.`,
                        ]
                      : undefined,
                });
                if (ok) {
                  try {
                    await onExcluir(it.id);
                  } catch {
                    addToast(
                      "error",
                      "Erro ao excluir",
                      "Não foi possível excluir este item.",
                    );
                  }
                }
              }}
              className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
              title="Excluir"
            >
              <IconTrash />
            </button>
          </div>
        </div>

        {editandoId === it.id && (
          <div className="p-3 border-t border-border bg-card space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Nome
              </label>
              <input
                autoFocus
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                className="w-full h-9 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500 text-foreground"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Ícone
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
                {ICONES_DISPONIVEIS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setEditIcone(ic)}
                    className={`w-8 h-8 rounded border text-base flex items-center justify-center transition-all ${editIcone === ic ? "border-emerald-500 bg-emerald-500/10 scale-110" : "border-border hover:bg-muted"}`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={cancelarEdicao}
                className="flex-1 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSalvarEdicao(it.id)}
                disabled={salvando}
                className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <SharedModal onClose={onClose} maxWidth="max-w-sm">
      <ModalHeader onClose={onClose}>
        <span className="font-medium text-sm">{title}</span>
      </ModalHeader>

        <ModalBody className="p-4 space-y-2">
          {items.length === 0 && (
            <div className="text-center text-muted-foreground text-sm italic">
              Nenhum item cadastrado.
            </div>
          )}

          {groupByTipo ? (
            <>
              {receitas.length > 0 && (
                <>
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-500">
                      📈 Receitas
                    </span>
                    <div className="flex-1 h-px bg-emerald-500/20" />
                  </div>
                  {receitas.map((it) => renderItem(it))}
                </>
              )}
              {despesas.length > 0 && (
                <>
                  <div className="flex items-center gap-2 py-1 mt-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-rose-500">
                      📉 Despesas
                    </span>
                    <div className="flex-1 h-px bg-rose-500/20" />
                  </div>
                  {despesas.map((it) => renderItem(it))}
                </>
              )}
            </>
          ) : (
            items.map((it) => renderItem(it))
          )}
        </ModalBody>

        <ModalFooter className="flex">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
        </ModalFooter>
      {ConfirmUI}
    </SharedModal>
  );
}
