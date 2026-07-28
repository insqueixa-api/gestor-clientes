// lib/integrations/gerenciaapp.ts
// src/lib/integrations/gerenciaapp.ts
//
// Reescrito em 27/07/2026 pra usar o portal de autoatendimento por MAC do
// GerenciaApp (/ativador) em vez do painel admin (/users) — ver
// app/api/integrations/apps/gerenciaapp/route.ts pro motivo (o /users tinha
// dois bugs sérios: busca por MAC só achava 1 registro entre vários, e
// DELETE por id apagava TODOS os registros daquele MAC, não só o alvo).
// O /ativador não precisa mais de login_email/login_password nem
// ranking_app_id — só MAC + nome do servidor + URL do m3u.
export const GerenciaAppIntegration = {
    actionPrefix: "GERENCIAAPP",
    useApi: true, // roda direto no Next.js (app/api/integrations/apps/gerenciaapp/route.ts), com proxy residencial
    apiEndpoint: "/api/integrations/apps/gerenciaapp",

    buildCreatePayload: (params: {
        username: string;
        password?: string;
        macValue: string;
        finalServerName: string;
        serverName?: string;
        m3uUrl: string;
        appName?: string;
    }) => {
        return {
            action: "create",
            macValue: params.macValue,
            finalServerName: params.finalServerName || params.serverName,
            m3uUrl: params.m3uUrl || "",
        };
    },

    buildDeletePayload: (params: {
        username: string;
        finalServerName?: string;
        serverName?: string;
        macValue: string;
        appName?: string;
    }) => {
        return {
            action: "delete",
            username: params.finalServerName || params.serverName || params.username.trim(),
            macValue: params.macValue || "",
        };
    }
};
