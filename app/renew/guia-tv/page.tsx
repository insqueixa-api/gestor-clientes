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

function GuiaTVCliente() {
  const sp = useSearchParams();
  const raw = (sp.get("servidor") ?? "").toUpperCase();
  const servidorFiltro = SERVIDOR_MAP[raw] ?? "TODOS";
  const contaId = sp.get("conta") ?? "";

  // ✅ Mesma sessão do /renew, lida direto do sessionStorage (mesma origem) —
  // não precisa trafegar o token pela URL do Guia TV.
  const sessionToken =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("cp_session") || ""
      : "";

  // ✅ Loga a abertura da página uma única vez por montagem — silencioso, nunca bloqueia a UI
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    if (!sessionToken) return;
    logged.current = true;

    fetch("/api/client-portal/guia-tv/log-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servidor: servidorFiltro, session_token: sessionToken }),
      cache: "no-store",
    }).catch(() => {}); // falha de log nunca deve incomodar o cliente
  }, [servidorFiltro, sessionToken]);

  return (
    <GuiaTVView
      servidorFiltro={servidorFiltro}
      modoCliente
      sessionToken={sessionToken}
      contaId={contaId}
    />
  );
}

export default function GuiaTVClientePage() {
  return (
    <Suspense>
      <GuiaTVCliente />
    </Suspense>
  );
}
