// app/api/epg/sync-catalog/fast/route.ts
import { NextRequest, NextResponse }   from "next/server";
import { createClient }                from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;


const SERVIDOR  = "FAST" as const;
const CLIENT_ID = "aefcff7a-9b8f-46be-9a1b-155a73a472de";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BATCH = 500;

function limparTitulo(titulo: string): string {
  return titulo
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    .replace(/\s+4K\s+(DIRECTORS?.?CUT|HDRR|HDR|DV|HYBRID|HDCAM|CAM|REMUX|HEVC|H265).*$/gi, "")
    .replace(/(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|WEB-DL|WEBRIP|H265|HEVC|REMUX|DIRECTORS?.?CUT)$/gi, "")
    .replace(/\s+(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|BLU-RAY|WEB-DL|WEBRIP|HDRIP|DVDRIP|BDRIP|H265|H\.265|HEVC|REMUX|DIRECTORS?.?CUT)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: cliente } = await supabaseAdmin
    .from("clients")
    .select("m3u_url")
    .eq("id", CLIENT_ID)
    .single();

const { data: statsView } = await supabaseAdmin
    .from("catalog_stats_por_servidor")
    .select("filmes, series_unicas, episodios")
    .eq("servidor", SERVIDOR)
    .single();

  // Busca a data exata do último sync gravado no banco
  const { data: syncData } = await supabaseAdmin
    .from("catalog_availability")
    .select("sincronizado_em")
    .eq("servidor", SERVIDOR)
    .order("sincronizado_em", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    m3u_url: cliente?.m3u_url || null,
    executado_em: syncData?.sincronizado_em || null,
    resultado: {
      filmes:        statsView?.filmes        || 0,
      series_unicas: statsView?.series_unicas || 0,
      episodios:     statsView?.episodios     || 0,
    },
  });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const { tipo, lote } = body as {
    tipo: "iniciar" | "master" | "episodios" | "finalizar";
    lote?: any[];
  };

  // ── Snapshot ANTES do sync ────────────────────────────────────────────────
  if (tipo === "iniciar") {
    const [{ count: totalAvail }, { count: totalEpisodios }] = await Promise.all([
      supabaseAdmin.from("catalog_availability").select("*", { count: "exact", head: true }).eq("servidor", SERVIDOR),
      supabaseAdmin.from("catalog_episodes").select("*", { count: "exact", head: true }).eq("servidor", SERVIDOR),
    ]);
    return NextResponse.json({ ok: true, totalAvailAntes: totalAvail || 0, totalEpisodiosAntes: totalEpisodios || 0 });
  }

  // ── Lote de master (filmes + séries) ─────────────────────────────────────
  if (tipo === "master" && Array.isArray(lote) && lote.length > 0) {
    const agora = new Date().toISOString();

    const loteNorm = lote.map(e => ({
      ...e,
      titulo_normalizado: limparTitulo(e.titulo_normalizado),
    }));

    for (let i = 0; i < loteNorm.length; i += BATCH) {
      const batch = loteNorm.slice(i, i + BATCH);

      // Deduplica dentro do lote após limparTitulo para evitar conflito no upsert
      const batchMap = new Map<string, any>()
      for (const e of batch) {
        const key = `${e.titulo_normalizado}|${e.tipo}`
        if (!batchMap.has(key) || (!batchMap.get(key).cover_url && e.cover_url)) {
          batchMap.set(key, e)
        }
      }
      const masterRows = [...batchMap.values()].map(e => ({
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

    const titulos = [...new Set(loteNorm.map(e => e.titulo_normalizado))];
    const idMap   = new Map<string, string>();

    for (let i = 0; i < titulos.length; i += 500) {
      const { data } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_normalizado")
        .in("titulo_normalizado", titulos.slice(i, i + 500));
      for (const row of data || []) idMap.set(row.titulo_normalizado, row.id);
    }

const availRows = loteNorm
      .map(e => {
        const master_id = idMap.get(e.titulo_normalizado);
        return master_id
          ? { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem, sincronizado_em: agora }
          : null;
      })
      .filter(Boolean) as any[];

    if (availRows.length > 0) {
      for (let i = 0; i < availRows.length; i += BATCH) {
        await supabaseAdmin
          .from("catalog_availability")
          .upsert(availRows.slice(i, i + BATCH), {
            onConflict:       "master_id,servidor",
            ignoreDuplicates: false,
          });
      }
    }

    return NextResponse.json({ ok: true, processados: loteNorm.length });
  }

  // ── Lote de episódios ─────────────────────────────────────────────────────
  if (tipo === "episodios" && Array.isArray(lote) && lote.length > 0) {
    const loteNorm = lote.map(e => ({
      ...e,
      titulo_normalizado: limparTitulo(e.titulo_normalizado),
    }));

    const titulos = [...new Set(loteNorm.map(e => e.titulo_normalizado))];
    const idMap   = new Map<string, string>();

    for (let i = 0; i < titulos.length; i += 500) {
      const { data } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_normalizado")
        .in("titulo_normalizado", titulos.slice(i, i + 500));
      for (const row of data || []) idMap.set(row.titulo_normalizado, row.id);
    }

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

    // master_ids de séries que ganharam pelo menos 1 episódio genuinamente novo
    // neste lote — usado depois pra "reabrir" o adicionado_em delas.
    const masterIdsComEpisodioNovo = new Set<string>();

    if (epRows.length > 0) {
      for (let i = 0; i < epRows.length; i += BATCH) {
        const lote2 = epRows.slice(i, i + BATCH);

        const masterIdsDoLote = [...new Set(lote2.map((ep: any) => ep.master_id))];
        const { data: existentes } = await supabaseAdmin
          .from("catalog_episodes")
          .select("master_id, temporada, episodio")
          .eq("servidor", SERVIDOR)
          .in("master_id", masterIdsDoLote);

        const existenteSet = new Set(
          (existentes || []).map(e => `${e.master_id}|${e.temporada}|${e.episodio}`)
        );

        for (const ep of lote2 as any[]) {
          const key = `${ep.master_id}|${ep.temporada}|${ep.episodio}`;
          if (!existenteSet.has(key)) {
            masterIdsComEpisodioNovo.add(ep.master_id);
          }
        }

        const { error } = await supabaseAdmin
          .from("catalog_episodes")
          .upsert(lote2, {
            onConflict:       "master_id,servidor,temporada,episodio",
            ignoreDuplicates: true,
          });

        if (error) {
          console.error(`[CATALOG-FAST] Erro episodes lote ${i}:`, error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }

    // Reabre o adicionado_em das séries que ganharam episódio novo neste lote —
    // sem isso, série existente que só recebeu episódio novo nunca reaparece
    // em "novidades" (o upsert de availability preserva adicionado_em original).
    if (masterIdsComEpisodioNovo.size > 0) {
      const idsArray = [...masterIdsComEpisodioNovo];
      console.log(`[CATALOG-FAST] Reabrindo adicionado_em de ${idsArray.length} séries com episódio novo...`);
      const { error: reopenErr } = await supabaseAdmin
        .from("catalog_availability")
        .update({ adicionado_em: new Date().toISOString() })
        .eq("servidor", SERVIDOR)
        .in("master_id", idsArray);
      if (reopenErr) console.error(`[CATALOG-FAST] Erro ao reabrir adicionado_em:`, reopenErr.message);
    }

    return NextResponse.json({ ok: true, processados: epRows.length });
  }

  // ── Finalizar ─────────────────────────────────────────────────────────────
  if (tipo === "finalizar") {
    const stats = body.stats || {};

// Snapshot ANTES vem da chamada "iniciar" feita pela extensão
    const totalAvailAntes    = body.totalAvailAntes    || 0;
    const totalEpisodiosAntes = body.totalEpisodiosAntes || 0;

const { error: rpcErr } = await supabaseAdmin
      .rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    if (rpcErr) console.error("[CATALOG-FAST] Erro RPC contadores:", rpcErr.message);

    // Refresh da view materializada
    await supabaseAdmin.rpc("refresh_catalog_stats");

    // Snapshot DEPOIS
    const [{ count: totalAvailDepois }, { count: totalEpisodiosDepois }] = await Promise.all([
      supabaseAdmin.from("catalog_availability").select("*", { count: "exact", head: true }).eq("servidor", SERVIDOR),
      supabaseAdmin.from("catalog_episodes").select("*", { count: "exact", head: true }).eq("servidor", SERVIDOR),
    ]);

    const resultado = {
      filmes:          stats.filmes   || 0,
      series_unicas:   stats.series   || 0,
      episodios:       stats.episodios || 0,
      novos_titulos:   Math.max(0, (totalAvailDepois    || 0) - (totalAvailAntes    || 0)),
      novos_episodios: Math.max(0, (totalEpisodiosDepois || 0) - (totalEpisodiosAntes || 0)),
      banco_titulos:   totalAvailDepois    || 0,
      banco_episodios: totalEpisodiosDepois || 0,
    };

    return NextResponse.json({ ok: true, finalizado: true, ...resultado });
  }

  return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
}