"use client";

import { useEffect } from "react";
import { logoutAction } from "./actions";

export default function LogoutPage() {
  useEffect(() => {
    // 1. Limpa rastros locais no navegador do usuário
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
      window.localStorage.removeItem('supabase.auth.token'); // Fallback de limpeza
    }
    
    // 2. Aciona a ação do servidor para matar o cookie seguro
    logoutAction();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-[#0f141a]">
      <div className="animate-pulse text-slate-400 font-medium">Encerrando sessão...</div>
    </div>
  );
}