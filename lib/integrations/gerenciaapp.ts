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
import { addYearsToIsoDate, isoDateInSaoPaulo } from "@/lib/date-br";

// ✅ 03/10/2026 (pedido do Márcio): o código de verdade agora vem da tabela
// gerenciaapp_ranking_apps (editável em Configurações → Integrações →
// GerenciaApp → "Aplicativos"), resolvido NA ROTA pelo app_id do catálogo.
// Este mapa por nome virou só RESERVA (app ainda não vinculado na tabela) e
// não trava mais aqui — quem trava, se não achar código nenhum, é a rota
// (mesma regra de segurança do achado de 31/07/2026 acima).
// GPC LG (placeholder 99, nunca confirmado) saiu: virou PLAYNX "pendente" na
// tabela — nunca mais posta um código chutado.
function legacyRankingAppId(appName?: string): number | null {
    const name = String(appName || "").trim().toUpperCase();
    if (!name) return null;

    if (name === "ZONE X" || name === "ZONEX") return 11;
    if (name === "VU REVENDA") return 12;
    if (name === "FACILITA" || name === "FACILITA APP") return 13;
    if (name === "UNI REVENDA") return 15;
    if (name === "GPC ROKU") return 17;
    if (name === "GPC ANDROID" || name === "GPC PRO" || name === "GPC PRO ANDROID") return 18;
    if (name === "IBO REVENDA") return 10;
    if (name === "IBONEW" || name === "IBO NEW") return 22;
    if (name === "GERENCIA MAX") return 21;

    return null;
}

export const GerenciaAppIntegration = {
    actionPrefix: "GERENCIAAPP",
    useApi: true, // create/check/delete rodam em app/api/integrations/apps/gerenciaapp (server-side, com proxy residencial — ver esse arquivo pra detalhes de como cada ação funciona hoje)
    apiEndpoint: "/api/integrations/apps/gerenciaapp",

    buildCreatePayload: (params: { username: string; password?: string; macValue: string; finalServerName: string; m3uUrl: string; serverName?: string; appName?: string; appId?: string | null }) => {
        // Data de 1 ano pra frente — placeholder no create; o vencimento real
        // vem depois via action:"check" (o painel não devolve vencimento de
        // verdade na resposta do create em si).
        // ✅ 03/10/2026: a partir de hoje em São Paulo (não do fuso local)
        const expireDate1Year = addYearsToIsoDate(isoDateInSaoPaulo(), 1);

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
            // código final resolvido na rota (tabela gerenciaapp_ranking_apps
            // pelo app_id); o do nome é só reserva
            ranking_app_id: legacyRankingAppId(params.appName),
            app_id: params.appId || null,
            app_name: params.appName || "",
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
