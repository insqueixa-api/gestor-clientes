// lib/integrations/clouddy.ts
// ClouDDy (console.clouddy.online) — por CONTA (email+senha do cliente),
// não por MAC. buildCreatePayload/buildDeletePayload ficam mínimos de
// propósito: o client_app_id (chave real usada pela rota) é adicionado
// pelo próprio chamador (novo_cliente.tsx), não por esses builders — ver
// app/api/integrations/apps/clouddy/route.ts pro fluxo completo.
export const ClouddyIntegration = {
  actionPrefix: "CLOUDDY",
  useApi: true,
  apiEndpoint: "/api/integrations/apps/clouddy",

  buildCreatePayload: (params: { m3uUrl: string; [key: string]: any }) => {
    return {
      action: "create",
      m3uUrl: params.m3uUrl,
    };
  },

  buildDeletePayload: () => {
    return { action: "delete" };
  },
};
