"use client";
// app/admin/settings/whatsapp/VmMaintenanceModal.tsx
import { useState } from "react";
import { Loader2, Power, RotateCw, Trash2, Wrench } from "lucide-react";
import { useConfirm } from "@/hooks/useConfirm";
import { Modal, ModalHeader, ModalBody } from "@/components/ui/Modal";

export default function VmMaintenanceModal({
  onClose,
  addToast,
}: {
  onClose: () => void;
  addToast: (t: "success" | "error", title: string, msg?: string) => void;
}) {
  const { confirm } = useConfirm();
  const [restartingService, setRestartingService] = useState(false);
  const [rebootingVm, setRebootingVm] = useState(false);
  const [hardResetting, setHardResetting] = useState(false);
  async function handleRestartService() {
    const ok = await confirm({
      title: "Reiniciar serviço?",
      subtitle: "Reinicia o processo do WhatsApp (~10s).",
      tone: "amber",
      confirmText: "Reiniciar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setRestartingService(true);
    try {
      await fetch("/api/whatsapp/restart-service", { method: "POST" });
      addToast("success", "Serviço reiniciado");
    } catch (e: any) {
      addToast("error", "Erro", e?.message);
    } finally {
      setTimeout(() => setRestartingService(false), 10000);
    }
  }
  async function handleRebootVm() {
    const ok = await confirm({
      title: "Reiniciar a VM inteira?",
      subtitle: "Reboot completo (~30-60s de indisponibilidade).",
      tone: "rose",
      confirmText: "Reiniciar VM",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setRebootingVm(true);
    try {
      const res = await fetch("/api/whatsapp/vm-reboot", { method: "POST" });
      if (res.ok)
        addToast(
          "success",
          "VM reiniciando",
          "Em ~1 minuto tudo volta sozinho.",
        );
      else {
        const json = await res.json().catch(() => ({}));
        addToast("error", "Erro ao reiniciar VM", json?.error);
      }
    } finally {
      setTimeout(() => setRebootingVm(false), 60000);
    }
  }
  async function handleHardReset() {
    const ok = await confirm({
      title: "Hard reset — apagar as 2 sessões?",
      subtitle:
        "Apaga TODAS as credenciais salvas dos 2 números conectados (não preserva nada) e reinicia o serviço. Depois disso as duas sessões ficam desconectadas — você precisa escanear QR Code novo pra cada uma. Só use se reconectar com QR novo não resolveu.",
      tone: "rose",
      confirmText: "Apagar tudo e resetar",
      cancelText: "Voltar",
    });
    if (!ok) return;
    setHardResetting(true);
    try {
      const res = await fetch("/api/whatsapp/hard-reset", { method: "POST" });
      if (res.ok)
        addToast(
          "success",
          "Sessões apagadas",
          "Serviço reiniciando. Gere um QR Code novo pra cada número quando voltar (~10-15s).",
        );
      else {
        const json = await res.json().catch(() => ({}));
        addToast("error", "Erro no hard reset", json?.error);
      }
    } catch (e: any) {
      addToast("error", "Erro no hard reset", e?.message);
    } finally {
      setTimeout(() => setHardResetting(false), 15000);
    }
  }
  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <ModalHeader onClose={onClose}>
        <h3 className="text-base font-medium text-foreground flex items-center gap-2">
          <Wrench className="w-4 h-4 text-muted-foreground" /> Manutenção VM
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Tente nesta ordem: serviço primeiro, VM só se não resolver.
        </p>
      </ModalHeader>

      <ModalBody className="p-6 space-y-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <div className="flex items-start gap-2">
              <RotateCw className="w-4 h-4 mt-0.5 text-emerald-500" />
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-emerald-600">
                  Reiniciar serviço
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Útil para um restart leve do processo do WhatsApp sem impactar
                  a VM inteira.
                </p>
              </div>
            </div>
            <button
              onClick={() => void handleRestartService()}
              disabled={restartingService}
              className="mt-3 w-full py-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium text-xs hover:bg-emerald-500/20 flex items-center justify-center gap-2"
            >
              {restartingService ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCw className="w-4 h-4" />
              )}{" "}
              Reiniciar Serviço (~10s)
            </button>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2">
              <Power className="w-4 h-4 mt-0.5 text-amber-500" />
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-amber-600">
                  Reiniciar VM
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Use quando o container/host estiver travado e o restart leve
                  não resolver.
                </p>
              </div>
            </div>
            <button
              onClick={() => void handleRebootVm()}
              disabled={rebootingVm}
              className="mt-3 w-full py-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium text-xs hover:bg-amber-500/20 flex items-center justify-center gap-2"
            >
              {rebootingVm ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Power className="w-4 h-4" />
              )}{" "}
              Reiniciar VM Completa (~60s)
            </button>
          </div>

          <div className="rounded-xl border border-rose-600/20 bg-rose-600/10 p-3">
            <div className="flex items-start gap-2">
              <Trash2 className="w-4 h-4 mt-0.5 text-rose-600" />
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-rose-700">
                  Hard reset
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Último recurso. Apaga as sessões e força novo QR para as 2
                  contas.
                </p>
              </div>
            </div>
            <button
              onClick={() => void handleHardReset()}
              disabled={hardResetting}
              className="mt-3 w-full py-2.5 rounded-lg bg-rose-600/10 text-rose-600 border border-rose-600/20 font-medium text-xs hover:bg-rose-600/20 flex items-center justify-center gap-2"
            >
              {hardResetting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}{" "}
              Hard Reset — Apagar as 2 sessões
            </button>
          </div>
        </ModalBody>
    </Modal>
  );
}
