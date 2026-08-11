"use client";
// app/redirect-kiwi/page.tsx

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function RedirectLogic() {
  const searchParams = useSearchParams();
  const rawUrl = searchParams.get("url");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // ✅ Só redireciona para a mesma origem (evita virar open-redirect
    // genérico via ?url=https://site-arbitrario.com usando o domínio real do
    // sistema pra dar aparência de legitimidade a um link de phishing) —
    // todos os usos reais (e-mails de notificação) sempre apontam pra
    // páginas /admin/... do próprio domínio. Checagem só client-side (window
    // não existe durante SSR).
    if (rawUrl && rawUrl.startsWith(window.location.origin)) {
      setUrl(rawUrl);
    }
  }, [rawUrl]);

  useEffect(() => {
    if (url) {
      // Tira o https:// para construir o Intent corretamente
      const cleanUrl = url.replace(/^https?:\/\//, "");

      // Cria a string do intent
      const kiwiIntentUrl = `intent://${cleanUrl}#Intent;scheme=https;package=com.kiwibrowser.browser;action=android.intent.action.VIEW;end;`;

      // Dispara o redirecionamento
      window.location.href = kiwiIntentUrl;

      // Fallback: se em 2 segundos o app não abrir, mostra o link na tela
      setTimeout(() => {
        const p = document.getElementById("fallback-msg");
        if (p) p.style.display = "block";
      }, 2000);
    }
  }, [url]);

  return (
    <div
      style={{
        textAlign: "center",
        marginTop: "100px",
        fontFamily: "sans-serif",
      }}
    >
      <h2>Abrindo no Kiwi Browser...</h2>
      <p id="fallback-msg" style={{ display: "none", color: "#666" }}>
        Se o Kiwi Browser não abriu automaticamente, certifique-se de que ele
        está instalado.
        <br />
        <br />
        <a
          href={`intent://${url?.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.kiwibrowser.browser;action=android.intent.action.VIEW;end;`}
          style={{ color: "#10b981" }}
        >
          Tentar novamente
        </a>
      </p>
    </div>
  );
}

export default function RedirectKiwi() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <RedirectLogic />
    </Suspense>
  );
}
