"use client";
// app/admin/settings/api-server/renovar_gerenciaapp_modal.tsx
//
// "Renovar" do GerenciaApp (08/09/2026, pedido do Márcio) — mesmo espírito
// do RecargaAppativaModal (paga de verdade no site deles primeiro, confirma
// aqui depois), mas aqui não lança uma despesa nova: dá baixa na próxima
// parcela pendente da recorrência mensal "Renovação GerenciaApp" que já
// existe no Financeiro Pessoal, e relê a validade real do painel deles pra
// atualizar o card. A recorrência em si continua existindo intacta.
import { useEffect, useState } from "react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import FormattedDateInput from "@/components/ui/FormattedDateInput";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

type Props = {
  onClose: () => void;
  onSuccess: (expireAccount: string | null) => void;
  onError?: (msg: string) => void;
};

type ParcelaPendente = {
  id: string;
  valor: number;
  data_vencimento: string;
};

export default function RenovarGerenciaAppModal({ onClose, onSuccess, onError }: Props) {
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parcela, setParcela] = useState<ParcelaPendente | null>(null);
  const [dataPagamento, setDataPagamento] = useState(
    new Date().toISOString().slice(0, 10),
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabaseBrowser
        .from("fin_transacoes")
        .select("id, valor, data_vencimento")
        .eq("tenant_id", tenantId)
        .eq("descricao", "Renovação GerenciaApp")
        .eq("status", "PENDENTE")
        .order("data_vencimento", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setParcela(data);
        setLoading(false);
      }
    }
    if (tenantId) load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function handleConfirm() {
    setSaving(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;
      const res = await fetch("/api/admin/gerenciaapp/renovar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ data_pagamento: dataPagamento }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || `Falha ao renovar (HTTP ${res.status}).`);
      }
      onSuccess(json.expire_account ?? null);
    } catch (e: any) {
      onError?.(e?.message || "Ocorreu um erro ao renovar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <ModalHeader onClose={onClose}>
        <h2 className="text-lg font-medium text-foreground tracking-tight">
          Renovar GerenciaApp
        </h2>
      </ModalHeader>

      <ModalBody className="p-6 space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            Carregando parcela pendente...
          </div>
        ) : !parcela ? (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-600">
            Nenhuma parcela pendente de "Renovação GerenciaApp" encontrada no
            Financeiro Pessoal.
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center bg-transparent border border-border p-3 rounded-lg">
              <div>
                <div className="text-[10px] uppercase font-medium text-muted-foreground">
                  Parcela referente a
                </div>
                <div className="text-sm font-medium text-foreground/90">
                  {new Date(`${parcela.data_vencimento}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase font-medium text-muted-foreground">
                  Valor
                </div>
                <div className="text-xl font-medium text-emerald-500">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(parcela.valor)}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5 tracking-tight">
                Data do pagamento
              </label>
              <FormattedDateInput
                type="date"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
              />
            </div>
          </>
        )}
      </ModalBody>

      <ModalFooter className="space-y-3">
        <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-lg text-xs text-sky-500">
          ℹ️ <strong>Renove de verdade no site do GerenciaApp antes de confirmar aqui.</strong>
          <br />
          Isso dá baixa na parcela deste mês no Financeiro Pessoal (a recorrência
          continua) e atualiza a validade mostrada no card com o valor real do painel.
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || loading || !parcela}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium shadow-lg shadow-emerald-900/20 transition-all"
          >
            {saving ? "Processando..." : "✅ Confirmar Pagamento + Atualizar Validade"}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
