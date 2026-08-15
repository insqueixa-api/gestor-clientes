"use client";
// app/admin/settings/financeiro_pessoal/ModalBaixa.tsx
// Extraído de page.tsx (14/08/2026) — ação esporádica (confirmar pagamento/
// recebimento ou reverter pra pendente), carrega via next/dynamic só quando
// o admin abre.
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, IconCalendar, ModalDayPicker, type Transacao } from "./shared";

export default function ModalBaixa({
  tenantId,
  transacao,
  contasDB,
  addToast,
  onClose,
  onSuccess,
}: {
  tenantId: string;
  transacao: Transacao;
  contasDB: any[];
  addToast: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isBaixando = transacao.status !== "PAGO";
  const isReceita = transacao.tipo === "RECEITA";

  // Valor
  const initialCents = Math.round(transacao.valor * 100);
  const [rawCents, setRawCents] = useState(initialCents);
  const valorAlterado = rawCents !== initialCents;

  const centsToDisplay = (cents: number) => {
    const str = String(cents).padStart(3, "0");
    const int = str.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const dec = str.slice(-2);
    return (int || "0") + "," + dec;
  };

  // Conta
  const [contaSelecionada, setContaSelecionada] = useState(
    transacao.conta_id || (contasDB[0]?.id ?? ""),
  );

  // Escopo (só aparece se valor mudar)
  const [escopo, setEscopo] = useState<"UNICA" | "TODAS">("UNICA");

  // Data de pagamento
  const isoToRaw = (iso: string) =>
    iso ? iso.split("-").reverse().join("") : "";
  const rawToDisplay = (raw: string) => {
    if (raw.length >= 5)
      return raw.slice(0, 2) + "/" + raw.slice(2, 4) + "/" + raw.slice(4);
    if (raw.length >= 3) return raw.slice(0, 2) + "/" + raw.slice(2);
    return raw;
  };

  const initDateIso = (() => {
    if (!isBaixando && transacao.data_pagamento) {
      const dt = new Date(transacao.data_pagamento);
      const d = String(dt.getDate()).padStart(2, "0");
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      return `${dt.getFullYear()}-${m}-${d}`;
    }
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();

  const [dataPagamento, setDataPagamento] = useState(initDateIso);
  const [rawDigits, setRawDigits] = useState(isoToRaw(initDateIso));
  const [showPicker, setShowPicker] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const handleDigitsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const raw = input.value.replace(/\D/g, "").slice(0, 8);
    setRawDigits(raw);
    if (raw.length === 8) {
      const d = raw.slice(0, 2),
        m = raw.slice(2, 4),
        y = raw.slice(4);
      setDataPagamento(`${y}-${m}-${d}`);
    }
    requestAnimationFrame(() => {
      if (cursorPos !== null && input)
        input.setSelectionRange(cursorPos, cursorPos);
    });
  };

  async function handleSave() {
    setSalvando(true);
    try {
      const novoStatus = isBaixando ? "PAGO" : "PENDENTE";
      const novoValor = rawCents / 100;
      const novaDataPagamento = isBaixando
        ? new Date(`${dataPagamento}T12:00:00`).toISOString()
        : null;

      // Atualiza a transação atual sempre
      const { error } = await supabaseBrowser
        .from("fin_transacoes")
        .update({
          status: novoStatus,
          valor: novoValor,
          conta_id: contaSelecionada || null,
          data_pagamento: novaDataPagamento,
        })
        .eq("id", transacao.id);

      if (error) throw error;

      // ✅ NOVO: se a transação foi paga, resolve a notificação de vencimento (se existir)
      if (novoStatus === "PAGO") {
        try {
          await supabaseBrowser.rpc("resolve_notification", {
            p_tenant_id: tenantId,
            p_type: "fin_vencido",
            p_source_id: transacao.id,
          });
        } catch {}
      }

      // Se valor mudou E escopo = TODAS, atualiza futuras também
      if (valorAlterado && escopo === "TODAS" && transacao.recorrencia_id) {
        await supabaseBrowser
          .from("fin_transacoes")
          .update({ valor: novoValor })
          .eq("recorrencia_id", transacao.recorrencia_id)
          .eq("status", "PENDENTE")
          .gt("data_vencimento", transacao.data_vencimento);
      }

      addToast(
        "success",
        isBaixando
          ? isReceita
            ? "Recebimento confirmado"
            : "Pagamento confirmado"
          : "Revertido para pendente",
        "Lançamento atualizado com sucesso.",
      );
      onSuccess();
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  const btnLabel = isBaixando
    ? isReceita
      ? "Confirmar Recebimento"
      : "Confirmar Pagamento"
    : "Voltar para Pendente";

  const btnColor = isBaixando
    ? isReceita
      ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20"
      : "bg-rose-600 hover:bg-rose-500 shadow-rose-900/20"
    : "bg-amber-500 hover:bg-amber-400 shadow-amber-900/20";

  return (
    <Modal
      title={
        isBaixando
          ? isReceita
            ? "Confirmar Recebimento"
            : "Confirmar Pagamento"
          : "Reverter para Pendente"
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Descrição + Valor */}
        <div className="p-3 rounded-xl border border-border bg-transparent flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
              {isReceita ? "📈 Receita" : "📉 Despesa"}
            </p>
            <p className="text-sm font-medium text-foreground/90 truncate">
              {transacao.descricao}
            </p>
            {transacao.categoria_nome && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {transacao.categoria_nome}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Valor (R$)
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={centsToDisplay(rawCents)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 13);
                setRawCents(parseInt(digits || "0", 10));
              }}
              onFocus={(e) => e.target.select()}
              className={`w-28 h-9 px-2 text-right font-medium rounded-lg border bg-card outline-none focus:border-emerald-500/50 text-sm ${
                isReceita
                  ? "text-emerald-500 border-emerald-500/20"
                  : "text-rose-500 border-rose-500/20"
              }`}
            />
            {valorAlterado && (
              <p className="text-[10px] text-amber-500 mt-0.5">
                Valor alterado
              </p>
            )}
          </div>
        </div>

        {/* Escopo — só aparece se valor mudou e tem recorrência */}
        {valorAlterado && transacao.recorrencia_id && (
          <div className="animate-in fade-in zoom-in-95 duration-150">
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              Aplicar novo valor em:
            </label>
            <div className="flex bg-transparent rounded-lg border border-border p-1 h-10">
              <button
                type="button"
                onClick={() => setEscopo("UNICA")}
                className={`flex-1 rounded-md text-xs font-medium transition-colors ${escopo === "UNICA" ? "bg-amber-500/10 text-amber-500 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                📅 Apenas nesta
              </button>
              <button
                type="button"
                onClick={() => setEscopo("TODAS")}
                className={`flex-1 rounded-md text-xs font-medium transition-colors ${escopo === "TODAS" ? "bg-sky-500/10 text-sky-500 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                🔁 Nesta e nas futuras
              </button>
            </div>
          </div>
        )}

        {/* Data de pagamento (só na baixa) */}
        {isBaixando && (
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
              Data de Pagamento
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={rawToDisplay(rawDigits)}
                onChange={handleDigitsChange}
                onFocus={(e) => e.target.select()}
                placeholder="DD/MM/AAAA"
                maxLength={10}
                className="w-full h-10 px-3 pr-10 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
              />
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 rounded-md transition-colors"
              >
                <IconCalendar />
              </button>
            </div>
            {showPicker && (
              <ModalDayPicker
                currentDate={
                  dataPagamento
                    ? new Date(`${dataPagamento}T12:00:00`)
                    : new Date()
                }
                onSelect={(date) => {
                  const d = String(date.getDate()).padStart(2, "0");
                  const m = String(date.getMonth() + 1).padStart(2, "0");
                  const y = date.getFullYear();
                  setDataPagamento(`${y}-${m}-${d}`);
                  setRawDigits(`${d}${m}${y}`);
                  setShowPicker(false);
                }}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
        )}

        {/* Conta */}
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
            Conta / Carteira
          </label>
          <select
            value={contaSelecionada}
            onChange={(e) => setContaSelecionada(e.target.value)}
            className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
          >
            <option value="">Sem conta</option>
            {contasDB.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icone} {c.nome}
              </option>
            ))}
          </select>
        </div>

        {/* Botões */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={salvando}
            className={`flex-1 py-2.5 rounded-lg text-white text-sm font-medium shadow-lg transition-all disabled:opacity-50 ${btnColor}`}
          >
            {salvando ? "Salvando..." : btnLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
