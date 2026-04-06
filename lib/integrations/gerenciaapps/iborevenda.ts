// src/lib/integrations/gerenciaapps/iborevenda.ts

export const IBORevendaIntegration = {
    actionPrefix: "GERENCIAAPP", // Prefixo usado na extensão (ex: GERENCIAAPP_CREATE)

    // Constrói o pacote de dados EXATAMENTE como o GerenciaApp exige (A sua regra de pedra)
    buildCreatePayload: (params: { username: string; password?: string; macValue: string; finalServerName: string; m3uUrl: string }) => {
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
            ranking_app_id: 10,
            dns: "",
            m3u8_list: params.m3uUrl || "",
            url_epg: "",
            price: 0,
            plan_id: "",
            expire_date: expireDate1Year,
            dnsOptions: "",
            whatsapp: "",
            is_trial: 0,
            // name: Removido conforme regra de ouro
        };
    },

    // Constrói o pacote de dados para deletar
    buildDeletePayload: (params: { username: string; macValue: string }) => {
        return {
            username: params.username.trim(),
            mac_device: params.macValue || ""
        };
    }
};