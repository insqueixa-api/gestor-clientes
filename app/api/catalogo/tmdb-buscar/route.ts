// app/api/catalogo/tmdb-buscar/route.ts
// Busca títulos no TMDB para correção manual
// GET ?q=titulo&tipo=FILME|SERIE&page=1

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TMDB_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE = "https://api.themoviedb.org/3";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q    = (searchParams.get("q") || "").trim();
  const tipo = searchParams.get("tipo") || "FILME";
  const page = searchParams.get("page") || "1";

  if (!q) return NextResponse.json({ ok: false, error: "q obrigatório" }, { status: 400 });

  try {
    const endpoint = tipo === "SERIE" ? "tv" : "movie";
    const url = `${TMDB_BASE}/search/${endpoint}?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}&language=pt-BR&page=${page}&include_adult=false`;
    const data = await fetch(url).then(r => r.json());

    const resultados = (data.results || []).slice(0, 20).map((r: any) => ({
      tmdb_id:    r.id,
      titulo:     tipo === "SERIE" ? (r.name || r.original_name) : (r.title || r.original_title),
      titulo_original: tipo === "SERIE" ? r.original_name : r.original_title,
      ano:        tipo === "SERIE"
        ? (r.first_air_date ? parseInt(r.first_air_date.slice(0, 4)) : null)
        : (r.release_date   ? parseInt(r.release_date.slice(0, 4))   : null),
      sinopse:    r.overview || null,
      avaliacao:  r.vote_average ? parseFloat(r.vote_average.toFixed(1)) : null,
      generos:    [],
      poster_url: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
    }));

    return NextResponse.json({ ok: true, data: resultados, total: data.total_results || 0 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
