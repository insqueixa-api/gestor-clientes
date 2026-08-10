"use client";
// components/apps/ReconfigureModeModal.tsx
//
// Escolha entre "Principal" (mantém a config de rede atual) e "Secundária"
// (gera uma configuração nova, sorteando outra DNS do servidor) ao
// reconfigurar um app — usado tanto no admin (novo_cliente.tsx) quanto no
// portal do cliente (renew-beta). Pedido do Márcio (28/07/2026).
import { useEffect } from "react";
import { Modal } from "@/components/ui/Modal";

export type ReconfigureMode = "principal" | "secundaria";

export default function ReconfigureModeModal({
  open,
  onClose,
  onChoose,
  appName,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (mode: ReconfigureMode) => void;
  appName: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-md" zIndex="z-[100000]">
      <div className="p-6 overflow-y-auto min-h-0 custom-scrollbar">
        <h3 className="text-lg font-bold text-foreground mb-1">
          Reconfigurar {appName}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Isso vai apagar a configuração atual desse app no painel e criar uma
          nova, do zero. Use essa opção quando o aplicativo estiver apresentando
          alguma falha — não é necessário reconfigurar um app que já está
          funcionando bem.
        </p>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onChoose("principal")}
            className="w-full text-left p-3 rounded-xl border border-border hover:border-sky-500/50 hover:bg-sky-500/5 transition-colors"
          >
            <p className="text-sm font-bold text-foreground">Principal</p>
            <p className="text-xs text-muted-foreground">
              Mantém a configuração de rede atual. Tente essa primeiro.
            </p>
          </button>
          <button
            type="button"
            onClick={() => onChoose("secundaria")}
            className="w-full text-left p-3 rounded-xl border border-border hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors"
          >
            <p className="text-sm font-bold text-foreground">Secundária</p>
            <p className="text-xs text-muted-foreground">
              Troca o servidor de conexão usado pelo app por outro disponível.
              Se já tentou a Principal e o problema continuou, tente essa agora.
            </p>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
