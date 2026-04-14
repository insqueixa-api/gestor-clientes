// /app/api/integrations/apps/ibopro/ibopro.ts

export const IboProAPI = {
  actionPrefix: "IBOPRO",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/ibopro",

  buildCreatePayload({
    macValue,
    m3uUrl,
    serverName,
    finalServerName,
    password, // PIN de proteção da playlist (de app_integrations.pin)
    // deviceKey é injetado pelo modal diretamente no payload via getDeviceKeyFromApp
  }: {
    macValue: string;
    m3uUrl: string;
    serverName?: string;
    finalServerName?: string;
    password?: string;
  }) {
    return {
      action: "create",
      mac_address: macValue,
      playlist_name: serverName || finalServerName || "Playlist",
      playlist_url: m3uUrl,
      pin: password || undefined,
    };
  },

  buildDeletePayload({
    macValue,
    serverName,
    finalServerName,
    password, // PIN de proteção da playlist
  }: {
    macValue: string;
    serverName?: string;
    finalServerName?: string;
    password?: string;
  }) {
    return {
      action: "delete",
      mac_address: macValue,
      playlist_name: serverName || finalServerName || "",
      pin: password || undefined,
    };
  },
};
