// lib/integrations/iptvduplex.ts
// IPTV Duplex Play (iptvduplex.com) — login por mac+device_key (sem
// captcha), resolvido em app/api/integrations/apps/iptvduplex/route.ts.
// NÃO confundir com "DuplexPlay" (app descontinuado no catálogo) nem com o
// handler "DUPLECAST" (duplecast.com — site diferente). Validado ao vivo em
// 27/07/2026: criar + listar + apagar playlist numa conta real com 3
// playlists de verdade (NaTV/FastTV/Elite), sem bloqueio de Cloudflare.
export const IptvDuplexIntegration = {
  actionPrefix: "IPTVDUPLEX",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/iptvduplex",

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
    // top-level do body, igual acontece com IBOPRO/QUICKPLAYER/MESSITV/BOBPLAYER/IBOPLAYER.
    //
    // ⚠️ 27/07/2026: usar SÓ o nome do servidor (params.serverName, ex:
    // "NaTV") aqui era um bug real, não só cosmético — o "Configurar" sempre
    // apaga-antes-de-criar (ver handleConfigApp em novo_cliente.tsx), e a
    // busca por nome no delete/create usa EXATAMENTE essa string. Como o
    // nome do servidor sozinho colide com playlists de OUTROS clientes que
    // por acaso têm o mesmo servidor (ex: várias contas com playlist "NaTV"),
    // isso apagou a playlist real de um servidor pra criar uma vazia no
    // lugar. `finalServerName` (ex: "Insqueixa_NaTV") é o padrão usado por
    // QUICKPLAYER e é único por cliente — DUPLECAST é a ÚNICA exceção de
    // propósito (pedido específico do Márcio, documentado em duplecast.ts).
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
