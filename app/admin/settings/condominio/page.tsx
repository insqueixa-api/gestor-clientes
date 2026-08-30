"use client";
// app/admin/settings/condominio/page.tsx
// Página de Ações (notícias) por condomínio — busca + filtro de status +
// seletor de condomínio (com adicionar/editar embutidos, lembra o último
// usado) + grid de Ações do condomínio selecionado. Montar Edições/gerar
// PDF fica em ./edicoes (link no topo).
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Pencil,
  Archive,
  ArchiveRestore,
  Images,
  Newspaper,
  ChevronDown,
  Rss,
  Move,
} from "lucide-react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import CondominioFilterDropdown from "./CondominioFilterDropdown";
import {
  LOCALSTORAGE_KEY,
  STATUS_COR,
  STATUS_ORDEM,
  type CondominioRow,
  type StatusAcao,
  type AcaoRow,
} from "./shared";

const ModalCondominio = dynamic(() => import("./ModalCondominio"), {
  ssr: false,
});
const ModalAcao = dynamic(() => import("./ModalAcao"), { ssr: false });
const CapaEditorModal = dynamic(() => import("./CapaEditorModal"), { ssr: false });

const STATUS_FILTROS: { valor: StatusAcao | "Todos"; label: string }[] = [
  { valor: "Todos", label: "Todos" },
  { valor: "futuro", label: "Futuro" },
  { valor: "planejado", label: "Planejado" },
  { valor: "em_andamento", label: "Em andamento" },
  { valor: "pausado", label: "Pausado" },
  { valor: "concluido", label: "Concluído" },
];

export default function CondominioPage() {
  const tenantId = useTenantId();
  const { confirm } = useConfirm();

  const [condominios, setCondominios] = useState<CondominioRow[]>([]);
  const [loadingCondominios, setLoadingCondominios] = useState(true);
  const [selectedCondominioId, setSelectedCondominioId] = useState<string | null>(
    null,
  );

  // ✅ Traz TODAS as ações (arquivadas e não) do condomínio numa tacada só —
  // "Ver arquivadas" filtra em memória, sem nova ida ao banco.
  const [acoesTodas, setAcoesTodas] = useState<AcaoRow[]>([]);
  const [loadingAcoes, setLoadingAcoes] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusAcao | "Todos">(
    "Todos",
  );
  const [showArchived, setShowArchived] = useState(false);

  const [isModalCondominioOpen, setIsModalCondominioOpen] = useState(false);
  const [editingCondominio, setEditingCondominio] =
    useState<CondominioRow | null>(null);

  const [isModalAcaoOpen, setIsModalAcaoOpen] = useState(false);
  const [editingAcao, setEditingAcao] = useState<AcaoRow | null>(null);
  // ✅ "Ajustar capa" (achado 26/08/2026, pedido do Márcio: arrastar a
  // posição da foto + trocar qual foto é a capa) — ver CapaEditorModal.tsx.
  const [editingCapaFor, setEditingCapaFor] = useState<AcaoRow | null>(null);

  // ✅ Seleção em lote (mexer em várias ações de uma vez, ex: arquivar N) e
  // grupos colapsados (por status) — a página sempre abre com tudo
  // expandido (Set vazio = nada colapsado).
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [gruposColapsados, setGruposColapsados] = useState<Set<StatusAcao>>(
    new Set(),
  );
  const [arquivandoLote, setArquivandoLote] = useState(false);
  const [arquivandoPublicados, setArquivandoPublicados] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => removeToast(id), 5000);
  }
  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // ✅ Otimização (pedido do Márcio: "sem um get após o outro"): antes eram
  // duas idas sequenciais ao banco (condomínios → só depois, já sabendo qual
  // ficou selecionado, as ações) + uma 3ª ida toda vez que "Ver arquivadas"
  // era clicado. Agora é uma chamada só ao RPC get_condominio_page_bundle
  // (docs/sql/condominio_page_bundle_rpc.sql), que já resolve qual
  // condomínio fica selecionado internamente (hint do localStorage) e traz
  // as ações arquivadas e não-arquivadas juntas — "Ver arquivadas" vira
  // filtro em memória, zero rede. Sem SECURITY DEFINER: continua rodando sob
  // a RLS do usuário logado.
  async function fetchBundle(hintId?: string | null) {
    if (!tenantId) return;
    setLoadingCondominios(true);
    setLoadingAcoes(true);
    try {
      const hint =
        hintId !== undefined
          ? hintId
          : selectedCondominioId ||
            (typeof window !== "undefined"
              ? localStorage.getItem(LOCALSTORAGE_KEY)
              : null);
      const { data, error } = await supabaseBrowser.rpc(
        "get_condominio_page_bundle",
        { p_condominio_id_hint: hint },
      );
      if (error) throw error;
      const bundle = data as {
        condominios: CondominioRow[];
        condominio_id: string | null;
        acoes: AcaoRow[];
      };
      setCondominios(bundle.condominios || []);
      setAcoesTodas(bundle.acoes || []);
      setSelectedCondominioId(bundle.condominio_id);
      if (bundle.condominio_id && typeof window !== "undefined") {
        localStorage.setItem(LOCALSTORAGE_KEY, bundle.condominio_id);
      }
    } catch (e: any) {
      addToast("error", "Erro ao carregar", e.message);
    } finally {
      setLoadingCondominios(false);
      setLoadingAcoes(false);
    }
  }

  useEffect(() => {
    fetchBundle();
  }, [tenantId]);

  useEffect(() => {
    setSelecionadas(new Set());
  }, [selectedCondominioId, showArchived]);

  function handleSelectCondominio(id: string) {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCALSTORAGE_KEY, id);
    }
    fetchBundle(id);
  }

  async function handleToggleArquivar(item: AcaoRow) {
    try {
      const { error } = await supabaseBrowser
        .from("condominio_acoes")
        .update({ arquivada: !item.arquivada })
        .eq("id", item.id);
      if (error) throw error;
      addToast(
        "success",
        item.arquivada ? "Ação restaurada" : "Ação arquivada",
        item.titulo,
      );
      fetchBundle(selectedCondominioId);
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    }
  }

  // ✅ "Publicar"/"Despublicar" (achado 26/08/2026, pedido do Márcio) —
  // published_at próprio da Ação, independente de ela entrar em alguma
  // Edição (que já tem seu published_at próprio, sem relação com este).
  async function handleTogglePublicar(item: AcaoRow) {
    try {
      const { error } = await supabaseBrowser
        .from("condominio_acoes")
        .update({ published_at: item.published_at ? null : new Date().toISOString() })
        .eq("id", item.id);
      if (error) throw error;
      addToast(
        "success",
        item.published_at ? "Ação despublicada" : "Ação publicada",
        item.titulo,
      );
      fetchBundle(selectedCondominioId);
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    }
  }

  function toggleSelecionada(id: string) {
    setSelecionadas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function toggleGrupoColapsado(status: StatusAcao) {
    setGruposColapsados((prev) => {
      const novo = new Set(prev);
      if (novo.has(status)) novo.delete(status);
      else novo.add(status);
      return novo;
    });
  }

  async function handleArquivarSelecionadas() {
    if (selecionadas.size === 0) return;
    const ids = Array.from(selecionadas);
    const novoValor = !showArchived; // vendo ativas → arquiva; vendo arquivadas → restaura
    setArquivandoLote(true);
    try {
      const { error } = await supabaseBrowser
        .from("condominio_acoes")
        .update({ arquivada: novoValor })
        .in("id", ids);
      if (error) throw error;
      addToast(
        "success",
        novoValor
          ? `${ids.length} ação(ões) arquivada(s)`
          : `${ids.length} ação(ões) restaurada(s)`,
      );
      setSelecionadas(new Set());
      fetchBundle(selectedCondominioId);
    } catch (e: any) {
      addToast("error", "Erro ao atualizar em lote", e.message);
    } finally {
      setArquivandoLote(false);
    }
  }

  // ✅ 30/08/2026, pedido do Márcio: "Publicar" (na tela de Edições) fica só
  // publicando — arquivar é uma ação à parte, aqui, e só pega Ações
  // "Concluído" que JÁ apareceram em alguma edição publicada (não arquiva
  // concluído que ainda nem foi publicado nenhuma vez).
  async function handleArquivarPublicados() {
    if (!selectedCondominioId || !tenantId) return;
    setArquivandoPublicados(true);
    try {
      const { data: edicoesPublicadas, error: edErr } = await supabaseBrowser
        .from("condominio_edicoes")
        .select("itens")
        .eq("tenant_id", tenantId)
        .eq("condominio_id", selectedCondominioId)
        .eq("status", "publicado");
      if (edErr) throw edErr;

      const idsPublicados = new Set<string>();
      for (const edicao of edicoesPublicadas || []) {
        for (const item of (edicao.itens as { acaoId?: string }[]) || []) {
          if (item.acaoId) idsPublicados.add(item.acaoId);
        }
      }

      const alvo = acoesTodas.filter(
        (a) => !a.arquivada && a.status === "concluido" && idsPublicados.has(a.id),
      );

      if (alvo.length === 0) {
        addToast("success", "Nada pra arquivar", "Nenhuma ação concluída já publicada está pendente.");
        return;
      }

      const ok = await confirm({
        title: "Arquivar ações publicadas?",
        subtitle: `${alvo.length} ação(ões) concluída(s) já apareceu(ram) numa edição publicada — arquivar tira elas da lista de disponíveis pra novas edições.`,
        tone: "amber",
        confirmText: "Arquivar",
        cancelText: "Cancelar",
      });
      if (!ok) return;

      const { error } = await supabaseBrowser
        .from("condominio_acoes")
        .update({ arquivada: true })
        .in("id", alvo.map((a) => a.id));
      if (error) throw error;

      addToast("success", `${alvo.length} ação(ões) arquivada(s)`);
      fetchBundle(selectedCondominioId);
    } catch (e: any) {
      addToast("error", "Erro ao arquivar publicados", e.message);
    } finally {
      setArquivandoPublicados(false);
    }
  }

  const selectedCondominio = condominios.find(
    (c) => c.id === selectedCondominioId,
  );

  const tituloPaginaModo = selectedCondominio?.titulo_pagina || "logo_nome";
  const condominioTemLogo = !!selectedCondominio?.logo_url;
  const tituloPaginaEfetivo =
    tituloPaginaModo === "logo" && !condominioTemLogo ? "nome" : tituloPaginaModo;
  const exibirLogo = tituloPaginaEfetivo !== "nome" && condominioTemLogo;
  const exibirIconePlaceholder =
    tituloPaginaEfetivo === "logo_nome" && !condominioTemLogo;
  const exibirNomeCondominio = tituloPaginaEfetivo !== "logo";

  const acoesFiltradas = acoesTodas.filter((a) => {
    if (a.arquivada !== showArchived) return false;
    if (statusFilter !== "Todos" && a.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (
        !a.titulo.toLowerCase().includes(q) &&
        !(a.texto || "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  // ✅ Agrupada por status (concluído primeiro, igual ordem usada no PDF/
  // Edições) em vez de uma lista só misturada.
  const gruposAcoes = STATUS_ORDEM.map((status) => ({
    status,
    itens: acoesFiltradas.filter((a) => a.status === status),
  })).filter((g) => g.itens.length > 0);

  return (
    <div className="space-y-6 pt-0 pb-6 px-3 sm:px-6 min-h-screen bg-background transition-colors">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2 min-w-0">
          {exibirLogo && (
            <img
              src={selectedCondominio!.logo_url!}
              alt={selectedCondominio!.nome}
              className="h-9 w-auto max-w-[200px] object-contain shrink-0"
            />
          )}
          {exibirIconePlaceholder && <span>🏢</span>}
          {exibirNomeCondominio && (
            <span className="truncate">
              {selectedCondominio?.nome || "Condomínio"}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/settings/condominio/edicoes"
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg border border-border text-foreground/80 hover:bg-muted font-medium text-xs md:text-sm flex items-center gap-2 transition-all"
          >
            <Newspaper className="w-4 h-4" /> Edições
          </Link>
          <button
            onClick={() => {
              setEditingAcao(null);
              setIsModalAcaoOpen(true);
            }}
            disabled={!selectedCondominioId}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50"
          >
            <span>+</span> Nova Ação
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ações por título ou texto..."
            className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusAcao | "Todos")}
          className="h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50"
        >
          {STATUS_FILTROS.map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.label}
            </option>
          ))}
        </select>

        <CondominioFilterDropdown
          condominios={condominios}
          selectedId={selectedCondominioId}
          onSelect={handleSelectCondominio}
          onEdit={(item) => {
            setEditingCondominio(item);
            setIsModalCondominioOpen(true);
          }}
          onAddNew={() => {
            setEditingCondominio(null);
            setIsModalCondominioOpen(true);
          }}
        />

        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`h-10 px-3 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
            showArchived
              ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
              : "border-border bg-transparent text-muted-foreground"
          }`}
        >
          {showArchived ? "🗄 Vendo arquivadas" : "🗄 Ver arquivadas"}
        </button>

        {!showArchived && (
          <button
            onClick={handleArquivarPublicados}
            disabled={arquivandoPublicados || !selectedCondominioId}
            title="Arquiva as Ações concluídas que já saíram numa edição publicada"
            className="h-10 px-3 rounded-lg border border-border bg-transparent text-muted-foreground text-xs font-medium hover:bg-muted transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {arquivandoPublicados ? "Arquivando..." : "🗄 Arquivar publicados"}
          </button>
        )}
      </div>

      {selecionadas.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex-wrap">
          <span className="text-sm font-medium text-foreground/90">
            {selecionadas.size} selecionada{selecionadas.size > 1 ? "s" : ""}
          </span>
          {acoesFiltradas.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setSelecionadas(
                  selecionadas.size === acoesFiltradas.length
                    ? new Set()
                    : new Set(acoesFiltradas.map((a) => a.id)),
                )
              }
              className="h-8 px-3 rounded-lg border border-border bg-transparent text-xs font-medium text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap"
            >
              {selecionadas.size === acoesFiltradas.length
                ? "Desmarcar todas"
                : "Selecionar todas"}
            </button>
          )}
          {!showArchived && (
            <Link
              href={`/admin/settings/condominio/edicoes/nova?condominio=${selectedCondominioId}&acoes=${Array.from(selecionadas).join(",")}`}
              className="h-8 px-3 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 text-xs font-bold hover:bg-sky-500/20 transition-colors flex items-center gap-1.5"
            >
              <Newspaper className="w-3.5 h-3.5" /> Criar Edição com essas
            </Link>
          )}
          <button
            type="button"
            onClick={handleArquivarSelecionadas}
            disabled={arquivandoLote}
            className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {arquivandoLote
              ? "Processando..."
              : showArchived
                ? "Restaurar selecionadas"
                : "Arquivar selecionadas"}
          </button>
          <button
            type="button"
            onClick={() => setSelecionadas(new Set())}
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancelar seleção
          </button>
        </div>
      )}

      {!loadingCondominios && condominios.length === 0 && (
        <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
          Nenhum condomínio cadastrado ainda — use o filtro acima para
          adicionar o primeiro.
        </div>
      )}

      {selectedCondominioId && loadingAcoes && (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando ações...
        </div>
      )}

      {selectedCondominioId && !loadingAcoes && acoesFiltradas.length === 0 && (
        <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
          {showArchived
            ? "Nenhuma ação arquivada."
            : "Nenhuma ação encontrada para este condomínio."}
        </div>
      )}

      {selectedCondominioId &&
        !loadingAcoes &&
        gruposAcoes.map((grupo) => {
          const cor = STATUS_COR[grupo.status];
          const colapsado = gruposColapsados.has(grupo.status);
          return (
            <div key={grupo.status} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${cor.bg} ${cor.text} ${cor.border}`}
                  >
                    {cor.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {grupo.itens.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGrupoColapsado(grupo.status)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {colapsado ? "Mostrar mais" : "Ocultar"}
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${colapsado ? "-rotate-90" : ""}`}
                  />
                </button>
              </div>

              {!colapsado && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-5">
                  {grupo.itens.map((item) => {
                    const capa = item.fotos?.[0];
                    const marcada = selecionadas.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl overflow-hidden shadow-sm border bg-card transition-all ${
                          marcada
                            ? "border-emerald-500/50 ring-1 ring-emerald-500/30"
                            : item.arquivada
                              ? "border-amber-500/30 opacity-75"
                              : "border-border hover:border-emerald-500/30"
                        }`}
                      >
                        {capa && (
                          <img
                            src={capa.url}
                            alt={item.titulo}
                            // ✅ posY ajustável por foto (achado 26/08/2026,
                            // pedido do Márcio — botão "Ajustar capa" mais
                            // abaixo, CapaEditorModal.tsx). Sem posY salvo
                            // ainda, cai pro mesmo padrão "mais pro topo" de
                            // antes (20%), não mais o center/center puro que
                            // cortava cabeça.
                            className="w-full h-36 object-cover"
                            style={{ objectPosition: `center ${capa.posY ?? 20}%` }}
                          />
                        )}
                        <div className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <label className="flex items-start gap-2 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={marcada}
                                onChange={() => toggleSelecionada(item.id)}
                                className="mt-0.5 shrink-0"
                              />
                              <h2
                                className="text-sm font-medium text-foreground/90 tracking-tight line-clamp-2"
                                title={item.titulo}
                              >
                                {item.titulo}
                              </h2>
                            </label>
                            <div className="flex gap-1 shrink-0">
                              <button
                                type="button"
                                title="Editar"
                                onClick={() => {
                                  setEditingAcao(item);
                                  setIsModalAcaoOpen(true);
                                }}
                                className="w-7 h-7 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 flex items-center justify-center transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {item.fotos?.length > 0 && (
                                <button
                                  type="button"
                                  title="Ajustar capa"
                                  onClick={() => setEditingCapaFor(item)}
                                  className="w-7 h-7 rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 flex items-center justify-center transition-colors"
                                >
                                  <Move className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                title={item.published_at ? "Despublicar" : "Publicar"}
                                onClick={() => handleTogglePublicar(item)}
                                className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                                  item.published_at
                                    ? "border-sky-500/20 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20"
                                    : "border-border text-muted-foreground hover:bg-muted"
                                }`}
                              >
                                <Rss className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title={item.arquivada ? "Restaurar" : "Arquivar"}
                                onClick={() => handleToggleArquivar(item)}
                                className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                                  item.arquivada
                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                                    : "border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                                }`}
                              >
                                {item.arquivada ? (
                                  <ArchiveRestore className="w-3.5 h-3.5" />
                                ) : (
                                  <Archive className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-muted-foreground capitalize">
                              {item.categoria}
                            </span>
                            {item.fotos?.length > 1 && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Images className="w-3 h-3" /> {item.fotos.length}
                              </span>
                            )}
                          </div>

                          {item.texto && (
                            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                              {item.texto}
                            </p>
                          )}

                          {/* ✅ Datas de criação/atualização/publicação
                              (achado 26/08/2026, pedido do Márcio) —
                              published_at é próprio da Ação (botão Rss
                              acima), independente de ela entrar em alguma
                              Edição (que tem seu próprio published_at). */}
                          <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                            <span title={new Date(item.created_at).toLocaleString("pt-BR")}>
                              Criado: {new Date(item.created_at).toLocaleDateString("pt-BR")}
                            </span>
                            {item.updated_at && item.updated_at !== item.created_at && (
                              <span title={new Date(item.updated_at).toLocaleString("pt-BR")}>
                                · Atualizado: {new Date(item.updated_at).toLocaleDateString("pt-BR")}
                              </span>
                            )}
                            {item.published_at && (
                              <span
                                className="text-sky-500 font-medium"
                                title={new Date(item.published_at).toLocaleString("pt-BR")}
                              >
                                · Publicado: {new Date(item.published_at).toLocaleDateString("pt-BR")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

      {isModalCondominioOpen && (
        <ModalCondominio
          condominio={editingCondominio}
          onClose={() => setIsModalCondominioOpen(false)}
          onSuccess={() => {
            setIsModalCondominioOpen(false);
            addToast(
              "success",
              editingCondominio ? "Condomínio atualizado" : "Condomínio criado",
              editingCondominio?.nome,
            );
            fetchBundle(selectedCondominioId);
          }}
          onError={(msg) => addToast("error", "Erro ao salvar", msg)}
        />
      )}

      {isModalAcaoOpen && selectedCondominioId && (
        <ModalAcao
          acao={editingAcao}
          condominioId={selectedCondominioId}
          condominioNome={selectedCondominio?.nome || ""}
          onClose={() => setIsModalAcaoOpen(false)}
          onSuccess={() => {
            setIsModalAcaoOpen(false);
            addToast(
              "success",
              editingAcao ? "Ação atualizada" : "Ação criada",
              editingAcao?.titulo,
            );
            fetchBundle(selectedCondominioId);
          }}
          onError={(msg) => addToast("error", "Erro ao salvar", msg)}
        />
      )}

      {editingCapaFor && tenantId && (
        <CapaEditorModal
          acao={editingCapaFor}
          tenantId={tenantId}
          onClose={() => setEditingCapaFor(null)}
          onSaved={() => {
            setEditingCapaFor(null);
            addToast("success", "Capa atualizada", editingCapaFor.titulo);
            fetchBundle(selectedCondominioId);
          }}
          onError={(msg) => addToast("error", "Erro ao salvar", msg)}
        />
      )}

      <div className="relative z-[999999]">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
      </div>
    </div>
  );
}
