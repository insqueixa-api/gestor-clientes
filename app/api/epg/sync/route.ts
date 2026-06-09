// app/api/epg/sync/route.ts
// Sync automático: Elite (principal) + NaTV (fallback)
// Fast: upload manual pelo painel do UniGestor
// Acionada pelo cron do Supabase ou manualmente

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { parseStringPromise } from "xml2js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── R2 Client ───────────────────────────────────────────────
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET    = process.env.R2_BUCKET_NAME        || "unigestor-media";
const R2_URL       = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
const EPG_KEY      = "epg/epg_br.json";       // resultado final (Elite+NaTV+Fast se válido)
const EPG_FAST_KEY = "epg/epg_fast.json";     // Fast separado — gerenciado pelo upload manual
const LOG_KEY      = "epg/epg_sync_log.json";

const FAST_MAX_DIAS = 3; // Fast é ignorado se tiver mais de 3 dias

// ─── Tipos ───────────────────────────────────────────────────
type EpgConfigRow = {
  provider:        "FAST" | "ELITE" | "NATV" | "EPGBR";
  priority:        number;
  server_username: string;
  server_password: string;
  dns:             string[];
  api_base_url:    string | null;
};

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
  prog_icon?:   string; // ícone do programa (quando disponível)
};

type EpgPayload = {
  gerado_em:       string;
  fast_gerado_em?: string | null;
  fast_valido?:    boolean;
  servidores_ok:   string[];
  total_canais:    number;
  total_programas: number;
  canais:          Canal[];
  programas:       Programa[];
};

// ─── Helpers ─────────────────────────────────────────────────
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

function normalizarNome(s: string): string {
  return s.toUpperCase()
    // Remove prefixo "BR - " do iptv-epg.org
    .replace(/^BR\s*-\s*/i, "")
    // Remove qualidade entre colchetes [FHD], [HD], [SD], [4K]
    .replace(/\[?(FHD|HD|SD|4K|H265|H\.265)\]?/g, "")
    // Remove sufixo " LEG" (legendado)
    .replace(/\bLEG\b/g, "")
    // Remove estados/regiões
    .replace(/\b(SP|RJ|BR|MG|RS|GO|PE|BA|CE|AM|PA|SC|PR|DF)\b/g, "")
    // Remove colchetes vazios e símbolos
    .replace(/\[\]|\(\)/g, "")
    .replace(/[*²³+]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function qualidadePeso(s: string): number {
  const u = s.toUpperCase();
  if (u.includes("4K"))  return 4;
  if (u.includes("FHD")) return 3;
  if (u.includes("HD"))  return 2;
  return 1;
}

const CATEGORIAS: Record<string, string[]> = {
  "Notícias":      ["NEWS","CNN","JOVEM PAN NEWS","GLOBONEWS","GB NEWS","RECORD NEWS","BAND NEWS"],
  "Esportes":      ["SPORT","ESPN","FOX SPORTS","COMBATE","PREMIERE","GOLF","NFL","DAZN","SPORTYNET"],
  "Infantil":      ["GLOOB","CARTOON","TOONCAST","CARTOONITO","DISNEY","NICK","BOOMERANG","DISCOVERY KIDS","ZOOMOO"],
  "Filmes":        ["TELECINE","TC ","HBO","CINEMAX","CINESKY","WARNER","PARAMOUNT","UNIVERSAL","STUDIO UNIVERSAL","MEGAPIX","PRIME BOX","TNT "],
  "Variedades":    ["MULTISHOW","GNT","VIVA","OFF ","ARTE 1","WOOHOO","E!","LIFETIME","TLC","FASHION","BIS "],
  "Documentários": ["DISCOVERY","HISTORY","NATIONAL GEO","NAT GEO","ANIMAL PLANET","FUTURA","TV ESCOLA","TRAVEL","ID ","INVESTIGACAO","THEATER","H2 ","A&E","SPACE "],
  "Música":        ["MTV","MUSIC BOX","TRACE","CANAL BRASIL"],
  "Aberta":        ["GLOBO ","SBT ","REDETV","TV BRASIL","TV CULTURA","CULTURA ","REDE VIDA","REDE GOSPEL","RECORD TV","RECORDTV","BAND ","BANDNEWS","TV APARECIDA"],
  "Regional":      ["RBS TV","NSC TV","EPTV","INTER TV","RPC ","TV LIBERAL","REDE AMAZONICA","TV ASA BRANCA","TV GAZETA","TV MIRANTE","TV MORENA","TV TEM ","TV SENADO","TV CAMARA","TV JUSTICA"],
  "Religioso":     ["CANCAO","CANÇÃO","APARECIDA","NOVO TEMPO","BOA VONTADE","REDE SUPER","RIT TV"],
  "Adulto":        ["XXX","PLAYBOY","SEXTR","PORN","ADULT","SEXY HOT","TRANS ","GAY "],
};

const BR_KEYWORDS = [
  "GLOBO","SBT","BAND","RECORD","REDETV","MULTISHOW","GNT","VIVA",
  "SPORTV","PREMIERE","CNN BRASIL","JOVEM PAN","CULTURA","TV BRASIL",
  "TELECINE","COMBATE","TRACE BRAZUCA","MUSIC BOX BRASIL","OFF ",
  "CANAL RURAL","EPTV","NSC TV","RBS TV","INTER TV","CANAL BRASIL",
  "DISCOVERY","HISTORY","ESPN","FOX SPORTS","CARTOON","DISNEY",
  "NICKELODEON","GLOOB","TOONCAST","ANIMAL PLANET","ARTE 1","FUTURA",
  "TV ESCOLA","REDE VIDA","WOOHOO","LIFETIME","TLC","AMC","AXN",
  "PARAMOUNT","UNIVERSAL","WARNER","CINEMAX","MEGAPIX","TNT",
  "PRIME BOX","GLOOBINHO","DISCOVERY KIDS","ADULT SWIM","ZOOMOO",
  "BIS ","CANAL SONY","CURTA","FOOD NETWORK","HGTV","TRAVEL BOX",
  "TV CAMARA","TV SENADO","TV JUSTICA","TV RA","STUDIO UNIVERSAL",
  "REDE BRASIL","REDE SUPER","NOVO TEMPO","BOA VONTADE","FISH TV",
  "SABOR E ARTE","CANAL DO BOI","FASHION TV","NHK","USA ","SPACE ",
];

function categorizar(nome: string): string {
  const n = nome.toUpperCase();
  for (const [cat, kws] of Object.entries(CATEGORIAS)) {
    for (const kw of kws) {
      if (n.includes(kw)) return cat;
    }
  }
  return "Outros";
}

function isBR(channelId: string, displayName: string): boolean {
  // Bloqueia canais com prefixo de país [pt], [es], [us], [ar], etc.
  // Esses são canais internacionais mesmo que tenham nomes parecidos com BR
  if (/^\[(pt|es|us|ar|mx|co|cl|fr|de|it|uk|au|jp|cn)\]/i.test(displayName.trim())) return false;
  if (channelId.toLowerCase().endsWith(".br")) return true;
  const dn = displayName.toUpperCase();
  return BR_KEYWORDS.some(kw => dn.includes(kw));
}

// Canais Globo permitidos — só os principais, sem afiliadas regionais
// Apenas estes canais Globo são aceitos — RJ, SP, Brasil, News, e Globosat
// Todas as afiliadas regionais (Inter TV, NSC TV, RBS, etc.) são descartadas
const GLOBO_PERMITIDOS = [
  "GLOBO RJ", "GLOBO SP",
  "GLOBO BRASIL", "GLOBO BRAZIL",
  "GLOBONEWS", "GLOBO NEWS",
  "+ GLOBOSAT", "MAIS GLOBOSAT",
  "GLOBO TV INTERNACIONAL", "GLOBO INTERNACIONAL",
];

function isAfiliataDescartavel(nomeUpper: string): boolean {
  // Se é um canal Globo mas NÃO está na lista de permitidos → descarta
  if (!nomeUpper.includes("GLOBO")) return false;
  return !GLOBO_PERMITIDOS.some(p => nomeUpper.includes(p));
}

// ─── Monta URLs do EPG (Elite e NaTV apenas) ─────────────────
function buildEpgUrls(cfg: EpgConfigRow): string[] {
  const dns  = cfg.dns || [];
  const user = cfg.server_username;
  const pass = cfg.server_password;

  switch (cfg.provider) {
    case "ELITE":
      return dns.map((d: string) => `${d.replace(/\/$/, "")}/xmltv.php?username=${user}&password=${pass}`);
    case "NATV":
      return dns.map((d: string) => `${d.replace(/\/$/, "")}/epg`);
    case "EPGBR":
      return ["https://iptv-epg.org/files/epg-br.xml"];
    default:
      return [];
  }
}

// ─── Download + Parse do XML ─────────────────────────────────
async function fetchEParsear(cfg: EpgConfigRow): Promise<{
  canais: Map<string, Canal>;
  programas: Programa[];
  erro?: string;
}> {
  const urls = buildEpgUrls(cfg);
  if (!urls.length) return { canais: new Map(), programas: [], erro: "Provider não suportado no sync automático" };

  let xmlText = "";
  let lastErro = "";

  for (const url of urls) {
    try {
      console.log(`[EPG] ${cfg.provider} tentando: ${url}`);
      const res = await fetch(url, {
        signal:   AbortSignal.timeout(45_000),
        redirect: "follow",
        headers: {
          "User-Agent": "VLC/3.0.18 LibVLC/3.0.18",
          "Accept":     "*/*",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xmlText = await res.text();
      console.log(`[EPG] ${cfg.provider} ok: ${xmlText.length} bytes`);
      break;
    } catch (e: any) {
      lastErro = e.message;
      console.warn(`[EPG] ${cfg.provider} falhou em ${url}: ${e.message}`);
    }
  }

  if (!xmlText) return { canais: new Map(), programas: [], erro: lastErro || "Todos os DNS falharam" };

  let parsed: any;
  try {
    parsed = await parseStringPromise(xmlText, { explicitArray: true });
  } catch (e: any) {
    return { canais: new Map(), programas: [], erro: `XML inválido: ${e.message}` };
  }

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
    if (!cid || !dn || !isBR(cid, dn)) continue;

    const existing = canais.get(cid);
    if (existing && qualidadePeso(dn) <= qualidadePeso(existing.display_name)) continue;

    const cat = categorizar(dn);
    if (cat === "Adulto") continue;

    // Descarta afiliadas regionais da Globo (só mantém RJ, SP, Brasil, News)
    if (isAfiliataDescartavel(dn.toUpperCase())) continue;

    canais.set(cid, {
      id:           cid,
      display_name: dn,
      nome:         normalizarNome(dn).split(" ").map((w: string) =>
                      w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                    ).join(" "),
      categoria:    cat,
      icon,
      servidor:     cfg.provider,
    });
  }

  const programas: Programa[] = [];
  for (const prog of programmes) {
    const cid     = prog.$?.channel?.trim() || "";
    if (!canais.has(cid)) continue;
    const startDt = parseToBRT(prog.$?.start || "");
    const stopDt  = parseToBRT(prog.$?.stop  || "");
    if (!startDt || !stopDt || stopDt < agora || startDt > limite) continue;
    const title    = prog.title?.[0]?._ || prog.title?.[0] || "";
    const desc     = prog.desc?.[0]?._  || prog.desc?.[0]  || "";
    if (!title) continue;
    const progIcon = prog.icon?.[0]?.$?.src || "";
    const canal    = canais.get(cid)!;
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

// ─── Lê Fast do R2 (se existir e for válido) ─────────────────
async function lerFastDoR2(): Promise<{
  canais: Map<string, Canal>;
  programas: Programa[];
  gerado_em: string | null;
  valido: boolean;
}> {
  const vazio = { canais: new Map<string, Canal>(), programas: [] as Programa[], gerado_em: null, valido: false };

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: EPG_FAST_KEY }));
    const body = await obj.Body?.transformToString();
    if (!body) return vazio;

    const fast = JSON.parse(body) as EpgPayload & { gerado_em: string };
    const gerado = new Date(fast.gerado_em);
    const diasDecorridos = (Date.now() - gerado.getTime()) / (1000 * 60 * 60 * 24);

    if (diasDecorridos > FAST_MAX_DIAS) {
      console.log(`[EPG] Fast ignorado — ${diasDecorridos.toFixed(1)} dias (limite: ${FAST_MAX_DIAS})`);
      return { ...vazio, gerado_em: fast.gerado_em, valido: false };
    }

    // Reconstrói Map de canais e lista de programas
    const canais = new Map<string, Canal>();
    for (const c of fast.canais || []) canais.set(c.id, c);

    console.log(`[EPG] Fast válido: ${canais.size} canais, ${fast.programas?.length} programas (${diasDecorridos.toFixed(1)} dias)`);
    return { canais, programas: fast.programas || [], gerado_em: fast.gerado_em, valido: true };

  } catch {
    console.log("[EPG] Fast não encontrado no R2");
    return vazio;
  }
}

// ─── Merge dos servidores ─────────────────────────────────────
function consolidar(resultados: Array<{ canais: Map<string, Canal>; programas: Programa[]; provider: string }>) {
  // Fast tem prioridade máxima quando válido
  // EPGBR: prioridade 3 (mesma do Fast, ícones perfeitos)
  const prioridade: Record<string, number> = { FAST: 3, EPGBR: 3, ELITE: 2, NATV: 1 };
  const canaisFinais  = new Map<string, Canal>();
  const programasTodos: Programa[] = [];

  for (const { canais, programas, provider } of resultados) {
    const prio       = prioridade[provider] || 0;
    const idParaNorm = new Map<string, string>();

    for (const [cid, canal] of canais) {
      const norm = normalizarNome(canal.display_name);
      if (!norm) continue;
      idParaNorm.set(cid, norm);

      const existente = canaisFinais.get(norm);
      if (!existente) {
        canaisFinais.set(norm, { ...canal });
      } else {
        const prioExist = prioridade[existente.servidor] || 0;
        if (prio > prioExist) {
          canaisFinais.set(norm, { ...canal, icon: canal.icon || existente.icon });
        } else if (!existente.icon && canal.icon) {
          existente.icon = canal.icon;
        }
      }
    }

    for (const prog of programas) {
      const norm = idParaNorm.get(prog.channel_id);
      if (!norm || !canaisFinais.has(norm)) continue;
      const cf = canaisFinais.get(norm)!;
      programasTodos.push({ ...prog, channel_id: cf.id, channel_nome: cf.nome, categoria: cf.categoria });
    }
  }

  const vistos = new Set<string>();
  const programasDedup = programasTodos.filter(p => {
    const key = `${p.channel_id}|${p.start}`;
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });

  const canaisLista = [...canaisFinais.values()]
    .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome));

  programasDedup.sort((a, b) => a.channel_id.localeCompare(b.channel_id) || a.start.localeCompare(b.start));

  return { canais: canaisLista, programas: programasDedup };
}

// ─── Upload no R2 ────────────────────────────────────────────
async function uploadR2(key: string, body: string) {
  await s3.send(new PutObjectCommand({
    Bucket:       R2_BUCKET,
    Key:          key,
    Body:         body,
    ContentType:  "application/json",
    CacheControl: "public, max-age=3600",
  }));
  return `${R2_URL}/${key}`;
}

// ─── POST — Sync automático (Elite + NaTV + Fast do R2) ──────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const agora  = new Date().toISOString();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Busca Elite e NaTV do banco
  const { data: configs, error: cfgErr } = await supabase
    .from("vw_epg_config")
    .select("*")
    .in("provider", ["ELITE", "NATV"])
    .order("priority", { ascending: true });

  if (cfgErr || !configs?.length) {
    return NextResponse.json({ error: "Sem configuração EPG no banco", detail: cfgErr?.message }, { status: 500 });
  }

  // Adiciona EPGBR como fonte extra (pública, sem credenciais, sem bloqueio de IP)
  const configsComEpgBr = [
    ...(configs as EpgConfigRow[]),
    {
      provider:        "EPGBR" as const,
      priority:        0, // processado primeiro
      server_username: "",
      server_password: "",
      dns:             [],
      api_base_url:    null,
    },
  ].sort((a, b) => a.priority - b.priority); // EPGBR (0) primeiro

  const log: Record<string, any> = { executado_em: agora, servidores: {}, resultado: {}, erro: null };
  const resultados: Array<{ canais: Map<string, Canal>; programas: Programa[]; provider: string }> = [];
  let jsonUrl = "";

  // 1. Processa EPGBR + Elite + NaTV
  for (const cfg of configsComEpgBr) {
    console.log(`[EPG] Processando ${cfg.provider}...`);
    const { canais, programas, erro } = await fetchEParsear(cfg);

    log.servidores[cfg.provider] = { ok: !erro, canais: canais.size, programas: programas.length, erro: erro || null };

    if (erro || !canais.size) { console.warn(`[EPG] ${cfg.provider} falhou: ${erro}`); continue; }

    resultados.push({ canais, programas, provider: cfg.provider });
  }

  if (!resultados.length) {
    log.erro = "Elite e NaTV falharam";
    await uploadR2(LOG_KEY, JSON.stringify(log, null, 2));
    return NextResponse.json({ error: log.erro, log }, { status: 502 });
  }

  // 2. Tenta incluir Fast do R2 (se válido)
  const fast = await lerFastDoR2();
  log.servidores["FAST"] = {
    ok:        fast.valido,
    canais:    fast.canais.size,
    programas: fast.programas.length,
    gerado_em: fast.gerado_em,
    fonte:     "R2 (upload manual)",
    erro:      fast.valido ? null : fast.gerado_em ? `Expirado (>${FAST_MAX_DIAS} dias)` : "Não encontrado",
  };

  if (fast.valido) {
    // Fast vai primeiro (prioridade máxima)
    resultados.unshift({ canais: fast.canais, programas: fast.programas, provider: "FAST" });
  }

  // 3. Consolida e salva
  const { canais, programas } = consolidar(resultados);
  const payload: EpgPayload = {
    gerado_em:       agora,
    fast_gerado_em:  fast.gerado_em,
    fast_valido:     fast.valido,
    servidores_ok:   resultados.map(r => r.provider),
    total_canais:    canais.length,
    total_programas: programas.length,
    canais,
    programas,
  };

  jsonUrl = await uploadR2(EPG_KEY, JSON.stringify(payload, null, 0));

  const duracao = Math.round((Date.now() - inicio) / 1000);
  log.resultado = { url: jsonUrl, duracao_s: duracao, servidores_ok: resultados.map(r => r.provider) };
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
