// lib/integrations/ninjaplayer.ts
// Ninja Player (meta-player.app) — login por mac+device_key ("OTP CODE" na
// tela do app, na prática fixo por aparelho). Só troca a playlist inteira
// (sem múltiplas playlists por MAC, ao contrário do GerenciaApp) — ver
// app/api/integrations/apps/ninjaplayer/route.ts pro fluxo completo.
export const NinjaPlayerIntegration = {
  actionPrefix: "NINJAPLAYER",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/ninjaplayer",

  buildCreatePayload: (params: { macValue: string; m3uUrl: string }) => {
    return {
      action: "create",
      macValue: params.macValue,
      m3uUrl: params.m3uUrl,
    };
  },

  buildDeletePayload: (params: { macValue: string }) => {
    return {
      action: "delete",
      macValue: params.macValue,
    };
  },
};
