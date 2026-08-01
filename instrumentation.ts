// instrumentation.ts
// Hook de registro do Next.js — carrega a config certa do Sentry conforme o
// runtime (nodejs para rotas normais e proxy.ts — proxy sempre roda em
// Node.js desde a v16 do Next, não existe mais opção de rodar em edge nele;
// o branch "edge" abaixo só é usado se algum dia existir outro código
// rodando explicitamente em edge runtime no projeto).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
