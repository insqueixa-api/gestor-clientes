// lib/integrations/messitv.ts
// MessiTV (messitvplayer.com) — login por mac+device_key, captcha resolvido
// via Gemini na rota (app/api/integrations/apps/messitv/route.ts). Validado
// ao vivo em 27/07/2026: criar + listar + apagar playlist numa conta real,
// sem bloqueio de Cloudflare (diferente do activation.iboplayer.com/IBOSOL).
export const MessiTVIntegration = {
  actionPrefix: "MESSITV",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/messitv",

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
    // top-level do body, igual acontece com IBOPRO/QUICKPLAYER.
    return {
      action: "create",
      macValue: params.macValue,
      finalServerName: params.serverName,
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
      username: params.serverName || params.username.trim(),
      macValue: params.macValue || "",
      password: params.password || "",
    };
  },
};
