export const QuickPlayerAPI = {
  actionPrefix: "QUICKPLAYER",
  useApi: true, // Avisa a tela para usar o backend, não a extensão
  apiEndpoint: "/api/integrations/apps/quickplayer/proxy",

  buildCreatePayload({
    macValue,
    m3uUrl,
    serverName,
    finalServerName,
    password, // Usado como PIN
    appName
  }: any) {
    return {
      action: "CREATE",
      mac: macValue,
      playlist_name: serverName || finalServerName || "Playlist",
      playlist_url: m3uUrl,
      pin: password || undefined,
      appName
    };
  },

  buildDeletePayload({
    macValue,
    serverName,
    finalServerName,
    password,
    appName
  }: any) {
    return {
      action: "DELETE",
      mac: macValue,
      playlist_name: serverName || finalServerName || "",
      pin: password || undefined,
      appName
    };
  },
};