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
    //
    // ⚠️ 27/07/2026: usar SÓ o nome do servidor (params.serverName, ex:
    // "NaTV") aqui era um bug real, não só cosmético — o "Configurar" sempre
    // apaga-antes-de-criar (ver handleConfigApp em novo_cliente.tsx), e a
    // busca por nome no delete/create usa EXATAMENTE essa string. Como o
    // nome do servidor sozinho colide com playlists de OUTROS clientes que
    // por acaso têm o mesmo servidor, isso apaga a playlist real de um
    // servidor pra criar uma vazia no lugar (achado em produção no
    // IPTVDUPLEX, mesmo bug copiado pra cá). `finalServerName` (ex:
    // "Insqueixa_NaTV") é o padrão usado por QUICKPLAYER e é único por
    // cliente — DUPLECAST é a ÚNICA exceção de propósito (pedido específico
    // do Márcio, documentado em duplecast.ts).
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
