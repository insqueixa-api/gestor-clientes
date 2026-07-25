// lib/integrations/duplecast.ts
// src/lib/integrations/duplecast.ts

export const DupleCastIntegration = {
    actionPrefix: "DUPLECAST",
    useApi: true, // ✅ Login+criação+remoção rodam na VM via HTTP puro, sem extensão
    apiEndpoint: "/api/integrations/apps/duplecast",

    buildCreatePayload: (params: {
        username: string;
        password?: string;
        macValue: string;
        finalServerName: string;
        serverName: string; // ✅ Adicionado para receber apenas "Servidor"
        m3uUrl: string;
        appName?: string; // ✅ Adicionado Opcional
    }) => {
        return {
            action: "create",
            macValue:         params.macValue,
            finalServerName:  params.serverName, // ✅ Força o painel a usar apenas "Servidor" como nome da lista
            m3uUrl:           params.m3uUrl,
            password:         params.password || "",
        };
    },

    buildDeletePayload: (params: { username: string; finalServerName?: string; serverName?: string; macValue: string; appName?: string; password?: string }) => {
        return {
            action: "delete",
            // ✅ Busca EXATAMENTE como você pediu: Apenas o nome do Servidor (ex: FastTV)
            username: params.serverName || params.username.trim(),
            macValue: params.macValue || "",
            // 🔥 BUG achado em produção (25/07/2026): esse campo nunca existiu
            // aqui — mesmo o chamador passando o PIN pra buildDeletePayload,
            // ele se perdia, e a rota (duplecast/route.ts) nunca recebia pin
            // nenhum. Playlist "Protected" precisa do PIN pra deletar de
            // verdade (o site aceita e responde 302 mesmo sem o PIN certo,
            // só que sem apagar nada) — sem isso, "Configurar" (que agora
            // tenta apagar antes de recriar) e "Excluir do painel" falhavam
            // silenciosamente pra qualquer playlist protegida.
            password: params.password || "",
        };
    }
};