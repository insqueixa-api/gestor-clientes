"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

export default function RenewClient() {
  const sp = useSearchParams();
  const session = useMemo(() => (sp.get("session") ?? "").trim(), [sp]);

  // Se não tiver sessão, mostra erro
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f141a]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-2">
            Sessão Inválida
          </h1>
          <p className="text-slate-500 dark:text-white/60">
            Faça login novamente
          </p>
        </div>
      </div>
    );
  }

  // Painel logado (placeholder por enquanto)
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f141a]">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-4">
          🎉 Área Logada
        </h1>
        <p className="text-slate-500 dark:text-white/60 mb-2">
          Session: {session.slice(0, 30)}...
        </p>
        <p className="text-xs text-slate-400">
          (Painel em desenvolvimento)
        </p>
      </div>
    </div>
  );
}