// lib/integrations/ninjaplus.ts
// Ninja Plus (quickplayer.life) — 29/08/2026: achado ao vivo pelo Márcio que
// o app real por trás do catálogo "Ninja Plus" NÃO é o backend Laravel de
// meta-player.app (o que a integração NINJAPLAYER antiga assumia) — é outro
// domínio da mesma família QuickPlayer, com API própria em
// /api/public/customer/*. Testado ponta a ponta (auth → me → create → list
// → delete) com MAC/device real antes de escrever este arquivo. Diferenças
// do QUICKPLAYER "clássico" (api.quickplayer.app):
//   - login: POST /api/public/customer/auth {mac, device_key} (não
//     /api/login_by_mac {mac, key})
//   - respostas envelopadas em {error, data} (não {error, message})
//   - create é JSON puro (não FormData) com o PIN já embutido no body —
//     não tem is_protected/pin/confirm_pin separados
//   - delete é DELETE /playlist/{id} com o PIN no body, não um endpoint
//     de "remover por id" genérico com pin condicional
// Ver app/api/integrations/apps/ninjaplus/route.ts pro fluxo completo.
export const NinjaPlusIntegration = {
  actionPrefix: "NINJAPLUS",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/ninjaplus",

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
    // deviceKey vem injetado pelo modal (novo_cliente.tsx) como campo
    // top-level do body, mesmo padrão do QUICKPLAYER/IBOPRO.
    return {
      action: "create",
      mac: macValue,
      username,
      password: password || "",
      server_id: serverId || "",
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
    return {
      action: "delete",
      mac: macValue,
      playlist_name: finalServerName || serverName || "",
    };
  },
};
