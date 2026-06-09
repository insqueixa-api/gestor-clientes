// app/api/epg/sync/route.ts
// Baixa os 3 EPGs, processa e salva no Cloudflare R2
// Acionada pelo cron do Supabase ou manualmente

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseStringPromise } from "xml2js";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos — Vercel Hobby limit

// ─── R2 Client ───────────────────────────────────────────────
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME       || "unigestor-media";
const R2_URL    = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
const EPG_KEY   = "epg/epg_br.json";
const LOG_KEY   = "epg/epg_sync_log.json";

// ─── Tipos ───────────────────────────────────────────────────
type EpgConfigRow = {
  provider:        "FAST" | "ELITE" | "NATV";
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
};

// ─── Helpers ─────────────────────────────────────────────────
const BRT_OFFSET = -3 * 60; // minutos

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
    .replace(/\[?(FHD|HD|SD|4K|H265|H\.265)\]?/g, "")
    .replace(/\b(SP|RJ|BR|MG|RS|GO|PE|BA|CE|AM|PA|SC|PR|DF)\b/g, "")
    .replace(/[*²³]/g, "")
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
  if (channelId.toLowerCase().endsWith(".br")) return true;
  const dn = displayName.toUpperCase();
  return BR_KEYWORDS.some(kw => dn.includes(kw));
}

// ─── Monta URLs do EPG por provider (retorna múltiplas para fallback) ──
function buildEpgUrls(cfg: EpgConfigRow): string[] {
  const dns  = cfg.dns || [];
  const user = cfg.server_username;
  const pass = cfg.server_password;

  switch (cfg.provider) {
    case "FAST":
      // Fast: EPG público, sem credenciais — tenta todos os DNS
      return dns.map((d: string) => `${d.replace(/\/$/, "")}/epg.php`);
    case "ELITE":
      // Elite: DNS do servidor com credenciais
      return dns.map((d: string) => `${d.replace(/\/$/, "")}/xmltv.php?username=${user}&password=${pass}`);
    case "NATV":
      // NaTV: sem credenciais
      return dns.map((d: string) => `${d.replace(/\/$/, "")}/epg`);
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
  if (!urls.length) return { canais: new Map(), programas: [], erro: "Sem DNS configurado" };

  let xmlText: string = "";
  let lastErro = "";

  // Tenta cada DNS em ordem até um funcionar
  for (const url of urls) {
    try {
      console.log(`[EPG] ${cfg.provider} tentando: ${url}`);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(45_000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; IPTV/1.0)",
          "Accept":     "application/xml, text/xml, */*",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xmlText = await res.text();
      console.log(`[EPG] ${cfg.provider} ok com ${url}`);
      break; // Funcionou, para aqui
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

  const tv        = parsed?.tv || {};
  const channels  = tv.channel  || [];
  const programmes = tv.programme || [];

  const agora  = new Date();
  const limite = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Canais BR
  const canais = new Map<string, Canal>();
  for (const ch of channels) {
    const cid = ch.$?.id?.trim() || "";
    const dn  = ch["display-name"]?.[0]?._ || ch["display-name"]?.[0] || "";
    const icon = ch.icon?.[0]?.$?.src || "";
    if (!cid || !dn) continue;
    if (!isBR(cid, dn)) continue;

    const existing = canais.get(cid);
    if (existing && qualidadePeso(dn) <= qualidadePeso(existing.display_name)) continue;

    const cat = categorizar(dn);
    if (cat === "Adulto") continue;

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

  // Programas BR
  const programas: Programa[] = [];
  for (const prog of programmes) {
    const cid   = prog.$?.channel?.trim() || "";
    if (!canais.has(cid)) continue;

    const startDt = parseToBRT(prog.$?.start || "");
    const stopDt  = parseToBRT(prog.$?.stop  || "");
    if (!startDt || !stopDt) continue;
    if (stopDt < agora || startDt > limite) continue;

    const title = prog.title?.[0]?._ || prog.title?.[0] || "";
    const desc  = prog.desc?.[0]?._  || prog.desc?.[0]  || "";
    if (!title) continue;

    const canal = canais.get(cid)!;
    programas.push({
      channel_id:  cid,
      channel_nome: canal.nome,
      categoria:   canal.categoria,
      start:       toISOBRT(startDt),
      stop:        toISOBRT(stopDt),
      duracao_min: Math.round((stopDt.getTime() - startDt.getTime()) / 60000),
      title,
      desc,
    });
  }

  return { canais, programas };
}

// ─── Merge dos 3 servidores ───────────────────────────────────
function consolidar(resultados: Array<{ canais: Map<string, Canal>; programas: Programa[]; provider: string }>) {
  const prioridade: Record<string, number> = { FAST: 3, ELITE: 2, NATV: 1 };
  const canaisFinais = new Map<string, Canal>();  // nome_norm → canal
  const programasTodos: Programa[] = [];

  for (const { canais, programas, provider } of resultados) {
    const prio = prioridade[provider] || 0;
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
          const icon = canal.icon || existente.icon;
          canaisFinais.set(norm, { ...canal, icon });
        } else if (!existente.icon && canal.icon) {
          existente.icon = canal.icon;
        }
      }
    }

    for (const prog of programas) {
      const norm = idParaNorm.get(prog.channel_id);
      if (!norm || !canaisFinais.has(norm)) continue;
      programasTodos.push({
        ...prog,
        channel_id:   canaisFinais.get(norm)!.id,
        channel_nome: canaisFinais.get(norm)!.nome,
        categoria:    canaisFinais.get(norm)!.categoria,
      });
    }
  }

  // Remove programas duplicados (mesmo canal + mesmo start)
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

// ─── Handler Principal ────────────────────────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const agora  = new Date().toISOString();

  // Autenticação
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Busca configuração dos servidores EPG
  const { data: configs, error: cfgErr } = await supabase
    .from("vw_epg_config")
    .select("*")
    .order("priority", { ascending: true });

  if (cfgErr || !configs?.length) {
    return NextResponse.json({ error: "Sem configuração EPG no banco", detail: cfgErr?.message }, { status: 500 });
  }

  const log: Record<string, any> = {
    executado_em: agora,
    servidores: {},
    resultado:  {},
    erro:       null,
  };

  // Processa sequencialmente (Fast → Elite → NaTV)
  // Salva resultado parcial após cada servidor
  const resultados: Array<{ canais: Map<string, Canal>; programas: Programa[]; provider: string }> = [];
  let jsonUrl = "";

  for (const cfg of configs as EpgConfigRow[]) {
    console.log(`[EPG] Processando ${cfg.provider}...`);
    const { canais, programas, erro } = await fetchEParsear(cfg);

    log.servidores[cfg.provider] = {
      ok:        !erro,
      canais:    canais.size,
      programas: programas.length,
      erro:      erro || null,
    };

    if (erro || !canais.size) {
      console.warn(`[EPG] ${cfg.provider} falhou: ${erro}`);
      continue;
    }

    resultados.push({ canais, programas, provider: cfg.provider });

    // Salva parcial após cada servidor com sucesso
    const { canais: c, programas: p } = consolidar(resultados);
    const payload = {
      gerado_em:       agora,
      servidores_ok:   resultados.map(r => r.provider),
      total_canais:    c.length,
      total_programas: p.length,
      canais:          c,
      programas:       p,
    };

    jsonUrl = await uploadR2(EPG_KEY, JSON.stringify(payload, null, 0));
    console.log(`[EPG] Parcial salvo após ${cfg.provider}: ${c.length} canais, ${p.length} programas`);
  }

  if (!resultados.length) {
    log.erro = "Todos os servidores falharam";
    await uploadR2(LOG_KEY, JSON.stringify(log, null, 2));
    return NextResponse.json({ error: log.erro, log }, { status: 502 });
  }

  // Log final
  const duracao = Math.round((Date.now() - inicio) / 1000);
  log.resultado = {
    url:      jsonUrl,
    duracao_s: duracao,
    servidores_ok: resultados.map(r => r.provider),
  };

  await uploadR2(LOG_KEY, JSON.stringify(log, null, 2));

  return NextResponse.json({
    ok:       true,
    url:      jsonUrl,
    duracao_s: duracao,
    log,
  });
}

// GET para verificar status (último log)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const res = await fetch(`${R2_URL}/${LOG_KEY}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ status: "Nenhum sync realizado ainda" });
    const log = await res.json();
    return NextResponse.json(log);
  } catch {
    return NextResponse.json({ status: "Log não encontrado" });
  }
}
