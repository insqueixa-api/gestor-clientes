"use client";
// app/admin/settings/financeiro_pessoal/ModalBaixa.tsx
// Extraído de page.tsx (14/08/2026) — ação esporádica (confirmar pagamento/
// recebimento ou reverter pra pendente), carrega via next/dynamic só quando
// o admin abre.
import { useState, useEffect, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  Modal,
  IconCalendar,
  ModalDayPicker,
  distribuirCentavos,
  type Transacao,
} from "./shared";

type ParcelaPendente = {
  id: string;
  parcela_atual: number | null;
  parcela_total: number | null;
  valor: number;
  data_vencimento: string;
};

function formatDataCurta(input: string): string {
  let d = new Date(input);
  if (input.length === 10 && input.includes("-")) {
    d = new Date(`${input}T12:00:00-03:00`);
  }
  if (isNaN(d.getTime())) return input;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export default function ModalBaixa({
  tenantId,
  transacao,
  contasDB,
  addToast,
  onClose,
  onSuccess,
  onDataChanged,
}: {
  tenantId: string;
  transacao: Transacao;
  contasDB: any[];
  addToast: any;
  onClose: () => void;
  onSuccess: () => void;
  // Atualiza a tabela de fundo sem fechar o modal — usado quando uma
  // antecipação parcial já mudou dados reais no banco mas o admin ainda
  // precisa decidir o que fazer com o que sobrou.
  onDataChanged?: () => void;
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
  // ✅ A posição do cursor não pode ser copiada 1:1 do texto sem máscara pro
  // texto com "/" — a barra desloca tudo que vem depois dela. Sem isso, o
  // cursor ficava preso antes do último dígito digitado (em vez de depois),
  // e o próximo caractere digitado entrava fora de ordem (ex: tentar digitar
  // "12" resultava em "21").
  const posAposNDigitos = (display: string, n: number) => {
    if (n <= 0) return 0;
    let contados = 0;
    for (let i = 0; i < display.length; i++) {
      if (/\d/.test(display[i])) {
        contados++;
        if (contados === n) return i + 1;
      }
    }
    return display.length;
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
    const cursorPos = input.selectionStart ?? input.value.length;
    const digitsAntesDoCursor = input.value
      .slice(0, cursorPos)
      .replace(/\D/g, "").length;

    const raw = input.value.replace(/\D/g, "").slice(0, 8);
    setRawDigits(raw);
    if (raw.length === 8) {
      const d = raw.slice(0, 2),
        m = raw.slice(2, 4),
        y = raw.slice(4);
      setDataPagamento(`${y}-${m}-${d}`);
    }
    const novaPos = posAposNDigitos(rawToDisplay(raw), digitsAntesDoCursor);
    requestAnimationFrame(() => {
      if (input) input.setSelectionRange(novaPos, novaPos);
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
        const { error: errFuturas } = await supabaseBrowser
          .from("fin_transacoes")
          .update({ valor: novoValor })
          .eq("recorrencia_id", transacao.recorrencia_id)
          .eq("status", "PENDENTE")
          .gt("data_vencimento", transacao.data_vencimento);

        if (errFuturas) {
          // A transação atual já foi salva (linha acima) — não desfaz isso,
          // só avisa que as futuras não puderam ser sincronizadas, senão o
          // toast de sucesso mentiria sobre parcelas futuras que continuam
          // com o valor antigo.
          addToast(
            "error",
            "Lançamento salvo, mas parcelas futuras não foram atualizadas",
            errFuturas.message,
          );
          onSuccess();
          return;
        }
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

  // ─── Antecipar Parcelas (14/08/2026) ──────────────────────────────────────
  // Só faz sentido confirmando pagamento (não ao reverter) de um parcelamento
  // de verdade (recorrencia_id + parcela_total, não recorrência sem fim).
  const [view, setView] = useState<"baixa" | "antecipar">("baixa");
  const podeAntecipar =
    isBaixando && !!transacao.recorrencia_id && !!transacao.parcela_total;

  const [pendentes, setPendentes] = useState<ParcelaPendente[]>([]);
  const [loadingPendentes, setLoadingPendentes] = useState(false);
  const [quantidade, setQuantidade] = useState(1);
  const [direcao, setDirecao] = useState<"PROXIMAS" | "ULTIMAS">("PROXIMAS");
  const [rawCentsAntecipar, setRawCentsAntecipar] = useState(0);
  const [valorAntecTocado, setValorAntecTocado] = useState(false);
  const [contaAntecipar, setContaAntecipar] = useState(
    transacao.conta_id || (contasDB[0]?.id ?? ""),
  );
  const [dataAntecipar, setDataAntecipar] = useState(initDateIso);
  const [rawDigitsAntecipar, setRawDigitsAntecipar] = useState(
    isoToRaw(initDateIso),
  );
  const [showPickerAntecipar, setShowPickerAntecipar] = useState(false);
  const [salvandoAntecipar, setSalvandoAntecipar] = useState(false);

  useEffect(() => {
    if (view !== "antecipar" || !transacao.recorrencia_id) return;
    let cancelled = false;
    setLoadingPendentes(true);
    supabaseBrowser
      .from("fin_transacoes")
      .select("id, parcela_atual, parcela_total, valor, data_vencimento")
      .eq("recorrencia_id", transacao.recorrencia_id)
      .eq("status", "PENDENTE")
      .order("data_vencimento", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          addToast(
            "error",
            "Erro ao buscar parcelas pendentes",
            error.message,
          );
          setPendentes([]);
        } else {
          const rows = (data ?? []) as ParcelaPendente[];
          setPendentes(rows);
          setQuantidade((q) => Math.min(Math.max(q, 1), rows.length || 1));
        }
        setLoadingPendentes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, transacao.recorrencia_id]);

  // pendentes já vem ordenada por vencimento ascendente — "próximas" = as N
  // primeiras (mais antigas), "últimas" = as N finais (mais recentes).
  const selecionadas = useMemo(() => {
    if (pendentes.length === 0) return [];
    if (direcao === "PROXIMAS") return pendentes.slice(0, quantidade);
    return pendentes.slice(Math.max(0, pendentes.length - quantidade));
  }, [pendentes, direcao, quantidade]);

  // Enquanto o admin não editar o campo manualmente, o valor total sugerido
  // acompanha a soma original das parcelas selecionadas.
  useEffect(() => {
    if (valorAntecTocado) return;
    const somaCents = selecionadas.reduce(
      (acc, p) => acc + Math.round(p.valor * 100),
      0,
    );
    setRawCentsAntecipar(somaCents);
  }, [selecionadas, valorAntecTocado]);

  const valoresPorParcela = useMemo(
    () => distribuirCentavos(rawCentsAntecipar, selecionadas.length),
    [rawCentsAntecipar, selecionadas.length],
  );

  const handleDigitsChangeAntecipar = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = e.target;
    const cursorPos = input.selectionStart ?? input.value.length;
    const digitsAntesDoCursor = input.value
      .slice(0, cursorPos)
      .replace(/\D/g, "").length;

    const raw = input.value.replace(/\D/g, "").slice(0, 8);
    setRawDigitsAntecipar(raw);
    if (raw.length === 8) {
      const d = raw.slice(0, 2),
        m = raw.slice(2, 4),
        y = raw.slice(4);
      setDataAntecipar(`${y}-${m}-${d}`);
    }
    const novaPos = posAposNDigitos(rawToDisplay(raw), digitsAntesDoCursor);
    requestAnimationFrame(() => {
      if (input) input.setSelectionRange(novaPos, novaPos);
    });
  };

  function abrirAntecipar() {
    setValorAntecTocado(false);
    setView("antecipar");
  }

  async function handleConfirmAntecipar() {
    if (selecionadas.length === 0 || rawCentsAntecipar <= 0) return;
    setSalvandoAntecipar(true);
    try {
      const novaDataPagamento = new Date(
        `${dataAntecipar}T12:00:00`,
      ).toISOString();

      const results = await Promise.all(
        selecionadas.map((p, i) =>
          supabaseBrowser
            .from("fin_transacoes")
            .update({
              status: "PAGO",
              valor: valoresPorParcela[i] / 100,
              conta_id: contaAntecipar || null,
              data_pagamento: novaDataPagamento,
            })
            // ✅ Guard: só confirma se a parcela ainda estiver PENDENTE.
            // Sem isso, uma parcela já paga por outro caminho enquanto o
            // modal estava aberto (outra aba, outro admin) era sobrescrita
            // silenciosamente com o valor/data da antecipação — o update
            // "ganhava" mesmo sem checar o estado atual da linha.
            .eq("id", p.id)
            .eq("status", "PENDENTE")
            .select("id"),
        ),
      );

      // Cada resultado é correlacionado por índice com `selecionadas` — sem
      // isso, uma falha em apenas uma das N parcelas (rede, RLS, constraint)
      // ficava indistinguível de sucesso total: o toast dizia "confirmadas
      // com sucesso" mesmo com o banco em estado parcial, sem dizer qual
      // parcela faltou.
      const confirmadas: ParcelaPendente[] = [];
      const jaNaoPendentes: ParcelaPendente[] = [];
      const comErro: { p: ParcelaPendente; msg: string }[] = [];
      results.forEach((r, i) => {
        const p = selecionadas[i];
        if (r.error) comErro.push({ p, msg: r.error.message });
        else if (!r.data || r.data.length === 0) jaNaoPendentes.push(p);
        else confirmadas.push(p);
      });

      // Best-effort — resolve a notificação de vencimento só das que
      // realmente foram confirmadas agora.
      if (confirmadas.length > 0) {
        await Promise.allSettled(
          confirmadas.map((p) =>
            supabaseBrowser.rpc("resolve_notification", {
              p_tenant_id: tenantId,
              p_type: "fin_vencido",
              p_source_id: p.id,
            }),
          ),
        );
      }

      // Reflete no estado local exatamente o que restou pendente de verdade
      // (tira as confirmadas e as que já não estavam mais pendentes) — o
      // que sobrar pode ser tentado de novo com segurança, já que o guard
      // acima faz o reenvio ser idempotente.
      const pendentesRestantes = pendentes.filter(
        (row) =>
          !confirmadas.some((c) => c.id === row.id) &&
          !jaNaoPendentes.some((j) => j.id === row.id),
      );
      setPendentes(pendentesRestantes);
      setQuantidade((q) =>
        Math.min(Math.max(q, 1), pendentesRestantes.length || 1),
      );
      setValorAntecTocado(false);

      if (comErro.length === 0 && jaNaoPendentes.length === 0) {
        addToast(
          "success",
          pendentesRestantes.length === 0
            ? "Parcelamento quitado"
            : "Parcelas antecipadas",
          `${confirmadas.length} parcela${confirmadas.length > 1 ? "s" : ""} confirmada${confirmadas.length > 1 ? "s" : ""} com sucesso.`,
        );
        onSuccess();
        onClose();
      } else {
        // Falha parcial (ou parcela que mudou de status por fora enquanto o
        // modal estava aberto) — avisa exatamente o que aconteceu com cada
        // grupo, atualiza a tabela de fundo, mas mantém o modal aberto (já
        // com a lista de pendentes corrigida) pra o admin decidir se tenta
        // de novo só o que faltou. Usa onDataChanged (não onSuccess) —
        // onSuccess é interpretado pelo pai como "fechar o modal", o que
        // contradiria a mensagem acima.
        onDataChanged?.();
        const partes: string[] = [];
        if (confirmadas.length > 0)
          partes.push(
            `${confirmadas.length} confirmada${confirmadas.length > 1 ? "s" : ""}`,
          );
        if (jaNaoPendentes.length > 0)
          partes.push(
            `${jaNaoPendentes.length} já não estava${jaNaoPendentes.length > 1 ? "m" : ""} mais pendente${jaNaoPendentes.length > 1 ? "s" : ""}`,
          );
        if (comErro.length > 0)
          partes.push(
            `${comErro.length} ${comErro.length > 1 ? "falharam" : "falhou"}: ${comErro[0].msg}`,
          );
        addToast("error", "Antecipação parcial", partes.join(" · "));
      }
    } catch (e: any) {
      addToast("error", "Erro ao antecipar", e.message);
    } finally {
      setSalvandoAntecipar(false);
    }
  }

  return (
    <Modal
      title={
        view === "antecipar"
          ? "Antecipar Parcelas"
          : isBaixando
            ? isReceita
              ? "Confirmar Recebimento"
              : "Confirmar Pagamento"
            : "Reverter para Pendente"
      }
      onClose={onClose}
    >
      {view === "antecipar" ? (
        <div className="space-y-4">
          <div className="p-3 rounded-xl border border-border bg-transparent">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
              {isReceita ? "📈 Receita parcelada" : "📉 Despesa parcelada"}
            </p>
            <p className="text-sm font-medium text-foreground/90 truncate">
              {transacao.descricao}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {loadingPendentes
                ? "Carregando parcelas pendentes..."
                : `${pendentes.length} parcela${pendentes.length !== 1 ? "s" : ""} pendente${pendentes.length !== 1 ? "s" : ""}`}
            </p>
          </div>

          {!loadingPendentes && pendentes.length > 0 && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Quantas parcelas antecipar?
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuantidade((q) => Math.max(1, q - 1));
                      setValorAntecTocado(false);
                    }}
                    className="w-9 h-9 rounded-lg border border-border text-muted-foreground hover:bg-muted flex items-center justify-center font-bold"
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={quantidade}
                    onChange={(e) => {
                      const n = parseInt(
                        e.target.value.replace(/\D/g, ""),
                        10,
                      );
                      setQuantidade(
                        Number.isNaN(n)
                          ? 1
                          : Math.min(Math.max(n, 1), pendentes.length),
                      );
                      setValorAntecTocado(false);
                    }}
                    className="w-16 h-9 text-center bg-transparent border border-border rounded-lg text-sm font-medium text-foreground outline-none focus:border-emerald-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setQuantidade((q) => Math.min(pendentes.length, q + 1));
                      setValorAntecTocado(false);
                    }}
                    className="w-9 h-9 rounded-lg border border-border text-muted-foreground hover:bg-muted flex items-center justify-center font-bold"
                  >
                    +
                  </button>
                  {quantidade < pendentes.length && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuantidade(pendentes.length);
                        setValorAntecTocado(false);
                      }}
                      className="ml-auto text-xs font-semibold text-sky-500 hover:text-sky-400"
                    >
                      Selecionar todas (quita)
                    </button>
                  )}
                </div>
              </div>

              {quantidade < pendentes.length && (
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Quais parcelas?
                  </label>
                  <div className="flex bg-transparent rounded-lg border border-border p-1 h-10">
                    <button
                      type="button"
                      onClick={() => {
                        setDirecao("PROXIMAS");
                        setValorAntecTocado(false);
                      }}
                      className={`flex-1 rounded-md text-xs font-medium transition-colors ${direcao === "PROXIMAS" ? "bg-amber-500/10 text-amber-500 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      📅 Próximas (mais antigas)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDirecao("ULTIMAS");
                        setValorAntecTocado(false);
                      }}
                      className={`flex-1 rounded-md text-xs font-medium transition-colors ${direcao === "ULTIMAS" ? "bg-sky-500/10 text-sky-500 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      ⏪ Últimas (mais recentes)
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Parcelas selecionadas
                </label>
                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {selecionadas.map((p, i) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/40 border border-border/60"
                    >
                      <span className="text-foreground/90">
                        {p.parcela_total
                          ? `Parcela ${p.parcela_atual}/${p.parcela_total}`
                          : "Parcela"}{" "}
                        · {formatDataCurta(p.data_vencimento)}
                      </span>
                      <span className="font-medium text-foreground tabular-nums">
                        R${" "}
                        {((valoresPorParcela[i] ?? 0) / 100)
                          .toFixed(2)
                          .replace(".", ",")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Valor total pago (R$)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={centsToDisplay(rawCentsAntecipar)}
                  onChange={(e) => {
                    const digits = e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 13);
                    setRawCentsAntecipar(parseInt(digits || "0", 10));
                    setValorAntecTocado(true);
                  }}
                  onFocus={(e) => e.target.select()}
                  className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm font-medium text-foreground outline-none focus:border-emerald-500/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Dividido entre as {selecionadas.length} parcela
                  {selecionadas.length !== 1 ? "s" : ""} selecionada
                  {selecionadas.length !== 1 ? "s" : ""}.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Data de Pagamento
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={rawToDisplay(rawDigitsAntecipar)}
                    onChange={handleDigitsChangeAntecipar}
                    onFocus={(e) => e.target.select()}
                    placeholder="DD/MM/AAAA"
                    maxLength={10}
                    className="w-full h-10 px-3 pr-10 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPickerAntecipar(true)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 rounded-md transition-colors"
                  >
                    <IconCalendar />
                  </button>
                </div>
                {showPickerAntecipar && (
                  <ModalDayPicker
                    currentDate={
                      dataAntecipar
                        ? new Date(`${dataAntecipar}T12:00:00`)
                        : new Date()
                    }
                    onSelect={(date) => {
                      const d = String(date.getDate()).padStart(2, "0");
                      const m = String(date.getMonth() + 1).padStart(2, "0");
                      const y = date.getFullYear();
                      setDataAntecipar(`${y}-${m}-${d}`);
                      setRawDigitsAntecipar(`${d}${m}${y}`);
                      setShowPickerAntecipar(false);
                    }}
                    onClose={() => setShowPickerAntecipar(false)}
                  />
                )}
              </div>

              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Conta / Carteira
                </label>
                <select
                  value={contaAntecipar}
                  onChange={(e) => setContaAntecipar(e.target.value)}
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
            </>
          )}

          {!loadingPendentes && pendentes.length === 0 && (
            <div className="text-center text-sm text-muted-foreground italic py-4">
              Nenhuma parcela pendente encontrada.
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setView("baixa")}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Voltar
            </button>
            <button
              onClick={handleConfirmAntecipar}
              disabled={
                salvandoAntecipar ||
                loadingPendentes ||
                selecionadas.length === 0 ||
                rawCentsAntecipar <= 0
              }
              className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium shadow-lg transition-all disabled:opacity-50"
            >
              {salvandoAntecipar
                ? "Salvando..."
                : quantidade === pendentes.length
                  ? "Confirmar Quitação"
                  : `Confirmar Antecipação (${quantidade})`}
            </button>
          </div>
        </div>
      ) : (
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
                  const digits = e.target.value
                    .replace(/\D/g, "")
                    .slice(0, 13);
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
              className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            {podeAntecipar && (
              <button
                onClick={abrirAntecipar}
                className="flex-1 py-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 text-sm font-medium hover:bg-sky-500/20 transition-colors"
              >
                Antecipar
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={salvando}
              className={`flex-1 py-2.5 rounded-lg text-white text-sm font-medium shadow-lg transition-all disabled:opacity-50 ${btnColor}`}
            >
              {salvando ? "Salvando..." : btnLabel}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
