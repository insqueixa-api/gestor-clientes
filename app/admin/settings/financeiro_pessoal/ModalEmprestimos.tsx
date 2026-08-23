"use client";
// app/admin/settings/financeiro_pessoal/ModalEmprestimos.tsx
// Hub de "Empréstimos informais" (sem vencimento, pago aos poucos) — lista
// pessoas + saldo devedor calculado ao vivo a partir de fin_transacoes
// (emprestimo_id), e histórico por pessoa. Não cria transação nenhuma
// sozinho: "+ Emprestei"/"+ Recebi pagamento" delegam pro ModalTransacao já
// existente em page.tsx via onNovoLancamento (ele empilha por cima, mesmo
// z-index — igual ModalTransacao já empilha ModalNovaConta/ModalNovaCategoria
// por cima de si mesmo), assim o fluxo de salvar/autocomplete/conta
// continua sendo um só lugar só.
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, IconPlus, IconChevronLeft } from "./shared";

type Emprestimo = {
  id: string;
  nome: string;
  observacoes: string | null;
  quitado: boolean;
  created_at: string;
};

type LancamentoHistorico = {
  id: string;
  tipo: "RECEITA" | "DESPESA";
  valor: number;
  data_pagamento: string | null;
  descricao: string;
};

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v,
  );

export default function ModalEmprestimos({
  tenantId,
  addToast,
  onClose,
  onNovoLancamento,
  refreshNonce,
}: {
  tenantId: string;
  addToast: any;
  onClose: () => void;
  onNovoLancamento: (params: {
    emprestimoId: string;
    emprestimoNome: string;
    emprestimoTipo: "DESPESA" | "RECEITA";
  }) => void;
  refreshNonce: number;
}) {
  const [loading, setLoading] = useState(true);
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [mostrarQuitados, setMostrarQuitados] = useState(false);

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [historico, setHistorico] = useState<LancamentoHistorico[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);

  const [showNovaPessoa, setShowNovaPessoa] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novaObs, setNovaObs] = useState("");
  const [salvandoPessoa, setSalvandoPessoa] = useState(false);

  // Lista + saldos num único carregamento: 1 query pra fin_emprestimos + 1
  // query agregada pra TODOS os saldos de uma vez (evita N+1 — 1 select por
  // pessoa seria o mesmo problema de get_saldo_conta já documentado nesta
  // tela).
  const carregar = async () => {
    setLoading(true);
    try {
      const [resEmprestimos, resSaldos] = await Promise.all([
        supabaseBrowser
          .from("fin_emprestimos")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabaseBrowser
          .from("fin_transacoes")
          .select("emprestimo_id, tipo, valor")
          .eq("tenant_id", tenantId)
          .eq("status", "PAGO")
          .not("emprestimo_id", "is", null),
      ]);
      if (resEmprestimos.error) throw resEmprestimos.error;
      if (resSaldos.error) throw resSaldos.error;

      setEmprestimos(resEmprestimos.data || []);

      const mapa: Record<string, number> = {};
      for (const t of resSaldos.data || []) {
        if (!t.emprestimo_id) continue;
        const delta =
          t.tipo === "DESPESA" ? Number(t.valor) : -Number(t.valor);
        mapa[t.emprestimo_id] = (mapa[t.emprestimo_id] || 0) + delta;
      }
      setSaldos(mapa);
    } catch (e: any) {
      addToast("error", "Erro ao carregar empréstimos", e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [refreshNonce]);

  const carregarHistorico = async (emprestimoId: string) => {
    setLoadingHistorico(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("fin_transacoes")
        .select("id, tipo, valor, data_pagamento, descricao")
        .eq("tenant_id", tenantId)
        .eq("emprestimo_id", emprestimoId)
        .order("data_pagamento", { ascending: false });
      if (error) throw error;
      setHistorico(data || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar histórico", e.message);
    } finally {
      setLoadingHistorico(false);
    }
  };

  useEffect(() => {
    if (selecionadoId) carregarHistorico(selecionadoId);
  }, [selecionadoId, refreshNonce]);

  async function handleCriarPessoa() {
    if (!novoNome.trim()) return;
    setSalvandoPessoa(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("fin_emprestimos")
        .insert({
          tenant_id: tenantId,
          nome: novoNome.trim(),
          observacoes: novaObs.trim() || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      addToast("success", "Pessoa adicionada", `${data.nome} foi cadastrada.`);
      setEmprestimos((prev) => [data, ...prev]);
      setNovoNome("");
      setNovaObs("");
      setShowNovaPessoa(false);
      setSelecionadoId(data.id);
    } catch (e: any) {
      addToast("error", "Erro ao criar", e.message);
    } finally {
      setSalvandoPessoa(false);
    }
  }

  async function handleToggleQuitado(emprestimo: Emprestimo) {
    const novoValor = !emprestimo.quitado;
    try {
      const { error } = await supabaseBrowser
        .from("fin_emprestimos")
        .update({ quitado: novoValor })
        .eq("id", emprestimo.id);
      if (error) throw error;
      setEmprestimos((prev) =>
        prev.map((e) =>
          e.id === emprestimo.id ? { ...e, quitado: novoValor } : e,
        ),
      );
      addToast(
        "success",
        novoValor ? "Marcado como quitado" : "Reaberto",
        novoValor
          ? "Some da lista principal — o histórico continua guardado."
          : "Voltou pra lista principal de empréstimos.",
      );
    } catch (e: any) {
      addToast("error", "Erro ao atualizar", e.message);
    }
  }

  const selecionado = emprestimos.find((e) => e.id === selecionadoId) || null;
  const listaVisivel = emprestimos.filter((e) =>
    mostrarQuitados ? true : !e.quitado,
  );
  const totalDevido = listaVisivel.reduce(
    (acc, e) => acc + (saldos[e.id] || 0),
    0,
  );

  // ── Detalhe de uma pessoa ─────────────────────────────────────────────
  if (selecionado) {
    const saldo = saldos[selecionado.id] || 0;
    return (
      <Modal
        title={selecionado.nome}
        onClose={onClose}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <button
            onClick={() => setSelecionadoId(null)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconChevronLeft /> Todas as pessoas
          </button>

          <div className="p-4 rounded-xl border border-border bg-transparent text-center">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Saldo devedor
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${saldo > 0 ? "text-rose-500" : saldo < 0 ? "text-emerald-500" : "text-foreground/80"}`}
            >
              {fmtBRL(Math.abs(saldo))}
            </div>
            {saldo < 0 && (
              <div className="text-[11px] text-emerald-500 mt-0.5">
                Pagou a mais — você deve pra {selecionado.nome}
              </div>
            )}
            {saldo === 0 && emprestimos.length > 0 && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Quitado
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() =>
                onNovoLancamento({
                  emprestimoId: selecionado.id,
                  emprestimoNome: selecionado.nome,
                  emprestimoTipo: "DESPESA",
                })
              }
              className="h-11 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 font-bold text-sm hover:bg-rose-500/20 transition-colors"
            >
              📉 Emprestei
            </button>
            <button
              onClick={() =>
                onNovoLancamento({
                  emprestimoId: selecionado.id,
                  emprestimoNome: selecionado.nome,
                  emprestimoTipo: "RECEITA",
                })
              }
              className="h-11 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-bold text-sm hover:bg-emerald-500/20 transition-colors"
            >
              📈 Recebi pagamento
            </button>
          </div>

          <button
            onClick={() => handleToggleQuitado(selecionado)}
            className="w-full h-9 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            {selecionado.quitado
              ? "↩️ Reabrir (tirar de quitado)"
              : "✅ Marcar como quitado"}
          </button>

          <div>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Histórico
            </div>
            {loadingHistorico ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Carregando...
              </div>
            ) : historico.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Nenhum lançamento ainda.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
                {historico.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-border"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-foreground/90 truncate">
                        {h.descricao}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {h.data_pagamento
                          ? new Date(h.data_pagamento).toLocaleDateString(
                              "pt-BR",
                              { timeZone: "America/Sao_Paulo" },
                            )
                          : "—"}
                      </div>
                    </div>
                    <span
                      className={`text-sm font-medium shrink-0 ml-3 ${h.tipo === "DESPESA" ? "text-rose-500" : "text-emerald-500"}`}
                    >
                      {h.tipo === "DESPESA" ? "-" : "+"} {fmtBRL(h.valor)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  // ── Lista de pessoas ─────────────────────────────────────────────────
  return (
    <Modal title="Empréstimos" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        {listaVisivel.length > 0 && (
          <div className="p-3 rounded-xl border border-border bg-transparent flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total devido
            </span>
            <span className="text-lg font-bold text-rose-500 tabular-nums">
              {fmtBRL(totalDevido)}
            </span>
          </div>
        )}

        {showNovaPessoa ? (
          <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
            <input
              autoFocus
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nome (ex: Sobrinha - Fulana)"
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50"
            />
            <input
              value={novaObs}
              onChange={(e) => setNovaObs(e.target.value)}
              placeholder="Observação (opcional)"
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowNovaPessoa(false)}
                className="flex-1 h-9 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={handleCriarPessoa}
                disabled={salvandoPessoa || !novoNome.trim()}
                className="flex-1 h-9 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 disabled:opacity-50"
              >
                {salvandoPessoa ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNovaPessoa(true)}
            className="w-full h-10 rounded-lg border border-dashed border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center gap-2"
          >
            <IconPlus /> Nova pessoa
          </button>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Carregando...
          </div>
        ) : listaVisivel.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Nenhum empréstimo em aberto.
          </div>
        ) : (
          <div className="space-y-2">
            {listaVisivel.map((e) => {
              const saldo = saldos[e.id] || 0;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelecionadoId(e.id)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border hover:border-emerald-500/40 hover:bg-muted transition-colors text-left"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground/90 truncate">
                      {e.nome}
                      {e.quitado && (
                        <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                          (quitado)
                        </span>
                      )}
                    </div>
                    {e.observacoes && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {e.observacoes}
                      </div>
                    )}
                  </div>
                  <span
                    className={`text-sm font-bold tabular-nums shrink-0 ml-3 ${saldo > 0 ? "text-rose-500" : saldo < 0 ? "text-emerald-500" : "text-muted-foreground"}`}
                  >
                    {fmtBRL(Math.abs(saldo))}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {emprestimos.some((e) => e.quitado) && (
          <button
            onClick={() => setMostrarQuitados((v) => !v)}
            className="w-full text-center text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {mostrarQuitados ? "Ocultar quitados" : "Mostrar quitados"}
          </button>
        )}
      </div>
    </Modal>
  );
}
