// app/api/epg/sync-catalog/natv/route.ts
//
// Sincronização do catálogo — Servidor NATV
//
// O Fast bloqueia downloads server-side por IP de datacenter.
// Fluxo:
//   GET  → devolve o m3u_url do cliente para o browser abrir/baixar
//   POST → recebe o arquivo M3U como multipart/form-data e processa

import { NextRequest, NextResponse }   from "next/server";
import { createClient }                from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand }  from "@aws-sdk/client-s3";
import {
  parseM3U,
  statsDoparse,
  type EntradaCatalogo,
} from "@/lib/catalog/catalog-parser";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

// ─── R2 ───────────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region:   "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME        || "unigestor-media";
const R2_URL    = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
const LOG_KEY   = "epg/catalog_natv_log.json";
const SERVIDOR  = "NATV" as const;
const CLIENT_ID = "f7e0b6e7-e7bb-486f-924c-5fc6704b94e9";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BATCH = 500;

// ─── GET — Devolve m3u_url para o browser abrir ───────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Tenta também retornar status do último sync
  let ultimoSync = null;
  try {
    const logRes = await fetch(`${R2_URL}/${LOG_KEY}`, { cache: "no-store" });
    if (logRes.ok) ultimoSync = await logRes.json();
  } catch {}

  const { data: cliente } = await supabaseAdmin
    .from("clients")
    .select("m3u_url")
    .eq("id", CLIENT_ID)
    .single();

  return NextResponse.json({
    m3u_url:   cliente?.m3u_url || null,
    ultimo_sync: ultimoSync,
  });
}

// ─── POST — Recebe o arquivo M3U e processa ───────────────────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const agora  = new Date().toISOString();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const log: Record<string, any> = {
    servidor: SERVIDOR, executado_em: agora,
    etapas: {}, resultado: {}, erro: null,
  };

  try {
    // ── 1. Lê o arquivo M3U do form-data ─────────────────────────────────────
    const formData = await req.formData();
    const arquivo  = formData.get("m3u") as File | null;

    if (!arquivo) {
      log.erro = "Nenhum arquivo M3U enviado. Use o campo 'm3u' no form-data.";
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 400 });
    }

    const m3uText = await arquivo.text();
    log.etapas.upload = { ok: true, nome: arquivo.name, bytes: m3uText.length };
    console.log(`[CATALOG-NATV] Arquivo recebido: ${arquivo.name} (${m3uText.length} bytes)`);

    // ── 2. Parsear ────────────────────────────────────────────────────────────
    console.log(`[CATALOG-NATV] Parseando...`);
    const entradas = parseM3U(m3uText);
    const stats    = statsDoparse(entradas);
    log.etapas.parse = { ok: true, ...stats, total_entradas: entradas.length };
    console.log(`[CATALOG-NATV] Parse concluído:`, stats);

    // ── 3. Separar e deduplicar ───────────────────────────────────────────────
    const canais       = entradas.filter(e => e.tipo === "CANAL");
    const filmes       = entradas.filter(e => e.tipo === "FILME");
    const series       = entradas.filter(e => e.tipo === "SERIE");
    const filmesUnicos = deduplicarPorTitulo(filmes);
    const seriesUnicas = agruparSeries(series);
    const todasMaster  = [...canais, ...filmesUnicos, ...seriesUnicas.master];

    // ── 4a. Upsert catalog_master ─────────────────────────────────────────────
    console.log(`[CATALOG-NATV] Upsert catalog_master: ${todasMaster.length} títulos...`);
    for (let i = 0; i < todasMaster.length; i += BATCH) {
      const rows = todasMaster.slice(i, i + BATCH).map(e => ({
        titulo_normalizado: e.titulo_normalizado,
        tipo:               e.tipo,
        ...(e.cover_url ? { cover_url: e.cover_url } : {}),
        ano:          e.ano ?? null,
        atualizado_em: agora,
      }));
      const { error } = await supabaseAdmin
        .from("catalog_master")
        .upsert(rows, { onConflict: "titulo_normalizado", ignoreDuplicates: false });
      if (error) console.error(`[CATALOG-NATV] Erro master lote ${i}:`, error.message);
    }

    // ── 4b. Buscar IDs ────────────────────────────────────────────────────────
    console.log(`[CATALOG-NATV] Buscando IDs...`);
    const masterIdMap = new Map<string, string>();
    const titulos = todasMaster.map(e => e.titulo_normalizado);
    for (let i = 0; i < titulos.length; i += 500) {
      const { data } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_normalizado")
        .in("titulo_normalizado", titulos.slice(i, i + 500));
      for (const row of data || []) masterIdMap.set(row.titulo_normalizado, row.id);
    }
    log.etapas.master = { ok: true, titulos: todasMaster.length, ids: masterIdMap.size };

    // ── 4c. Upsert catalog_availability ──────────────────────────────────────
    const availRows = [...canais, ...filmesUnicos, ...seriesUnicas.master]
      .map(e => {
        const master_id = masterIdMap.get(e.titulo_normalizado);
        return master_id ? { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem } : null;
      })
      .filter(Boolean) as any[];

    for (let i = 0; i < availRows.length; i += BATCH) {
      const { error } = await supabaseAdmin
        .from("catalog_availability")
        .upsert(availRows.slice(i, i + BATCH), { onConflict: "master_id,servidor", ignoreDuplicates: true });
      if (error) console.error(`[CATALOG-NATV] Erro availability lote ${i}:`, error.message);
    }

    // ── 4d. Upsert catalog_episodes ───────────────────────────────────────────
    const epRows = seriesUnicas.episodios
      .map(ep => {
        const master_id = masterIdMap.get(ep.titulo_normalizado);
        return master_id ? {
          master_id, servidor: SERVIDOR,
          temporada: ep.temporada!, episodio: ep.episodio!,
          cover_url: ep.cover_url || null,
        } : null;
      })
      .filter(Boolean) as any[];

    for (let i = 0; i < epRows.length; i += BATCH) {
      const { error } = await supabaseAdmin
        .from("catalog_episodes")
        .upsert(epRows.slice(i, i + BATCH), { onConflict: "master_id,servidor,temporada,episodio", ignoreDuplicates: true });
      if (error) console.error(`[CATALOG-NATV] Erro episodes lote ${i}:`, error.message);
    }

    // ── 4e. Contadores ────────────────────────────────────────────────────────
    await supabaseAdmin.rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    // ── 5. Resultado ──────────────────────────────────────────────────────────
    const duracao = Math.round((Date.now() - inicio) / 1000);
    log.resultado = {
      duracao_s:     duracao,
      canais:        canais.length,
      filmes:        filmesUnicos.length,
      series_unicas: seriesUnicas.master.length,
      episodios:     epRows.length,
      availability_upsert: availRows.length,
      episodes_upsert:     epRows.length,
    };

    await salvarLog(log);
    console.log(`[CATALOG-NATV] Concluído em ${duracao}s`, log.resultado);

    return NextResponse.json({ ok: true, ...log.resultado });

  } catch (e: any) {
    log.erro = e.message;
    await salvarLog(log);
    console.error(`[CATALOG-NATV] Erro fatal:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function deduplicarPorTitulo(filmes: EntradaCatalogo[]): EntradaCatalogo[] {
  const mapa = new Map<string, EntradaCatalogo>();
  for (const f of filmes) {
    const ex = mapa.get(f.titulo_normalizado);
    if (!ex || (!ex.cover_url && f.cover_url)) mapa.set(f.titulo_normalizado, f);
  }
  return [...mapa.values()];
}

function agruparSeries(series: EntradaCatalogo[]) {
  const masterMap = new Map<string, EntradaCatalogo>();
  for (const ep of series) {
    const ex = masterMap.get(ep.titulo_normalizado);
    if (!ex || (!ex.cover_url && ep.cover_url)) masterMap.set(ep.titulo_normalizado, ep);
  }
  return { master: [...masterMap.values()], episodios: series };
}

async function salvarLog(log: Record<string, any>) {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: LOG_KEY,
      Body: JSON.stringify(log, null, 2), ContentType: "application/json",
    }));
  } catch (e) { console.error("[CATALOG-NATV] Erro ao salvar log:", e); }
}
