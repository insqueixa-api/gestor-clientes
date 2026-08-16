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
      // ✅ Era serverName || finalServerName — ordem invertida em relação a
      // TODA outra integração da família (bobplayer/iboplayer/messitv/
      // iptvduplex/iptvplayerio). finalServerName (ex: "Insqueixa_NaTV") é
      // único por cliente; serverName sozinho (ex: "NaTV") colide entre
      // clientes diferentes no mesmo servidor — exatamente o motivo
      // documentado nas outras integrações.
      playlist_name: finalServerName || serverName || "Playlist",
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
      // ✅ Mesma correção do buildCreatePayload acima — precisa buscar a
      // playlist pelo nome único do cliente, senão um "Remover" pode achar
      // a playlist de OUTRO cliente que compartilha o mesmo servidor.
      playlist_name: finalServerName || serverName || "",
      pin: password || undefined,
      // deviceKey é injetado via payloadDelete.deviceKey
    };
  },
};