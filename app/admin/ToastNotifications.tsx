"use client";

import { useEffect, useRef } from "react";

export type ToastMessage = {
  id: number;
  type: "success" | "error" | "warning"; // ✅ ADICIONADO
  title: string;
  message?: string;
  durationMs?: number;
};

interface Props {
  toasts: ToastMessage[];
  removeToast: (id: number) => void;
}

export default function ToastNotifications({ toasts, removeToast }: Props) {
  const timersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  // agenda auto-dismiss por toast (uma vez por id)
  useEffect(() => {
    // cria timers para novos toasts
    for (const t of toasts) {
      if (timersRef.current.has(t.id)) continue;

      const duration = Math.max(1000, Number(t.durationMs ?? 5000));

      const timer = setTimeout(() => {
        timersRef.current.delete(t.id);
        removeToast(t.id);
      }, duration);

      timersRef.current.set(t.id, timer);
    }

    // remove timers órfãos (toast já removido manualmente)
    for (const [id, timer] of timersRef.current.entries()) {
      if (!toasts.some((t) => t.id === id)) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
    }

    // cleanup geral ao desmontar
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, [toasts, removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-9999999 flex flex-col gap-2 w-full max-w-md pointer-events-none">
      {toasts.map((t) => {
        const duration = Math.max(1000, Number(t.durationMs ?? 5000));

        return (
          <div
            key={t.id}
className={`pointer-events-auto relative overflow-hidden flex items-start gap-3 p-4 rounded-xl shadow-2xl border transition-all animate-in fade-in slide-in-from-top-5 duration-300 ${
  t.type === "success"
    ? "bg-[#0f141a]/95 border-emerald-500/50 text-emerald-100 shadow-emerald-900/20"
    : t.type === "warning"
      ? "bg-[#0f141a]/95 border-amber-500/50 text-amber-100 shadow-amber-900/20"
      : "bg-[#0f141a]/95 border-rose-500/50 text-rose-100 shadow-rose-900/20"
}`}
          >
            {/* Ícone */}
            <div className={`mt-0.5 ${
  t.type === "success" ? "text-emerald-500" 
  : t.type === "warning" ? "text-amber-500" 
  : "text-rose-500"
}`}>
  {t.type === "success" ? (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : t.type === "warning" ? (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )}
</div>

            {/* Texto */}
            <div className="flex-1">
              <h4 className="font-bold text-sm">{t.title}</h4>
              {t.message && <p className="text-xs opacity-80 mt-1">{t.message}</p>}
            </div>

            {/* Botão Fechar */}
            <button
              type="button"
              onClick={() => {
                const timer = timersRef.current.get(t.id);
                if (timer) {
                  clearTimeout(timer);
                  timersRef.current.delete(t.id);
                }
                removeToast(t.id);
              }}
              className="text-white/40 hover:text-white transition-colors"
              aria-label="Fechar toast"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Barra de tempo */}
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-white/10">
<div
  className={`h-full ${
    t.type === "success" ? "bg-emerald-400/80" 
    : t.type === "warning" ? "bg-amber-400/80" 
    : "bg-rose-400/80"
  } origin-left`}
                style={{
                  width: "100%",
                  animation: `toast-progress-shrink ${duration}ms linear forwards`,
                }}
              />
            </div>
          </div>
        );
      })}

      {/* keyframes locais */}
      <style jsx>{`
        @keyframes toast-progress-shrink {
          from {
            transform: scaleX(1);
          }
          to {
            transform: scaleX(0);
          }
        }
      `}</style>
    </div>
  );
}
