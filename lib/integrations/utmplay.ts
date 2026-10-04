// lib/integrations/utmplay.ts
// UTM Play (utmplay.wtf) — 04/10/2026, testado ao vivo no aparelho do Márcio
// (login → ler listas → criar → apagar só a de teste). Site Express com sessão
// por cookie, sem captcha e sem PIN — ver app/api/integrations/apps/utmplay/route.ts.
export const UtmPlayIntegration = {
  actionPrefix: "UTMPLAY",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/utmplay",

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
