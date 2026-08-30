"use client";
// app/admin/settings/condominio/edicoes/nova/page.tsx
// ✅ 30/08/2026, refatoração grande pedida pelo Márcio: a tela deixou de ter
// duas colunas (escolher | reordenar) — agora é uma única grade 2-por-linha
// (mesmo layout do PDF, ordenada por status e depois categoria, sem
// destacar a categoria visualmente) usada tanto pra ESCOLHER as ações
// (clique marca/desmarca) quanto pra PRÉVIA (clique abre o ModalAcao pra
// edição rápida ali mesmo). A ordem agora é 100% determinística (status →
// categoria), então @dnd-kit saiu — não tem mais nada pra arrastar.
// "Pré-visualizar" só monta a grade e salva o rascunho (sem chamar a VM);
// o PDF só é gerado (e sobe pro R2) quando clica em "Baixar PDF" — e só de
// novo se o conteúdo mudou desde a última vez (mesmo dirty-check de antes).
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
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

// ✅ Mesma ordem usada no PDF (template.js): status primeiro (ver
// STATUS_ORDEM), categoria em ordem alfabética dentro do status — sem
// separar visualmente por categoria, só agrupa quem é vizinho.
function agruparPorStatus(lista: AcaoRow[]) {
  return STATUS_ORDEM.map((status) => ({
    status,
    itens: lista
      .filter((a) => a.status === status)
      .slice()
      .sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR")),
  })).filter((g) => g.itens.length > 0);
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

// ✅ Card compacto, 2 por linha — mesmo espírito visual do card no PDF
// (template.js: foto + título + categoria). Usado tanto no modo "escolher"
// (clique marca/desmarca, com checkbox) quanto no "previa" (clique abre o
// ModalAcao pra edição rápida).
function GrupoGrid({
  grupos,
  modo,
  selecionadosIds,
  colapsados,
  onToggleColapsado,
  onToggleAcao,
  onEditarAcao,
}: {
  grupos: { status: StatusAcao; itens: AcaoRow[] }[];
  modo: "escolher" | "previa";
  selecionadosIds: Set<string>;
  colapsados: Set<StatusAcao>;
  onToggleColapsado: (status: StatusAcao) => void;
  onToggleAcao: (acao: AcaoRow) => void;
  onEditarAcao: (acao: AcaoRow) => void;
}) {
  if (grupos.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground bg-card rounded-xl border border-dashed border-border">
        {modo === "escolher" ? "Nenhuma ação encontrada." : "Marque ações acima pra montar a edição."}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {grupos.map((grupo) => {
        const cor = STATUS_COR[grupo.status];
        const colapsado = colapsados.has(grupo.status);
        return (
          <div key={grupo.status} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cor.bg} ${cor.text} ${cor.border}`}
                >
                  {cor.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{grupo.itens.length}</span>
              </div>
              <button
                type="button"
                onClick={() => onToggleColapsado(grupo.status)}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {colapsado ? "Mostrar" : "Ocultar"}
                <ChevronDown
                  className={`w-3 h-3 transition-transform duration-200 ${colapsado ? "-rotate-90" : ""}`}
                />
              </button>
            </div>

            {!colapsado && (
              <div className="grid grid-cols-2 gap-2">
                {grupo.itens.map((a) => {
                  const marcada = selecionadosIds.has(a.id);
                  const capa = a.fotos?.[0];
                  return (
                    <div
                      key={a.id}
                      onClick={() => (modo === "escolher" ? onToggleAcao(a) : onEditarAcao(a))}
                      title={modo === "previa" ? "Clique para editar" : undefined}
                      className={`rounded-lg border overflow-hidden cursor-pointer transition-colors bg-card ${
                        modo === "escolher" && marcada
                          ? "border-emerald-500/40 ring-1 ring-emerald-500/30"
                          : "border-border hover:border-emerald-500/30"
                      }`}
                    >
                      {capa ? (
                        <img
                          src={capa.url}
                          alt=""
                          className="w-full h-20 object-cover"
                          style={{ objectPosition: `center ${capa.posY ?? 20}%` }}
                        />
                      ) : (
                        <div className="w-full h-20 bg-muted" />
                      )}
                      <div className="p-2 flex items-start gap-1.5">
                        {modo === "escolher" && (
                          <input
                            type="checkbox"
                            checked={marcada}
                            readOnly
                            className="mt-0.5 shrink-0 pointer-events-none"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-foreground/90 leading-tight line-clamp-2">
                            {a.titulo}
                          </p>
                          <p className="text-[10px] text-muted-foreground capitalize truncate">
                            {a.categoria}
                          </p>
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
  const [acoesDisponiveis, setAcoesDisponiveis] = useState<AcaoRow[]>([]);
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
  // ✅ 30/08/2026: o PDF só é gerado (e sobe pro R2) quando clica em "Baixar
  // PDF" — não mais em "Pré-visualizar" (que agora só monta a grade na
  // página, sem chamar a VM). Gerar de novo (depois de editar) troca o
  // arquivo: apaga o antigo do R2 antes de subir o novo.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // ✅ "Foto" do conteúdo no momento em que pdfUrl foi gerado — compara com
  // o conteúdo atual pra saber se a prévia ficou desatualizada (editou algo
  // depois de gerar o PDF) sem precisar de efeito/ordem de render nenhuma,
  // só um valor calculado direto no render.
  const [pdfSnapshot, setPdfSnapshot] = useState<string | null>(null);
  const [introducao, setIntroducao] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [sugestaoIA, setSugestaoIA] = useState<string | null>(null);

  const [selecionadosIds, setSelecionadosIds] = useState<Set<string>>(new Set());
  // ✅ "escolher" = grade com todas as ações disponíveis, clique marca/
  // desmarca. "previa" = grade só com as selecionadas, na ordem final do
  // PDF, clique abre o ModalAcao pra editar rápido ali mesmo.
  const [modo, setModo] = useState<"escolher" | "previa">(edicaoIdParam ? "previa" : "escolher");
  const [salvando, setSalvando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [colapsados, setColapsados] = useState<Set<StatusAcao>>(new Set());

  const [editingAcao, setEditingAcao] = useState<AcaoRow | null>(null);
  const [isModalAcaoOpen, setIsModalAcaoOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  async function carregarAcoes() {
    if (!tenantId || !condominioId) return;
    const { data, error } = await supabaseBrowser
      .from("condominio_acoes")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("condominio_id", condominioId)
      .eq("arquivada", false)
      .order("created_at", { ascending: false });
    if (!error) setAcoesDisponiveis(data || []);
  }

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
        setAcoesDisponiveis(resAcoes.data || []);
        setEdicoesExistentes(resEdicoes.data || []);

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
          setSelecionadosIds(new Set(itensSalvos.map((i) => i.acaoId)));
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
            setModo("previa");
          } else {
            setModo("escolher");
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
          setSelecionadosIds(idsPreSelecionados);
        }
      } catch (e: any) {
        addToast("error", "Erro ao carregar", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId, condominioId]);

  function toggleAcao(acao: AcaoRow) {
    setSelecionadosIds((prev) => {
      const novo = new Set(prev);
      if (novo.has(acao.id)) novo.delete(acao.id);
      else novo.add(acao.id);
      return novo;
    });
  }

  function toggleColapsado(status: StatusAcao) {
    setColapsados((prev) => {
      const novo = new Set(prev);
      if (novo.has(status)) novo.delete(status);
      else novo.add(status);
      return novo;
    });
  }

  function toggleSelecionarTodasVisiveis() {
    const todasMarcadas =
      acoesFiltradas.length > 0 &&
      acoesFiltradas.every((a) => selecionadosIds.has(a.id));
    setSelecionadosIds((prev) => {
      const novo = new Set(prev);
      acoesFiltradas.forEach((a) => {
        if (todasMarcadas) novo.delete(a.id);
        else novo.add(a.id);
      });
      return novo;
    });
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

  const acoesSelecionadas = useMemo(
    () => acoesDisponiveis.filter((a) => selecionadosIds.has(a.id)),
    [acoesDisponiveis, selecionadosIds],
  );
  const gruposSelecionados = useMemo(
    () => agruparPorStatus(acoesSelecionadas),
    [acoesSelecionadas],
  );
  const itensFinais: ItemSelecionado[] = useMemo(
    () => gruposSelecionados.flatMap((g) => g.itens).map(toItemSelecionado),
    [gruposSelecionados],
  );
  const periodoChave = calcPeriodoChave(tipo, dataReferencia);

  // ✅ true quando o conteúdo mudou depois do último PDF gerado — o
  // Publicar (e o reaproveitamento do "Baixar PDF") ficam bloqueados nesse
  // caso, pra nunca publicar/baixar um PDF que não bate mais com o que está
  // selecionado (inclui edição rápida feita direto na prévia).
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

  // ✅ "Pré-visualizar" agora só monta a grade nessa mesma página (no
  // formato do PDF) e salva o rascunho — sem chamar a VM. O PDF em si só é
  // gerado quando clica em "Baixar PDF" (handleBaixarPdf).
  async function handleIrParaPrevia() {
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
      setModo("previa");
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

  const acoesFiltradas = acoesDisponiveis.filter((a) =>
    busca.trim()
      ? a.titulo.toLowerCase().includes(busca.trim().toLowerCase())
      : true,
  );
  const gruposDisponiveis = useMemo(() => agruparPorStatus(acoesFiltradas), [acoesFiltradas]);

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
        <div className="max-w-3xl mx-auto space-y-4">
          {modo === "previa" && (
            <div className="p-3 rounded-xl border border-border bg-card flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-bold text-foreground/90">{titulo}</p>
                <p className="text-[11px] text-muted-foreground">
                  {condominio?.nome} · {tipo === "mensal" ? "Mensal" : "Semanal"} ·{" "}
                  {dataReferencia} · v{String(versao).padStart(3, "0")}
                </p>
              </div>
              {pdfUrl && (
                <p className={`text-[11px] font-medium ${previaDesatualizada ? "text-amber-500" : "text-emerald-500"}`}>
                  {previaDesatualizada ? "⚠️ Desatualizada" : "✓ PDF salvo"}
                </p>
              )}
            </div>
          )}

          {modo === "escolher" && (
            <div className="flex items-center gap-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar ações..."
                className="flex-1 h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
              />
              <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                {selecionadosIds.size} selecionada{selecionadosIds.size === 1 ? "" : "s"}
              </span>
              {acoesFiltradas.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelecionarTodasVisiveis}
                  className="h-10 px-3 rounded-lg border border-border bg-transparent text-xs font-medium text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0"
                >
                  {acoesFiltradas.every((a) => selecionadosIds.has(a.id))
                    ? "Desmarcar todas"
                    : "Selecionar todas"}
                </button>
              )}
            </div>
          )}

          <div className="max-h-[65vh] overflow-y-auto overscroll-contain custom-scrollbar pr-1">
            <GrupoGrid
              grupos={modo === "escolher" ? gruposDisponiveis : gruposSelecionados}
              modo={modo}
              selecionadosIds={selecionadosIds}
              colapsados={colapsados}
              onToggleColapsado={toggleColapsado}
              onToggleAcao={toggleAcao}
              onEditarAcao={(a) => {
                setEditingAcao(a);
                setIsModalAcaoOpen(true);
              }}
            />
          </div>

          {modo === "escolher" ? (
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

              <button
                type="button"
                onClick={handleIrParaPrevia}
                disabled={salvando || itensFinais.length === 0}
                className="w-full h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {salvando ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                  </>
                ) : (
                  "👁 Pré-visualizar"
                )}
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-border bg-card space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setModo("escolher")}
                  className="h-10 px-4 rounded-lg border border-border text-muted-foreground text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
                >
                  ✎ Editar
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
          )}
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
            carregarAcoes();
            addToast("success", "Ação atualizada", editingAcao?.titulo);
          }}
          onError={(msg) => addToast("error", "Erro ao salvar", msg)}
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
