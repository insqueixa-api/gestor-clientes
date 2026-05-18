// /lib/integrations/apps/lazerplay.ts
// (Ajuste o caminho se a sua pasta de integrações no front-end for diferente)

export const LazerPlayIntegration = {
    actionPrefix: "LAZERPLAY",

    buildCreatePayload: (params: {
        username: string;
        password?: string;
        macValue: string;
        finalServerName: string;
        serverName: string;
        m3uUrl: string;
        appName?: string;
    }) => ({
        mac:           params.macValue,
        playlist_name: params.finalServerName || params.serverName,
        playlist_url:  params.m3uUrl,
        pin:           params.password || "",
        // deviceKey é injetado pelo modal via getDeviceKeyFromApp
    }),

    buildDeletePayload: (params: {
        username: string;
        finalServerName?: string;
        serverName?: string;
        macValue: string;
        appName?: string;
        password?: string;
    }) => ({
        mac:           params.macValue,
        playlist_name: params.finalServerName || params.serverName || "",
        pin:           params.password || "",
        // deviceKey é injetado pelo modal via getDeviceKeyFromApp
    }),
};