import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  compiler: {
    // ✅ Antes removia TODO console.* em produção (client E servidor —
    // inclui rotas de API), deixando logs de erro mudos mesmo quando o
    // código chamava console.error de propósito. Mantém só console.error.
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
  // ✅ @resvg/resvg-js carrega um binário nativo (.node) por plataforma. Sem isso,
  // o webpack tenta empacotar o .node como JS e quebra o build ("Unexpected
  // character" nos binários linux-x64-gnu/musl). serverExternalPackages faz o
  // Next tratar o pacote como require() puro no runtime do servidor, sem passar
  // pelo bundler.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default withSentryConfig(nextConfig, {
  org: "unigestor",
  project: "javascript-nextjs",

  authToken: process.env.SENTRY_AUTH_TOKEN,

  // ❌ 11/09/2026: widenClientFileUpload sobe sourcemap de código do
  // Next.js/dependências além do nosso próprio (não só amplia o que É
  // enviado pro Sentry — amplia o que fica gerado/processado no build).
  // Testado ao vivo: nem isso nem sourcemap em geral são o vilão real do
  // Functions Storage (map total local = 3.4MB, insignificante) — mas
  // manter isso ligado sem necessidade não ajuda em nada, então desliga.
  widenClientFileUpload: false,

  // ✅ 11/09/2026, pedido do Márcio (Functions Storage no limite do Hobby):
  // força a apagar TODO .map do output final depois de subir pro Sentry —
  // o padrão do SDK só apaga os de client-side, mantendo os de
  // server-side "de propósito" (documentação deles). Como o Sentry já tem
  // a cópia própria pra symbolicar erro, isso não perde nada.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
    filesToDeleteAfterUpload: ["**/*.js.map", "**/*.mjs.map"],
  },

  tunnelRoute: "/monitoring",

  // ✅ 11/09/2026, pedido do Márcio (Functions Storage no limite do Hobby):
  // essa SIM foi a alavanca real, testada ao vivo (rebuild local: .next
  // caiu de 606MB pra 552MB, .next/server de 154MB pra 135MB) — desliga o
  // "embrulho automático" que a Sentry injeta em TODA rota/middleware/
  // componente de servidor, mesmo os que nunca chamam Sentry. As 21
  // chamadas manuais de Sentry.captureException/captureMessage (webhooks
  // de pagamento, fulfillment, envio de WhatsApp) continuam funcionando
  // 100% normal — dependem só do SDK inicializado (sentry.server.config.ts
  // etc.), não dessa auto-instrumentação.
  webpack: {
    autoInstrumentServerFunctions: false,
    autoInstrumentAppDirectory: false,
    autoInstrumentMiddleware: false,
  },

  silent: !process.env.CI,
});
