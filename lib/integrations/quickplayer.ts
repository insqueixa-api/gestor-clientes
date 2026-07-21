// lib/integrations/quickplayer.ts
// Quick Player / Quick Player Pro — mesma API pra ambos (api.quickplayer.app),
// login por MAC+Device Key (sem conta de revenda/e-mail-senha, é por
// dispositivo). O servidor (route.ts) monta a URL m3u com o DNS #1 cadastrado
// no servidor + usuário/senha do cliente — nunca reaproveita um m3u_url
// pronto, porque só o DNS #1 libera a licença (achado do Márcio, 21/07/2026).
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
      playlist_name: serverName || finalServerName || "",
    };
  },
};
