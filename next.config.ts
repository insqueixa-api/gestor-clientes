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

  widenClientFileUpload: true,

  tunnelRoute: "/monitoring",

  silent: !process.env.CI,
});
