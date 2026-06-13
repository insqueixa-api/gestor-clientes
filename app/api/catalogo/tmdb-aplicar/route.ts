// app/api/catalogo/tmdb-aplicar/route.ts
// Aplica um resultado do TMDB a um título do catalog_master
// POST { master_id, tmdb_id, tipo }

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TMDB_KEY  = process.env.TMDB_API_KEY!;
const TMDB_BASE = "https://api.themoviedb.org/3";

export async function POST(req: NextRequest) {
  const { master_id, tmdb_id, tipo } = await req.json();

  if (!master_id || !tmdb_id) {
    return NextResponse.json({ ok: false, error: "master_id e tmdb_id obrigatórios" }, { status: 400 });
  }

  try {
    // Busca detalhes completos do TMDB
    const endpoint = tipo === "SERIE" ? "tv" : "movie";
    const detUrl = `${TMDB_BASE}/${endpoint}/${tmdb_id}?api_key=${TMDB_KEY}&language=pt-BR`;
    const det = await fetch(detUrl).then(r => r.json());

    const ano = tipo === "SERIE"
      ? (det.first_air_date ? parseInt(det.first_air_date.slice(0, 4)) : null)
      : (det.release_date   ? parseInt(det.release_date.slice(0, 4))   : null);

    const generos = ((det.genres || []) as any[]).map((g: any) => g.name).filter(Boolean);
    const poster  = det.poster_path ? `https://image.tmdb.org/t/p/w500${det.poster_path}` : null;
    const sinopse = det.overview || null;
    const avaliacao = det.vote_average ? parseFloat(det.vote_average.toFixed(1)) : null;
    const total_temporadas = tipo === "SERIE" ? (det.number_of_seasons || null) : null;
    const total_episodios  = tipo === "SERIE" ? (det.number_of_episodes || null) : null;

    const update: Record<string, any> = {
      tmdb_id,
      tmdb_confirmado: true,
      tmdb_buscado_em: new Date().toISOString(),
      poster_tmdb_url: poster,
      sinopse,
      avaliacao,
      generos,
      atualizado_em: new Date().toISOString(),
    };
    if (ano) update.ano = ano;
    if (total_temporadas) update.total_temporadas = total_temporadas;
    if (total_episodios)  update.total_episodios  = total_episodios;

    const { error } = await supabaseAdmin
      .from("catalog_master")
      .update(update)
      .eq("id", master_id);

    if (error) throw error;

    return NextResponse.json({ ok: true, aplicado: { tmdb_id, poster, sinopse, avaliacao, generos, ano } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
