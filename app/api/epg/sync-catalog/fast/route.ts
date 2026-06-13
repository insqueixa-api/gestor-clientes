// app/api/epg/sync-catalog/fast/route.ts
//
// Sincronização do catálogo — Servidor FAST
//
// Diferente de Elite e NaTV, o Fast bloqueia IPs de datacenter.
// A extensão do Chrome baixa o M3U com o IP do usuário, parseia e
// envia os dados em lotes para esta rota via POST.
//
// POST body:
//   { tipo: "master",    lote: EntradaMaster[]  }
//   { tipo: "episodios", lote: EntradaEpisodio[] }
//   { tipo: "finalizar", stats: { filmes, series, episodios } }
//
// GET → status do último sync (log no R2) + m3u_url do cliente

import { NextRequest, NextResponse }   from "next/server";
import { createClient }                from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand }  from "@aws-sdk/client-s3";

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
const LOG_KEY   = "epg/catalog_fast_log.json";
const SERVIDOR  = "FAST" as const;
const CLIENT_ID = "aefcff7a-9b8f-46be-9a1b-155a73a472de";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BATCH = 500;

// ─── Limpeza de título ────────────────────────────────────────────────────────
// Remove sufixos de qualidade (4K, HD, HDR, BluRay...) e normaliza acentos
// para evitar duplicatas como "1917 4K" vs "1917" e "PERMISSÃO" vs "PERMISSAO"
function limparTitulo(titulo: string): string {
  return titulo
    .toUpperCase()
    // Remove acentos — "PERMISSÃO" → "PERMISSAO"
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // Remove sufixos de qualidade entre colchetes/parênteses: [4K], (HD), [WEB-DL]
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDR|SDR|UHD|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP)\s*[\])]/gi, "")
    // Remove sufixos de qualidade soltos no final: "FILME 4K", "FILME HDR"
    .replace(/\s+(4K|FHD|HDR|SDR|UHD|FULL|ULTRA|BLURAY|BLU-RAY|WEB-DL|WEBRIP|H265|HEVC|REMUX)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── GET — Status do último sync + URL do M3U ─────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { data: cliente } = await supabaseAdmin
    .from("clients")
    .select("m3u_url")
    .eq("id", CLIENT_ID)
    .single();

  let logData: any = { status: "Nenhum sync realizado ainda" };
  try {
    const res = await fetch(`${R2_URL}/${LOG_KEY}`, { cache: "no-store" });
    if (res.ok) logData = await res.json();
  } catch {}

  return NextResponse.json({ ...logData, m3u_url: cliente?.m3u_url || null });
}

// ─── POST — Recebe lotes da extensão e grava no Supabase ─────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const { tipo, lote } = body as {
    tipo: "master" | "episodios" | "finalizar";
    lote?: any[];
  };

  // ── Lote de master (filmes + séries) ─────────────────────────────────────
  if (tipo === "master" && Array.isArray(lote) && lote.length > 0) {
    const agora = new Date().toISOString();

    // 1. Normaliza todos os títulos antes de qualquer operação
    const loteNorm = lote.map(e => ({
      ...e,
      titulo_normalizado: limparTitulo(e.titulo_normalizado),
    }));

    // 2. Upsert catalog_master em lotes
    for (let i = 0; i < loteNorm.length; i += BATCH) {
      const batch = loteNorm.slice(i, i + BATCH);
      const masterRows = batch.map(e => ({
        titulo_normalizado: e.titulo_normalizado,
        tipo:               e.tipo,
        ...(e.cover_url ? { cover_url: e.cover_url } : {}),
        ano:           e.ano ?? null,
        atualizado_em: agora,
      }));

      const { error } = await supabaseAdmin
        .from("catalog_master")
        .upsert(masterRows, { onConflict: "titulo_normalizado", ignoreDuplicates: false });

      if (error) {
        console.error(`[CATALOG-FAST] Erro master lote ${i}:`, error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    // 3. Busca IDs gerados — títulos já normalizados
    const titulos = [...new Set(loteNorm.map(e => e.titulo_normalizado))];
    const idMap   = new Map<string, string>();

    for (let i = 0; i < titulos.length; i += 500) {
      const { data } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_normalizado")
        .in("titulo_normalizado", titulos.slice(i, i + 500));
      for (const row of data || []) idMap.set(row.titulo_normalizado, row.id);
    }

    // 4. Upsert catalog_availability
    const availRows = loteNorm
      .map(e => {
        const master_id = idMap.get(e.titulo_normalizado);
        return master_id
          ? { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem }
          : null;
      })
      .filter(Boolean) as any[];

    if (availRows.length > 0) {
      for (let i = 0; i < availRows.length; i += BATCH) {
        await supabaseAdmin
          .from("catalog_availability")
          .upsert(availRows.slice(i, i + BATCH), {
            onConflict:       "master_id,servidor",
            ignoreDuplicates: true,
          });
      }
    }

    return NextResponse.json({ ok: true, processados: loteNorm.length });
  }

  // ── Lote de episódios ─────────────────────────────────────────────────────
  if (tipo === "episodios" && Array.isArray(lote) && lote.length > 0) {
    // 1. Normaliza títulos
    const loteNorm = lote.map(e => ({
      ...e,
      titulo_normalizado: limparTitulo(e.titulo_normalizado),
    }));

    // 2. Busca IDs das séries (já gravadas com título limpo)
    const titulos = [...new Set(loteNorm.map(e => e.titulo_normalizado))];
    const idMap   = new Map<string, string>();

    for (let i = 0; i < titulos.length; i += 500) {
      const { data } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_normalizado")
        .in("titulo_normalizado", titulos.slice(i, i + 500));
      for (const row of data || []) idMap.set(row.titulo_normalizado, row.id);
    }

    // 3. Monta e grava episódios
    const epRows = loteNorm
      .map(e => {
        const master_id = idMap.get(e.titulo_normalizado);
        return master_id ? {
          master_id,
          servidor:  SERVIDOR,
          temporada: e.temporada,
          episodio:  e.episodio,
          cover_url: e.cover_url || null,
        } : null;
      })
      .filter(Boolean) as any[];

    if (epRows.length > 0) {
      for (let i = 0; i < epRows.length; i += BATCH) {
        const { error } = await supabaseAdmin
          .from("catalog_episodes")
          .upsert(epRows.slice(i, i + BATCH), {
            onConflict:       "master_id,servidor,temporada,episodio",
            ignoreDuplicates: true,
          });

        if (error) {
          console.error(`[CATALOG-FAST] Erro episodes lote ${i}:`, error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true, processados: epRows.length });
  }

  // ── Finalizar: atualiza contadores e salva log ────────────────────────────
  if (tipo === "finalizar") {
    const { error: rpcErr } = await supabaseAdmin
      .rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    if (rpcErr) console.error("[CATALOG-FAST] Erro RPC contadores:", rpcErr.message);

    const stats = body.stats || {};

    const { count: totalAvail }     = await supabaseAdmin
      .from("catalog_availability")
      .select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);

    const { count: totalEpisodios } = await supabaseAdmin
      .from("catalog_episodes")
      .select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);

    const log = {
      servidor:     SERVIDOR,
      executado_em: new Date().toISOString(),
      resultado: {
        filmes:          stats.filmes          || 0,
        series_unicas:   stats.series          || 0,
        episodios:       stats.episodios        || 0,
        novos_titulos:   Math.max(0, (totalAvail    || 0) - ((stats.filmes || 0) + (stats.series || 0))),
        novos_episodios: Math.max(0, (totalEpisodios || 0) - (stats.episodios || 0)),
        banco_titulos:   totalAvail    || 0,
        banco_episodios: totalEpisodios || 0,
      },
      erro: null,
    };

    try {
      await s3.send(new PutObjectCommand({
        Bucket:      R2_BUCKET,
        Key:         LOG_KEY,
        Body:        JSON.stringify(log, null, 2),
        ContentType: "application/json",
      }));
    } catch (e) {
      console.error("[CATALOG-FAST] Erro ao salvar log no R2:", e);
    }

    return NextResponse.json({ ok: true, finalizado: true, ...log.resultado });
  }

  return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
}
