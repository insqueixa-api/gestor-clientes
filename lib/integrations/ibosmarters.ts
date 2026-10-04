// lib/integrations/ibosmarters.ts
// IBO Smarters Player (ibosmartersplayer.com) — 03/10/2026, testado ao vivo no
// aparelho do Márcio (login → info → enviar 2 listas → apagar 1 → apagar a outra).
// API própria (não é inoRain): ver app/api/integrations/apps/ibosmarters/route.ts.
// Sem PIN — o site não tem proteção de playlist.
export const IboSmartersIntegration = {
  actionPrefix: "IBOSMARTERS",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/ibosmarters",

  // finalServerName ("Insqueixa_NaTV") é único por cliente — "Configurar"
  // apaga-antes-de-criar buscando por esse nome.
  buildCreatePayload: (params: {
    username: string;
    password?: string;
    macValue: string;
    finalServerName: string;
    serverName: string;
    m3uUrl: string;
    appName?: string;
  }) => ({
    action: "create",
    macValue: params.macValue,
    finalServerName: params.finalServerName || params.serverName,
    m3uUrl: params.m3uUrl,
  }),

  buildDeletePayload: (params: {
    username: string;
    finalServerName?: string;
    serverName?: string;
    macValue: string;
    appName?: string;
    password?: string;
  }) => ({
    action: "delete",
    username: params.finalServerName || params.serverName || params.username.trim(),
    macValue: params.macValue || "",
  }),
};
