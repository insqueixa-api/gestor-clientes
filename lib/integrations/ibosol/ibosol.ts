export const IboSolIntegration = {
    actionPrefix: "IBOSOL", // Aciona o IBOSOL_CREATE e IBOSOL_DELETE na extensão

    buildCreatePayload: (params: {
        username: string;
        password?: string; // O PIN numérico
        macValue: string;
        finalServerName: string;
        serverName: string;
        m3uUrl: string;
        appName?: string; // ✅ Recebe o nome do App (Ex: "BOB Player")
    }) => {
        return {
            appName:          params.appName, // Fundamental para a extensão achar no dropdown
            macValue:         params.macValue,
            serverName:       params.serverName || params.finalServerName, // IboSol aceita só o Servidor
            m3uUrl:           params.m3uUrl,
            password:         params.password || "", // Será tratado como PIN
        };
    },

    buildDeletePayload: (params: { 
        username: string; 
        finalServerName?: string; 
        serverName?: string; 
        macValue: string;
        appName?: string; // ✅ Recebe o nome do App
    }) => {
        return {
            appName:   params.appName, // Fundamental para a exclusão
            macValue:  params.macValue || "",
        };
    },
};