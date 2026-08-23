"use client";
// app/admin/settings/condominio/edicoes/nova/page.tsx
// Monta uma Edição: escolhe Ações, agrupadas automaticamente por status
// (concluído primeiro, igual protótipo local), reordena os GRUPOS com
// setas ▲▼ (lista curta, arrastar não compensa) e os ITENS dentro de cada
// grupo com drag-and-drop (@dnd-kit — pedido do Márcio, "não quero ficar
// clicando em cada seta"). Pré-visualiza/gera PDF via VM (serviço
// Puppeteer) e salva como rascunho em condominio_edicoes.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GripVertical, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import {
  STATUS_COR,
  STATUS_ORDEM,
  type AcaoRow,
  type CondominioRow,
  type StatusAcao,
} from "../../shared";

type ItemSelecionado = {
  acaoId: string;
  titulo: string;
  categoria: string;
  texto: string | null;
  status: StatusAcao;
  fotos: { url: string; legenda: string }[];
};

type Grupo = { status: StatusAcao; itens: ItemSelecionado[] };

function toItemSelecionado(a: AcaoRow): ItemSelecionado {
  return {
    acaoId: a.id,
    titulo: a.titulo,
    categoria: a.categoria,
    texto: a.texto,
    status: a.status,
    fotos: a.fotos || [],
  };
}

function calcPeriodoChave(tipo: "semanal" | "mensal", dataISO: string): string {
  const d = new Date(`${dataISO}T12:00:00`);
  if (tipo === "mensal") {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `mensal:${y}-${m}-01`;
  }
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const seg = new Date(d);
  seg.setDate(d.getDate() + diff);
  const y = seg.getFullYear();
  const m = String(seg.getMonth() + 1).padStart(2, "0");
  const dd = String(seg.getDate()).padStart(2, "0");
  return `semanal:${y}-${m}-${dd}`;
}

function hojeISO() {
  return new Date().toISOString().split("T")[0];
}

function SortableItem({ item }: { item: ItemSelecionado }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.acaoId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
        title="Arrastar para reordenar"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-sm text-foreground/90 truncate">{item.titulo}</span>
    </div>
  );
}

export default function NovaEdicaoPage() {
  const tenantId = useTenantId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const condominioId = searchParams.get("condominio");
  const edicaoIdParam = searchParams.get("edicao");
  // ✅ Ponte vinda da tela de Ações ("Criar Edição com essas", depois de
  // marcar várias no checkbox) — lista de ids separados por vírgula.
  const acoesPreSelecionadasParam = searchParams.get("acoes");

  const [condominio, setCondominio] = useState<CondominioRow | null>(null);
  const [acoesDisponiveis, setAcoesDisponiveis] = useState<AcaoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  const [edicaoId, setEdicaoId] = useState<string | null>(edicaoIdParam);
  const [titulo, setTitulo] = useState("Informativo Semanal aos Moradores");
  const [tipo, setTipo] = useState<"semanal" | "mensal">("semanal");
  const [dataReferencia, setDataReferencia] = useState(hojeISO());
  const [introducao, setIntroducao] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [sugestaoIA, setSugestaoIA] = useState<string | null>(null);

  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  // ✅ Coluna esquerda (escolher ações) agrupada por status, igual à página
  // de Ações — abre sempre tudo expandido.
  const [pickerColapsados, setPickerColapsados] = useState<Set<StatusAcao>>(
    new Set(),
  );

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  const selectedIds = useMemo(
    () => new Set(grupos.flatMap((g) => g.itens.map((i) => i.acaoId))),
    [grupos],
  );

  useEffect(() => {
    if (!tenantId || !condominioId) return;
    (async () => {
      setLoading(true);
      try {
        const [resCond, resAcoes] = await Promise.all([
          supabaseBrowser
            .from("condominios")
            .select("*")
            .eq("id", condominioId)
            .eq("tenant_id", tenantId)
            .single(),
          supabaseBrowser
            .from("condominio_acoes")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("condominio_id", condominioId)
            .eq("arquivada", false)
            .order("created_at", { ascending: false }),
        ]);
        if (resCond.error) throw resCond.error;
        if (resAcoes.error) throw resAcoes.error;
        setCondominio(resCond.data);
        setAcoesDisponiveis(resAcoes.data || []);

        if (edicaoIdParam) {
          const { data: edicaoData, error: edicaoErr } = await supabaseBrowser
            .from("condominio_edicoes")
            .select("*")
            .eq("id", edicaoIdParam)
            .eq("tenant_id", tenantId)
            .single();
          if (edicaoErr) throw edicaoErr;
          if (edicaoData) {
            setTitulo(edicaoData.titulo);
            setTipo(edicaoData.tipo);
            setDataReferencia(edicaoData.data_referencia);
            setIntroducao(edicaoData.introducao || "");
            const itensSalvos: ItemSelecionado[] = edicaoData.itens || [];
            const gruposReconstruidos: Grupo[] = [];
            for (const item of itensSalvos) {
              const ultimo = gruposReconstruidos[gruposReconstruidos.length - 1];
              if (ultimo && ultimo.status === item.status) {
                ultimo.itens.push(item);
              } else {
                gruposReconstruidos.push({ status: item.status, itens: [item] });
              }
            }
            setGrupos(gruposReconstruidos);
          }
        } else if (acoesPreSelecionadasParam) {
          const idsPreSelecionados = new Set(
            acoesPreSelecionadasParam.split(",").filter(Boolean),
          );
          const acoesEncontradas = (resAcoes.data || []).filter((a) =>
            idsPreSelecionados.has(a.id),
          );
          const gruposIniciais: Grupo[] = [];
          for (const status of STATUS_ORDEM) {
            const itensDoStatus = acoesEncontradas
              .filter((a) => a.status === status)
              .map(toItemSelecionado);
            if (itensDoStatus.length > 0) {
              gruposIniciais.push({ status, itens: itensDoStatus });
            }
          }
          setGrupos(gruposIniciais);
        }
      } catch (e: any) {
        addToast("error", "Erro ao carregar", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId, condominioId]);

  function toggleAcao(acao: AcaoRow) {
    setGrupos((prev) => {
      const jaSelecionada = prev.some((g) => g.itens.some((i) => i.acaoId === acao.id));
      if (jaSelecionada) {
        return prev
          .map((g) => ({ ...g, itens: g.itens.filter((i) => i.acaoId !== acao.id) }))
          .filter((g) => g.itens.length > 0);
      }
      const item = toItemSelecionado(acao);
      const idxExistente = prev.findIndex((g) => g.status === item.status);
      if (idxExistente >= 0) {
        const novo = [...prev];
        novo[idxExistente] = {
          ...novo[idxExistente],
          itens: [...novo[idxExistente].itens, item],
        };
        return novo;
      }
      // Novo grupo — insere na posição certa da ordem padrão de status.
      const novoGrupo: Grupo = { status: item.status, itens: [item] };
      const posDesejada = STATUS_ORDEM.indexOf(item.status);
      const copia = [...prev, novoGrupo];
      copia.sort(
        (a, b) => STATUS_ORDEM.indexOf(a.status) - STATUS_ORDEM.indexOf(b.status),
      );
      // Mantém a ordem já customizada pelo usuário pros grupos existentes,
      // só encaixa o novo na posição padrão relativa (evita reordenar tudo
      // de novo toda vez que uma ação é marcada).
      const semNovo = prev;
      const antesDoNovo = semNovo.filter(
        (g) => STATUS_ORDEM.indexOf(g.status) < posDesejada,
      );
      const depoisDoNovo = semNovo.filter(
        (g) => STATUS_ORDEM.indexOf(g.status) > posDesejada,
      );
      return [...antesDoNovo, novoGrupo, ...depoisDoNovo];
    });
  }

  function togglePickerColapsado(status: StatusAcao) {
    setPickerColapsados((prev) => {
      const novo = new Set(prev);
      if (novo.has(status)) novo.delete(status);
      else novo.add(status);
      return novo;
    });
  }

  function toggleSelecionarTodasVisiveis() {
    const todasMarcadas =
      acoesFiltradas.length > 0 &&
      acoesFiltradas.every((a) => selectedIds.has(a.id));
    acoesFiltradas.forEach((a) => {
      const marcada = selectedIds.has(a.id);
      if (todasMarcadas && marcada) toggleAcao(a);
      if (!todasMarcadas && !marcada) toggleAcao(a);
    });
  }

  function moverGrupo(idx: number, direcao: -1 | 1) {
    setGrupos((prev) => {
      const alvo = idx + direcao;
      if (alvo < 0 || alvo >= prev.length) return prev;
      const copia = [...prev];
      [copia[idx], copia[alvo]] = [copia[alvo], copia[idx]];
      return copia;
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setGrupos((prev) =>
      prev.map((g) => {
        const oldIndex = g.itens.findIndex((i) => i.acaoId === active.id);
        if (oldIndex === -1) return g;
        const newIndex = g.itens.findIndex((i) => i.acaoId === over.id);
        if (newIndex === -1) return g;
        return { ...g, itens: arrayMove(g.itens, oldIndex, newIndex) };
      }),
    );
  }

  async function handleRevisarIA() {
    if (!introducao.trim()) {
      addToast("error", "Escreva uma introdução antes de pedir a revisão.");
      return;
    }
    setRevisando(true);
    setSugestaoIA(null);
    try {
      const { data: sessionData } = await supabaseBrowser.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/admin/condominio/revisar-texto", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          titulo: "introdução do informativo",
          texto: introducao,
          nomeCondominio: condominio?.nome || "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Falha ao revisar.");
      setSugestaoIA(json.sugestao);
    } catch (e: any) {
      addToast("error", "Erro ao revisar", e.message);
    } finally {
      setRevisando(false);
    }
  }

  const itensFinais = grupos.flatMap((g) => g.itens);
  const periodoChave = calcPeriodoChave(tipo, dataReferencia);

  async function handlePreVisualizar() {
    if (!condominio || itensFinais.length === 0) {
      addToast("error", "Selecione pelo menos uma ação antes de pré-visualizar.");
      return;
    }
    setGerandoPdf(true);
    try {
      const { data: sessionData } = await supabaseBrowser.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/admin/condominio/gerar-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          condominio,
          edicao: { tipo, data_referencia: dataReferencia, versao: 1, introducao },
          itens: itensFinais,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Falha ao gerar PDF.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (e: any) {
      addToast("error", "Erro ao pré-visualizar", e.message);
    } finally {
      setGerandoPdf(false);
    }
  }

  async function handleSalvarRascunho() {
    if (!titulo.trim()) {
      addToast("error", "Título é obrigatório");
      return;
    }
    if (itensFinais.length === 0) {
      addToast("error", "Selecione pelo menos uma ação.");
      return;
    }
    setSalvando(true);
    try {
      const payloadComum = {
        titulo: titulo.trim(),
        tipo,
        data_referencia: dataReferencia,
        periodo_chave: periodoChave,
        introducao: introducao.trim() || null,
        itens: itensFinais,
      };

      if (edicaoId) {
        const { error } = await supabaseBrowser
          .from("condominio_edicoes")
          .update(payloadComum)
          .eq("id", edicaoId)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      } else {
        // Já existe rascunho aberto pra esse período? Sobrescreve (igual
        // protótipo). Senão, cria um novo com a próxima versão do período.
        const { data: rascunhoExistente } = await supabaseBrowser
          .from("condominio_edicoes")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("condominio_id", condominioId)
          .eq("periodo_chave", periodoChave)
          .eq("status", "rascunho")
          .maybeSingle();

        if (rascunhoExistente) {
          const { error } = await supabaseBrowser
            .from("condominio_edicoes")
            .update(payloadComum)
            .eq("id", rascunhoExistente.id);
          if (error) throw error;
          setEdicaoId(rascunhoExistente.id);
        } else {
          const { data: versoesExistentes } = await supabaseBrowser
            .from("condominio_edicoes")
            .select("versao")
            .eq("tenant_id", tenantId)
            .eq("condominio_id", condominioId)
            .eq("periodo_chave", periodoChave)
            .order("versao", { ascending: false })
            .limit(1);
          const proximaVersao = (versoesExistentes?.[0]?.versao || 0) + 1;

          const { data: nova, error } = await supabaseBrowser
            .from("condominio_edicoes")
            .insert({
              tenant_id: tenantId,
              condominio_id: condominioId,
              versao: proximaVersao,
              status: "rascunho",
              ...payloadComum,
            })
            .select("id")
            .single();
          if (error) throw error;
          setEdicaoId(nova.id);
        }
      }

      addToast("success", "Rascunho salvo", titulo);
      router.push("/admin/settings/condominio/edicoes");
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  const acoesFiltradas = acoesDisponiveis.filter((a) =>
    busca.trim()
      ? a.titulo.toLowerCase().includes(busca.trim().toLowerCase())
      : true,
  );

  // ✅ Mesmo agrupamento por status usado na página de Ações.
  const gruposDisponiveis = STATUS_ORDEM.map((status) => ({
    status,
    itens: acoesFiltradas.filter((a) => a.status === status),
  })).filter((g) => g.itens.length > 0);

  if (!condominioId) {
    return (
      <div className="p-12 text-center text-muted-foreground">
        Selecione um condomínio primeiro na tela de{" "}
        <Link href="/admin/settings/condominio" className="text-emerald-500 underline">
          Ações
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-3 sm:px-6 min-h-screen bg-background transition-colors">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
          📰 {edicaoId ? "Editar Edição" : "Nova Edição"}
        </h1>
        <Link
          href="/admin/settings/condominio/edicoes"
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Voltar
        </Link>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Coluna esquerda: escolher ações */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar ações..."
                className="flex-1 h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
              />
              {acoesFiltradas.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelecionarTodasVisiveis}
                  className="h-10 px-3 rounded-lg border border-border bg-transparent text-xs font-medium text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0"
                >
                  {acoesFiltradas.every((a) => selectedIds.has(a.id))
                    ? "Desmarcar todas"
                    : "Selecionar todas"}
                </button>
              )}
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto overscroll-contain custom-scrollbar pr-1">
              {gruposDisponiveis.map((grupo) => {
                const cor = STATUS_COR[grupo.status];
                const colapsado = pickerColapsados.has(grupo.status);
                return (
                  <div key={grupo.status} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cor.bg} ${cor.text} ${cor.border}`}
                        >
                          {cor.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {grupo.itens.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePickerColapsado(grupo.status)}
                        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {colapsado ? "Mostrar mais" : "Ocultar"}
                        <ChevronDown
                          className={`w-3 h-3 transition-transform duration-200 ${colapsado ? "-rotate-90" : ""}`}
                        />
                      </button>
                    </div>

                    {!colapsado && (
                      <div className="space-y-1.5">
                        {grupo.itens.map((a) => {
                          const marcada = selectedIds.has(a.id);
                          return (
                            <label
                              key={a.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                marcada
                                  ? "border-emerald-500/40 bg-emerald-500/5"
                                  : "border-border hover:bg-muted"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={marcada}
                                onChange={() => toggleAcao(a)}
                                className="shrink-0"
                              />
                              <span className="flex-1 text-sm text-foreground/90 truncate">
                                {a.titulo}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {acoesFiltradas.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">
                  Nenhuma ação encontrada.
                </div>
              )}
            </div>
          </div>

          {/* Coluna direita: ordem final + dados da edição */}
          <div className="space-y-4">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="space-y-3">
                {grupos.length === 0 && (
                  <div className="p-6 text-center text-xs text-muted-foreground bg-card rounded-xl border border-dashed border-border">
                    Marque ações à esquerda pra montar a edição.
                  </div>
                )}
                {grupos.map((g, idx) => {
                  const cor = STATUS_COR[g.status];
                  return (
                    <div
                      key={g.status}
                      className="p-3 rounded-xl border border-border bg-card"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cor.bg} ${cor.text} ${cor.border}`}
                        >
                          {cor.label}
                        </span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => moverGrupo(idx, -1)}
                            disabled={idx === 0}
                            className="w-6 h-6 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 flex items-center justify-center"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moverGrupo(idx, 1)}
                            disabled={idx === grupos.length - 1}
                            className="w-6 h-6 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-30 flex items-center justify-center"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <SortableContext
                        items={g.itens.map((i) => i.acaoId)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-1.5">
                          {g.itens.map((item) => (
                            <SortableItem key={item.acaoId} item={item} />
                          ))}
                        </div>
                      </SortableContext>
                    </div>
                  );
                })}
              </div>
            </DndContext>

            <div className="p-4 rounded-xl border border-border bg-card space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Tipo
                  </label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as "semanal" | "mensal")}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50"
                  >
                    <option value="semanal">Semanal</option>
                    <option value="mensal">Mensal</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Data de referência
                  </label>
                  <input
                    type="date"
                    value={dataReferencia}
                    onChange={(e) => setDataReferencia(e.target.value)}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Título
                </label>
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Introdução (opcional)
                  </label>
                  <button
                    type="button"
                    onClick={handleRevisarIA}
                    disabled={revisando || !introducao.trim()}
                    className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400 disabled:opacity-50 transition-colors"
                  >
                    {revisando ? "Revisando..." : "✨ Revisar com IA"}
                  </button>
                </div>
                <textarea
                  value={introducao}
                  onChange={(e) => setIntroducao(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-transparent border border-border rounded-lg text-sm text-foreground/90 outline-none focus:border-emerald-500/50 resize-y"
                />
                {sugestaoIA && (
                  <div className="mt-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                      {sugestaoIA}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIntroducao(sugestaoIA);
                          setSugestaoIA(null);
                        }}
                        className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                      >
                        Usar este texto
                      </button>
                      <button
                        type="button"
                        onClick={() => setSugestaoIA(null)}
                        className="h-8 px-3 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:bg-muted transition-colors"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handlePreVisualizar}
                  disabled={gerandoPdf || itensFinais.length === 0}
                  className="flex-1 h-10 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 text-sm font-medium hover:bg-sky-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {gerandoPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Gerando...
                    </>
                  ) : (
                    "👁 Pré-visualizar PDF"
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleSalvarRascunho}
                  disabled={salvando || itensFinais.length === 0}
                  className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
                >
                  {salvando ? "Salvando..." : "Salvar rascunho"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-[999999]">
        <ToastNotifications
          toasts={toasts}
          removeToast={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        />
      </div>
    </div>
  );
}
