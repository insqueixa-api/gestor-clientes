export const DupleCastIntegration = {
    actionPrefix: "DUPLECAST",

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
            macValue:         params.macValue,
            finalServerName:  params.serverName, // ✅ Força o painel a usar apenas "Servidor" como nome da lista
            m3uUrl:           params.m3uUrl,
            password:         params.password || "",
        };
    },

    buildDeletePayload: (params: { username: string; finalServerName?: string; serverName?: string; macValue: string; appName?: string }) => {
        return {
            // ✅ Busca EXATAMENTE como você pediu: Apenas o nome do Servidor (ex: FastTV)
            username: params.serverName || params.username.trim(),
            macValue: params.macValue || "",
        };
    }
};