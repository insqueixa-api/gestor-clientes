// sentry.server.config.ts
// Sentry — runtime Node.js do servidor (rotas de API, server components).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Amostra baixa só pra ter visibilidade de latência de rota/query (sem
  // risco de PII — diferente do client, que tem tracing desligado de
  // propósito por causa de dado sensível de pagamento no portal).
  tracesSampleRate: 0.1,

  includeLocalVariables: true,

  enableLogs: true,
});
