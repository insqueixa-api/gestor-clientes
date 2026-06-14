// app/api/epg/sync/route.ts
// Arquitetura: EPGBR (iptv-epg.org) é a lista mestre de canais.
// Elite e NaTV completam programação para canais que o EPGBR não cobrir.
//
// Mapeamento em 3 camadas (ordem de prioridade):
//   1. channel ID exato
//   2. channel ID case-insensitive
//   3. nome normalizado (remove HD/FHD/FHDR/qualidade/estado/sufixos)
//
// Deduplicação por janela de ±5min (evita duplicatas de horário ligeiramente diferente)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseStringPromise } from "xml2js";
import { createClient as createAdmin } from "@supabase/supabase-js";

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

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const R2_BUCKET = process.env.R2_BUCKET_NAME        || "unigestor-media";
const R2_URL    = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
const EPG_KEY   = "epg/epg_br.json";
const LOG_KEY   = "epg/epg_sync_log.json";

// ─── Tipos ───────────────────────────────────────────────────
type Canal = {
  id: string; display_name: string; nome: string;
  categoria: string; icon: string; servidor: string;
};
type Programa = {
  channel_id: string; channel_nome: string; categoria: string;
  start: string; stop: string; duracao_min: number;
  title: string; desc: string; prog_icon?: string;
};
type EpgConfigRow = {
  provider: "ELITE" | "NATV" | "EPGBR";
  priority: number;
  server_username: string;
  server_password: string;
  dns: string[];
  api_base_url: string | null;
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
    for (const kw of kws) { if (n.includes(kw)) return cat; }
  }
  return "Outros";
}

function nomeExibicao(raw: string): string {
  return raw.replace(/^BR\s*-\s*/i, "").trim();
}

// ─── Slug: remove tudo exceto letras e números, tudo minúsculo ───────────────
// Usado para matching robusto — independe de pontos, traços, espaços, acentos
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Apelidos manuais: slugs de IDs que nunca vão bater automaticamente
// slug(ID_do_Elite_ou_NaTV) → channel_id_do_EPGBR
const SLUG_ALIASES: Record<string, string> = {
  "investigacaodiscoveryidbr": "InvestigacaoDiscovery.br",
  "discoveryworldhdbr":        "DiscoveryWorld.br",
  "homehealthbr":              "DiscoveryHomeandHealth.br",
  "hdtheaterbr":               "DiscoveryTheater.br",
  "universalchannelbr":        "Universal.br",
  "h2br":                      "History2.br",
  "discturbohdbr":             "DiscoveryTurbo.br",
  "histobr":                   "HistoryChannel.br",
  "cartbr":                    "CartoonNetwork.br",
  "musicbbr":                  "MusicBoxBrasil.br",
  "hdunvbr":                   "Universal.br",
  "tntnbr":                    "TNT.br",
  "idbr":                      "InvestigacaoDiscovery.br",
  "globobr":                   "GloboRJ.br",
  "cnovabr":                   "CancaoNova.br",
  "hdtrbobr":                  "TravelBoxBrazil.br",
  "hdgazbr":                   "TVGazeta.br",
};

// Normaliza nome de canal removendo qualidade/estado antes de slugificar
function normSlug(nome: string): string {
  return slug(
    nome
      .replace(/^BR\s*[-–]\s*/i, "")           // remove prefixo "BR - "
      .replace(/\b(FHDR?|H\.?265|4K|HD|SD)\b/gi, " ")  // qualidade
      .replace(/\b(LEG|DUB|DUBLADO|LEGENDADO)\b/gi, " ") // áudio
      .replace(/\b(BR|SP|RJ|MG|RS|SC|PR|DF|GO|BA|PE|CE|AM|PA)\b/gi, " ") // estado
      .replace(/[*²³]/g, " ")
      .replace(/&amp;/gi, "e")
  );
}

// mantém compatibilidade com código que ainda usa normalizarParaMatch
function normalizarParaMatch(s: string): string { return normSlug(s); }

// ─── Parse Dates ────────────────────────────────────────────────
function parseToBRT(tsStr: string): Date | null {
  const m = tsStr.trim().match(/^(\d{14})\s*([+-]\d{4})$/);
  if (!m) return null;
  const [, dt, tz] = m;

  // Monta a string no formato ISO 8601 nativo: YYYY-MM-DDTHH:mm:ss+TZ
  const YYYY = dt.slice(0, 4);
  const MM = dt.slice(4, 6);
  const DD = dt.slice(6, 8);
  const HH = dt.slice(8, 10);
  const mm = dt.slice(10, 12);
  const ss = dt.slice(12, 14);
  const tzFormatted = `${tz.slice(0, 3)}:${tz.slice(3, 5)}`; // Ex: "-0300" -> "-03:00"

  const d = new Date(`${YYYY}-${MM}-${DD}T${HH}:${mm}:${ss}${tzFormatted}`);
  return isNaN(d.getTime()) ? null : d;
}

function toISOBRT(d: Date): string {
  // Retorna em UTC padrão. O frontend lidará com o fuso local dinamicamente.
  return d.toISOString();
}

// ─── Busca XML ────────────────────────────────────────────────
async function fetchXML(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(45_000),
      redirect: "follow",
      headers: { "User-Agent": "VLC/3.0.18 LibVLC/3.0.18", "Accept": "*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e: any) {
    console.warn(`[EPG] fetch falhou: ${url} — ${e.message}`);
    return null;
  }
}

// ─── Parse EPGBR (lista mestre) ───────────────────────────────
async function parseEPGBR(): Promise<{
  canais: Map<string, Canal>;
  programas: Programa[];
  erro?: string;
}> {
  const xml = await fetchXML("https://iptv-epg.org/files/epg-br.xml");
  if (!xml) return { canais: new Map(), programas: [], erro: "Falha ao baixar EPGBR" };

  let parsed: any;
  try { parsed = await parseStringPromise(xml, { explicitArray: true }); }
  catch (e: any) { return { canais: new Map(), programas: [], erro: `XML inválido: ${e.message}` }; }

  const tv         = parsed?.tv || {};
  const channels   = tv.channel   || [];
  const programmes = tv.programme || [];
  const agora      = new Date();
  const limite     = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

  const canais = new Map<string, Canal>();
  for (const ch of channels) {
    const cid  = ch.$?.id?.trim() || "";
    const dn   = ch["display-name"]?.[0]?._ || ch["display-name"]?.[0] || "";
    const icon = ch.icon?.[0]?.$?.src || "";
    if (!cid || !dn) continue;
    const nome = nomeExibicao(dn);
    canais.set(cid, { id: cid, display_name: dn, nome, categoria: categorizar(nome), icon, servidor: "EPGBR" });
  }

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
      channel_id: cid, channel_nome: canal.nome, categoria: canal.categoria,
      start: toISOBRT(startDt), stop: toISOBRT(stopDt),
      duracao_min: Math.round((stopDt.getTime() - startDt.getTime()) / 60000),
      title, desc,
    };
    if (progIcon) entry.prog_icon = progIcon;
    programas.push(entry);
  }

  return { canais, programas };
}

// ─── Parse Elite/NaTV (complemento) ──────────────────────────
async function parseComplementar(
  cfg: EpgConfigRow,
  canaisMestre: Map<string, Canal>,
  adicionarExtras: boolean = false
): Promise<{ programas: Programa[]; canaisNovos: Canal[]; erro?: string }> {

  // Índice EPGBR por slug — cobre todas as variações de capitalização/pontuação
  const epgbrPorIdExato = new Map<string, string>(); // id exato → id (mantido para compat)
  const epgbrPorSlug    = new Map<string, string>(); // slug(id ou nome) → id

  for (const [cid, canal] of canaisMestre) {
    epgbrPorIdExato.set(cid, cid);
    // Slug do ID
    const sId = slug(cid);
    if (!epgbrPorSlug.has(sId)) epgbrPorSlug.set(sId, cid);
    // Slug do ID sem "br" no final
    const sIdNoBr = sId.replace(/br$/, "");
    if (sIdNoBr && !epgbrPorSlug.has(sIdNoBr)) epgbrPorSlug.set(sIdNoBr, cid);
    // Slug do nome completo
    const sNome = normSlug(canal.display_name);
    if (sNome && !epgbrPorSlug.has(sNome)) epgbrPorSlug.set(sNome, cid);
    // Slug do nome sem prefixo
    const sNomeSimp = normSlug(canal.nome);
    if (sNomeSimp && !epgbrPorSlug.has(sNomeSimp)) epgbrPorSlug.set(sNomeSimp, cid);
  }

  function mapearCanal(sourceId: string, sourceNames: string[]): string | null {
    // 1. Apelido manual (casos impossíveis de resolver automaticamente)
    const sAlias = slug(sourceId);
    if (SLUG_ALIASES[sAlias]) return SLUG_ALIASES[sAlias];

    // 2. Slug do ID exato
    if (epgbrPorIdExato.has(sourceId)) return epgbrPorIdExato.get(sourceId)!;

    // 3. Slug do ID (sem distinção de maiúsculas/pontos/traços)
    const sId = slug(sourceId);
    if (epgbrPorSlug.has(sId)) return epgbrPorSlug.get(sId)!;

    // 4. Slug do ID sem o sufixo "br" no final
    const sIdNoBr = sId.replace(/br$/, "");
    if (sIdNoBr && epgbrPorSlug.has(sIdNoBr)) return epgbrPorSlug.get(sIdNoBr)!;

    // 5. Slug do nome normalizado
    for (const name of sourceNames) {
      const sNome = normSlug(name);
      if (sNome && epgbrPorSlug.has(sNome)) return epgbrPorSlug.get(sNome)!;
    }
    return null;
  }

  const dns  = cfg.dns || [];
  const user = cfg.server_username;
  const pass = cfg.server_password;
  let urls: string[] = [];
  if (cfg.provider === "ELITE") {
    urls = dns.map(d => `${d.replace(/\/$/, "")}/xmltv.php?username=${user}&password=${pass}`);
  } else if (cfg.provider === "NATV") {
    urls = dns.map(d => `${d.replace(/\/$/, "")}/epg`);
  } else {
    urls = ["https://iptv-epg.org/files/epg-br.xml"];
  }

  let xml: string | null = null;
  for (const url of urls) { xml = await fetchXML(url); if (xml) break; }
  if (!xml) return { programas: [], canaisNovos: [], erro: "Sem XML" };

  let parsed: any;
  try { parsed = await parseStringPromise(xml, { explicitArray: true }); }
  catch { return { programas: [], canaisNovos: [], erro: "XML inválido" }; }

  const tv         = parsed?.tv || {};
  const channels   = tv.channel   || [];
  const programmes = tv.programme || [];
  const agora      = new Date();
  const limite     = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Mapear channel IDs do servidor para IDs do EPGBR
  const serverIdParaMestreId = new Map<string, string>();
  for (const ch of channels) {
    const cid   = ch.$?.id?.trim() || "";
    const names = [ch["display-name"]?.[0]?._ || ch["display-name"]?.[0] || ""].filter(Boolean);
    if (!cid) continue;
    const mestreId = mapearCanal(cid, names);
    if (mestreId) serverIdParaMestreId.set(cid, mestreId);
  }

  // Canais extras BR (só Elite)
  const canaisNovos: Canal[] = [];
  if (adicionarExtras) {
    const idsJaNoMestre = new Set([...canaisMestre.keys()]);
    const normsJaNoMestre = new Set([...canaisMestre.values()].map(c => normalizarParaMatch(c.display_name)));

    for (const ch of channels) {
      const cid  = ch.$?.id?.trim() || "";
      const dn   = ch["display-name"]?.[0]?._ || ch["display-name"]?.[0] || "";
      const icon = ch.icon?.[0]?.$?.src || "";
      if (!cid || !dn) continue;
      if (!cid.toLowerCase().endsWith(".br")) continue;
      if (idsJaNoMestre.has(cid)) continue;
      const n = normalizarParaMatch(dn);
      if (normsJaNoMestre.has(n)) continue;
      
      normsJaNoMestre.add(n);
      idsJaNoMestre.add(cid);
      serverIdParaMestreId.set(cid, cid);
      
      const nomeFinal = n.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      
      canaisNovos.push({
        id: cid, display_name: dn,
        nome: nomeFinal,
        categoria: categorizar(nomeFinal), // Usa a sua lista mestre de categorias para alocar
        icon, servidor: "ELITE",
      });
    }
  }
  const todosCanaisMap = new Map(canaisMestre);
  for (const c of canaisNovos) todosCanaisMap.set(c.id, c);

  const programas: Programa[] = [];
  for (const prog of programmes) {
    const serverCid = prog.$?.channel?.trim() || "";
    const mestreCid = serverIdParaMestreId.get(serverCid);
    if (!mestreCid) continue;
    const canal = todosCanaisMap.get(mestreCid);
    if (!canal) continue;
    const startDt = parseToBRT(prog.$?.start || "");
    const stopDt  = parseToBRT(prog.$?.stop  || "");
    if (!startDt || !stopDt || stopDt < agora || startDt > limite) continue;
    const title = prog.title?.[0]?._ || prog.title?.[0] || "";
    const desc  = prog.desc?.[0]?._  || prog.desc?.[0]  || "";
    if (!title) continue;
    programas.push({
      channel_id: mestreCid, channel_nome: canal.nome, categoria: canal.categoria,
      start: toISOBRT(startDt), stop: toISOBRT(stopDt),
      duracao_min: Math.round((stopDt.getTime() - startDt.getTime()) / 60000),
      title, desc,
    });
  }

  return { programas, canaisNovos };
}

// ─── Upload R2 ────────────────────────────────────────────────
async function uploadR2(key: string, body: string) {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: body,
    ContentType: "application/json", CacheControl: "public, max-age=3600",
  }));
  return `${R2_URL}/${key}`;
}

// ─── POST — Sync ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const agora  = new Date().toISOString();

  // Permite chamada via cron (sem sessão de usuário) usando secret no header.
  const cronAuth = req.headers.get("authorization");
  const isCron = cronAuth === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`;

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const log: Record<string, any> = { executado_em: agora, servidores: {}, resultado: {}, erro: null };

  // 1. EPGBR — lista mestre
  const { canais: canaisMestre, programas: progsMestre, erro: erroMestre } = await parseEPGBR();
  log.servidores["EPGBR"] = { ok: !erroMestre, canais: canaisMestre.size, programas: progsMestre.length, erro: erroMestre || null };

  if (erroMestre || !canaisMestre.size) {
    log.erro = "EPGBR falhou — abortando";
    await uploadR2(LOG_KEY, JSON.stringify(log, null, 2));
    return NextResponse.json({ error: log.erro, log }, { status: 502 });
  }

  // 2. Elite e NaTV
    const { data: configs } = await supabaseAdmin

    .from("vw_epg_config")
    .select("*")
    .in("provider", ["ELITE", "NATV"])
    .order("priority", { ascending: true });

  // Deduplicação por sobreposição de período (bloqueia o intervalo inteiro do programa)
  // Começa vazio: Elite e NaTV entram primeiro (sem concorrência do EPGBR),
  // o EPGBR só preenche o que sobrar no final.
  const jaTemProg = new Map<string, { start: number; stop: number }[]>();

  function jaExiste(channelId: string, startIso: string, stopIso: string): boolean {
    const arr = jaTemProg.get(channelId);
    if (!arr?.length) return false;
    
    const newStart = new Date(startIso).getTime();
    const newStop = new Date(stopIso).getTime();
    
    // Bloqueia se houver sobreposição: NOVO começa antes do ATUAL terminar E NOVO termina depois do ATUAL começar
    return arr.some(existente => newStart < existente.stop && newStop > existente.start);
  }

  let programasFinais: Programa[] = [];

  for (const cfg of (configs || []) as EpgConfigRow[]) {
    console.log(`[EPG] Complementando com ${cfg.provider}...`);
    const { programas: progsComp, canaisNovos, erro } = await parseComplementar(cfg, canaisMestre, cfg.provider === "ELITE");

    if (canaisNovos.length > 0) {
      for (const c of canaisNovos) canaisMestre.set(c.id, c);
    }

    log.servidores[cfg.provider] = { ok: !erro, programas: progsComp.length, canais_extras: canaisNovos.length, erro: erro || null };

    if (!erro && progsComp.length > 0) {
      let adicionados = 0;
      for (const p of progsComp) {
        if (!jaExiste(p.channel_id, p.start, p.stop)) {
          const arr = jaTemProg.get(p.channel_id) || [];
          arr.push({ start: new Date(p.start).getTime(), stop: new Date(p.stop).getTime() });
          jaTemProg.set(p.channel_id, arr);
          programasFinais.push(p);
          adicionados++;
        }
      }
      log.servidores[cfg.provider].adicionados = adicionados;
      console.log(`[EPG] ${cfg.provider}: +${adicionados} programas complementares`);
    }
  }

  // EPGBR entra por último, só preenchendo buracos que Elite/NaTV não cobriram
  {
    let adicionadosEPGBR = 0;
    for (const p of progsMestre) {
      if (!jaExiste(p.channel_id, p.start, p.stop)) {
        const arr = jaTemProg.get(p.channel_id) || [];
        arr.push({ start: new Date(p.start).getTime(), stop: new Date(p.stop).getTime() });
        jaTemProg.set(p.channel_id, arr);
        programasFinais.push(p);
        adicionadosEPGBR++;
      }
    }
    log.servidores["EPGBR"].adicionados = adicionadosEPGBR;
    console.log(`[EPG] EPGBR: +${adicionadosEPGBR} programas de preenchimento`);
  }

  // 3. Ordena e salva
  const canaisLista = [...canaisMestre.values()]
    .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));

  programasFinais.sort((a, b) =>
    a.channel_id.localeCompare(b.channel_id) || a.start.localeCompare(b.start)
  );

  const payload = {
    gerado_em: agora,
    servidores_ok: ["EPGBR", ...(configs || []).map((c: any) => c.provider)],
    total_canais: canaisLista.length,
    total_programas: programasFinais.length,
    canais: canaisLista,
    programas: programasFinais,
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
