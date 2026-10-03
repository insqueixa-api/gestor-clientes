// lib/integrations/inorain-family.ts
//
// Família "inoRain" (03/10/2026): várias marcas de player IPTV no MESMO
// backend white-label — api.<site>/api/{validate_mac, login_by_mac, device,
// playlist_with_mac, palylist_from_web}. Lógica única em
// lib/integrations/inorain-family-route.ts (testada ao vivo no IPTV OTT
// Player e no IPTV 4K com o aparelho do Márcio).
//
// Só entram marcas que também estão na AtivaApp (pedido do Márcio: sem
// ativação automática da licença, não vale integrar). Conferido pelo campo
// "modulo" do catálogo da AtivaApp, que é o nome do site de cada marca.
// Fora de propósito: HD Media Player, IBO Premium, OTT Plus, Smart Play, Top
// IPTV Smart, Uni Stream TV, Xplayer (não estão na AtivaApp) e Premium IPTV
// (site fora do ar). IPTV Play (AtivaApp) não tem site nessa família.
//
// Arquivo sem import de servidor — usado também no navegador (registro de
// integrações, tela de cadastro).
export const INORAIN_FAMILY: Record<string, { brand: string; site: string; endpoint: string }> = {
  IPTVDUPLEX: { brand: "IPTV Duplex Play", site: "https://iptvduplex.com", endpoint: "/api/integrations/apps/iptvduplex" },
  IPTVPLAYERIO: { brand: "IPTV Player.io", site: "https://iptvplayer.io", endpoint: "/api/integrations/apps/iptvplayerio" },
  OTTPLAYER: { brand: "IPTV OTT Player", site: "https://simpletv.live", endpoint: "/api/integrations/apps/ottplayer" },
  IPTV4K: { brand: "IPTV 4K", site: "https://iptv-4k.live", endpoint: "/api/integrations/apps/iptv4k" },
  IPTVPLAYER: { brand: "IPTV Player (I-player)", site: "https://i-player.live", endpoint: "/api/integrations/apps/iptvplayer" },
  IPTVPLUS: { brand: "IPTV Plus", site: "https://iptvpluseplayer.live", endpoint: "/api/integrations/apps/iptvplus" },
  IPTVPRO: { brand: "IPTV Pro", site: "https://iptvproplayer.live", endpoint: "/api/integrations/apps/iptvpro" },
  IPTVSTAR: { brand: "IPTV Star", site: "https://iptv-star.live", endpoint: "/api/integrations/apps/iptvstar" },
  PROPLAYER: { brand: "Pro Player", site: "https://pro-player.live", endpoint: "/api/integrations/apps/proplayer" },
  TIVIPLAYER: { brand: "TIVI Player (IPTV Stream Player)", site: "https://tiviplayer.io", endpoint: "/api/integrations/apps/tiviplayer" },
  STREAMMEDIA: { brand: "Stream Media Player", site: "https://streammediaplayer.com", endpoint: "/api/integrations/apps/streammedia" },
  STREAMXTREAM: { brand: "Stream Xtream", site: "https://streamxtream.com", endpoint: "/api/integrations/apps/streamxtream" },
  SMARTIPTVPLAYER: { brand: "Smart IPTV Player", site: "https://smart-iptv-player.com", endpoint: "/api/integrations/apps/smartiptvplayer" },
  // ✅ 03/10/2026: Lazer Play e FocoX Play (mesmo painel na AtivaApp, módulo
  // "iptv-lazer-play-io"). O SITE fica atrás do desafio do Cloudflare, mas a
  // API (api.lazerplay.io) responde direto — confirmado da VM e local.
  LAZERPLAY: { brand: "Lazer Play / FocoX Play", site: "https://lazerplay.io", endpoint: "/api/integrations/apps/lazerplay" },
  // Fun Play: mesma família, mas cadastro de aparelhos SEPARADO do Lazer Play
  // (api.funplays.app — o mesmo MAC tem outro id lá). AtivaApp: módulo "funplays".
  FUNPLAY: { brand: "Fun Play", site: "https://funplays.app", endpoint: "/api/integrations/apps/funplay" },
};

export const INORAIN_HANDLERS = new Set(Object.keys(INORAIN_FAMILY));

/** Handler do registro (lib/integrations/index.ts) pra uma marca da família. */
export function makeInorainIntegration(actionPrefix: string) {
  return {
    actionPrefix,
    useApi: true,
    apiEndpoint: INORAIN_FAMILY[actionPrefix].endpoint,

    // finalServerName ("Insqueixa_NaTV") é único por cliente — "Configurar"
    // apaga-antes-de-criar buscando por esse nome exato.
    buildCreatePayload: (params: {
      username: string;
      password?: string; // PIN da integração (PIN_HANDLERS) — protege a playlist
      macValue: string;
      finalServerName: string;
      serverName: string;
      m3uUrl: string;
      appName?: string;
    }) => ({
      action: "create",
      macValue: params.macValue,
      finalServerName: params.finalServerName || params.serverName,
      m3uUrl: params.m3uUrl,
      password: params.password || "",
    }),

    buildDeletePayload: (params: {
      username: string;
      finalServerName?: string;
      serverName?: string;
      macValue: string;
      appName?: string;
      password?: string;
    }) => ({
      action: "delete",
      username: params.finalServerName || params.serverName || params.username.trim(),
      macValue: params.macValue || "",
      password: params.password || "",
    }),
  };
}
