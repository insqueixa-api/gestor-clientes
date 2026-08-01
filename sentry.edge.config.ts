// sentry.edge.config.ts
// Sentry — runtime Edge (middleware.ts).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: 0,

  enableLogs: true,
});
