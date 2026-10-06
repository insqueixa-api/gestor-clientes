// lib/integrations/duplecast.ts

// Nome da lista no DupleCast: só o nome do servidor (convenção própria);
// a secundária (finalServerName terminando em "_2", ver lib/apps/orchestration.ts)
// vira "<Servidor>_2" pra conviver com a principal.
function duplecastListName(params: { serverName: string; finalServerName?: string }): string {
  return String(params.finalServerName || "").endsWith("_2") ? `${params.serverName}_2` : params.serverName;
}

export const DupleCastIntegration = {
    actionPrefix: "DUPLECAST",
    useApi: true, // login+criação+remoção rodam em app/api/integrations/apps/duplecast (server-side)
    apiEndpoint: "/api/integrations/apps/duplecast",

    buildCreatePayload: (params: {
        username: string;
        password?: string;
        macValue: string;
        finalServerName: string;
        serverName: string;
        m3uUrl: string;
        appName?: string;
    }) => {
        return {
            action: "create",
            macValue:         params.macValue,
            // Convenção própria da Duplecast: usa só o nome do servidor
            // (ex: "FastTV"), NÃO o finalServerName com o username prefixado
            // que as outras integrações usam. Ver duplecast/route.ts pra
            // como isso é resolvido/buscado do lado do painel.
            // ✅ 06/10/2026: secundária ganha "_2" (o orquestrador manda o
            // finalServerName da secundária com esse sufixo) — principal e
            // secundária convivem no aparelho.
            finalServerName:  duplecastListName(params),
            m3uUrl:           params.m3uUrl,
            password:         params.password || "",
        };
    },

    buildDeletePayload: (params: { username: string; finalServerName?: string; serverName?: string; macValue: string; appName?: string; password?: string }) => {
        return {
            action: "delete",
            // Mesma convenção do create: busca só pelo nome do servidor
            // (+ "_2" quando é a secundária).
            username: params.serverName ? duplecastListName({ serverName: params.serverName, finalServerName: params.finalServerName }) : params.username.trim(),
            macValue: params.macValue || "",
            // Playlist "Protected" no painel Duplecast exige o PIN pra
            // apagar de verdade — sem ele o site responde 302 mas não apaga
            // nada.
            password: params.password || "",
        };
    }
};
