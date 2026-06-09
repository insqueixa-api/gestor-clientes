// app/api/epg/upload-fast/route.ts
// Upload manual do XML do Fast — salva como epg_fast.json no R2
// Chamada pelo painel do UniGestor (botão de upload)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

const R2_BUCKET    = process.env.R2_BUCKET_NAME        || "unigestor-media";
const R2_URL       = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
const EPG_FAST_KEY = "epg/epg_fast.json";

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
    for (const kw of kws) { if (n.includes(kw)) return cat; }
  }
  return "Outros";
}

function isBR(channelId: string, displayName: string): boolean {
  if (channelId.toLowerCase().endsWith(".br")) return true;
  return BR_KEYWORDS.some(kw => displayName.toUpperCase().includes(kw));
}

export async function POST(req: NextRequest) {
  // Autenticação
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Recebe o XML como multipart/form-data
  let xmlText: string;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    if (!file.name.endsWith(".xml")) return NextResponse.json({ error: "Envie um arquivo .xml" }, { status: 400 });
    xmlText = await file.text();
  } catch (e: any) {
    return NextResponse.json({ error: "Erro ao ler arquivo", detail: e.message }, { status: 400 });
  }

  // Parseia o XML
  let parsed: any;
  try {
    parsed = await parseStringPromise(xmlText, { explicitArray: true });
  } catch (e: any) {
    return NextResponse.json({ error: "XML inválido", detail: e.message }, { status: 400 });
  }

  const tv         = parsed?.tv || {};
  const channels   = tv.channel   || [];
  const programmes = tv.programme || [];
  const agora      = new Date();
  const limite     = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Canais BR
  const canais = new Map<string, any>();
  for (const ch of channels) {
    const cid  = ch.$?.id?.trim() || "";
    const dn   = ch["display-name"]?.[0]?._ || ch["display-name"]?.[0] || "";
    const icon = ch.icon?.[0]?.$?.src || "";
    if (!cid || !dn || !isBR(cid, dn)) continue;

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
      servidor:     "FAST",
    });
  }

  // Programas BR
  const programas: any[] = [];
  for (const prog of programmes) {
    const cid     = prog.$?.channel?.trim() || "";
    if (!canais.has(cid)) continue;
    const startDt = parseToBRT(prog.$?.start || "");
    const stopDt  = parseToBRT(prog.$?.stop  || "");
    if (!startDt || !stopDt || stopDt < agora || startDt > limite) continue;
    const title = prog.title?.[0]?._ || prog.title?.[0] || "";
    const desc  = prog.desc?.[0]?._  || prog.desc?.[0]  || "";
    if (!title) continue;
    const canal = canais.get(cid)!;
    programas.push({
      channel_id:   cid,
      channel_nome: canal.nome,
      categoria:    canal.categoria,
      start:        toISOBRT(startDt),
      stop:         toISOBRT(stopDt),
      duracao_min:  Math.round((stopDt.getTime() - startDt.getTime()) / 60000),
      title,
      desc,
    });
  }

  // Cobertura real do arquivo
  const todasDatas = programas.map(p => new Date(p.stop)).filter(Boolean);
  const ultimaData = todasDatas.length ? new Date(Math.max(...todasDatas.map(d => d.getTime()))) : null;

  // Salva no R2
  const gerado_em = agora.toISOString();
  const payload = {
    gerado_em,
    fonte:          "upload_manual",
    total_canais:   canais.size,
    total_programas: programas.length,
    cobertura_ate:  ultimaData?.toISOString() || null,
    canais:         [...canais.values()],
    programas,
  };

  const url = await (async () => {
    await s3.send(new PutObjectCommand({
      Bucket:       R2_BUCKET,
      Key:          EPG_FAST_KEY,
      Body:         JSON.stringify(payload, null, 0),
      ContentType:  "application/json",
      CacheControl: "public, max-age=3600",
    }));
    return `${R2_URL}/${EPG_FAST_KEY}`;
  })();

  return NextResponse.json({
    ok:              true,
    url,
    total_canais:    canais.size,
    total_programas: programas.length,
    gerado_em,
    cobertura_ate:   ultimaData?.toISOString() || null,
  });
}
