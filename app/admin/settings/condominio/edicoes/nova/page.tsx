"use client";
// app/admin/settings/condominio/edicoes/nova/page.tsx
// ✅ 30/08/2026, 3ª rodada da refatoração grande pedida pelo Márcio: essa
// tela É a "página principal" (formato do jornal) — os cards ficam
// idênticos aos da lista de Ações (foto, título, categoria, texto), com os
// MESMOS botões de editar/ajustar capa (pra corrigir posição da foto, trocar
// foto ou texto sem ter que voltar pra lista de Ações e perder a seleção).
// Fixo em 2 por linha no computador, 1 no celular. Arrasta pra reordenar
// dentro do próprio status (@dnd-kit) — a ordem inicial é por categoria, mas
// o Márcio pode sobrescrever arrastando.
// "Pré-visualizar" NÃO troca de tela — só oculta (não remove) as ações não
// marcadas, mantendo o mesmo layout: é literalmente a prévia do que vai
// pro PDF. O PDF em si (chamada à VM) só roda ao clicar em "Baixar PDF" —
// e só de novo se o conteúdo mudou desde a última vez.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { GripVertical, ChevronDown, Images, Loader2, Pencil, Move } from "lucide-react";
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
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import {
  STATUS_COR,
  STATUS_ORDEM,
  nomeArquivoPdf,
  type AcaoRow,
  type CondominioRow,
  type StatusAcao,
} from "../../shared";

const ModalAcao = dynamic(() => import("../../ModalAcao"), { ssr: false });
const CapaEditorModal = dynamic(() => import("../../CapaEditorModal"), { ssr: false });

type ItemSelecionado = {
  acaoId: string;
  titulo: string;
  categoria: string;
  texto: string | null;
  status: StatusAcao;
  // ✅ posY incluído (30/08/2026) — antes o tipo omitia esse campo mesmo ele
  // passando por baixo (spread de AcaoRow.fotos, que já tem posY) até o PDF;
  // TS não pegava, mas um refactor futuro que confiasse nesse tipo pra
  // reconstruir o array (ex: `.map(f => ({url, legenda}))`) apagaria o
  // posY sem erro nenhum. Tipo agora reflete o que de fato trafega.
  fotos: { url: string; legenda: string; posY?: number }[];
};

// ✅ Cada grupo (status) guarda TODAS as ações desse status, marcadas ou
// não — a ordem do array É a ordem de exibição (arrastável), e "prévia" só
// filtra visualmente por `selecionada`, nunca mexe na ordem/estrutura.
type ItemGrupo = { acao: AcaoRow; selecionada: boolean };
type Grupo = { status: StatusAcao; itens: ItemGrupo[] };

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

// ✅ Ordem inicial: se é uma edição já salva, respeita a ordem que já
// estava lá (o Márcio pode ter arrastado antes); ações novas (fora do
// itensSalvos) entram ordenadas por categoria, no fim do respectivo status.
// Edição nova (sem itensSalvos): tudo ordenado por categoria, marcado
// conforme `preSelecionados` (ponte vinda da tela de Ações) se houver.
function construirGrupos(
  acoes: AcaoRow[],
  itensSalvos: ItemSelecionado[] | null,
  preSelecionados?: Set<string> | null,
): Grupo[] {
  const idsOrdem = itensSalvos ? itensSalvos.map((i) => i.acaoId) : [];
  const posSalva = new Map(idsOrdem.map((id, idx) => [id, idx]));
  const selecionadoSet = itensSalvos ? new Set(idsOrdem) : preSelecionados || new Set<string>();

  return STATUS_ORDEM.map((status) => {
    const doStatus = acoes.filter((a) => a.status === status);
    doStatus.sort((a, b) => {
      const pa = posSalva.has(a.id) ? (posSalva.get(a.id) as number) : Infinity;
      const pb = posSalva.has(b.id) ? (posSalva.get(b.id) as number) : Infinity;
      if (pa !== pb) return pa - pb;
      return a.categoria.localeCompare(b.categoria, "pt-BR");
    });
    return {
      status,
      itens: doStatus.map((acao) => ({ acao, selecionada: selecionadoSet.has(acao.id) })),
    };
  }).filter((g) => g.itens.length > 0);
}

// ✅ Depois de editar uma Ação (ou ajustar a capa) direto nessa tela, busca
// os dados frescos e reconstrói `grupos` reaproveitando a ordem/seleção
// atual (não é um reload da página) — se o status mudou no ModalAcao, o
// item migra pro grupo novo sozinho (mesma lógica de ordenação por posição
// prévia + categoria do construirGrupos acima).
function mesclarAcoesAtualizadas(acoesNovas: AcaoRow[], gruposAtuais: Grupo[]): Grupo[] {
  const posMap = new Map<string, number>();
  const selMap = new Map<string, boolean>();
  let idx = 0;
  gruposAtuais.forEach((g) =>
    g.itens.forEach((i) => {
      posMap.set(i.acao.id, idx++);
      selMap.set(i.acao.id, i.selecionada);
    }),
  );
  return STATUS_ORDEM.map((status) => {
    const doStatus = acoesNovas.filter((a) => a.status === status);
    doStatus.sort((a, b) => {
      const pa = posMap.has(a.id) ? (posMap.get(a.id) as number) : Infinity;
      const pb = posMap.has(b.id) ? (posMap.get(b.id) as number) : Infinity;
      if (pa !== pb) return pa - pb;
      return a.categoria.localeCompare(b.categoria, "pt-BR");
    });
    return {
      status,
      itens: doStatus.map((acao) => ({ acao, selecionada: selMap.get(acao.id) ?? false })),
    };
  }).filter((g) => g.itens.length > 0);
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

// ✅ Card idêntico ao da lista de Ações (page.tsx: foto, checkbox+título,
// categoria, contagem de fotos, texto) — inclusive os botões de Editar e
// Ajustar capa (pedido do Márcio: corrigir posição da foto/foto/texto sem
// ter que voltar pra lista de Ações e perder a seleção/ordem daqui). Só o
// Publicar/Arquivar da Ação (que é outra coisa, própria da Ação) fica de
// fora — não faz sentido aqui.
function GrupoCard({
  item,
  onToggle,
  onEditar,
  onAjustarCapa,
}: {
  item: ItemGrupo;
  onToggle: () => void;
  onEditar: () => void;
  onAjustarCapa: () => void;
}) {
  const { acao } = item;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: acao.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const capa = acao.fotos?.[0];
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl overflow-hidden shadow-sm border bg-card transition-colors ${
        item.selecionada
          ? "border-emerald-500/50 ring-1 ring-emerald-500/30"
          : "border-border"
      }`}
    >
      {capa ? (
        <img
          src={capa.url}
          alt={acao.titulo}
          className="w-full h-36 object-cover"
          style={{ objectPosition: `center ${capa.posY ?? 20}%` }}
        />
      ) : (
        <div className="w-full h-36 bg-muted" />
      )}
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <label className="flex items-start gap-2 min-w-0 cursor-pointer">
            <input
              type="checkbox"
              checked={item.selecionada}
              onChange={onToggle}
              className="mt-0.5 shrink-0"
            />
            <h2
              className="text-sm font-medium text-foreground/90 tracking-tight line-clamp-2"
              title={acao.titulo}
            >
              {acao.titulo}
            </h2>
          </label>
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              title="Editar"
              onClick={onEditar}
              className="w-7 h-7 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 flex items-center justify-center transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {acao.fotos?.length > 0 && (
              <button
                type="button"
                title="Ajustar capa"
                onClick={onAjustarCapa}
                className="w-7 h-7 rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 flex items-center justify-center transition-colors"
              >
                <Move className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              {...attributes}
              {...listeners}
              title="Arrastar para reordenar"
              className="w-7 h-7 rounded-lg text-muted-foreground hover:bg-muted cursor-grab active:cursor-grabbing touch-none flex items-center justify-center transition-colors"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground capitalize">
            {acao.categoria}
          </span>
          {acao.fotos?.length > 1 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Images className="w-3 h-3" /> {acao.fotos.length}
            </span>
          )}
        </div>

        {acao.texto && (
          <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
            {acao.texto}
          </p>
        )}
      </div>
    </div>
  );
}

function GrupoSecao({
  grupo,
  soSelecionados,
  busca,
  colapsado,
  sensors,
  onToggleColapsado,
  onToggleTodos,
  onToggleItem,
  onDragEnd,
  onEditar,
  onAjustarCapa,
}: {
  grupo: Grupo;
  soSelecionados: boolean;
  busca: string;
  colapsado: boolean;
  sensors: ReturnType<typeof useSensors>;
  onToggleColapsado: () => void;
  onToggleTodos: () => void;
  onToggleItem: (acaoId: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onEditar: (acao: AcaoRow) => void;
  onAjustarCapa: (acao: AcaoRow) => void;
}) {
  const termo = busca.trim().toLowerCase();
  const visiveis = grupo.itens.filter((i) => {
    if (soSelecionados && !i.selecionada) return false;
    if (termo && !i.acao.titulo.toLowerCase().includes(termo)) return false;
    return true;
  });
  if (visiveis.length === 0) return null;

  const cor = STATUS_COR[grupo.status];
  const todasMarcadas = grupo.itens.every((i) => i.selecionada);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={todasMarcadas}
            onChange={onToggleTodos}
            title="Selecionar todos deste status"
            className="shrink-0"
          />
          <span
            className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${cor.bg} ${cor.text} ${cor.border}`}
          >
            {cor.label}
          </span>
          <span className="text-xs text-muted-foreground">{visiveis.length}</span>
        </div>
        <button
          type="button"
          onClick={onToggleColapsado}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {colapsado ? "Mostrar mais" : "Ocultar"}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${colapsado ? "-rotate-90" : ""}`}
          />
        </button>
      </div>

      {!colapsado && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visiveis.map((i) => i.acao.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">
              {visiveis.map((item) => (
                <GrupoCard
                  key={item.acao.id}
                  item={item}
                  onToggle={() => onToggleItem(item.acao.id)}
                  onEditar={() => onEditar(item.acao)}
                  onAjustarCapa={() => onAjustarCapa(item.acao)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

export default function NovaEdicaoPage() {
  const tenantId = useTenantId();
  const router = useRouter();
  const { confirm } = useConfirm();
  const searchParams = useSearchParams();
  const condominioId = searchParams.get("condominio");
  const edicaoIdParam = searchParams.get("edicao");
  // ✅ Ponte vinda da tela de Ações ("Criar Edição com essas", depois de
  // marcar várias no checkbox) — lista de ids separados por vírgula.
  const acoesPreSelecionadasParam = searchParams.get("acoes");

  const [condominio, setCondominio] = useState<CondominioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  const [edicaoId, setEdicaoId] = useState<string | null>(edicaoIdParam);
  const [titulo, setTitulo] = useState("Informativo Semanal aos Moradores");
  const [tipo, setTipo] = useState<"semanal" | "mensal">("semanal");
  const [dataReferencia, setDataReferencia] = useState(hojeISO());
  // ✅ Achado 26/08/2026 (Márcio: "a prévia gerada, o nome do arquivo vem
  // todo errado") — a prévia sempre mandava `versao: 1` fixo pro gerador de
  // PDF, então o nome sugerido pelo navegador (vem do <title> do PDF, ver
  // shared.ts/nomeArquivoPdf) sempre dizia "v001", mesmo editando uma edição
  // que já era v002/v003. `versaoExistente` (carregada 1x, se estiver
  // editando uma edição já salva) vs. calculada na hora (edição nova, ver
  // `versao` useMemo abaixo, a partir de `edicoesExistentes` já em memória
  // — sem NENHUMA chamada nova ao Supabase quando tipo/data mudam).
  const [versaoExistente, setVersaoExistente] = useState<number | null>(null);
  const [edicoesExistentes, setEdicoesExistentes] = useState<
    { id: string; periodo_chave: string; versao: number }[]
  >([]);
  // ✅ O PDF só é gerado (e sobe pro R2) quando clica em "Baixar PDF" — não
  // mais em "Pré-visualizar" (que agora só oculta as não marcadas, sem
  // chamar a VM). Gerar de novo (depois de editar) troca o arquivo: apaga o
  // antigo do R2 antes de subir o novo.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // ✅ "Foto" do conteúdo no momento em que pdfUrl foi gerado — compara com
  // o conteúdo atual pra saber se ficou desatualizado (editou/reordenou
  // algo depois de gerar o PDF) sem precisar de efeito/ordem de render
  // nenhuma, só um valor calculado direto no render.
  const [pdfSnapshot, setPdfSnapshot] = useState<string | null>(null);
  const [introducao, setIntroducao] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [sugestaoIA, setSugestaoIA] = useState<string | null>(null);

  const [grupos, setGrupos] = useState<Grupo[]>([]);
  // ✅ "Prévia" não é uma tela diferente — só oculta (via CSS/filtro, não
  // remove) as ações não marcadas, mantendo o mesmo layout de 2 por linha.
  const [soSelecionados, setSoSelecionados] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [colapsados, setColapsados] = useState<Set<StatusAcao>>(new Set());

  const [editingAcao, setEditingAcao] = useState<AcaoRow | null>(null);
  const [isModalAcaoOpen, setIsModalAcaoOpen] = useState(false);
  // ✅ "Ajustar capa" (mesmo componente da lista de Ações — CapaEditorModal).
  const [editingCapaFor, setEditingCapaFor] = useState<AcaoRow | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  // ✅ 30/08/2026 — mesma proteção contra bfcache do lado da lista de Ações:
  // se essa tela for restaurada do cache do navegador (botão Voltar/Avançar
  // depois de sair pra outra página), força um reload completo em vez de
  // reaproveitar seleção/versão/pdfUrl antigos que podem já não bater mais
  // com o banco.
  useEffect(() => {
    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted) window.location.reload();
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  useEffect(() => {
    if (!tenantId || !condominioId) return;
    (async () => {
      setLoading(true);
      try {
        // ✅ Achado 26/08/2026 (pedido do Márcio: "manter uma chamada única
        // ao Supabase com tudo de uma vez") — as 3 consultas que essa tela
        // sempre precisou (condomínio, ações disponíveis, TODAS as edições
        // já existentes desse condomínio) viram uma única leva paralela.
        const [resCond, resAcoes, resEdicoes] = await Promise.all([
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
          supabaseBrowser
            .from("condominio_edicoes")
            .select("id, periodo_chave, versao, titulo, tipo, data_referencia, introducao, itens, pdf_url")
            .eq("tenant_id", tenantId)
            .eq("condominio_id", condominioId),
        ]);
        if (resCond.error) throw resCond.error;
        if (resAcoes.error) throw resAcoes.error;
        if (resEdicoes.error) throw resEdicoes.error;
        setCondominio(resCond.data);
        setEdicoesExistentes(resEdicoes.data || []);
        const acoes: AcaoRow[] = resAcoes.data || [];

        const edicaoData = edicaoIdParam
          ? (resEdicoes.data || []).find((e: any) => e.id === edicaoIdParam)
          : null;

        if (edicaoData) {
          setTitulo(edicaoData.titulo);
          setTipo(edicaoData.tipo);
          setDataReferencia(edicaoData.data_referencia);
          setIntroducao(edicaoData.introducao || "");
          setVersaoExistente(edicaoData.versao || 1);
          setPdfUrl(edicaoData.pdf_url || null);
          const itensSalvos: ItemSelecionado[] = edicaoData.itens || [];
          setGrupos(construirGrupos(acoes, itensSalvos));
          if (edicaoData.pdf_url) {
            setPdfSnapshot(
              JSON.stringify({
                titulo: edicaoData.titulo,
                tipo: edicaoData.tipo,
                dataReferencia: edicaoData.data_referencia,
                introducao: edicaoData.introducao || "",
                itensFinais: itensSalvos,
              }),
            );
            setSoSelecionados(true);
          }
        } else if (edicaoIdParam) {
          // edicaoIdParam foi passado mas não achamos a linha (id errado,
          // ou de outro condomínio) — mesmo erro que a query antiga
          // (.single()) já dava nesse caso, só que sem precisar de uma 2ª
          // chamada pra descobrir.
          throw new Error("Edição não encontrada para este condomínio.");
        } else if (acoesPreSelecionadasParam) {
          const idsPreSelecionados = new Set(
            acoesPreSelecionadasParam.split(",").filter(Boolean),
          );
          setGrupos(construirGrupos(acoes, null, idsPreSelecionados));
        } else {
          setGrupos(construirGrupos(acoes, null, null));
        }
      } catch (e: any) {
        addToast("error", "Erro ao carregar", e.message);
      } finally {
        setLoading(false);
      }
    })();
    // ✅ Bug real achado 30/08/2026 (Márcio: "seleciono no botão 'Criar
    // Edição com essas' e traz o que não pedi") — faltavam edicaoIdParam e
    // acoesPreSelecionadasParam aqui. Sem eles, clicar em "Criar Edição com
    // essas" de novo com uma seleção nova, estando essa mesma rota já
    // montada (Next.js App Router reaproveita o componente quando só o
    // querystring muda), não recarregava nada — a seleção antiga (de uma
    // visita anterior a essa mesma página) ficava presa em vez de pegar a
    // nova.
  }, [tenantId, condominioId, edicaoIdParam, acoesPreSelecionadasParam]);

  // ✅ Usado depois de editar uma Ação ou ajustar a capa direto nessa tela
  // (ModalAcao/CapaEditorModal abaixo) — busca os dados frescos e reaplica
  // em `grupos` via mesclarAcoesAtualizadas, sem perder seleção/ordem.
  async function recarregarAcoes() {
    if (!tenantId || !condominioId) return;
    const { data, error } = await supabaseBrowser
      .from("condominio_acoes")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", condominioId)
      .eq("arquivada", false)
      .order("created_at", { ascending: false });
    if (error) {
      addToast("error", "Erro ao recarregar ações", error.message);
      return;
    }
    setGrupos((prev) => mesclarAcoesAtualizadas(data || [], prev));
  }

  function toggleSelecionada(status: StatusAcao, acaoId: string) {
    setGrupos((prev) =>
      prev.map((g) =>
        g.status !== status
          ? g
          : {
              ...g,
              itens: g.itens.map((i) =>
                i.acao.id === acaoId ? { ...i, selecionada: !i.selecionada } : i,
              ),
            },
      ),
    );
  }

  function toggleGrupoTodos(status: StatusAcao) {
    setGrupos((prev) =>
      prev.map((g) => {
        if (g.status !== status) return g;
        const todasMarcadas = g.itens.every((i) => i.selecionada);
        return { ...g, itens: g.itens.map((i) => ({ ...i, selecionada: !todasMarcadas })) };
      }),
    );
  }

  function handleDragEnd(status: StatusAcao, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setGrupos((prev) =>
      prev.map((g) => {
        if (g.status !== status) return g;
        const oldIndex = g.itens.findIndex((i) => i.acao.id === active.id);
        const newIndex = g.itens.findIndex((i) => i.acao.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return g;
        return { ...g, itens: arrayMove(g.itens, oldIndex, newIndex) };
      }),
    );
  }

  function toggleColapsado(status: StatusAcao) {
    setColapsados((prev) => {
      const novo = new Set(prev);
      if (novo.has(status)) novo.delete(status);
      else novo.add(status);
      return novo;
    });
  }

  const totalSelecionadas = useMemo(
    () => grupos.reduce((n, g) => n + g.itens.filter((i) => i.selecionada).length, 0),
    [grupos],
  );

  const idsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const ids = new Set<string>();
    grupos.forEach((g) =>
      g.itens.forEach((i) => {
        if (!termo || i.acao.titulo.toLowerCase().includes(termo)) ids.add(i.acao.id);
      }),
    );
    return ids;
  }, [grupos, busca]);

  const todasFiltradasMarcadas = useMemo(() => {
    let algumaVisivel = false;
    for (const g of grupos) {
      for (const i of g.itens) {
        if (!idsFiltrados.has(i.acao.id)) continue;
        algumaVisivel = true;
        if (!i.selecionada) return false;
      }
    }
    return algumaVisivel;
  }, [grupos, idsFiltrados]);

  function toggleSelecionarTodasVisiveis() {
    setGrupos((prev) =>
      prev.map((g) => ({
        ...g,
        itens: g.itens.map((i) =>
          idsFiltrados.has(i.acao.id) ? { ...i, selecionada: !todasFiltradasMarcadas } : i,
        ),
      })),
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

  // ✅ Ordem final = a ordem em que os itens aparecem dentro de cada grupo
  // (respeitando arrasto manual), filtrando só os marcados. Mesma ordem
  // usada tanto na tela quanto no PDF.
  const itensFinais: ItemSelecionado[] = useMemo(
    () =>
      grupos.flatMap((g) =>
        g.itens.filter((i) => i.selecionada).map((i) => toItemSelecionado(i.acao)),
      ),
    [grupos],
  );
  const periodoChave = calcPeriodoChave(tipo, dataReferencia);

  // ✅ true quando o conteúdo mudou depois do último PDF gerado — o
  // Publicar (e o reaproveitamento do "Baixar PDF") ficam bloqueados nesse
  // caso, pra nunca publicar/baixar um PDF que não bate mais com o que está
  // selecionado (inclui reordenar arrastando).
  const contentSnapshotAtual = JSON.stringify({
    titulo,
    tipo,
    dataReferencia,
    introducao,
    itensFinais,
  });
  const previaDesatualizada = pdfUrl != null && pdfSnapshot !== contentSnapshotAtual;

  // ✅ Versão real pro nome do PDF (achado 26/08/2026, virou contador ÚNICO
  // em 30/08/2026 — antes reiniciava v001 a cada período/semana, o Márcio
  // queria uma sequência crescente pra sempre, tipo v001, v002, v003...
  // independente da semana) — puramente derivada de `edicoesExistentes`
  // (já carregada 1x, junto com condomínio/ações, no useEffect inicial),
  // sem round-trip nenhum ao Supabase.
  const versao = useMemo(() => {
    if (versaoExistente != null) return versaoExistente;
    const maxVersao = edicoesExistentes.reduce((max, e) => Math.max(max, e.versao), 0);
    return maxVersao + 1;
  }, [versaoExistente, edicoesExistentes]);

  // ✅ Salva/atualiza o rascunho no banco — chamada tanto ao ir pra prévia
  // quanto depois de gerar/regenerar o PDF. Devolve o id da edição salva.
  async function salvarRascunho(pdfUrlParaSalvar: string | null): Promise<string> {
    const payloadComum = {
      titulo: titulo.trim(),
      tipo,
      data_referencia: dataReferencia,
      periodo_chave: periodoChave,
      introducao: introducao.trim() || null,
      itens: itensFinais,
      pdf_url: pdfUrlParaSalvar,
      versao,
    };

    if (edicaoId) {
      const { error } = await supabaseBrowser
        .from("condominio_edicoes")
        .update(payloadComum)
        .eq("id", edicaoId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return edicaoId;
    }

    // Já existe rascunho aberto pra esse período? Sobrescreve (igual
    // protótipo). Senão, cria um novo.
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
      return rascunhoExistente.id;
    }

    const { data: nova, error } = await supabaseBrowser
      .from("condominio_edicoes")
      .insert({
        tenant_id: tenantId,
        condominio_id: condominioId,
        status: "rascunho",
        ...payloadComum,
      })
      .select("id")
      .single();
    if (error) throw error;
    setEdicaoId(nova.id);
    return nova.id;
  }

  // ✅ "Pré-visualizar" só oculta as não marcadas (soSelecionados=true) —
  // sem trocar de tela nem chamar a VM. Salva o rascunho junto, pra não
  // perder a seleção/ordem se sair da página. "Voltar a editar" é só o
  // inverso, sem precisar salvar de novo.
  async function handleTogglePrevia() {
    if (soSelecionados) {
      setSoSelecionados(false);
      return;
    }
    if (!titulo.trim()) {
      addToast("error", "Título é obrigatório");
      return;
    }
    if (itensFinais.length === 0) {
      addToast("error", "Selecione pelo menos uma ação antes de pré-visualizar.");
      return;
    }
    setSalvando(true);
    try {
      await salvarRascunho(pdfUrl);
      setSoSelecionados(true);
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSalvando(false);
    }
  }

  // ✅ 30/08/2026, pedido do Márcio: só gera (chama a VM) + sobe pro R2 se
  // ainda não existe pdfUrl OU se o conteúdo mudou desde o último gerado
  // (previaDesatualizada) — clicando de novo sem ter alterado nada, só abre
  // o arquivo que já está no R2, sem reprocessar. Gerar de novo troca o
  // arquivo no R2 em vez de acumular um novo a cada clique.
  async function handleBaixarPdf() {
    if (pdfUrl && !previaDesatualizada) {
      window.open(pdfUrl, "_blank");
      return;
    }
    if (!titulo.trim()) {
      addToast("error", "Título é obrigatório");
      return;
    }
    if (!condominio || itensFinais.length === 0) {
      addToast("error", "Selecione pelo menos uma ação.");
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
          edicao: { tipo, data_referencia: dataReferencia, versao, introducao },
          itens: itensFinais,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Falha ao gerar PDF.");
      }
      const blob = await res.blob();

      const nomeArquivo = nomeArquivoPdf(condominio.nome, tipo, versao);
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: nomeArquivo,
          contentType: "application/pdf",
          folder: "condominio-pdfs",
        }),
      });
      const { presignedUrl, publicUrl } = await presignRes.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "application/pdf" },
      });

      const pdfUrlAntigo = pdfUrl;

      await salvarRascunho(publicUrl);
      setPdfUrl(publicUrl);
      setPdfSnapshot(contentSnapshotAtual);

      // Troca (não acumula): apaga do R2 o arquivo anterior — best-effort,
      // não trava o fluxo se falhar.
      if (pdfUrlAntigo && pdfUrlAntigo !== publicUrl) {
        fetch("/api/upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pdfUrlAntigo }),
        }).catch(() => {});
      }

      window.open(publicUrl, "_blank");
      addToast("success", "PDF gerado e salvo", titulo);
    } catch (e: any) {
      addToast("error", "Erro ao gerar PDF", e.message);
    } finally {
      setGerandoPdf(false);
    }
  }

  // ✅ Publicar não gera PDF de novo — só registra, reaproveitando o
  // pdf_url que "Baixar PDF" já deixou salvo no R2.
  async function handlePublicar() {
    if (!pdfUrl) {
      addToast("error", "Gere o PDF antes de publicar.");
      return;
    }
    if (previaDesatualizada) {
      addToast("error", "Prévia desatualizada", "Você editou algo depois do último PDF gerado — gere de novo antes de publicar.");
      return;
    }
    const ok = await confirm({
      title: "Publicar edição?",
      subtitle: `"${titulo}" — depois de publicada, o conteúdo fica congelado (não dá mais pra editar os itens).`,
      tone: "emerald",
      confirmText: "Publicar",
      cancelText: "Voltar",
    });
    if (!ok) return;

    setPublicando(true);
    try {
      const id = await salvarRascunho(pdfUrl);
      const { error } = await supabaseBrowser
        .from("condominio_edicoes")
        .update({ status: "publicado", published_at: new Date().toISOString() })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      addToast("success", "Edição publicada", titulo);
      router.push("/admin/settings/condominio/edicoes");
    } catch (e: any) {
      addToast("error", "Erro ao publicar", e.message);
    } finally {
      setPublicando(false);
    }
  }

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
        <div className="max-w-5xl mx-auto space-y-4">
          {!soSelecionados && (
            <div className="flex items-center gap-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar ações..."
                className="flex-1 h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                {totalSelecionadas} selecionada{totalSelecionadas === 1 ? "" : "s"}
              </span>
              {idsFiltrados.size > 0 && (
                <button
                  type="button"
                  onClick={toggleSelecionarTodasVisiveis}
                  className="h-10 px-3 rounded-lg border border-border bg-transparent text-xs font-medium text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0"
                >
                  {todasFiltradasMarcadas ? "Desmarcar todas" : "Selecionar todas"}
                </button>
              )}
            </div>
          )}

          <div className="space-y-3 max-h-[70vh] overflow-y-auto overscroll-contain custom-scrollbar pr-1">
            {grupos.map((grupo) => (
              <GrupoSecao
                key={grupo.status}
                grupo={grupo}
                soSelecionados={soSelecionados}
                busca={busca}
                colapsado={colapsados.has(grupo.status)}
                sensors={sensors}
                onToggleColapsado={() => toggleColapsado(grupo.status)}
                onToggleTodos={() => toggleGrupoTodos(grupo.status)}
                onToggleItem={(id) => toggleSelecionada(grupo.status, id)}
                onDragEnd={(e) => handleDragEnd(grupo.status, e)}
                onEditar={(acao) => {
                  setEditingAcao(acao);
                  setIsModalAcaoOpen(true);
                }}
                onAjustarCapa={(acao) => setEditingCapaFor(acao)}
              />
            ))}
            {soSelecionados && totalSelecionadas === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground bg-card rounded-xl border border-dashed border-border">
                Nenhuma ação selecionada.
              </div>
            )}
          </div>

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

            {pdfUrl && (
              <p className={`text-[11px] ${previaDesatualizada ? "text-amber-500" : "text-emerald-500"}`}>
                {previaDesatualizada
                  ? "⚠️ Prévia desatualizada — gere de novo antes de publicar."
                  : "✓ PDF salvo — pronto pra publicar."}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleTogglePrevia}
                disabled={salvando || (!soSelecionados && itensFinais.length === 0)}
                className="flex-1 h-10 rounded-lg border border-border text-foreground/90 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {salvando ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                  </>
                ) : soSelecionados ? (
                  "✎ Voltar a editar"
                ) : (
                  "👁 Pré-visualizar"
                )}
              </button>
              <button
                type="button"
                onClick={handleBaixarPdf}
                disabled={gerandoPdf || itensFinais.length === 0}
                className="flex-1 h-10 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 text-sm font-medium hover:bg-sky-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {gerandoPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Gerando...
                  </>
                ) : pdfUrl && !previaDesatualizada ? (
                  "⬇ Baixar PDF"
                ) : (
                  "📄 Gerar PDF"
                )}
              </button>
              <button
                type="button"
                onClick={handlePublicar}
                disabled={publicando || !pdfUrl || previaDesatualizada}
                title={!pdfUrl ? "Gere o PDF antes de publicar" : previaDesatualizada ? "Prévia desatualizada — gere de novo" : "Publicar"}
                className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >
                {publicando ? "Publicando..." : "✅ Publicar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalAcaoOpen && condominioId && (
        <ModalAcao
          acao={editingAcao}
          condominioId={condominioId}
          condominioNome={condominio?.nome || ""}
          onClose={() => setIsModalAcaoOpen(false)}
          onSuccess={() => {
            setIsModalAcaoOpen(false);
            recarregarAcoes();
            addToast("success", "Ação atualizada", editingAcao?.titulo);
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
            recarregarAcoes();
          }}
        />
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
