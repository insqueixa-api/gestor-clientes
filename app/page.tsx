"use client";

import { Suspense, useEffect, useState } from "react";
import LoginClient from "./LoginClient";

function HomeRouter() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    // 1. Verifica token via QueryString (?t=123)
    const urlParams = new URLSearchParams(window.location.search);
    const fromQuery = urlParams.get("t")?.trim();

    // 2. Verifica token via Hash (#t=123)
    let fromHash = "";
    const h = window.location.hash || "";
    const m = h.match(/(?:^#|[&#])t=([^&]+)/);
    if (m?.[1]) fromHash = m[1];

    // 3. Verifica no sessionStorage
    let stored = "";
    try {
      stored = window.sessionStorage.getItem("cp_login_token") || "";
    } catch {}

    // Roteamento
    if (fromQuery || fromHash || stored) {
      setHasToken(true);
    } else {
      setHasToken(false);
    }
  }, []);

  // Tela preta rápida apenas enquanto carrega
  if (hasToken === null) {
    return <div className="min-h-screen bg-background" />;
  }

  // Agora a raiz ("/") exibe o Login do Cliente, com ou sem token inicial
  return <LoginClient />;
}

export default function HomePage() {
  return (
    <Suspense
      fallback={<div className="min-h-screen bg-background" />}
    >
      <HomeRouter />
    </Suspense>
  );
}
