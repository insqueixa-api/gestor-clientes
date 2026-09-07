"use client";
// app/admin/settings/condominio/CapaEditorModal.tsx
// "Ajustar capa" (achado 26/08/2026, pedido do Márcio: "a foto corta a
// cabeça... poderia arrastar a foto no melhor ângulo... e um botão de
// trocar foto"). Duas coisas num modal só: arrasta a foto de capa (fotos[0])
// pra cima/baixo — vira `posY` (0-100%, mesmo número de object-position) —
// e escolhe qualquer outra foto já enviada pra virar a nova capa (reordena
// o array, a escolhida vira fotos[0]). Salva direto em condominio_acoes.
import { useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import type { AcaoRow, Foto } from "./shared";

type Props = {
  acao: AcaoRow;
  tenantId: string;
  onClose: () => void;
  onSaved: () => void;
  onError?: (msg: string) => void;
};

// Mesma altura do crop real no card (h-36 = 9rem), pra o que o Márcio vê
// aqui já ser exatamente o que vai aparecer na grade.
const PREVIEW_HEIGHT = 144;
const POS_Y_PADRAO = 20;

export default function CapaEditorModal({ acao, tenantId, onClose, onSaved, onError }: Props) {
  const [fotos, setFotos] = useState<Foto[]>(acao.fotos || []);
  const [posY, setPosY] = useState<number>(acao.fotos?.[0]?.posY ?? POS_Y_PADRAO);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const draggingRef = useRef<{ startY: number; startPos: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const capa = fotos[0];

  function handlePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = { startY: e.clientY, startPos: posY };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!draggingRef.current || !containerRef.current) return;
    const deltaY = e.clientY - draggingRef.current.startY;
    const altura = containerRef.current.offsetHeight || PREVIEW_HEIGHT;
    // Arrastar pra BAIXO revela a parte de CIMA da foto (posY diminui) —
    // gesto natural: "empurrar a foto pra baixo" pra ver o que ficou
    // cortado em cima.
    const deltaPercent = (deltaY / altura) * 100;
    const novo = Math.max(0, Math.min(100, draggingRef.current.startPos - deltaPercent));
    setPosY(novo);
  }

  function handlePointerUp() {
    draggingRef.current = null;
  }

  // ✅ 07/09/2026, pedido do Márcio: botão de girar a capa 90° (ex: foto
  // tirada de lado no celular). Em vez de guardar um ângulo e aplicar
  // transform:rotate em CSS (precisaria repetir a mesma lógica aqui, na
  // grade de Ações, na prévia do jornal E no template do PDF — que roda
  // fora daqui, na VM — com risco real de esquecer um lugar, mesmo erro já
  // cometido antes com o posY que "não chegava no PDF"), gira o ARQUIVO de
  // verdade (canvas) e reenvia como uma nova imagem — todo mundo que só lê
  // a URL (grade, prévia, PDF) já funciona certo sem precisar saber que
  // rotação existe. Bucket confirmado com CORS liberado pro nosso domínio.
  async function handleRotate() {
    if (!capa) return;
    setRotating(true);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      // ✅ Achado ao vivo (07/09/2026): essa mesma foto já aparece na tela
      // sem crossOrigin (a pré-visualização abaixo) — o navegador guarda
      // uma versão em cache sem validação de CORS, e pedir a MESMA URL de
      // novo com crossOrigin="anonymous" esbarra nesse cache e falha
      // (comportamento conhecido de browser). Um parâmetro extra na URL
      // força uma requisição de rede nova, já negociada como CORS desde o
      // início, sem essa colisão.
      const bustedUrl = `${capa.url}${capa.url.includes("?") ? "&" : "?"}_rotate=${Date.now()}`;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Falha ao carregar a foto pra rotacionar."));
        img.src = bustedUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalHeight;
      canvas.height = img.naturalWidth;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Não foi possível preparar a rotação.");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a foto rotacionada."))),
          "image/jpeg",
          0.92,
        ),
      );

      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: `capa-rotacionada-${Date.now()}.jpg`,
          contentType: "image/jpeg",
          folder: "condominio-acoes",
        }),
      });
      const { presignedUrl, publicUrl } = await presignRes.json();
      if (!presignedUrl || !publicUrl) throw new Error("Falha ao preparar o envio da foto rotacionada.");

      await fetch(presignedUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "image/jpeg" },
      });

      setFotos((prev) => {
        const next = [...prev];
        next[0] = { ...next[0], url: publicUrl };
        return next;
      });
      // ✅ Enquadramento vertical antigo não faz mais sentido depois de
      // girar (composição da foto mudou) — volta pro padrão pra o Márcio
      // reajustar do zero.
      setPosY(POS_Y_PADRAO);
    } catch (e: any) {
      onError?.(e?.message || "Erro ao rotacionar a foto.");
    } finally {
      setRotating(false);
    }
  }

  function escolherComoCapa(idx: number) {
    if (idx === 0) return;
    const novaCapa = fotos[idx];
    setFotos((prev) => {
      const nova = [...prev];
      const [escolhida] = nova.splice(idx, 1);
      nova.unshift(escolhida);
      return nova;
    });
    setPosY(novaCapa?.posY ?? POS_Y_PADRAO);
  }

  async function handleSalvar() {
    setSaving(true);
    try {
      const fotosFinais = fotos.map((f, i) => (i === 0 ? { ...f, posY: Math.round(posY) } : f));
      const { error } = await supabaseBrowser
        .from("condominio_acoes")
        .update({ fotos: fotosFinais })
        .eq("id", acao.id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      onSaved();
    } catch (e: any) {
      onError?.(e?.message || "Erro ao salvar capa.");
    } finally {
      setSaving(false);
    }
  }

  if (!capa) return null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <ModalHeader onClose={onClose}>
        <h2 className="text-base font-semibold text-foreground">Ajustar capa</h2>
      </ModalHeader>

      <ModalBody className="p-4 sm:p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs text-muted-foreground">
              Arraste a foto pra cima ou pra baixo pra escolher o melhor enquadramento.
            </p>
            <button
              type="button"
              onClick={handleRotate}
              disabled={rotating}
              title="Girar foto 90°"
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${rotating ? "animate-spin" : ""}`} />
              {rotating ? "Girando..." : "Girar"}
            </button>
          </div>
          <div
            ref={containerRef}
            className="w-full rounded-xl overflow-hidden border border-border select-none"
            style={{ height: PREVIEW_HEIGHT }}
          >
            <img
              src={capa.url}
              alt="Capa"
              draggable={false}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="w-full h-full object-cover cursor-ns-resize touch-none"
              style={{ objectPosition: `center ${posY}%` }}
            />
          </div>
        </div>

        {fotos.length > 1 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Ou escolha outra foto como capa:</p>
            <div className="flex gap-2 flex-wrap">
              {fotos.map((f, idx) => (
                <button
                  key={f.url + idx}
                  type="button"
                  onClick={() => escolherComoCapa(idx)}
                  className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                    idx === 0 ? "border-emerald-500" : "border-border hover:border-emerald-500/50"
                  }`}
                  title={idx === 0 ? "Capa atual" : "Usar como capa"}
                >
                  <img src={f.url} alt="" className="w-full h-full object-cover" />
                  {idx === 0 && (
                    <span className="absolute inset-x-0 bottom-0 bg-emerald-600 text-white text-[9px] font-bold text-center py-0.5">
                      CAPA
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
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
          onClick={handleSalvar}
          disabled={saving}
          className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
