// app/api/integrations/apps/ibopro/ibopro.ts
// /app/api/integrations/apps/ibopro/ibopro.ts
export const IboProAPI = {
  actionPrefix: "IBOPRO",
  useApi: true, // ✅ Login+criação+remoção rodam na VM/servidor via HTTP puro, sem extensão
  apiEndpoint: "/api/integrations/apps/ibopro",

  buildCreatePayload({
    macValue,
    m3uUrl,
    serverName,
    finalServerName,
    password, // PIN de proteção (de app_integrations.pin)
  }: {
    macValue: string;
    m3uUrl: string;
    serverName?: string;
    finalServerName?: string;
    password?: string;
  }) {
    return {
      action: "create",
      mac: macValue,
      playlist_name: serverName || finalServerName || "Playlist",
      playlist_url: m3uUrl,
      pin: password || undefined,
      // deviceKey é injetado pelo modal via getDeviceKeyFromApp
    };
  },

  buildDeletePayload({
    macValue,
    serverName,
    finalServerName,
    password,
  }: {
    macValue: string;
    serverName?: string;
    finalServerName?: string;
    password?: string;
  }) {
    return {
      action: "delete",
      mac: macValue,
      playlist_name: serverName || finalServerName || "",
      pin: password || undefined,
      // deviceKey é injetado via payloadDelete.deviceKey
    };
  },
};