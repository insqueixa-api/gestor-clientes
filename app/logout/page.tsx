"use client";

import { useEffect } from "react";
import { logoutAction } from "./actions";

export default function LogoutPage() {
  useEffect(() => {
    // 1. Limpa rastros locais no navegador do usuário
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
      window.localStorage.removeItem("supabase.auth.token"); // Fallback de limpeza
    }

    // 2. Aciona a ação do servidor para matar o cookie seguro
    logoutAction();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="animate-pulse text-muted-foreground/80 font-medium">
        Encerrando sessão...
      </div>
    </div>
  );
}
