"use client";
// app/renew/ConfigureResultModal.tsx
//
// Tela de resultado (não Toast) do Configurar/Reconfigurar — mesmo estilo
// visual da tela de "Renovação com sucesso" do Bloco 1. Pedido do Márcio
// (28/07/2026): depois de configurar, o cliente precisa de instruções
// claras (fechar o app na TV, abrir de novo, recarregar a lista) em vez de
// só um toast que some sozinho. Reaproveitado tanto em RenewBetaClient.tsx
// (lista principal) quanto em apps/[id]/AppDetailClient.tsx (detalhe).
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { buildPortalSupportLink } from "@/lib/client-portal/support-link";

export type ConfigureResultData = {
  kind: "success" | "error" | "blocked";
  isReconfigure: boolean;
  appName: string;
  expireDate?: string | null;
  repeatWarning?: boolean;
  errorMessage?: string;
  escalate?: boolean;
  suggestSecondary?: boolean;
};

function SupportLink({ supportPhone }: { supportPhone: string }) {
  if (!supportPhone) return null;
  return (
    <a
      href={buildPortalSupportLink(supportPhone)}
      target="_blank"
      rel="noreferrer"
      className="inline-block text-sm font-bold text-sky-500 hover:underline"
    >
      Falar com o suporte →
    </a>
  );
}

export default function ConfigureResultModal({
  open,
  onCloseAction,
  data,
  supportPhone,
}: {
  open: boolean;
  onCloseAction: () => void;
  data: ConfigureResultData | null;
  supportPhone: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseAction();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCloseAction]);

  if (!mounted || !open || !data) return null;

  const isSuccess = data.kind === "success";
  const isBlocked = data.kind === "blocked";

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseAction();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[calc(100vw-1rem)] sm:max-w-xl md:max-w-2xl lg:max-w-3xl bg-card border border-border rounded-2xl shadow-2xl p-6 sm:p-7 text-center animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
      >
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
            isSuccess
              ? "bg-emerald-500/20"
              : isBlocked
                ? "bg-amber-500/20"
                : "bg-rose-500/10"
          }`}
        >
          {isSuccess ? (
            <svg
              className="w-8 h-8 text-emerald-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : isBlocked ? (
            <svg
              className="w-8 h-8 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          ) : (
            <svg
              className="w-8 h-8 text-rose-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}
        </div>

        <h2 className="text-xl font-bold text-foreground mb-2">
          {isSuccess
            ? data.isReconfigure
              ? "Reconfigurado com sucesso ✅"
              : "Configurado com sucesso ✅"
            : isBlocked
              ? "Muitas tentativas seguidas"
              : "Não foi possível concluir"}
        </h2>

        {isSuccess ? (
          <div className="space-y-3 text-left">
            {(data.repeatWarning || data.suggestSecondary) && (
              <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <p className="text-xs text-amber-500 font-medium">
                  {data.suggestSecondary
                    ? "Se ainda não resolver, tente novamente escolhendo a outra opção de configuração."
                    : "Você já tinha feito essa ação recentemente — agora ela não muda mais nada."}
                </p>
              </div>
            )}

            {data.expireDate && (
              <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <p className="text-sm text-emerald-500 font-medium">
                  Vencimento:{" "}
                  {String(data.expireDate).split("-").reverse().join("/")}
                </p>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              Agora feche o aplicativo{" "}
              <strong className="text-foreground">{data.appName}</strong> na sua
              TV, abra de novo e procure um botão de{" "}
              <strong className="text-foreground">Atualizar</strong> ou{" "}
              <strong className="text-foreground">Recarregar</strong> a lista de
              canais dentro do app.
            </p>

            {data.isReconfigure && (
              <p className="text-sm text-muted-foreground">
                Se o problema continuar, desligue a TV e o modem por alguns
                minutos e tente de novo.
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              Se ainda tiver algum problema, é só falar com o suporte.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {data.errorMessage ||
                "Não foi possível concluir agora. Tente novamente em instantes."}
            </p>
            {data.suggestSecondary && (
              <p className="text-xs text-amber-500 font-medium">
                Se quiser tentar novamente, use a outra opção de configuração.
              </p>
            )}
          </div>
        )}

        {isBlocked && (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-left">
            <p className="text-xs text-amber-500 font-medium">
              Aguarde alguns minutos antes de tentar de novo. Se preferir, feche
              esta janela e volte mais tarde.
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-col items-center gap-3">
          {(isSuccess || isBlocked || data.escalate) && (
            <SupportLink supportPhone={supportPhone} />
          )}
          <button
            onClick={onCloseAction}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md transition-colors"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
