// lib/integrations/iptvplayerio.ts
// IPTV Playerio (iptvplayer.io) — login por mac+device_key (sem captcha),
// resolvido em app/api/integrations/apps/iptvplayerio/route.ts. Mesmo
// backend white-label do IPTV Duplex Play (api.iptvduplex.com) — só muda o
// domínio (api.iptvplayer.io) e a marca; endpoints e formato de resposta
// são idênticos (confirmado ao vivo em 28/07/2026).
export const IptvPlayerioIntegration = {
  actionPrefix: "IPTVPLAYERIO",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/iptvplayerio",

  buildCreatePayload: (params: {
    username: string;
    password?: string; // PIN da integração (PIN_HANDLERS) — protege a playlist
    macValue: string;
    finalServerName: string;
    serverName: string;
    m3uUrl: string;
    appName?: string;
  }) => {
    // Mesma regra do IPTVDUPLEX: usa finalServerName (único por cliente,
    // ex: "Insqueixa_NaTV") pra não colidir com playlists de OUTROS
    // clientes que compartilham o mesmo servidor — "Configurar" sempre
    // apaga-antes-de-criar buscando por essa mesma string.
    return {
      action: "create",
      macValue: params.macValue,
      finalServerName: params.finalServerName || params.serverName,
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
      username: params.finalServerName || params.serverName || params.username.trim(),
      macValue: params.macValue || "",
      password: params.password || "",
    };
  },
};
