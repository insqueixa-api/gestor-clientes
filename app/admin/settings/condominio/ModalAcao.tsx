"use client";
// app/admin/settings/condominio/ModalAcao.tsx
// Cria E edita no mesmo modal — mesmo contrato de ModalCondominio.tsx.
// Migra o formulário de Ação do protótipo local (Vidamerica/components/
// AcaoForm.tsx): título, categoria, status, texto (com revisão por IA),
// fotos múltiplas com legenda.
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import imageCompression from "browser-image-compression";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import type { AcaoRow, Foto, StatusAcao } from "./shared";

// ✅ 1 capa + até 3 abaixo (achado 26/08/2026, pedido do Márcio: "limite a
// 4 fotos por card") — mesmo limite vale aqui no upload e em page.tsx (onde
// as fotos são exibidas).
const MAX_FOTOS = 4;

// Mesmas 10 categorias fixas do protótipo local (Vidamerica/lib/types.ts) —
// texto livre no banco (não é uma tabela à parte, ver docs/sql/
// condominio_acoes.sql), então categoria nova = digitar em "+ Nova
// categoria..." uma vez; da próxima vez ela já aparece na lista (buscada
// direto das Ações já cadastradas do tenant, sem precisar cadastrar em
// lugar nenhum antes).
const CATEGORIAS_FIXAS = [
  { valor: "portaria", label: "Portaria" },
  { valor: "obras", label: "Obras" },
  { valor: "limpeza", label: "Limpeza" },
  { valor: "hidraulica", label: "Hidráulica" },
  { valor: "eletrica", label: "Elétrica" },
  { valor: "cameras", label: "Câmeras / Segurança" },
  { valor: "juridico", label: "Jurídico" },
  { valor: "lazer", label: "Lazer" },
  { valor: "colaboradores", label: "Colaboradores" },
  { valor: "comunicado", label: "Comunicado" },
];

const STATUS_OPCOES: { valor: StatusAcao; label: string }[] = [
  { valor: "futuro", label: "Futuro" },
  { valor: "planejado", label: "Planejado / Em cotação" },
  { valor: "em_andamento", label: "Em andamento" },
  { valor: "pausado", label: "Pausado" },
  { valor: "concluido", label: "Concluído" },
];

type Props = {
  acao?: AcaoRow | null;
  condominioId: string;
  condominioNome: string;
  onClose: () => void;
  onSuccess: () => void;
  onError?: (msg: string) => void;
};

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

export default function ModalAcao({
  acao,
  condominioId,
  condominioNome,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const tenantId = useTenantId();
  const { confirm } = useConfirm();
  const alertError = (msg: string) =>
    onError
      ? Promise.resolve(onError(msg))
      : confirm({
          title: "Erro",
          subtitle: msg,
          tone: "rose",
          confirmText: "OK",
          cancelText: "",
        });
  const isEditing = !!acao;
  const [saving, setSaving] = useState(false);

  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("outro");
  const [categoriaOutra, setCategoriaOutra] = useState("");
  const [categoriasExtras, setCategoriasExtras] = useState<string[]>([]);
  // ✅ 30/08/2026, pedido do Márcio: ação nova já nasce como "Concluído" —
  // no fluxo dele, a ação normalmente já foi feita quando ele registra.
  const [status, setStatus] = useState<StatusAcao>("concluido");
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [uploadingFoto, setUploadingFoto] = useState(false);

  const [revisando, setRevisando] = useState(false);
  const [sugestaoIA, setSugestaoIA] = useState<string | null>(null);

  useEffect(() => {
    if (acao) {
      setTitulo(acao.titulo);
      setCategoria(acao.categoria || "outro");
      setStatus(acao.status);
      setTexto(acao.texto || "");
      setFotos(Array.isArray(acao.fotos) ? acao.fotos : []);
    }
  }, [acao]);

  // ✅ Categorias "extras" (fora das 10 fixas) já usadas pelo tenant em
  // qualquer condomínio — assim, digitar uma categoria nova uma vez já
  // deixa ela disponível pra reusar depois, sem precisar de uma tabela de
  // categorias/tela de gerenciamento à parte.
  useEffect(() => {
    if (!tenantId) return;
    supabaseBrowser
      .from("condominio_acoes")
      .select("categoria")
      .eq("tenant_id", tenantId)
      .then(({ data }) => {
        if (!data) return;
        const fixas = new Set(CATEGORIAS_FIXAS.map((c) => c.valor));
        const extras = Array.from(
          new Set(
            data
              .map((r) => r.categoria)
              .filter((c): c is string => !!c && !fixas.has(c)),
          ),
        ).sort((a, b) => a.localeCompare(b, "pt-BR"));
        setCategoriasExtras(extras);
      });
  }, [tenantId]);

  // Garante que o valor atual (inclusive um vindo de edição, ainda não
  // presente na lista buscada) sempre tenha uma <option> correspondente.
  const opcoesCategoria = useMemo(() => {
    const todas = new Set([
      ...CATEGORIAS_FIXAS.map((c) => c.valor),
      ...categoriasExtras,
    ]);
    if (categoria && categoria !== "outro") todas.add(categoria);
    return Array.from(todas).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [categoriasExtras, categoria]);

  function labelCategoria(valor: string) {
    return CATEGORIAS_FIXAS.find((c) => c.valor === valor)?.label || valor;
  }

  async function handleFotoUpload(file: File): Promise<Foto | null> {
    if (!file.type.startsWith("image/")) {
      await alertError(`Arquivo inválido: "${file.name}" não é uma imagem.`);
      return null;
    }
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      });

      const res = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: compressed.type || file.type,
          folder: "condominio-acoes",
        }),
      });
      const { presignedUrl, publicUrl } = await res.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: compressed,
        headers: { "Content-Type": compressed.type || file.type },
      });
      return { url: publicUrl, legenda: "" };
    } catch (e: any) {
      await alertError(`Erro no upload de "${file.name}": ` + e?.message);
      return null;
    }
  }

  // ✅ Ctrl+clique/seleção múltipla (achado 26/08/2026, pedido do Márcio:
  // "hoje eu tenho que selecionar foto por foto") — o <input multiple>
  // já entrega vários arquivos de uma vez; sobe um de cada vez (sequencial,
  // simples e evita estourar presigns em paralelo) até bater o limite de
  // MAX_FOTOS. Selecionar mais do que cabe só usa as primeiras — avisa
  // quantas ficaram de fora.
  async function handleFotosSelecionadas(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const vagas = MAX_FOTOS - fotos.length;
    if (vagas <= 0) {
      await alertError(`Limite de ${MAX_FOTOS} fotos por ação já atingido.`);
      return;
    }
    const arquivos = Array.from(fileList);
    const aEnviar = arquivos.slice(0, vagas);
    if (arquivos.length > vagas) {
      await alertError(
        `Só cabem mais ${vagas} foto(s) (limite de ${MAX_FOTOS}) — as ${arquivos.length - vagas} última(s) selecionada(s) foram ignoradas.`,
      );
    }

    setUploadingFoto(true);
    try {
      for (const file of aEnviar) {
        const foto = await handleFotoUpload(file);
        if (foto) setFotos((prev) => [...prev, foto]);
      }
    } finally {
      setUploadingFoto(false);
    }
  }

  function removerFoto(idx: number) {
    setFotos((prev) => prev.filter((_, i) => i !== idx));
  }

  function atualizarLegenda(idx: number, legenda: string) {
    setFotos((prev) => prev.map((f, i) => (i === idx ? { ...f, legenda } : f)));
  }

  async function handleRevisarIA() {
    if (!texto.trim()) {
      await alertError("Escreva um texto antes de pedir a revisão da IA.");
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
          titulo: titulo || "item do informativo",
          texto,
          nomeCondominio: condominioNome,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao revisar com a IA.");
      }
      setSugestaoIA(json.sugestao);
    } catch (e: any) {
      await alertError(e?.message || "Falha ao revisar com a IA.");
    } finally {
      setRevisando(false);
    }
  }

  async function handleSave() {
    if (!titulo.trim()) {
      await alertError("Título é obrigatório");
      return;
    }
    const categoriaFinal =
      categoria === "outro" && categoriaOutra.trim() ? categoriaOutra.trim() : categoria;

    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        condominio_id: condominioId,
        titulo: titulo.trim(),
        categoria: categoriaFinal,
        status,
        texto: texto.trim() || null,
        fotos,
      };

      if (isEditing && acao) {
        const { error } = await supabaseBrowser
          .from("condominio_acoes")
          .update(payload)
          .eq("id", acao.id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
      } else {
        const { error } = await supabaseBrowser
          .from("condominio_acoes")
          .insert(payload);
        if (error) throw error;
      }

      onSuccess();
    } catch (e: any) {
      await alertError(e?.message || "Erro ao salvar ação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <ModalHeader onClose={onClose}>
        <h2 className="text-base font-semibold text-foreground">
          {isEditing ? "Editar Ação" : "Nova Ação"}
        </h2>
      </ModalHeader>

      <ModalBody className="p-4 sm:p-6 space-y-4">
        <div>
          <Label>Título</Label>
          <Input
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Portaria: novo alinhamento"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Categoria</Label>
            <Select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {opcoesCategoria.map((valor) => (
                <option key={valor} value={valor}>
                  {labelCategoria(valor)}
                </option>
              ))}
              <option value="outro">+ Nova categoria...</option>
            </Select>
            {categoria === "outro" && (
              <Input
                className="mt-2"
                autoFocus
                value={categoriaOutra}
                onChange={(e) => setCategoriaOutra(e.target.value)}
                placeholder="Nome da categoria (ex: Comodidades)"
              />
            )}
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusAcao)}
            >
              {STATUS_OPCOES.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label>Texto</Label>
            <button
              type="button"
              onClick={handleRevisarIA}
              disabled={revisando || !texto.trim()}
              className="text-[11px] font-medium text-emerald-500 hover:text-emerald-400 disabled:opacity-50 transition-colors"
            >
              {revisando ? "Revisando..." : "✨ Revisar com IA"}
            </button>
          </div>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={5}
            placeholder="Descreva o que foi feito, está em andamento ou planejado..."
            className="w-full px-3 py-2 bg-transparent border border-border rounded-lg text-sm text-foreground/90 placeholder-muted-foreground/40 outline-none focus:border-emerald-500/50 transition-colors resize-y"
          />

          {sugestaoIA && (
            <div className="mt-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
              <p className="text-[10px] font-medium text-emerald-600 uppercase tracking-wider">
                Sugestão da IA
              </p>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                {sugestaoIA}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTexto(sugestaoIA);
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

        <div>
          <Label>Fotos</Label>
          <div className="space-y-2">
            {fotos.map((foto, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 p-2 border border-border rounded-xl"
              >
                <img
                  src={foto.url}
                  alt={`Foto ${idx + 1}`}
                  className="w-12 h-12 rounded-lg object-cover border border-border shrink-0"
                />
                <Input
                  value={foto.legenda}
                  onChange={(e) => atualizarLegenda(idx, e.target.value)}
                  placeholder="Legenda (opcional)"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => removerFoto(idx)}
                  className="shrink-0 p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"
                  title="Remover foto"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}

            {fotos.length < MAX_FOTOS && (
              <label className="flex items-center justify-center gap-2 h-10 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-emerald-500/50 transition-colors text-xs font-medium text-muted-foreground">
                {uploadingFoto
                  ? "Enviando..."
                  : `+ Adicionar foto (${fotos.length}/${MAX_FOTOS}) — segure Ctrl pra escolher várias`}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={uploadingFoto}
                  onChange={(e) => {
                    handleFotosSelecionadas(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {fotos.length >= MAX_FOTOS && (
              <p className="text-[11px] text-muted-foreground text-center">
                Limite de {MAX_FOTOS} fotos atingido — remova uma pra adicionar outra.
              </p>
            )}
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || uploadingFoto}
          className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Salvando..." : isEditing ? "Salvar alterações" : "Criar ação"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
