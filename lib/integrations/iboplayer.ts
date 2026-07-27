// lib/integrations/iboplayer.ts
// IBO Player (iboplayer.com) — login por mac+device_key, captcha resolvido
// via Gemini na rota (app/api/integrations/apps/iboplayer/route.ts). Mesma
// família/backend do MessiTV e BOB Player. Substitui o fluxo antigo que
// vivia dentro de ibosol/route.ts (só delete, create quebrado via
// activation.iboplayer.com bloqueado por Cloudflare). Validado ao vivo em
// 27/07/2026: criar + listar + apagar playlist numa conta real com 3
// playlists de verdade (EliteTV, FastTV, NaTV), sem bloqueio de Cloudflare.
export const IboPlayerIntegration = {
  actionPrefix: "IBOPLAYER",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/iboplayer",

  buildCreatePayload: (params: {
    username: string;
    password?: string; // PIN da integração (PIN_HANDLERS) — protege a playlist
    macValue: string;
    finalServerName: string;
    serverName: string;
    m3uUrl: string;
    appName?: string;
  }) => {
    // deviceKey vem injetado pelo modal (novo_cliente.tsx) como campo
    // top-level do body, igual acontece com IBOPRO/QUICKPLAYER/MESSITV/BOBPLAYER.
    return {
      action: "create",
      macValue: params.macValue,
      finalServerName: params.serverName,
      m3uUrl: params.m3uUrl,
      password: params.password || "",
    };
  },

  buildDeletePayload: (params: {
    username: string;
    finalServerName?: string;
    serverName?: string;
    macValue: string;
    appName?: string;
    password?: string;
  }) => {
    return {
      action: "delete",
      username: params.serverName || params.username.trim(),
      macValue: params.macValue || "",
      password: params.password || "",
    };
  },
};
