// src/lib/integrations/gerenciaapp.ts

// Função interna para descobrir qual é o ID correto baseado no nome do App
function getRankingAppId(appName?: string): number {
    if (!appName) return 10; // Fallback padrão

    const name = appName.trim().toUpperCase();

    if (name === "ZONE X" || name === "ZONEX") return 11;
    if (name === "VU REVENDA") return 12;
    if (name === "FACILITA" || name === "FACILITA APP") return 13;
    if (name === "UNI REVENDA") return 15;
    if (name === "GPC ROKU") return 17;
    if (name === "GPC ANDROID") return 20;
    if (name === "IBO REVENDA" || name === "GERENCIAAPP" || name === "GERENCIA APP") return 10;

    return 10; // Fallback se não encontrar
}

export const GerenciaAppIntegration = {
    actionPrefix: "GERENCIAAPP",

    buildCreatePayload: (params: { username: string; password?: string; macValue: string; finalServerName: string; m3uUrl: string; serverName?: string; appName?: string }) => {
        // Calcula a data exata de 1 ano para frente a partir de hoje
        const today = new Date();
        today.setFullYear(today.getFullYear() + 1);
        const expireDate1Year = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        return {
            modo_selecao: 1,
            mac_device: params.macValue,
            server_name: params.finalServerName,
            account_username: "",
            account_password: "",
            xteam_username: "",
            xteam_password: "",
            username_login: params.username,
            password_login: params.password || "",
            ranking_app_id: getRankingAppId(params.appName), // ✅ A mágica da unificação acontece aqui!
            dns: "",
            m3u8_list: params.m3uUrl || "",
            url_epg: "",
            price: 0,
            plan_id: "",
            expire_date: expireDate1Year,
            dnsOptions: "",
            whatsapp: "",
            is_trial: 0,
        };
    },

    buildDeletePayload: (params: { username: string; finalServerName?: string; serverName?: string; macValue: string; appName?: string }) => {
        return {
            // ✅ Regra padrão: Nome_Servidor. A extensão usa isso primeiro, se não achar, cai pro macValue.
            username: params.finalServerName || params.username.trim(),
            macValue: params.macValue || ""
        };
    }
};