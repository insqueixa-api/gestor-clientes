// src/lib/integrations/gerenciaapps/gpc_roku.ts

export const GPCRokuIntegration = {
    actionPrefix: "GERENCIAAPP", 

    // ✅ Adicionado serverName e appName opcionais
    buildCreatePayload: (params: { username: string; password?: string; macValue: string; finalServerName: string; m3uUrl: string; serverName?: string; appName?: string }) => {
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
            ranking_app_id: 17, // ✅ GPC Roku TV: ID 17
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

    // ✅ Adicionado appName opcional
    buildDeletePayload: (params: { username: string; finalServerName?: string; serverName?: string; macValue: string; appName?: string }) => {
        return {
            username: params.username.trim(),
            mac_device: params.macValue || ""
        };
    }
};