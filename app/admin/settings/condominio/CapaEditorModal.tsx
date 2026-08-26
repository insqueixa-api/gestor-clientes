"use client";
// app/admin/settings/condominio/CapaEditorModal.tsx
// "Ajustar capa" (achado 26/08/2026, pedido do Márcio: "a foto corta a
// cabeça... poderia arrastar a foto no melhor ângulo... e um botão de
// trocar foto"). Duas coisas num modal só: arrasta a foto de capa (fotos[0])
// pra cima/baixo — vira `posY` (0-100%, mesmo número de object-position) —
// e escolhe qualquer outra foto já enviada pra virar a nova capa (reordena
// o array, a escolhida vira fotos[0]). Salva direto em condominio_acoes.
import { useRef, useState } from "react";
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
          <p className="text-xs text-muted-foreground mb-2">
            Arraste a foto pra cima ou pra baixo pra escolher o melhor enquadramento.
          </p>
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
