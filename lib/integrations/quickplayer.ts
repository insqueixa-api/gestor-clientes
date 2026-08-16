// lib/integrations/quickplayer.ts
// Quick Player / Quick Player Pro — mesma API pra ambos (api.quickplayer.app),
// login por MAC+Device Key (sem conta de revenda/e-mail-senha, é por
// dispositivo). O servidor (route.ts) monta a URL m3u com o DNS #1 cadastrado
// no servidor + usuário/senha do cliente — nunca reaproveita um m3u_url
// pronto, porque só o DNS #1 libera a licença.
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
  }: {
    macValue: string;
    username: string;
    password?: string;
    serverId?: string;
    finalServerName?: string;
    serverName?: string;
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
