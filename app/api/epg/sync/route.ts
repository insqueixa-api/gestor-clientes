// app/api/epg/sync/route.ts
// Arquitetura: EPGBR (iptv-epg.org) é a lista mestre de canais.
// Elite e NaTV completam programação para canais que o EPGBR não cobrir.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { parseStringPromise } from "xml2js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME        || "unigestor-media";
const R2_URL    = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
const EPG_KEY   = "epg/epg_br.json";
const LOG_KEY   = "epg/epg_sync_log.json";

// ─── Tipos ───────────────────────────────────────────────────
type Canal = {
  id:           string;
  display_name: string;
  nome:         string;
  categoria:    string;
  icon:         string;
  servidor:     string;
};

type Programa = {
  channel_id:   string;
  channel_nome: string;
  categoria:    string;
  start:        string;
  stop:         string;
  duracao_min:  number;
  title:        string;
  desc:         string;
  prog_icon?:   string;
};

type EpgConfigRow = {
  provider:        "ELITE" | "NATV" | "EPGBR";
  priority:        number;
  server_username: string;
  server_password: string;
  dns:             string[];
  api_base_url:    string | null;
};

// ─── Categorias ──────────────────────────────────────────────
const CATEGORIAS: Record<string, string[]> = {
  "Notícias":      ["NEWS","CNN","JOVEM PAN","GLOBONEWS","RECORD NEWS","BAND NEWS","FOX NEWS"],
  "Esportes":      ["SPORT","ESPN","FOX SPORTS","COMBATE","PREMIERE","CONMEBOL","FIFA","DAZN","GE TV"],
  "Infantil":      ["GLOOB","CARTOON","TOONCAST","CARTOONITO","DISNEY","NICK","BABY TV","DISCOVERY KIDS","ZOOMOO","RA TIM BUM"],
  "Filmes":        ["TELECINE","HBO","CINEMAX","WARNER","PARAMOUNT","UNIVERSAL","STUDIO UNIVERSAL","MEGAPIX","PRIME BOX","TNT","STAR ACTION","STAR HITZ","STAR LIFE","STAR CHANNEL","FX","TBS","TCM","AXN"],
  "Variedades":    ["MULTISHOW","GNT","VIVA","OFF","ARTE 1","WOOHOO","E!","LIFETIME","TLC","FASHION","BIS","COMEDY CENTRAL","TRUETV","TRUT"],
  "Documentários": ["DISCOVERY","HISTORY","NAT GEO","NATIONAL GEO","NATGEO","ANIMAL PLANET","FUTURA","TRAVEL","SMITHSONIAN","FILM&ARTS","FX","SPACE","A&E"],
  "Música":        ["MTV","MUSIC BOX","VH1","TRACE"],
  "Aberta":        ["GLOBO","SBT","REDETV","TV BRASIL","CULTURA","REDE VIDA","REDE GOSPEL","RECORD","BAND","TV APARECIDA","CNT"],
  "Regional":      ["TV GAZETA","TV CABO BRANCO","TV TRIBUNA","TV TEM","EPTV","TV CAMARA","TV SENADO","TV JUSTICA","TV NOVO TEMPO"],
  "Religioso":     ["APARECIDA","NOVO TEMPO","BOA VONTADE","REDE SUPER","RIT TV","REDE BRASIL"],
  "Outros":        [],
};

function categorizar(nome: string): string {
  const n = nome.toUpperCase();
  for (const [cat, kws] of Object.entries(CATEGORIAS)) {
    if (cat === "Outros") continue;
    for (const kw of kws) {
      if (n.includes(kw)) return cat;
    }
  }
  return "Outros";
}

function nomeExibicao(raw: string): string {
  // Remove prefixo "BR - " do iptv-epg.org
  return raw.replace(/^BR\s*-\s*/i, "").trim();
}

// ─── Parse BRT ────────────────────────────────────────────────
const BRT_OFFSET = -3 * 60;

function parseToBRT(tsStr: string): Date | null {
  const m = tsStr.trim().match(/^(\d{14})\s*([+-]\d{4})$/);
  if (!m) return null;
  const [, dt, tz] = m;
  const sign  = tz[0] === "+" ? 1 : -1;
  const tzMin = sign * (parseInt(tz.slice(1, 3)) * 60 + parseInt(tz.slice(3)));
  const d = new Date(
    `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}T${dt.slice(8,10)}:${dt.slice(10,12)}:${dt.slice(12,14)}Z`
  );
  d.setMinutes(d.getMinutes() - tzMin + BRT_OFFSET);
  return d;
}

function toISOBRT(d: Date): string {
  return d.toISOString().replace("Z", "-03:00");
}

// ─── Busca XML ────────────────────────────────────────────────
async function fetchXML(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal:   AbortSignal.timeout(45_000),
      redirect: "follow",
      headers:  { "User-Agent": "VLC/3.0.18 LibVLC/3.0.18", "Accept": "*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e: any) {
    console.warn(`[EPG] fetch falhou: ${url} — ${e.message}`);
    return null;
  }
}

// ─── Parse EPGBR (lista mestre) ───────────────────────────────
// Retorna mapa channel_id → Canal E programas
async function parseEPGBR(): Promise<{
  canais: Map<string, Canal>;
  programas: Programa[];
  erro?: string;
}> {
  const url = "https://iptv-epg.org/files/epg-br.xml";
  const xml = await fetchXML(url);
  if (!xml) return { canais: new Map(), programas: [], erro: "Falha ao baixar EPGBR" };

  let parsed: any;
  try { parsed = await parseStringPromise(xml, { explicitArray: true }); }
  catch (e: any) { return { canais: new Map(), programas: [], erro: `XML inválido: ${e.message}` }; }

  const tv         = parsed?.tv || {};
  const channels   = tv.channel   || [];
  const programmes = tv.programme || [];
  const agora      = new Date();
  const limite     = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Monta canais — todos os 176 são BR por definição
  const canais = new Map<string, Canal>();
  for (const ch of channels) {
    const cid  = ch.$?.id?.trim() || "";
    const dn   = ch["display-name"]?.[0]?._ || ch["display-name"]?.[0] || "";
    const icon = ch.icon?.[0]?.$?.src || "";
    if (!cid || !dn) continue;
    const nome = nomeExibicao(dn);
    canais.set(cid, {
      id:           cid,
      display_name: dn,
      nome,
      categoria:    categorizar(nome),
      icon,
      servidor:     "EPGBR",
    });
  }

  // Monta programas
  const programas: Programa[] = [];
  for (const prog of programmes) {
    const cid = prog.$?.channel?.trim() || "";
    if (!canais.has(cid)) continue;
    const startDt = parseToBRT(prog.$?.start || "");
    const stopDt  = parseToBRT(prog.$?.stop  || "");
    if (!startDt || !stopDt || stopDt < agora || startDt > limite) continue;
    const title    = prog.title?.[0]?._ || prog.title?.[0] || "";
    const desc     = prog.desc?.[0]?._  || prog.desc?.[0]  || "";
    const progIcon = prog.icon?.[0]?.$?.src || "";
    if (!title) continue;
    const canal = canais.get(cid)!;
    const entry: Programa = {
      channel_id:   cid,
      channel_nome: canal.nome,
      categoria:    canal.categoria,
      start:        toISOBRT(startDt),
      stop:         toISOBRT(stopDt),
      duracao_min:  Math.round((stopDt.getTime() - startDt.getTime()) / 60000),
      title,
      desc,
    };
    if (progIcon) entry.prog_icon = progIcon;
    programas.push(entry);
  }

  return { canais, programas };
}

// ─── Parse Elite/NaTV (complemento) ──────────────────────────
// Só aproveitamos programas de canais que já estão na lista do EPGBR
// A correspondência é feita por nome normalizado
async function parseComplementar(cfg: EpgConfigRow, canaisMestre: Map<string, Canal>): Promise<{
  programas: Programa[];
  erro?: string;
}> {
  // Monta mapa nome_normalizado → canal_id do mestre
  const normParaId = new Map<string, string>();
  for (const [cid, canal] of canaisMestre) {
    const norm = canal.nome.toUpperCase().replace(/\s+/g, " ").trim();
    normParaId.set(norm, cid);
  }

  // URLs
  const dns  = cfg.dns || [];
  const user = cfg.server_username;
  const pass = cfg.server_password;
  let urls: string[] = [];
  if (cfg.provider === "ELITE") {
    urls = dns.map(d => `${d.replace(/\/$/, "")}/xmltv.php?username=${user}&password=${pass}`);
  } else if (cfg.provider === "NATV") {
    urls = dns.map(d => `${d.replace(/\/$/, "")}/epg`);
  } else if (cfg.provider === "EPGBR") {
    urls = ["https://iptv-epg.org/files/epg-br.xml"];
  }

  let xml: string | null = null;
  for (const url of urls) {
    xml = await fetchXML(url);
    if (xml) break;
  }
  if (!xml) return { programas: [], erro: "Sem XML" };

  let parsed: any;
  try { parsed = await parseStringPromise(xml, { explicitArray: true }); }
  catch (e: any) { return { programas: [], erro: `XML inválido` }; }

  const tv         = parsed?.tv || {};
  const channels   = tv.channel   || [];
  const programmes = tv.programme || [];
  const agora      = new Date();
  const limite     = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Mapeia channel_id do server → channel_id do mestre
  const serverIdParaMestreId = new Map<string, string>();
  for (const ch of channels) {
    const cid = ch.$?.id?.trim() || "";
    const dn  = ch["display-name"]?.[0]?._ || ch["display-name"]?.[0] || "";
    if (!cid || !dn) continue;
    // Normaliza igual ao mestre
    const norm = nomeExibicao(dn)
      .toUpperCase()
      .replace(/\[?(FHD|HD|SD|4K)\]?/g, "")
      .replace(/\bLEG\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const mestreId = normParaId.get(norm);
    if (mestreId) serverIdParaMestreId.set(cid, mestreId);
  }

  // Programas só para canais que mapearam
  const programas: Programa[] = [];
  for (const prog of programmes) {
    const serverCid = prog.$?.channel?.trim() || "";
    const mestreCid = serverIdParaMestreId.get(serverCid);
    if (!mestreCid) continue;
    const canal    = canaisMestre.get(mestreCid)!;
    const startDt  = parseToBRT(prog.$?.start || "");
    const stopDt   = parseToBRT(prog.$?.stop  || "");
    if (!startDt || !stopDt || stopDt < agora || startDt > limite) continue;
    const title = prog.title?.[0]?._ || prog.title?.[0] || "";
    const desc  = prog.desc?.[0]?._  || prog.desc?.[0]  || "";
    if (!title) continue;
    programas.push({
      channel_id:   mestreCid,
      channel_nome: canal.nome,
      categoria:    canal.categoria,
      start:        toISOBRT(startDt),
      stop:         toISOBRT(stopDt),
      duracao_min:  Math.round((stopDt.getTime() - startDt.getTime()) / 60000),
      title,
      desc,
    });
  }

  return { programas };
}

// ─── Upload R2 ────────────────────────────────────────────────
async function uploadR2(key: string, body: string) {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: body,
    ContentType: "application/json",
    CacheControl: "public, max-age=3600",
  }));
  return `${R2_URL}/${key}`;
}

// ─── POST — Sync ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const agora  = new Date().toISOString();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const log: Record<string, any> = { executado_em: agora, servidores: {}, resultado: {}, erro: null };

  // 1. EPGBR — lista mestre
  console.log("[EPG] Processando EPGBR (lista mestre)...");
  const { canais: canaisMestre, programas: progsMestre, erro: erroMestre } = await parseEPGBR();

  log.servidores["EPGBR"] = {
    ok:        !erroMestre,
    canais:    canaisMestre.size,
    programas: progsMestre.length,
    erro:      erroMestre || null,
  };

  if (erroMestre || !canaisMestre.size) {
    log.erro = "EPGBR falhou — abortando";
    await uploadR2(LOG_KEY, JSON.stringify(log, null, 2));
    return NextResponse.json({ error: log.erro, log }, { status: 502 });
  }

  // 2. Elite e NaTV — complementam programação
  const { data: configs } = await supabase
    .from("vw_epg_config")
    .select("*")
    .in("provider", ["ELITE", "NATV"])
    .order("priority", { ascending: true });

  // Mapa canal_id → conjunto de starts já registrados (evita duplicatas)
  const jaTemProg = new Map<string, Set<string>>();
  for (const p of progsMestre) {
    const s = jaTemProg.get(p.channel_id) || new Set();
    s.add(p.start);
    jaTemProg.set(p.channel_id, s);
  }

  let programasFinais = [...progsMestre];

  for (const cfg of (configs || []) as EpgConfigRow[]) {
    console.log(`[EPG] Complementando com ${cfg.provider}...`);
    const { programas: progsComp, erro } = await parseComplementar(cfg, canaisMestre);

    log.servidores[cfg.provider] = {
      ok:        !erro,
      programas: progsComp.length,
      erro:      erro || null,
    };

    if (!erro && progsComp.length > 0) {
      let adicionados = 0;
      for (const p of progsComp) {
        const s = jaTemProg.get(p.channel_id) || new Set();
        if (!s.has(p.start)) {
          s.add(p.start);
          jaTemProg.set(p.channel_id, s);
          programasFinais.push(p);
          adicionados++;
        }
      }
      log.servidores[cfg.provider].adicionados = adicionados;
      console.log(`[EPG] ${cfg.provider}: +${adicionados} programas complementares`);
    }
  }

  // 3. Ordena canais e programas
  const canaisLista = [...canaisMestre.values()]
    .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));

  programasFinais.sort((a, b) =>
    a.channel_id.localeCompare(b.channel_id) || a.start.localeCompare(b.start)
  );

  // 4. Salva no R2
  const payload = {
    gerado_em:       agora,
    servidores_ok:   ["EPGBR", ...(configs || []).map((c: any) => c.provider)],
    total_canais:    canaisLista.length,
    total_programas: programasFinais.length,
    canais:          canaisLista,
    programas:       programasFinais,
  };

  const jsonUrl = await uploadR2(EPG_KEY, JSON.stringify(payload, null, 0));
  const duracao = Math.round((Date.now() - inicio) / 1000);

  log.resultado = { url: jsonUrl, duracao_s: duracao };
  await uploadR2(LOG_KEY, JSON.stringify(log, null, 2));

  return NextResponse.json({ ok: true, url: jsonUrl, duracao_s: duracao, log });
}

// ─── GET — Status do último sync ─────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const res = await fetch(`${R2_URL}/${LOG_KEY}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ status: "Nenhum sync realizado ainda" });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ status: "Log não encontrado" });
  }
}
