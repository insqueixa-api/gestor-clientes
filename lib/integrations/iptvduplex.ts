// lib/integrations/iptvduplex.ts
// IPTV Duplex Play (iptvduplex.com) — login por mac+device_key (sem
// captcha), resolvido em app/api/integrations/apps/iptvduplex/route.ts.
// NÃO confundir com "DuplexPlay" (app descontinuado no catálogo) nem com o
// handler "DUPLECAST" (duplecast.com — site diferente). Validado ao vivo em
// 27/07/2026: criar + listar + apagar playlist numa conta real com 3
// playlists de verdade (NaTV/FastTV/Elite), sem bloqueio de Cloudflare.
export const IptvDuplexIntegration = {
  actionPrefix: "IPTVDUPLEX",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/iptvduplex",

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
    // top-level do body, igual acontece com IBOPRO/QUICKPLAYER/MESSITV/BOBPLAYER/IBOPLAYER.
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
