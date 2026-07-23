// app/api/integrations/apps/ibosol/ibosol.ts
// /app/api/integrations/apps/ibosol/ibosol.ts

export const IbosolAPI = {
  actionPrefix: "IBOSOL",
  // ❌ Voltou a ser via extensão (21-22/07/2026): activation.iboplayer.com e
  // iboplayer.com bloqueiam qualquer chamada server-to-server (Vercel ou
  // local) com um desafio Cloudflare que nem Playwright real resolve — só
  // funciona de dentro de um navegador genuíno, não controlado por CDP.
  useApi: false,
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
    serverName,
    finalServerName,
    password,
  }: {
    appName: string;
    macValue: string;
    deviceKey?: string;
    serverName?: string;
    finalServerName?: string;
    password?: string; // PIN da playlist
  }) {
    return {
      action: "delete",
      app_name: appName,
      mac_address: macValue,
      device_key: deviceKey || "",
      playlist_name: serverName || finalServerName || "",
      pin: password || undefined,
    };
  },
};