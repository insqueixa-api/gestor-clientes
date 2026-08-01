// instrumentation-client.ts
// Sentry — runtime do navegador. Session Replay e Tracing ficam desligados
// de propósito por enquanto: o portal do cliente (renew-beta) lida com
// pagamento/dados de conta, e ligar replay sem configurar mascaramento
// antes arriscaria gravar informação sensível sem querer.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0,

  enableLogs: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
