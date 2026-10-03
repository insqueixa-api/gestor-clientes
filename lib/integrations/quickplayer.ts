// lib/integrations/quickplayer.ts
// Quick Player / Quick Player Pro — mesma API pra ambos (api.quickplayer.app),
// login por MAC+Device Key (sem conta de revenda/e-mail-senha, é por
// dispositivo). Desde 03/10/2026 a URL m3u é a lista do cliente (m3u_url,
// principal/secundária) — a regra antiga do DNS #1 era da parceria, acabou.
export const QuickPlayerAPI = {
  actionPrefix: "QUICKPLAYER",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/quickplayer",

  buildCreatePayload({
    macValue,
    username,
    password,
    serverId,
    finalServerName,
    serverName,
    m3uUrl,
  }: {
    macValue: string;
    username: string;
    password?: string;
    serverId?: string;
    finalServerName?: string;
    serverName?: string;
    m3uUrl?: string;
  }) {
    // deviceKey vem já injetado pelo modal (novo_cliente.tsx) como campo
    // top-level do body, igual acontece com IBOPRO — não precisa repetir aqui.
    return {
      action: "create",
      mac: macValue,
      username,
      password: password || "",
      server_id: serverId || "",
      // Padrão usado pelos outros apps: "usuário_servidor" (finalServerName),
      // não só o nome do servidor sozinho.
      playlist_name: finalServerName || serverName || "",
      // ✅ 03/10/2026: lista do cliente (principal/secundária, rotaciona no
      // Reconfigurar) — acabou a obrigatoriedade do DNS #1 (era da parceria).
      m3u_url: m3uUrl || "",
    };
  },

  buildDeletePayload({
    macValue,
    finalServerName,
    serverName,
  }: {
    macValue: string;
    finalServerName?: string;
    serverName?: string;
  }) {
    // deviceKey vem injetado pelo modal, igual no create.
    // ✅ Faltava mandar o nome da playlist — sem isso, route.ts não tinha
    // como saber QUAL playlist apagar e apagava TODAS as do MAC, mesmo as
    // de outro client_app que porventura compartilhe o mesmo dispositivo.
    return {
      action: "delete",
      mac: macValue,
      playlist_name: finalServerName || serverName || "",
    };
  },
};
