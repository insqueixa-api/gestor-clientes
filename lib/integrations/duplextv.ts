// lib/integrations/duplextv.ts
// Duplex TV (duplex24.com) — SEM device_key/PIN, só mac + nome + URL.
// Resolvido em app/api/integrations/apps/duplextv/route.ts. Standalone —
// não depende mais da família IBOSOL (removida por completo do projeto).
export const DuplexTvIntegration = {
  actionPrefix: "DUPLEXTV",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/duplextv",

  buildCreatePayload: (params: {
    username: string;
    password?: string;
    macValue: string;
    finalServerName: string;
    serverName: string;
    m3uUrl: string;
    appName?: string;
  }) => {
    return {
      action: "create",
      macValue: params.macValue,
      finalServerName: params.finalServerName || params.serverName,
      m3uUrl: params.m3uUrl,
    };
  },

  // Sem PIN e sem busca por nome — o parceiro só sabe apagar TODAS as
  // playlists de um mac de uma vez (sem delete seletivo), então o único
  // dado que a rota precisa é o próprio macValue.
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
      macValue: params.macValue || "",
    };
  },
};
