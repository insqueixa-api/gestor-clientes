"use client";
// app/admin/settings/financeiro_pessoal/ModalNovaConta.tsx
// Extraído de page.tsx (14/08/2026) — aberto pelo botão "+ Nova Conta" e
// também de dentro do ModalTransacao (atalho "criar conta na hora"); em
// ambos os casos carrega via next/dynamic só quando abre.
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  Modal as SharedModal,
  ModalHeader,
  ModalBody,
} from "@/components/ui/Modal";

export default function ModalNovaConta({
  tenantId,
  onClose,
  onSave,
  addToast,
}: {
  tenantId: string;
  onClose: () => void;
  onSave: (novaConta: any) => void;
  addToast: any;
}) {
  const [nome, setNome] = useState("");
  const [icone, setIcone] = useState("🏦");
  const [salvando, setSalvando] = useState(false);
  const icones = ["🏦", "💳", "💵", "🪙", "🟣", "🟠", "🟢", "🔴", "🤝", "📱"];

  async function handleSave() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("fin_contas_bancarias")
        .insert({ tenant_id: tenantId, nome: nome.trim(), icone })
        .select()
        .single();
      if (error) throw error;
      addToast("success", "Conta criada", "Nova conta adicionada com sucesso.");
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
        <span className="font-medium text-sm">Criar Nova Conta</span>
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
              placeholder="Ex: C6 Bank"
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
            {salvando ? "Salvando..." : "Salvar Conta"}
          </button>
        </ModalBody>
    </SharedModal>
  );
}
