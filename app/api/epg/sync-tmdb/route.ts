// app/api/epg/sync-tmdb/route.ts
//
// Enriquecimento do catálogo com dados do TMDB
//
// Fluxo:
//   GET  → retorna status (quantos faltam, quantos têm TMDB)
//   POST → processa um lote de títulos sem TMDB
//          ?tipo=FILME|SERIE  (padrão: FILME)
//          ?lote=50           (padrão: 50, máximo: 100)
//          ?forcar=true       → re-processa mesmo os que já tentaram
//
// O TMDB é buscado por nome + ano (se disponível)
// tmdb_confirmado=false → match automático (pode ter falso positivo)
// tmdb_confirmado=true  → confirmado manualmente via interface

import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TMDB_KEY     = process.env.TMDB_API_KEY || "";
const TMDB_BASE    = "https://api.themoviedb.org/3";
const TMDB_IMG     = "https://image.tmdb.org/t/p/w500";
const SLEEP_MS     = 250; // respeita rate limit do TMDB (40 req/s)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Busca no TMDB ────────────────────────────────────────────────────────────
async function buscarTMDB(titulo: string, tipo: "FILME" | "SERIE", ano: number | null) {
  const endpoint = tipo === "FILME" ? "search/movie" : "search/tv";
  const params   = new URLSearchParams({
    api_key:       TMDB_KEY,
    query:         titulo,
    language:      "pt-BR",
    include_adult: "false",
    ...(ano ? { year: String(ano) } : {}),
  });

  const res = await fetch(`${TMDB_BASE}/${endpoint}?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0] || null;
}

// ─── Busca detalhes completos do título ───────────────────────────────────────
async function buscarDetalhes(tmdbId: number, tipo: "FILME" | "SERIE") {
  const endpoint = tipo === "FILME" ? `movie/${tmdbId}` : `tv/${tmdbId}`;
  const params   = new URLSearchParams({ api_key: TMDB_KEY, language: "pt-BR" });

  const res = await fetch(`${TMDB_BASE}/${endpoint}?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return null;
  return await res.json();
}

// ─── GET — Status ─────────────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const [
    { count: totalFilmes },
    { count: totalSeries },
    { count: semTmdbFilmes },
    { count: semTmdbSeries },
    { count: confirmados },
  ] = await Promise.all([
    supabaseAdmin.from("catalog_master").select("*", { count: "exact", head: true }).eq("tipo", "FILME"),
    supabaseAdmin.from("catalog_master").select("*", { count: "exact", head: true }).eq("tipo", "SERIE"),
    supabaseAdmin.from("catalog_master").select("*", { count: "exact", head: true }).eq("tipo", "FILME").is("tmdb_id", null),
    supabaseAdmin.from("catalog_master").select("*", { count: "exact", head: true }).eq("tipo", "SERIE").is("tmdb_id", null),
    supabaseAdmin.from("catalog_master").select("*", { count: "exact", head: true }).eq("tmdb_confirmado", true),
  ]);

  return NextResponse.json({
    filmes:         { total: totalFilmes, sem_tmdb: semTmdbFilmes, com_tmdb: (totalFilmes||0) - (semTmdbFilmes||0) },
    series:         { total: totalSeries, sem_tmdb: semTmdbSeries, com_tmdb: (totalSeries||0) - (semTmdbSeries||0) },
    confirmados,
    tmdb_key_ok:    TMDB_KEY.length > 0,
  });
}

// ─── POST — Processar lote ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (!TMDB_KEY) return NextResponse.json({ error: "TMDB_API_KEY não configurada" }, { status: 500 });

  const params = req.nextUrl.searchParams;
  const tipo   = (params.get("tipo") || "FILME").toUpperCase() as "FILME" | "SERIE";
  const lote   = Math.min(parseInt(params.get("lote") || "50"), 100);
  const forcar = params.get("forcar") === "true";

  // Busca títulos sem TMDB
  let query = supabaseAdmin
    .from("catalog_master")
    .select("id, titulo_normalizado, tipo, ano")
    .eq("tipo", tipo)
    .is("tmdb_id", null)
    .limit(lote);

  if (!forcar) {
    // Só busca os que nunca tentamos OU que tentamos há mais de 30 dias
    query = query.or("tmdb_buscado_em.is.null,tmdb_buscado_em.lt." + 
      new Date(Date.now() - 30 * 24 * 3600000).toISOString());
  }

  const { data: titulos, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!titulos?.length) return NextResponse.json({ ok: true, processados: 0, msg: "Nada para processar" });

  const agora     = new Date().toISOString();
  let encontrados = 0;
  let nao_encontrados = 0;

  for (const titulo of titulos) {
    try {
      await sleep(SLEEP_MS);

      const resultado = await buscarTMDB(titulo.titulo_normalizado, tipo, titulo.ano);

      if (!resultado) {
        // Marca como tentado mas sem resultado
        await supabaseAdmin.from("catalog_master").update({ tmdb_buscado_em: agora }).eq("id", titulo.id);
        nao_encontrados++;
        continue;
      }

      // Busca detalhes completos para pegar sinopse e gêneros
      const detalhes = await buscarDetalhes(resultado.id, tipo);
      await sleep(SLEEP_MS);

      const nomeResultado = tipo === "FILME" ? resultado.title : resultado.name;
      const generosList   = (detalhes?.genres || []).map((g: any) => g.name) as string[];
      const poster        = resultado.poster_path ? `${TMDB_IMG}${resultado.poster_path}` : null;
      const sinopse       = detalhes?.overview || resultado.overview || null;
      const avaliacao     = resultado.vote_average ? parseFloat(resultado.vote_average.toFixed(1)) : null;

      await supabaseAdmin.from("catalog_master").update({
        tmdb_id:         resultado.id,
        sinopse:         sinopse || null,
        avaliacao:       avaliacao,
        generos:         generosList.length > 0 ? generosList : null,
        poster_tmdb_url: poster,
        tmdb_confirmado: false,  // automático = não confirmado
        tmdb_buscado_em: agora,
      }).eq("id", titulo.id);

      encontrados++;
      console.log(`[TMDB] ✓ "${titulo.titulo_normalizado}" → "${nomeResultado}" (${resultado.id})`);

    } catch (e: any) {
      console.error(`[TMDB] Erro em "${titulo.titulo_normalizado}":`, e.message);
      // Marca como tentado mesmo com erro para não ficar em loop
      await supabaseAdmin.from("catalog_master").update({ tmdb_buscado_em: agora }).eq("id", titulo.id);
      nao_encontrados++;
    }
  }

  return NextResponse.json({
    ok:              true,
    tipo,
    processados:     titulos.length,
    encontrados,
    nao_encontrados,
    proximo_lote:    titulos.length === lote, // true = ainda tem mais para processar
  });
}
