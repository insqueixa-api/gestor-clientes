// sentry.edge.config.ts
// Sentry — runtime Edge. Hoje nada no projeto roda em edge (proxy.ts passou
// a rodar em Node.js por padrão a partir do Next 16), mantido só pra cobrir
// se algum dia surgir uma rota explicitamente edge.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: 0,

  enableLogs: true,
});
