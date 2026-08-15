"use client";
// app/admin/settings/financeiro_pessoal/ModalAjusteSaldo.tsx
// Extraído de page.tsx (14/08/2026) — ação esporádica (ajustar saldo direto
// na conta), carrega via next/dynamic só quando o admin abre.
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal } from "./shared";

export default function ModalAjusteSaldo({
  tenantId,
  contas,
  saldos,
  onClose,
  onSuccess,
  addToast,
}: {
  tenantId: string;
  contas: any[];
  saldos: Record<string, number>;
  onClose: () => void;
  onSuccess: () => void;
  addToast: any;
}) {
  const [contaId, setContaId] = useState(contas[0]?.id || "");
  const [rawCentsSaldo, setRawCentsSaldo] = useState(0);
  const [salvando, setSalvando] = useState(false);

  const saldoAtual = saldos[contaId] || 0;

  const centsToDisplay = (cents: number) => {
    const negative = cents < 0;
    const abs = Math.abs(cents);
    const str = String(abs).padStart(3, "0");
    const int = str.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const dec = str.slice(-2);
    return (negative ? "-" : "") + (int || "0") + "," + dec;
  };

  const novoSaldoVal = rawCentsSaldo / 100;

  async function handleSave() {
    if (rawCentsSaldo === 0 && saldoAtual === 0) {
      onClose();
      return;
    }
    const val = novoSaldoVal;
    if (val === saldoAtual) {
      onClose();
      return;
    }

    setSalvando(true);
    try {
      // Busca o saldo_inicial atual da conta para recalcular
      const { data: conta, error: errConta } = await supabaseBrowser
        .from("fin_contas_bancarias")
        .select("saldo_inicial")
        .eq("id", contaId)
        .single();
      if (errConta) throw errConta;

      const saldoInicialAtual = Number(conta.saldo_inicial || 0);
      const diff = val - saldoAtual;
      const novoSaldoInicial = saldoInicialAtual + diff;

      const { error } = await supabaseBrowser
        .from("fin_contas_bancarias")
        .update({ saldo_inicial: novoSaldoInicial })
        .eq("id", contaId);

      if (error) throw error;
      addToast(
        "success",
        "Saldo Atualizado",
        "O saldo foi ajustado diretamente na conta.",
      );
      onSuccess();
    } catch (e: any) {
      addToast("error", "Erro ao ajustar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal title="Ajustar Saldo" onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sm text-sky-600">
          O saldo será ajustado diretamente — nenhum lançamento será criado.
        </div>
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Conta / Carteira
          </label>
          <select
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            className="w-full h-11 px-3 bg-transparent border border-border rounded-lg outline-none text-sm focus:border-emerald-500 text-foreground"
          >
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icone} {c.nome} (Atual:{" "}
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(saldos[c.id] || 0)}
                )
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Qual é o saldo real hoje?
          </label>
          <div className="flex items-center h-11 bg-card border border-border rounded-lg focus-within:border-emerald-500 transition-colors overflow-hidden">
            <span className="pl-3 pr-1 text-sm font-medium text-muted-foreground select-none shrink-0">
              R$
            </span>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={centsToDisplay(rawCentsSaldo)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 13);
                setRawCentsSaldo(parseInt(digits || "0", 10));
              }}
              onFocus={(e) => e.target.select()}
              className="flex-1 h-full pr-3 bg-transparent outline-none text-sm font-medium text-foreground"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={salvando}
            className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Salvar Ajuste"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
