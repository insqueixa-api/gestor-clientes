"use client";
// components/guia-tv/ModalSugestoes.tsx
// Extraído de GuiaTVView.tsx (14/08/2026): ModalSugestaoConteudo (cliente
// sugere um filme/série) e ModalGerenciarSugestoes (admin gerencia os
// pedidos, atrás do botão "Sincronizar" que é `!modoCliente`-gated) —
// ambos num arquivo só porque compartilham tipos/constantes de status.
// Cada um carrega via next/dynamic só quando o respectivo modal abre.
import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, CheckCircle } from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import type { TipoConteudo, ServidorId } from "./types";

type SugestaoBuscaItem = { id: string; titulo: string };
type SugestaoHistoricoItem = {
  suggestion_id: string;
  servidor: string;
  tipo: TipoConteudo;
  titulo: string;
  link: string;
  status: "PENDENTE" | "ENVIADO_SUPORTE" | "ADICIONADO" | "REJEITADO";
  categoria_adicionada: string | null;
  motivo_rejeicao: string | null;
  pedido_em: string;
  total_pedidos: number;
  pode_editar: boolean;
};

const STATUS_SUGESTAO_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  ENVIADO_SUPORTE: "Enviado ao suporte",
  ADICIONADO: "Adicionado no servidor",
  REJEITADO: "Não foi possível adicionar",
};
const STATUS_SUGESTAO_COR: Record<string, string> = {
  PENDENTE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  ENVIADO_SUPORTE: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  ADICIONADO: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  REJEITADO: "bg-rose-500/10 text-rose-500 border-rose-500/20",
};

export function ModalSugestaoConteudo({
  onClose,
  tipo,
  tituloInicial,
  servidor,
  sessionToken,
  contaId,
}: {
  onClose: () => void;
  tipo: TipoConteudo;
  tituloInicial: string;
  servidor: ServidorId;
  sessionToken: string;
  contaId: string;
}) {
  const [view, setView] = useState<"form" | "historico">("form");

  // ── form de sugestão ──────────────────────────────────────────────────────
  const [titulo, setTitulo] = useState(tituloInicial);
  const [link, setLink] = useState("");
  const [aceite, setAceite] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [encontrados, setEncontrados] = useState<SugestaoBuscaItem[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // ── popup de duplicata ────────────────────────────────────────────────────
  const [duplicata, setDuplicata] = useState<{
    suggestion_id: string;
    titulo_existente: string;
    status: string;
    total_pedidos: number;
  } | null>(null);
  const [confirmandoDuplicata, setConfirmandoDuplicata] = useState(false);

  // ── histórico ─────────────────────────────────────────────────────────────
  const [historico, setHistorico] = useState<SugestaoHistoricoItem[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editLink, setEditLink] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [processandoExclusao, setProcessandoExclusao] = useState(false);

  // Autocomplete: checa no catálogo enquanto digita (debounce simples)
  useEffect(() => {
    if (view !== "form") return;
    const termo = titulo.trim();
    if (termo.length < 2) {
      setEncontrados([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      fetch("/api/client-portal/guia-tv/sugestao/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: sessionToken,
          servidor,
          tipo,
          q: termo,
        }),
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((d) => setEncontrados(d?.ok ? d.data : []))
        .catch(() => setEncontrados([]))
        .finally(() => setBuscando(false));
    }, 400);
    return () => clearTimeout(t);
  }, [titulo, servidor, tipo, sessionToken, view]);

  function carregarHistorico() {
    setLoadingHistorico(true);
    fetch("/api/client-portal/guia-tv/sugestao/historico", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: sessionToken, conta: contaId }),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => setHistorico(d?.ok ? d.data : []))
      .catch(() => setHistorico([]))
      .finally(() => setLoadingHistorico(false));
  }

  async function enviarSugestao() {
    setErro(null);
    if (!titulo.trim()) {
      setErro("Informe o nome do conteúdo.");
      return;
    }
    if (!link.trim()) {
      setErro("O link é obrigatório.");
      return;
    }
    if (!aceite) {
      setErro("Você precisa marcar a ciência antes de enviar.");
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/client-portal/guia-tv/sugestao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: sessionToken,
          conta: contaId,
          servidor,
          tipo,
          titulo: titulo.trim(),
          link: link.trim(),
        }),
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);

      if (!d?.ok) {
        setErro(d?.error || "Não foi possível enviar sua sugestão.");
        return;
      }

      if (d.duplicate && d.needs_confirmation) {
        setDuplicata({
          suggestion_id: d.suggestion_id,
          titulo_existente: d.titulo_existente,
          status: d.status,
          total_pedidos: d.total_pedidos,
        });
        return;
      }
      if (d.already_requested_by_you) {
        setSucesso(
          `Você já tinha pedido "${d.titulo}" — status atual: ${STATUS_SUGESTAO_LABEL[d.status] || d.status}.`,
        );
        return;
      }
      setSucesso(`Sugestão de "${d.titulo}" enviada com sucesso!`);
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarDuplicata() {
    if (!duplicata) return;
    setConfirmandoDuplicata(true);
    try {
      const res = await fetch("/api/client-portal/guia-tv/sugestao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: sessionToken,
          conta: contaId,
          confirmar_duplicata: true,
          suggestion_id: duplicata.suggestion_id,
        }),
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        setSucesso(
          `Pedido registrado! "${d.titulo}" já tinha sido sugerido por outra pessoa — status: ${STATUS_SUGESTAO_LABEL[d.status] || d.status}.`,
        );
        setDuplicata(null);
      } else {
        setErro(d?.error || "Não foi possível registrar seu pedido.");
      }
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setConfirmandoDuplicata(false);
    }
  }

  function iniciarEdicaoHistorico(item: SugestaoHistoricoItem) {
    setEditandoId(item.suggestion_id);
    setEditTitulo(item.titulo);
    setEditLink(item.link);
  }

  async function salvarEdicaoHistorico(suggestionId: string) {
    setSalvandoEdicao(true);
    try {
      const res = await fetch("/api/client-portal/guia-tv/sugestao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: sessionToken,
          conta: contaId,
          editar: true,
          suggestion_id: suggestionId,
          titulo: editTitulo,
          link: editLink,
        }),
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        setEditandoId(null);
        carregarHistorico();
      }
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function excluirHistorico(suggestionId: string) {
    setProcessandoExclusao(true);
    try {
      const res = await fetch("/api/client-portal/guia-tv/sugestao", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: sessionToken,
          conta: contaId,
          suggestion_id: suggestionId,
        }),
        cache: "no-store",
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        setExcluindoId(null);
        carregarHistorico();
      }
    } finally {
      setProcessandoExclusao(false);
    }
  }

  const jaExisteNoCatalogo = encontrados.length > 0;

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <div className="text-lg font-bold text-foreground flex items-center gap-2.5">
          <Sparkles size={18} className="text-emerald-500" />
          {view === "form" ? "Sugerir conteúdo" : "Meus pedidos"}
        </div>
      </ModalHeader>

        <ModalBody className="p-5 space-y-4 bg-muted/20">
          {view === "form" ? (
            <>
              {sucesso ? (
                <div className="text-center py-8 space-y-4">
                  <CheckCircle size={40} className="text-emerald-500 mx-auto" />
                  <p className="text-sm font-medium text-foreground">
                    {sucesso}
                  </p>
                  <button
                    onClick={onClose}
                    className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              ) : duplicata ? (
                <div className="space-y-4">
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-foreground/90">
                    <p className="font-bold mb-1.5">
                      Conteúdo já solicitado por outro usuário
                    </p>
                    <p className="text-muted-foreground">
                      "{duplicata.titulo_existente}" já foi pedido{" "}
                      {duplicata.total_pedidos}x (status atual:{" "}
                      {STATUS_SUGESTAO_LABEL[duplicata.status] ||
                        duplicata.status}
                      ). Deseja registrar seu pedido também?
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setDuplicata(null)}
                      className="flex-1 h-10 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={confirmarDuplicata}
                      disabled={confirmandoDuplicata}
                      className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors disabled:opacity-60"
                    >
                      {confirmandoDuplicata
                        ? "Registrando..."
                        : "Sim, registrar"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Nome do {tipo === "FILME" ? "Filme" : "Série"}
                    </label>
                    <input
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                      placeholder="Digite o nome exato..."
                      className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none focus:border-emerald-500/50 transition-colors text-sm"
                      autoFocus
                    />
                  </div>

                  {buscando && (
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <RefreshCw size={12} className="animate-spin" /> Checando
                      se já existe...
                    </div>
                  )}

                  {jaExisteNoCatalogo && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-2">
                      <p className="text-sm font-bold text-emerald-500 flex items-center gap-2">
                        <CheckCircle size={14} /> Já disponível no servidor!
                      </p>
                      <ul className="text-xs text-foreground/80 space-y-1 pl-1">
                        {encontrados.map((e) => (
                          <li key={e.id}>• {e.titulo}</li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        Não é possível sugerir um título que já está no
                        catálogo.
                      </p>
                    </div>
                  )}

                  {!jaExisteNoCatalogo &&
                    titulo.trim().length >= 2 &&
                    !buscando && (
                      <>
                        <div>
                          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                            Link comprovando disponibilidade no Brasil
                          </label>
                          <input
                            value={link}
                            onChange={(e) => setLink(e.target.value)}
                            placeholder="https://..."
                            className="w-full h-11 px-3 bg-transparent border border-border rounded-xl text-foreground outline-none focus:border-emerald-500/50 transition-colors text-sm"
                          />
                          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                            Envie o link direto da página do filme/série (ex.:
                            página oficial, IMDb, catálogo de streaming). Não
                            aceitamos link de busca do Google.
                          </p>
                        </div>

                        <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed cursor-pointer">
                          <input
                            type="checkbox"
                            checked={aceite}
                            onChange={(e) => setAceite(e.target.checked)}
                            className="mt-0.5 rounded border-border"
                          />
                          <span>
                            Estou ciente de que este pedido{" "}
                            <strong>não garante</strong> a inclusão do conteúdo.
                            Todo pedido é enviado ao suporte do servidor, que
                            avalia se é possível adicionar.
                          </span>
                        </label>

                        {erro && (
                          <div className="text-xs text-rose-500 font-medium">
                            {erro}
                          </div>
                        )}

                        <button
                          onClick={enviarSugestao}
                          disabled={enviando}
                          className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-60"
                        >
                          {enviando ? "Enviando..." : "Enviar sugestão"}
                        </button>
                      </>
                    )}
                </>
              )}
            </>
          ) : (
            <>
              {loadingHistorico ? (
                <div className="text-center py-12 text-muted-foreground animate-pulse flex flex-col items-center gap-3">
                  <RefreshCw size={20} className="animate-spin" /> Carregando
                  seus pedidos...
                </div>
              ) : historico.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground/70 italic text-sm">
                  Você ainda não fez nenhum pedido.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {historico.map((h) => (
                    <div
                      key={h.suggestion_id}
                      className="p-3.5 rounded-xl border border-border bg-card space-y-2"
                    >
                      {editandoId === h.suggestion_id ? (
                        <div className="space-y-2">
                          <input
                            value={editTitulo}
                            onChange={(e) => setEditTitulo(e.target.value)}
                            className="w-full h-9 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                            placeholder="Nome do conteúdo"
                          />
                          <input
                            value={editLink}
                            onChange={(e) => setEditLink(e.target.value)}
                            className="w-full h-9 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                            placeholder="https://..."
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditandoId(null)}
                              className="flex-1 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() =>
                                salvarEdicaoHistorico(h.suggestion_id)
                              }
                              disabled={
                                salvandoEdicao ||
                                !editTitulo.trim() ||
                                !editLink.trim()
                              }
                              className="flex-1 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
                            >
                              {salvandoEdicao ? "Salvando..." : "Salvar"}
                            </button>
                          </div>
                        </div>
                      ) : excluindoId === h.suggestion_id ? (
                        <div className="space-y-2">
                          <p className="text-xs text-rose-500 font-medium">
                            Excluir este pedido? Não pode ser desfeito.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setExcluindoId(null)}
                              className="flex-1 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => excluirHistorico(h.suggestion_id)}
                              disabled={processandoExclusao}
                              className="flex-1 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50"
                            >
                              {processandoExclusao ? "Excluindo..." : "Excluir"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground truncate">
                              {h.titulo}
                            </span>
                            <span
                              className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${STATUS_SUGESTAO_COR[h.status] || ""}`}
                            >
                              {STATUS_SUGESTAO_LABEL[h.status] || h.status}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {h.tipo === "FILME" ? "Filme" : "Série"} ·{" "}
                            {h.servidor}
                            {h.categoria_adicionada &&
                              ` · Categoria: ${h.categoria_adicionada}`}
                            {h.total_pedidos > 1 &&
                              ` · Pedido por ${h.total_pedidos} pessoas`}
                          </div>
                          {h.status === "REJEITADO" && h.motivo_rejeicao && (
                            <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">
                              Motivo: {h.motivo_rejeicao}
                            </div>
                          )}
                          {h.pode_editar && (
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => iniciarEdicaoHistorico(h)}
                                className="text-xs font-semibold text-amber-500 hover:text-amber-400"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => setExcluindoId(h.suggestion_id)}
                                className="text-xs font-semibold text-rose-500 hover:text-rose-400"
                              >
                                Excluir
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter className="block text-center">
          <button
            onClick={() => {
              const next = view === "form" ? "historico" : "form";
              setView(next);
              if (next === "historico") carregarHistorico();
            }}
            className="text-xs font-medium text-sky-500 hover:text-sky-400 transition-colors"
          >
            {view === "form"
              ? "Ver meus pedidos anteriores →"
              : "← Voltar pra sugerir novo conteúdo"}
          </button>
        </ModalFooter>
    </Modal>
  );
}

type SugestaoAdminSolicitante = {
  client_id: string;
  nome: string;
  username: string;
  whatsapp: string | null;
};
type SugestaoAdminItem = {
  id: string;
  servidor: string;
  tipo: TipoConteudo;
  titulo: string;
  link: string;
  status: "PENDENTE" | "ENVIADO_SUPORTE" | "ADICIONADO" | "REJEITADO";
  categoria_adicionada: string | null;
  motivo_rejeicao: string | null;
  criado_em: string;
  total_pedidos: number;
  solicitantes: SugestaoAdminSolicitante[];
};

export function ModalGerenciarSugestoes({ onClose }: { onClose: () => void }) {
  const [statusFiltro, setStatusFiltro] = useState<string>("PENDENTE");
  const [itens, setItens] = useState<SugestaoAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [rejeitandoId, setRejeitandoId] = useState<string | null>(null);
  const [motivoRejeicao, setMotivoRejeicao] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editLink, setEditLink] = useState("");
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  function carregar() {
    setLoading(true);
    fetch(`/api/catalogo/sugestoes?status=${statusFiltro}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => setItens(d?.ok ? d.data : []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltro]);

  async function atualizarStatus(
    id: string,
    status: string,
    extra?: Record<string, any>,
  ) {
    setProcessandoId(id);
    try {
      const res = await fetch("/api/catalogo/sugestoes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, ...extra }),
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        carregar();
        setRejeitandoId(null);
        setMotivoRejeicao("");
      }
    } finally {
      setProcessandoId(null);
    }
  }

  function iniciarEdicao(item: SugestaoAdminItem) {
    setEditandoId(item.id);
    setEditTitulo(item.titulo);
    setEditLink(item.link);
  }

  async function salvarEdicao(id: string) {
    setProcessandoId(id);
    try {
      const res = await fetch("/api/catalogo/sugestoes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, titulo: editTitulo, link: editLink }),
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        carregar();
        setEditandoId(null);
      }
    } finally {
      setProcessandoId(null);
    }
  }

  async function excluir(id: string) {
    setProcessandoId(id);
    try {
      const res = await fetch("/api/catalogo/sugestoes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        carregar();
        setExcluindoId(null);
      }
    } finally {
      setProcessandoId(null);
    }
  }

  function copiarLink(id: string, link: string) {
    navigator.clipboard.writeText(link).then(() => {
      setCopiadoId(id);
      setTimeout(() => setCopiadoId(null), 2000);
    });
  }

  const FILTROS = [
    "PENDENTE",
    "ENVIADO_SUPORTE",
    "ADICIONADO",
    "REJEITADO",
    "TODOS",
  ];

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <ModalHeader onClose={onClose}>
        <div className="text-lg font-bold text-foreground flex items-center gap-2.5">
          <Sparkles size={18} className="text-emerald-500" /> Gerenciar
          Sugestões
        </div>
        <div className="text-xs text-muted-foreground/90 mt-1.5 leading-relaxed">
          Pedidos de conteúdo enviados pelos clientes pelo Guia TV.
        </div>
      </ModalHeader>

        <div className="px-5 pt-4 flex flex-wrap gap-2 bg-muted/20">
          {FILTROS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFiltro(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFiltro === f
                  ? "bg-emerald-600 text-white shadow"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {STATUS_SUGESTAO_LABEL[f] || "Todos"}
            </button>
          ))}
        </div>

        <ModalBody className="p-5 space-y-3 bg-muted/20">
          {loading ? (
            <div className="text-center py-16 text-muted-foreground animate-pulse flex flex-col items-center gap-3">
              <RefreshCw size={20} className="animate-spin" /> Carregando...
            </div>
          ) : itens.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70 italic text-sm">
              Nenhuma sugestão nesse status.
            </div>
          ) : (
            itens.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-border bg-card space-y-3"
              >
                {editandoId === item.id ? (
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Título
                    </label>
                    <input
                      value={editTitulo}
                      onChange={(e) => setEditTitulo(e.target.value)}
                      className="w-full h-9 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                    />
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Link
                    </label>
                    <input
                      value={editLink}
                      onChange={(e) => setEditLink(e.target.value)}
                      className="w-full h-9 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50"
                    />
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => setEditandoId(null)}
                        className="flex-1 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => salvarEdicao(item.id)}
                        disabled={
                          processandoId === item.id ||
                          !editTitulo.trim() ||
                          !editLink.trim()
                        }
                        className="flex-1 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-bold text-foreground">
                            {item.titulo}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${STATUS_SUGESTAO_COR[item.status] || ""}`}
                          >
                            {STATUS_SUGESTAO_LABEL[item.status] || item.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.tipo === "FILME" ? "Filme" : "Série"} ·{" "}
                          {item.servidor} · {item.total_pedidos} pedido
                          {item.total_pedidos !== 1 ? "s" : ""}
                          {item.categoria_adicionada &&
                            ` · Categoria: ${item.categoria_adicionada}`}
                        </div>
                        {item.motivo_rejeicao && (
                          <div className="text-xs text-rose-500 mt-1">
                            Motivo: {item.motivo_rejeicao}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-sky-500 hover:text-sky-400 underline"
                        >
                          Ver link
                        </a>
                        <button
                          onClick={() => copiarLink(item.id, item.link)}
                          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                        >
                          {copiadoId === item.id ? "Copiado ✓" : "Copiar link"}
                        </button>
                      </div>
                    </div>

                    {/* Quem pediu — pra alinhar no WhatsApp se precisar */}
                    {item.solicitantes.length > 0 && (
                      <div className="pt-2 border-t border-border/60">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                          Pedido por
                        </div>
                        <div className="flex flex-col gap-1">
                          {item.solicitantes.map((s) => (
                            <div
                              key={s.client_id}
                              className="text-xs text-foreground/80 flex items-center gap-2 flex-wrap"
                            >
                              <span className="font-semibold">{s.nome}</span>
                              <span className="text-muted-foreground">
                                @{s.username}
                              </span>
                              {s.whatsapp && (
                                <a
                                  href={`https://wa.me/${s.whatsapp.replace(/\D/g, "")}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-emerald-500 hover:text-emerald-400 font-medium"
                                >
                                  WhatsApp
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {rejeitandoId === item.id ? (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <textarea
                      value={motivoRejeicao}
                      onChange={(e) => setMotivoRejeicao(e.target.value)}
                      placeholder="Explique o motivo da rejeição (o cliente verá isso)..."
                      className="w-full bg-transparent border border-border rounded-lg p-2.5 text-sm text-foreground outline-none focus:border-rose-500/50 resize-none min-h-[70px]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setRejeitandoId(null);
                          setMotivoRejeicao("");
                        }}
                        className="flex-1 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() =>
                          atualizarStatus(item.id, "REJEITADO", {
                            motivo_rejeicao: motivoRejeicao,
                          })
                        }
                        disabled={
                          processandoId === item.id || !motivoRejeicao.trim()
                        }
                        className="flex-1 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50"
                      >
                        Confirmar Rejeição
                      </button>
                    </div>
                  </div>
                ) : excluindoId === item.id ? (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <p className="text-xs text-rose-500 font-medium">
                      Excluir esta sugestão permanentemente? Isso não pode ser
                      desfeito.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExcluindoId(null)}
                        className="flex-1 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => excluir(item.id)}
                        disabled={processandoId === item.id}
                        className="flex-1 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50"
                      >
                        Excluir Definitivamente
                      </button>
                    </div>
                  </div>
                ) : (
                  editandoId !== item.id && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border/60">
                      {item.status !== "ENVIADO_SUPORTE" && (
                        <button
                          onClick={() =>
                            atualizarStatus(item.id, "ENVIADO_SUPORTE")
                          }
                          disabled={processandoId === item.id}
                          className="h-8 px-3 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-500 border border-sky-500/20 text-xs font-semibold disabled:opacity-50"
                        >
                          Marcar Enviado ao Suporte
                        </button>
                      )}
                      {item.status !== "ADICIONADO" && (
                        <button
                          onClick={() => atualizarStatus(item.id, "ADICIONADO")}
                          disabled={processandoId === item.id}
                          className="h-8 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 text-xs font-semibold disabled:opacity-50"
                        >
                          Marcar Adicionado
                        </button>
                      )}
                      {item.status !== "REJEITADO" && (
                        <button
                          onClick={() => setRejeitandoId(item.id)}
                          disabled={processandoId === item.id}
                          className="h-8 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 text-xs font-semibold disabled:opacity-50"
                        >
                          Rejeitar
                        </button>
                      )}
                      <button
                        onClick={() => iniciarEdicao(item)}
                        disabled={processandoId === item.id}
                        className="h-8 px-3 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20 text-xs font-semibold disabled:opacity-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setExcluindoId(item.id)}
                        disabled={processandoId === item.id}
                        className="h-8 px-3 rounded-lg bg-muted hover:bg-muted/70 text-muted-foreground border border-border text-xs font-semibold disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    </div>
                  )
                )}
              </div>
            ))
          )}
        </ModalBody>
    </Modal>
  );
}
