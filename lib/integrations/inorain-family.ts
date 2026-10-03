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
  // HD Player e Core Player: mesma família, cada um com cadastro próprio
  // (AtivaApp: módulos "hdplayer" e "coreplayer"). 03/10/2026.
  HDPLAYER: { brand: "HD Player", site: "https://hdplayer.live", endpoint: "/api/integrations/apps/hdplayer" },
  COREPLAYER: { brand: "Core Player", site: "https://coreplayer.io", endpoint: "/api/integrations/apps/coreplayer" },
  // 03/10/2026: achados varrendo o catálogo (apps sem integração, todos na
  // AtivaApp com "módulo" = domínio) — api.<site> responde no formato da família.
  DUPLEXMAX: { brand: "Duplex Max", site: "https://duplexmax.app", endpoint: "/api/integrations/apps/duplexmax" },
  EPICPLAY: { brand: "Epic Play", site: "https://epic-play.app", endpoint: "/api/integrations/apps/epicplay" },
  LUMINAPLAYER: { brand: "Lumina Player", site: "https://luminaplayer.com", endpoint: "/api/integrations/apps/luminaplayer" },
  POWERPLAY: { brand: "Power Play", site: "https://power-play.app", endpoint: "/api/integrations/apps/powerplay" },
  STZPLAYER: { brand: "STZ Player", site: "https://stzplayer.com", endpoint: "/api/integrations/apps/stzplayer" },
  SUPERPLAY: { brand: "Super Play", site: "https://super-play.io", endpoint: "/api/integrations/apps/superplay" },
  VIZZIONPLAY: { brand: "Vizzion Play", site: "https://vizzionplay.com", endpoint: "/api/integrations/apps/vizzionplay" },
  // Magic Player (03/10/2026): mesmo site do Lazer Play (mesmo bundle), mas o
  // login fica em magicplayerclientes.com e a API em api.magicplayer.life —
  // por isso a integração é cadastrada com https://magicplayer.life.
  MAGICPLAYER: { brand: "Magic Player", site: "https://magicplayer.life", endpoint: "/api/integrations/apps/magicplayer" },
  // Dream TV (03/10/2026): config.js do site aponta pra api.dreamtv.life;
  // AtivaApp módulo "iptv-dreamtv-life" (mesmo padrão do Lazer Play).
  DREAMTV: { brand: "Dream TV", site: "https://dreamtv.life", endpoint: "/api/integrations/apps/dreamtv" },
  // Brasil IPTV (03/10/2026): config.js do site aponta pra api.brasiliptv.me.
  BRASILIPTV: { brand: "Brasil IPTV", site: "https://brasiliptv.me", endpoint: "/api/integrations/apps/brasiliptv" },
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
