// lib/integrations/capplayer.ts
// CAP Player (capplayer.com) — login por mac+device_key igual MessiTV/BOB
// Player/IBO Player, MAS backend diferente (Express próprio, não a
// "unified-backend" branca deles): SEM captcha, sessão por cookie
// (express:sess) criada num POST /login form-urlencoded normal, painel
// server-rendered (jQuery, não JSON API) — descoberto ao vivo em
// 06/09/2026 testando login real com MAC/Key do Márcio. Ver
// app/api/integrations/apps/capplayer/route.ts pro fluxo completo.
export const CapPlayerIntegration = {
  actionPrefix: "CAPPLAYER",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/capplayer",

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
    // top-level do body, mesmo padrão de MESSITV/BOBPLAYER/IBOPLAYER.
    //
    // finalServerName (ex: "Insqueixa_NaTV") é único por cliente — usar só
    // o nome do servidor colidiria com playlists de OUTROS clientes que
    // têm o mesmo servidor, já que "Configurar" sempre apaga-antes-de-criar
    // (handleConfigApp em novo_cliente.tsx) buscando por essa mesma string.
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
