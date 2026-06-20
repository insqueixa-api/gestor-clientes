// app/renew/guia-tv/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import GuiaTVView from "@/app/components/guia-tv/GuiaTVView";

type ServidorFiltro = "ELITE" | "NATV" | "FAST" | "TODOS";

const SERVIDOR_MAP: Record<string, ServidorFiltro> = {
  ELITE: "ELITE",
  NATV: "NATV",
  FAST: "FAST",
  TODOS: "TODOS",
};

function getStoredSession(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem("cp_session") || "";
  } catch {
    return "";
  }
}

function GuiaTVCliente() {
  const sp = useSearchParams();
  const raw = (sp.get("servidor") ?? "").toUpperCase();
  const servidorFiltro = SERVIDOR_MAP[raw] ?? "TODOS";

  // ✅ Loga a abertura da página uma única vez por montagem — silencioso, nunca bloqueia a UI
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;

    const sessionToken = getStoredSession();
    if (!sessionToken) return; // sem sessão salva, não há o que logar com segurança

    fetch("/api/client-portal/guia-tv/log-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: sessionToken, servidor: servidorFiltro }),
      cache: "no-store",
    }).catch(() => {}); // falha de log nunca deve incomodar o cliente
  }, [servidorFiltro]);

  return <GuiaTVView servidorFiltro={servidorFiltro} modoCliente />;
}

export default function GuiaTVClientePage() {
  return (
    <Suspense>
      <GuiaTVCliente />
    </Suspense>
  );
}