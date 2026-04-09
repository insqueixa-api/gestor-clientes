// src/lib/integrations/gerenciaapps/duplecast.ts

export const DupleCastIntegration = {
    actionPrefix: "DUPLECAST", // Prefixo usado na extensão (DUPLECAST_CREATE / DUPLECAST_DELETE)

    buildCreatePayload: (params: {
        username: string;
        password?: string;    // PIN numérico — vem de app_integrations.login_password
        macValue: string;
        finalServerName: string;
        serverName?: string;  // ✅ Nome limpo do servidor, vem do modal diretamente
        m3uUrl: string;
    }) => {
        return {
            macValue:         params.macValue,
            finalServerName:  params.finalServerName,
            serverName:       params.serverName || params.finalServerName || "Playlist", // ✅ usado como m3u_name no painel
            m3uUrl:           params.m3uUrl,
            password:         params.password || "", // a extensão extrai os dígitos: .replace(/\D/g, '')
        };
    },

    buildDeletePayload: (params: {
        username: string;
        macValue: string;
        serverName?: string; // ✅ mesmo nome gravado no create — usado como filters[server_host]
    }) => {
        return {
            username:   params.username.trim(),
            macValue:   params.macValue || "",
            serverName: params.serverName || "", // ✅ passado direto do modal
        };
    },
};