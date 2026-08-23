"use client";
// app/admin/settings/condominio/edicoes/page.tsx
// Lista de Edições (o "jornalzinho") do condomínio selecionado — rascunho/
// publicado, baixar PDF, publicar, excluir. Montar uma edição nova é a
// página separada ./nova (formulário grande — reordenar ações por
// drag-and-drop, revisão por IA etc.).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, CheckCircle2, Trash2 } from "lucide-react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import CondominioFilterDropdown from "../CondominioFilterDropdown";
import { LOCALSTORAGE_KEY, type CondominioRow } from "../shared";

type EdicaoRow = {
  id: string;
  tenant_id: string;
  condominio_id: string;
  titulo: string;
  tipo: "semanal" | "mensal";
  data_referencia: string;
  periodo_chave: string;
  versao: number;
  status: "rascunho" | "publicado";
  introducao: string | null;
  itens: any[];
  pdf_url: string | null;
  published_at: string | null;
  created_at: string;
};

export default function EdicoesPage() {
  const tenantId = useTenantId();
  const { confirm } = useConfirm();

  const [condominios, setCondominios] = useState<CondominioRow[]>([]);
  const [selectedCondominioId, setSelectedCondominioId] = useState<string | null>(
    null,
  );
  const [edicoes, setEdicoes] = useState<EdicaoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: "success" | "error", title: string, message?: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  async function fetchCondominios() {
    if (!tenantId) return;
    const { data, error } = await supabaseBrowser
      .from("condominios")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("nome");
    if (error) {
      addToast("error", "Erro ao carregar condomínios", error.message);
      return;
    }
    const rows = data || [];
    setCondominios(rows);
    setSelectedCondominioId((current) => {
      if (current && rows.some((c) => c.id === current)) return current;
      const salvo =
        typeof window !== "undefined" ? localStorage.getItem(LOCALSTORAGE_KEY) : null;
      if (salvo && rows.some((c) => c.id === salvo)) return salvo;
      return rows[0]?.id ?? null;
    });
  }

  useEffect(() => {
    fetchCondominios();
  }, [tenantId]);

  async function fetchEdicoes() {
    if (!tenantId || !selectedCondominioId) {
      setEdicoes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("condominio_edicoes")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("condominio_id", selectedCondominioId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setEdicoes(data || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar edições", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEdicoes();
  }, [tenantId, selectedCondominioId]);

  function handleSelectCondominio(id: string) {
    setSelectedCondominioId(id);
    if (typeof window !== "undefined") localStorage.setItem(LOCALSTORAGE_KEY, id);
  }

  const condominioSelecionado = condominios.find((c) => c.id === selectedCondominioId);

  async function gerarPdfBlob(edicao: EdicaoRow): Promise<Blob> {
    if (!condominioSelecionado) throw new Error("Condomínio não encontrado.");
    const { data: sessionData } = await supabaseBrowser.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch("/api/admin/condominio/gerar-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        condominio: condominioSelecionado,
        edicao: {
          tipo: edicao.tipo,
          data_referencia: edicao.data_referencia,
          versao: edicao.versao,
          introducao: edicao.introducao,
        },
        itens: edicao.itens,
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.error || "Falha ao gerar PDF.");
    }
    return res.blob();
  }

  // Mesmo formato de nome do protótipo local (Vidamerica): "{condomínio} -
  // Informativo {Semanal|Mensal} - v{003}.pdf".
  function nomeArquivoPdf(nomeCondominio: string, tipo: "semanal" | "mensal", versao: number) {
    const tipoLabel = tipo === "mensal" ? "Mensal" : "Semanal";
    return `${nomeCondominio} - Informativo ${tipoLabel} - v${String(versao).padStart(3, "0")}.pdf`;
  }

  function baixarBlob(blob: Blob, nomeArquivo: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ✅ Edição já publicada com pdf_url salvo: baixa o arquivo já pronto do
  // R2 direto, sem chamar a VM/Puppeteer de novo — só rascunho (conteúdo
  // ainda pode mudar) gera na hora.
  async function handleBaixarPdf(edicao: EdicaoRow) {
    if (!condominioSelecionado) return;
    if (edicao.pdf_url) {
      window.open(edicao.pdf_url, "_blank");
      return;
    }
    setBaixandoId(edicao.id);
    try {
      const blob = await gerarPdfBlob(edicao);
      baixarBlob(
        blob,
        nomeArquivoPdf(condominioSelecionado.nome, edicao.tipo, edicao.versao),
      );
    } catch (e: any) {
      addToast("error", "Erro ao gerar PDF", e.message);
    } finally {
      setBaixandoId(null);
    }
  }

  async function handlePublicar(edicao: EdicaoRow) {
    if (!condominioSelecionado) return;
    const ok = await confirm({
      title: "Publicar edição?",
      subtitle: `"${edicao.titulo}" — depois de publicada, o conteúdo fica congelado (não dá mais pra editar os itens) e o PDF fica salvo pra download rápido.`,
      tone: "emerald",
      confirmText: "Publicar",
      cancelText: "Voltar",
    });
    if (!ok) return;

    setBaixandoId(edicao.id);
    try {
      // Gera o PDF final e sobe pro R2 — só a partir daqui um PDF vira
      // "permanente" (pré-visualização continua descartável).
      const blob = await gerarPdfBlob(edicao);
      const nomeArquivo = nomeArquivoPdf(
        condominioSelecionado.nome,
        edicao.tipo,
        edicao.versao,
      );

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

      const { error } = await supabaseBrowser
        .from("condominio_edicoes")
        .update({
          status: "publicado",
          published_at: new Date().toISOString(),
          pdf_url: publicUrl,
        })
        .eq("id", edicao.id);
      if (error) throw error;
      addToast("success", "Edição publicada", edicao.titulo);
      fetchEdicoes();
    } catch (e: any) {
      addToast("error", "Erro ao publicar", e.message);
    } finally {
      setBaixandoId(null);
    }
  }

  async function handleExcluir(edicao: EdicaoRow) {
    const ok = await confirm({
      title: "Excluir edição?",
      subtitle: `Tem certeza que deseja excluir "${edicao.titulo}"?`,
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Voltar",
      details: ["Essa ação não pode ser desfeita."],
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser
        .from("condominio_edicoes")
        .delete()
        .eq("id", edicao.id);
      if (error) throw error;
      addToast("success", "Edição excluída", edicao.titulo);
      fetchEdicoes();
    } catch (e: any) {
      addToast("error", "Erro ao excluir", e.message);
    }
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-3 sm:px-6 min-h-screen bg-background transition-colors">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
          📰 Edições
        </h1>
        <Link
          href={
            selectedCondominioId
              ? `/admin/settings/condominio/edicoes/nova?condominio=${selectedCondominioId}`
              : "#"
          }
          className={`h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all ${!selectedCondominioId ? "pointer-events-none opacity-50" : ""}`}
        >
          <span>+</span> Nova Edição
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CondominioFilterDropdown
          condominios={condominios}
          selectedId={selectedCondominioId}
          onSelect={handleSelectCondominio}
          onEdit={() => {}}
          onAddNew={() => {}}
        />
        <Link
          href="/admin/settings/condominio"
          className="h-10 px-3 flex items-center text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Voltar pras Ações
        </Link>
      </div>

      {loading && (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-xl border border-border">
          Carregando edições...
        </div>
      )}

      {!loading && selectedCondominioId && edicoes.length === 0 && (
        <div className="p-12 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
          Nenhuma edição criada ainda pra este condomínio.
        </div>
      )}

      {!loading && edicoes.length > 0 && (
        <div className="space-y-2">
          {edicoes.map((edicao) => (
            <div
              key={edicao.id}
              className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border bg-card"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-medium text-foreground/90 truncate">
                    {edicao.titulo}
                  </h2>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                      edicao.status === "publicado"
                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                        : "bg-amber-500/10 text-amber-500 border-amber-500/30"
                    }`}
                  >
                    {edicao.status === "publicado" ? "Publicado" : "Rascunho"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {edicao.tipo === "mensal" ? "Mensal" : "Semanal"} · v
                  {String(edicao.versao).padStart(3, "0")} ·{" "}
                  {new Date(`${edicao.data_referencia}T12:00:00`).toLocaleDateString(
                    "pt-BR",
                  )}{" "}
                  · {edicao.itens?.length || 0} itens
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {edicao.status === "rascunho" && (
                  <Link
                    href={`/admin/settings/condominio/edicoes/nova?condominio=${edicao.condominio_id}&edicao=${edicao.id}`}
                    className="h-8 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted flex items-center transition-colors"
                  >
                    Editar
                  </Link>
                )}
                <button
                  type="button"
                  title={edicao.pdf_url ? "Abrir PDF" : "Gerar e baixar PDF"}
                  onClick={() => handleBaixarPdf(edicao)}
                  disabled={baixandoId === edicao.id}
                  className="w-8 h-8 rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {edicao.status === "rascunho" && (
                  <button
                    type="button"
                    title={
                      baixandoId === edicao.id
                        ? "Gerando e salvando o PDF..."
                        : "Publicar"
                    }
                    onClick={() => handlePublicar(edicao)}
                    disabled={baixandoId === edicao.id}
                    className="w-8 h-8 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 flex items-center justify-center transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  title="Excluir"
                  onClick={() => handleExcluir(edicao)}
                  className="w-8 h-8 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 flex items-center justify-center transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
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
