// lib/integrations/duplecast.ts

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
            finalServerName:  params.serverName,
            m3uUrl:           params.m3uUrl,
            password:         params.password || "",
        };
    },

    buildDeletePayload: (params: { username: string; finalServerName?: string; serverName?: string; macValue: string; appName?: string; password?: string }) => {
        return {
            action: "delete",
            // Mesma convenção do create: busca só pelo nome do servidor.
            username: params.serverName || params.username.trim(),
            macValue: params.macValue || "",
            // Playlist "Protected" no painel Duplecast exige o PIN pra
            // apagar de verdade — sem ele o site responde 302 mas não apaga
            // nada.
            password: params.password || "",
        };
    }
};
