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
const SLEEP_MS = 100;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Normalização para comparação ────────────────────────────────────────────
function normComp(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim();
}

// Score de similaridade: palavras em comum / total de palavras únicas
function similaridade(a: string, b: string): number {
  if (!a || !b) return 0;
  const wa = new Set(normComp(a).split(" ").filter(Boolean));
  const wb = new Set(normComp(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersecao = [...wa].filter(w => wb.has(w)).length;
  return intersecao / Math.max(wa.size, wb.size);
}

// Score máximo entre título original, título PT-BR e título alternativo
function melhorScore(busca: string, resultado: any, tipo: "FILME" | "SERIE"): number {
  const candidatos = [
    tipo === "FILME" ? resultado.title         : resultado.name,
    tipo === "FILME" ? resultado.original_title : resultado.original_name,
  ].filter(Boolean);
  return Math.max(...candidatos.map((c: string) => similaridade(busca, c)));
}

// ─── Busca no TMDB ────────────────────────────────────────────────────────────
async function buscarTMDB(titulo: string, tipo: "FILME" | "SERIE", ano: number | null): Promise<{
  resultado: any;
  score: number;
} | null> {
  const endpoint = tipo === "FILME" ? "search/movie" : "search/tv";

  // Tenta primeiro com ano, depois sem (para aumentar chances de encontrar)
  const tentativas = ano
    ? [{ api_key: TMDB_KEY, query: titulo, language: "pt-BR", include_adult: "false", year: String(ano) },
       { api_key: TMDB_KEY, query: titulo, language: "pt-BR", include_adult: "false" }]
    : [{ api_key: TMDB_KEY, query: titulo, language: "pt-BR", include_adult: "false" }];

  for (const p of tentativas) {
    const res = await fetch(`${TMDB_BASE}/${endpoint}?${new URLSearchParams(p)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) continue;

    const data = await res.json();
    const resultados = data.results || [];

    // Pega o resultado com maior score de similaridade (não necessariamente o primeiro)
    let melhor: any = null;
    let melhorScoreVal = 0;

    for (const r of resultados.slice(0, 5)) { // checa os 5 primeiros
      const score = melhorScore(titulo, r, tipo);
      if (score > melhorScoreVal) {
        melhorScoreVal = score;
        melhor = r;
      }
    }

    // Só aceita se o score for aceitável
    if (melhor && melhorScoreVal >= 0.5) {
      return { resultado: melhor, score: melhorScoreVal };
    }
  }

  return null;
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

// Processa em lotes de 5 em paralelo
  const CONCORRENCIA = 5;
  for (let i = 0; i < titulos.length; i += CONCORRENCIA) {
    const grupo = titulos.slice(i, i + CONCORRENCIA);
    await Promise.all(grupo.map(async (titulo) => {
      try {
        await sleep(SLEEP_MS);
        const tmdbRes = await buscarTMDB(titulo.titulo_normalizado, tipo, titulo.ano);

        if (!tmdbRes) {
          await supabaseAdmin.from("catalog_master").update({ tmdb_buscado_em: agora }).eq("id", titulo.id);
          nao_encontrados++;
          return;
        }

        const { resultado, score } = tmdbRes;
        const detalhes = await buscarDetalhes(resultado.id, tipo);

        const nomeResultado = tipo === "FILME" ? resultado.title : resultado.name;
        const generosList   = (detalhes?.genres || []).map((g: any) => g.name) as string[];
        const poster        = resultado.poster_path ? `${TMDB_IMG}${resultado.poster_path}` : null;
        const sinopse       = detalhes?.overview || resultado.overview || null;
        const avaliacao     = resultado.vote_average ? parseFloat(resultado.vote_average.toFixed(1)) : null;
        const confirmado    = score >= 0.8;

        await supabaseAdmin.from("catalog_master").update({
          tmdb_id:         resultado.id,
          sinopse:         sinopse || null,
          avaliacao,
          generos:         generosList.length > 0 ? generosList : null,
          poster_tmdb_url: poster,
          tmdb_confirmado: confirmado,
          tmdb_buscado_em: agora,
        }).eq("id", titulo.id);

        encontrados++;
      } catch (e: any) {
        await supabaseAdmin.from("catalog_master").update({ tmdb_buscado_em: agora }).eq("id", titulo.id);
        nao_encontrados++;
      }
    }));
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
