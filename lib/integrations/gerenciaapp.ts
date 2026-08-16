// lib/integrations/gerenciaapp.ts
//
// GERENCIAAPP cobre a família de painéis white-label que rodam o mesmo
// backend (IBO Revenda, Zone X, VU Revenda, Facilita, Uni Revenda, GPC
// Roku/Android/LG/Pro, IBONew, Gerencia Max) — ranking_app_id diz ao painel qual marca da
// família está sendo usada; sem bater o valor certo, o painel mistura
// configuração de uma marca com outra.
//
// Nota: "GPC Computador" (app_id def69af9...) é uma família de mesmo nome
// só na aparência — a instalação/ativação dela é 100% manual (integration_type
// null de propósito), diferente do app "IBONew" (app_id ffaa16fc...), que É
// dessa integração (ranking 22, confirmado via curl em 15/08/2026). Não
// confundir os dois ao mexer nesse mapeamento.
//
// 🔴 CRÍTICO (achado em produção, 31/07/2026): nome de app sem entrada nesta
// lista fazia o fallback antigo devolver 10 (IBO REVENDA) em silêncio pra
// QUALQUER nome não mapeado — resultado: um cliente configurado como app X
// foi criado de verdade no painel do parceiro como IBO Revenda (app errado,
// sem nenhum erro/aviso). Daqui pra frente, nome sem mapeamento TRAVA a
// configuração (erro claro pro admin) em vez de adivinhar um valor — errado
// é preferível travar a arriscar configurar o app errado de novo.
function getRankingAppId(appName?: string): number {
    const name = String(appName || "").trim().toUpperCase();
    if (!name) {
        throw new Error("Não foi possível identificar o app pra configurar no GerenciaApp (nome vazio) — avise o desenvolvedor antes de continuar.");
    }

    if (name === "ZONE X" || name === "ZONEX") return 11;
    if (name === "VU REVENDA") return 12;
    if (name === "FACILITA" || name === "FACILITA APP") return 13;
    if (name === "UNI REVENDA") return 15;
    if (name === "GPC ROKU") return 17;
    if (name === "GPC ANDROID" || name === "GPC PRO" || name === "GPC PRO ANDROID") return 18;
    if (name === "GPC LG") return 99; // TODO(Marcio): incluir código do ranking aqui pro GPC LG — 99 é placeholder/chute, nunca confirmado via curl real (diferente do GPC Pro=18 e IBONew=22). Trocar pelo valor certo assim que tiver o curl de criação.
    if (name === "IBO REVENDA") return 10;
    if (name === "IBONEW" || name === "IBO NEW") return 22;
    if (name === "GERENCIA MAX") return 21;

    throw new Error(`App "${appName}" ainda não tem ranking_app_id mapeado no GerenciaApp — avise o desenvolvedor antes de configurar (evita configurar o app errado no parceiro).`);
}

export const GerenciaAppIntegration = {
    actionPrefix: "GERENCIAAPP",
    useApi: true, // create/check/delete rodam em app/api/integrations/apps/gerenciaapp (server-side, com proxy residencial — ver esse arquivo pra detalhes de como cada ação funciona hoje)
    apiEndpoint: "/api/integrations/apps/gerenciaapp",

    buildCreatePayload: (params: { username: string; password?: string; macValue: string; finalServerName: string; m3uUrl: string; serverName?: string; appName?: string }) => {
        // Data de 1 ano pra frente — placeholder no create; o vencimento real
        // vem depois via action:"check" (o painel não devolve vencimento de
        // verdade na resposta do create em si).
        const today = new Date();
        today.setFullYear(today.getFullYear() + 1);
        const expireDate1Year = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        return {
            action: "create",
            modo_selecao: 1,
            mac_device: params.macValue,
            server_name: params.finalServerName,
            account_username: "",
            account_password: "",
            xteam_username: "",
            xteam_password: "",
            username_login: params.username,
            password_login: params.password || "",
            ranking_app_id: getRankingAppId(params.appName),
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
            action: "delete",
            // Busca a playlist pelo nome do servidor (Nome_Servidor); se não
            // vier, cai pro username puro.
            username: params.finalServerName || params.username.trim(),
            macValue: params.macValue || ""
        };
    }
};
