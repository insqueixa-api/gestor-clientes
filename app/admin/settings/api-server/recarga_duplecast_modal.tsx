"use client";
// app/admin/settings/api-server/recarga_duplecast_modal.tsx
//
// "Nova Recarga" pro parceiro Duplecast (26/08/2026, pedido do Márcio: "igual
// ao outro" — mesmo padrão de recarga_appativa_modal.tsx). O Márcio compra os
// códigos direto no painel de revenda deles ("Buy Codes"), depois só confirma
// aqui: lança a despesa no Financeiro Pessoal (categoria IPTV, "Recarga
// Duplecast") e chama o sync de créditos (list_codes via VM) pra refletir o
// saldo novo.
import { useEffect, useState } from "react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import FormattedDateInput from "@/components/ui/FormattedDateInput";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/components/ui/Modal";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 placeholder-muted-foreground/40 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({
  children,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

type Props = {
  partnerId: string;
  partnerLabel: string;
  onClose: () => void;
  onSuccess: () => void;
  onError?: (msg: string) => void;
};

export default function RecargaDuplecastModal({
  partnerId,
  partnerLabel,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const tenantId = useTenantId();
  const [saving, setSaving] = useState(false);

  const [qty, setQty] = useState("");
  // ✅ "Por Total" (26/08/2026, pedido do Márcio: "eu pago 25 USD por 10
  // códigos... vou preencher o valor total, aí sim vai calcular o valor
  // unitário" — a Duplecast vende em pacote, ele não sabe o preço por
  // código de cabeça). Default "total", diferente do recarga_appativa_modal
  // (que só vende crédito a crédito, então o custo unitário já é o dado
  // natural de entrada).
  const [amountMode, setAmountMode] = useState<"total" | "unit">("total");
  const [unitCost, setUnitCost] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [fxRate, setFxRate] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [purchasedAt, setPurchasedAt] = useState(
    new Date().toISOString().slice(0, 16),
  );
  const [notes, setNotes] = useState("");

  const qtyNum = Number(qty) || 0;
  const totalOriginal =
    amountMode === "total" ? Number(totalCost) || 0 : qtyNum * (Number(unitCost) || 0);
  const effectiveUnitCost =
    amountMode === "total"
      ? qtyNum > 0
        ? (Number(totalCost) || 0) / qtyNum
        : 0
      : Number(unitCost) || 0;
  const totalBrl =
    currency === "BRL" ? totalOriginal : totalOriginal * (Number(fxRate) || 1);

  // ✅ Mesma busca de cotação que recarga_appativa_modal.tsx já usa.
  useEffect(() => {
    async function fetchFx() {
      if (currency === "BRL") {
        setFxRate("1");
        return;
      }
      try {
        const { data } = await supabaseBrowser
          .from("tenant_fx_rates")
          .select("usd_to_brl, eur_to_brl")
          .eq("tenant_id", tenantId)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) {
          if (currency === "USD") setFxRate(data.usd_to_brl?.toString() || "1");
          if (currency === "EUR") setFxRate(data.eur_to_brl?.toString() || "1");
        }
      } catch {
        // silencioso — mantém o câmbio já digitado
      }
    }
    fetchFx();
  }, [currency, tenantId]);

  async function handleSave() {
    if (!qty || Number(qty) <= 0) {
      onError?.("A quantidade de códigos deve ser maior que zero.");
      return;
    }
    if (amountMode === "total") {
      if (!totalCost || Number(totalCost) <= 0) {
        onError?.("O valor total deve ser maior que zero.");
        return;
      }
    } else if (Number(unitCost) < 0) {
      onError?.("O custo unitário não pode ser negativo.");
      return;
    }

    setSaving(true);
    try {
      const { data: cat, error: catErr } = await supabaseBrowser
        .from("fin_categorias")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("nome", "%iptv%")
        .maybeSingle();
      if (catErr) throw catErr;
      if (!cat?.id) {
        throw new Error(
          'Categoria "IPTV" não encontrada no Financeiro Pessoal.',
        );
      }

      // ✅ Conta Mercado Pago PJ — mesma regra aplicada aos outros
      // lançamentos automáticos de IPTV (recarga_appativa_modal.tsx e
      // financeiro_pessoal/page.tsx).
      const { data: contas } = await supabaseBrowser
        .from("fin_contas_bancarias")
        .select("id, nome")
        .eq("tenant_id", tenantId);
      const contaMpPj = (contas || []).find((c: any) => {
        const n = String(c?.nome || "").toLowerCase();
        return n.includes("mercado pago") && n.includes("pj");
      })?.id;

      const fmtNote = () =>
        [
          `[${paymentMethod}]`,
          `${qty} códigos`,
          currency !== "BRL" ? `· Câmbio: ${Number(fxRate).toFixed(4)}` : null,
          `· Unit: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(effectiveUnitCost)}`,
          notes.trim() ? `· ${notes.trim()}` : null,
        ]
          .filter(Boolean)
          .join(" ");

      const purchaseDateOnly = purchasedAt.slice(0, 10);
      const purchaseIso = new Date(purchasedAt).toISOString();

      const { error: insErr } = await supabaseBrowser
        .from("fin_transacoes")
        .insert({
          tenant_id: tenantId,
          tipo: "DESPESA",
          descricao: "Recarga Duplecast",
          valor: totalBrl,
          data_vencimento: purchaseDateOnly,
          status: "PAGO",
          data_pagamento: purchaseIso,
          conta_id: contaMpPj ?? null,
          categoria_id: cat.id,
          is_recorrente: false,
          observacoes: fmtNote(),
        });
      if (insErr) throw insErr;

      // ✅ Só lança a despesa e sincroniza o saldo — a recarga em si já foi
      // feita manualmente no painel de revenda da Duplecast ("Buy Codes")
      // antes de preencher este modal (mesmo espírito do recarga_appativa_modal.tsx).
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;
      const syncRes = await fetch("/api/integrations/duplecast/sync-credits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ integration_id: partnerId }),
      });
      const syncJson = await syncRes.json().catch(() => ({}));
      if (!syncRes.ok || !syncJson?.ok) {
        throw new Error(
          "Recarga registrada no financeiro, mas falhou ao sincronizar o saldo: " +
            (syncJson?.error || ""),
        );
      }

      onSuccess();
    } catch (e: any) {
      onError?.(e?.message || "Ocorreu um erro ao processar a recarga.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <h2 className="text-lg font-medium text-foreground tracking-tight">
          Nova Recarga
        </h2>
        <div className="text-xs text-emerald-500 font-medium mt-0.5">
          {partnerLabel}
        </div>
      </ModalHeader>

      <ModalBody className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Data da compra</Label>
            <FormattedDateInput
              type="datetime-local"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Meio de pagamento</Label>
            <Select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="PIX">PIX</option>
              <option value="USDT">USDT</option>
              <option value="CARTAO">Cartão de Crédito</option>
              <option value="SALDO">Saldo em Conta</option>
              <option value="OUTRO">Outro</option>
            </Select>
          </div>
        </div>

        <div className="p-4 bg-transparent rounded-xl border border-border space-y-4">
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setAmountMode("total")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                amountMode === "total"
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Valor Total
            </button>
            <button
              type="button"
              onClick={() => setAmountMode("unit")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                amountMode === "unit"
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Custo por Código
            </button>
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4 space-y-1">
              <Label>Qtd. Códigos</Label>
              <Input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
                autoFocus
                className="font-medium text-emerald-500"
              />
            </div>
            <div className="col-span-4 space-y-1">
              <Label>Moeda</Label>
              <Select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="BRL">BRL (R$)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </Select>
            </div>
            {amountMode === "total" ? (
              <div className="col-span-4 space-y-1">
                <Label>Valor Total</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={totalCost}
                  onChange={(e) => setTotalCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            ) : (
              <div className="col-span-4 space-y-1">
                <Label>Custo Unit.</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                />
              </div>
            )}
          </div>

          {amountMode === "total" && qtyNum > 0 && (
            <div className="text-xs text-muted-foreground">
              ≈ Custo por código:{" "}
              <span className="font-medium text-foreground/90">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency,
                }).format(effectiveUnitCost)}
              </span>
            </div>
          )}

          {currency !== "BRL" && (
            <div className="space-y-1 animate-in slide-in-from-top-2">
              <Label>Cotação para BRL (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                placeholder={`1 ${currency} = ? BRL`}
              />
            </div>
          )}
        </div>

        <div className="flex justify-between items-end bg-transparent border border-border p-3 rounded-lg">
          <div>
            <div className="text-[10px] uppercase font-medium text-muted-foreground">
              Total Original
            </div>
            <div className="text-sm font-medium text-muted-foreground">
              {new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency,
              }).format(totalOriginal)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase font-medium text-muted-foreground">
              Total em BRL (Custo Real)
            </div>
            <div className="text-xl font-medium text-emerald-500">
              {new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(totalBrl)}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Observações</Label>
          <input
            className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none text-foreground/90"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional..."
          />
        </div>
      </ModalBody>

      <ModalFooter className="space-y-3">
        <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-lg text-xs text-sky-500">
          ℹ️ <strong>Lance isso aqui DEPOIS de comprar de verdade no painel de revenda da Duplecast ("Buy Codes").</strong>
          <br />
          A compra vai pro Financeiro Pessoal (despesa, categoria IPTV) e o saldo é
          sincronizado com o valor real deles.
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium shadow-lg shadow-emerald-900/20 transition-all"
          >
            {saving ? "Processando..." : "💰 Registrar Compra + Sincronizar"}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
