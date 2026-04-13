// /app/api/integrations/apps/ibosol/ibosol.ts

export const IbosolAPI = {
  actionPrefix: "IBOSOL",
  useApi: true, // ← sinaliza para o modal chamar API direta (não extensão)
  apiEndpoint: "/api/integrations/apps/ibosol",

  buildCreatePayload({
    appName,
    macValue,
    m3uUrl,
    finalServerName,
    serverName,
    password,
  }: {
    appName: string;
    macValue: string;
    m3uUrl: string;
    finalServerName?: string;
    serverName?: string;
    password?: string;
  }) {
    return {
      action: "create",
      app_name: appName,
      mac_address: macValue,
      playlist_name: serverName || finalServerName || "Playlist",
      playlist_url: m3uUrl,
      pin: password || undefined,
      device_key: undefined,
    };
  },

  buildDeletePayload({
    appName,
    macValue,
    deviceKey,
  }: {
    appName: string;
    macValue: string;
    deviceKey?: string;
  }) {
    return {
      action: "delete",
      app_name: appName,
      mac_address: macValue,
      device_key: deviceKey || "",
    };
  },
};