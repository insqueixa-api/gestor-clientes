// src/lib/integrations/duplecast/duplecast.ts

export const DupleCastIntegration = {
    actionPrefix: "DUPLECAST", // Prefixo usado na extensão (DUPLECAST_CREATE / DUPLECAST_DELETE)

    buildCreatePayload: (params: {
        username: string;
        password?: string; // PIN numérico — vem de app_integrations.login_password
        macValue: string;
        finalServerName: string;
        m3uUrl: string;
    }) => {
        return {
            macValue:         params.macValue,
            finalServerName:  params.finalServerName, // usado como m3u_name no painel
            m3uUrl:           params.m3uUrl,
            password:         params.password || "",  // a extensão extrai os dígitos: .replace(/\D/g, '')
        };
    },

    buildDeletePayload: (params: { username: string; macValue: string }) => {
        return {
            username:  params.username.trim(), // finalServerName, usado como filtro server_host
            macValue:  params.macValue || "",
        };
    },
};