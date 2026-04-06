// src/lib/integrations/gerenciaapps/unirevenda.ts

export const UNIRevendaIntegration = {
    // Mantemos GERENCIAAPP pois a extensão já domina o painel deles
    actionPrefix: "GERENCIAAPP", 

    buildCreatePayload: (params: { username: string; password?: string; macValue: string; finalServerName: string; m3uUrl: string }) => {
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
            ranking_app_id: 15, // ✅ A ÚNICA DIFERENÇA: ID 15 é o UNI Revenda!
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

    buildDeletePayload: (params: { username: string; macValue: string }) => {
        return {
            username: params.username.trim(),
            mac_device: params.macValue || ""
        };
    }
};