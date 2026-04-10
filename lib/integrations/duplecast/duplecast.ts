export const DupleCastIntegration = {
    actionPrefix: "DUPLECAST",

    buildCreatePayload: (params: {
        username: string;
        password?: string;
        macValue: string;
        finalServerName: string;
        serverName: string; // ✅ Adicionado para receber apenas "Servidor"
        m3uUrl: string;
    }) => {
        return {
            macValue:         params.macValue,
            finalServerName:  params.serverName, // ✅ Força o painel a usar apenas "Servidor" como nome da lista
            m3uUrl:           params.m3uUrl,
            password:         params.password || "",
        };
    },

    buildDeletePayload: (params: { 
        username: string; 
        serverName?: string; // ✅ Recebe o "Servidor" do handleDeleteApp
        macValue: string 
    }) => {
        return {
            // ✅ Usa o "Servidor" para buscar a lista e deletar (se não vier, faz fallback pro username)
            username:  params.serverName || params.username.trim(), 
            macValue:  params.macValue || "",
        };
    },
};