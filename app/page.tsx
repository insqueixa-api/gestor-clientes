"use client";

import { Suspense, useEffect, useState } from "react";
import LoginClient from "./LoginClient";
import LandingPage from "./LandingPage";

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

  // Tela preta rápida enquanto decide (evita piscar o layout errado)
  if (hasToken === null) return <div className="min-h-screen bg-slate-50 dark:bg-[#0f141a]" />;

  // Se o cliente (aluno/assinante) abriu o link do WhatsApp
  if (hasToken) return <LoginClient />;

  // Se for o administrador/lojista acessando a raiz
  return <LandingPage />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-[#0f141a]" />}>
      <HomeRouter />
    </Suspense>
  );
}