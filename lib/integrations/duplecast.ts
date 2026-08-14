// lib/integrations/duplecast.ts

export const DupleCastIntegration = {
    actionPrefix: "DUPLECAST",
    // ⚠️ useApi:false desde 14/08/2026 — a rota server-side (apiEndpoint
    // abaixo) ficou permanentemente bloqueada pelo Cloudflare do
    // duplecast.com ("Just a moment", requisição sem motor de JS nunca
    // passa, confirmado testando de 3 IPs diferentes). Migrado pro mesmo
    // padrão do ClouDDy: tudo via extensão do Chrome (aba real, sem CDP) —
    // ver lib/apps/duplecast-extension.ts e a seção DUPLECAST em
    // unigestor-extensao/background.js. Com useApi:false,
    // lib/apps/orchestration.ts para de tentar configurar sozinho no Portal
    // do cliente e cai no fluxo genérico de "pedido de configuração"
    // (client_app_requests) — o admin resolve manualmente pela extensão.
    useApi: false,
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
