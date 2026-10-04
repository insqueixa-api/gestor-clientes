// lib/integrations/cortex.ts
// Cortex Player (cortexplayer.site) — 03/10/2026, testado ao vivo no aparelho
// do Márcio. API própria (tvbox.agente.website/api/client), sem PIN da
// integração — ver app/api/integrations/apps/cortex/route.ts.
export const CortexIntegration = {
  actionPrefix: "CORTEX",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/cortex",

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
