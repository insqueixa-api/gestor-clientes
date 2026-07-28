// lib/integrations/bobplayer.ts
// BOB Player (bobplayer.com) — login por mac+device_key, captcha resolvido
// via Gemini na rota (app/api/integrations/apps/bobplayer/route.ts). Mesma
// família/backend do MessiTV, mas com sessão por COOKIE em vez de JWT
// Bearer — detalhe tratado inteiramente dentro da rota.
export const BobPlayerIntegration = {
  actionPrefix: "BOBPLAYER",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/bobplayer",

  buildCreatePayload: (params: {
    username: string;
    password?: string; // PIN da integração (PIN_HANDLERS) — protege a playlist
    macValue: string;
    finalServerName: string;
    serverName: string;
    m3uUrl: string;
    appName?: string;
  }) => {
    // deviceKey vem injetado pelo modal (novo_cliente.tsx) como campo
    // top-level do body, igual acontece com IBOPRO/QUICKPLAYER/MESSITV.
    //
    // finalServerName (ex: "Insqueixa_NaTV") é único por cliente — usar só
    // o nome do servidor (params.serverName, ex: "NaTV") colidiria com
    // playlists de OUTROS clientes que têm o mesmo servidor, já que
    // "Configurar" sempre apaga-antes-de-criar (handleConfigApp em
    // novo_cliente.tsx) buscando por essa mesma string. DUPLECAST é a ÚNICA
    // exceção de propósito (ver duplecast.ts).
    return {
      action: "create",
      macValue: params.macValue,
      finalServerName: params.finalServerName || params.serverName,
      m3uUrl: params.m3uUrl,
      password: params.password || "",
    };
  },

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
      username: params.finalServerName || params.serverName || params.username.trim(),
      macValue: params.macValue || "",
      password: params.password || "",
    };
  },
};
