"use client";
// app/admin/settings/financeiro_pessoal/ModalNovaCategoria.tsx
// Extraído de page.tsx (14/08/2026) — aberto de dentro do ModalTransacao
// (atalho "criar categoria na hora"); carrega via next/dynamic só quando abre.
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  Modal as SharedModal,
  ModalHeader,
  ModalBody,
} from "@/components/ui/Modal";

export default function ModalNovaCategoria({
  tenantId,
  onClose,
  onSave,
  tipoFixo,
  addToast,
}: {
  tenantId: string;
  onClose: () => void;
  onSave: (novaCat: any) => void;
  tipoFixo: string;
  addToast: any;
}) {
  const [nome, setNome] = useState("");
  const [icone, setIcone] = useState("📦");
  const [salvando, setSalvando] = useState(false);
  const icones = [
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
    "📱",
    "💻",
    "📦",
    "💰",
    "📈",
  ];

  async function handleSave() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("fin_categorias")
        .insert({
          tenant_id: tenantId,
          nome: nome.trim(),
          icone,
          tipo: tipoFixo,
        })
        .select()
        .single();
      if (error) throw error;
      addToast("success", "Categoria criada", "Nova categoria adicionada.");
      onSave(data);
    } catch (e: any) {
      addToast("error", "Erro ao criar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SharedModal onClose={onClose} maxWidth="max-w-sm">
      <ModalHeader onClose={onClose}>
        <span className="font-medium text-sm">
          Nova Categoria de {tipoFixo === "RECEITA" ? "Receita" : "Despesa"}
        </span>
      </ModalHeader>

        <ModalBody>
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Nome
            </label>
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Roupas"
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg outline-none text-sm focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Ícone
            </label>
            <div className="flex flex-wrap gap-2">
              {icones.map((i) => (
                <button
                  key={i}
                  onClick={() => setIcone(i)}
                  className={`w-8 h-8 rounded border text-lg flex items-center justify-center transition-all ${icone === i ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:bg-muted"}`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={salvando}
            className="w-full h-10 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 shadow-lg transition-colors disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Salvar Categoria"}
          </button>
        </ModalBody>
    </SharedModal>
  );
}
