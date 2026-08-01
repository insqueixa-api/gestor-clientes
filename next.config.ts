import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // ✅ O service worker cacheia GET /api/* por padrão (NetworkFirst, 24h) — se
  // uma exportação demorar mais que o timeout de rede do PWA, ele serve do
  // cache uma resposta ANTIGA em vez da atual. Isso já causou download de um
  // .xlsx desatualizado mesmo depois do bug no servidor já estar corrigido.
  // Downloads de arquivo nunca devem vir de cache — sempre rede.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
          sameOrigin && url.pathname.startsWith("/api/import_export/"),
        handler: "NetworkOnly",
        method: "GET",
      },
    ],
  },
});

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

export default withSentryConfig(withPWA(nextConfig), {
  org: "unigestor",
  project: "javascript-nextjs",

  authToken: process.env.SENTRY_AUTH_TOKEN,

  widenClientFileUpload: true,

  tunnelRoute: "/monitoring",

  silent: !process.env.CI,
});
