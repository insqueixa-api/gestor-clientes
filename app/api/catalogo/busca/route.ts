// app/api/catalogo/busca/route.ts
// Busca inteligente: ignora acentos, maiúsculas, pontuação
// Filtra todas as palavras significativas no banco (não só a primeira)
// GET ?q=the+walking+dead&servidor=TODOS&tipo=TODOS

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palavras que sozinhas não servem como filtro no banco
const STOP_WORDS = new Set(["a","o","e","i","u","as","os","de","do","da","dos","das","em","na","no","nas","nos","the","and","of","to","in","is","it","for"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q        = (searchParams.get("q") || "").trim();
  const servidor = searchParams.get("servidor") || "TODOS";
  const tipo     = searchParams.get("tipo")     || "TODOS";

  if (q.length < 2) return NextResponse.json({ ok: true, data: [] });

  const termoNorm = normalizar(q);
  const todasPalavras = termoNorm.split(" ").filter(Boolean);
  
  // Palavras significativas para filtrar no banco (sem stop words, mínimo 2 chars)
  const palavrasFiltro = todasPalavras.filter(p => p.length >= 2 && !STOP_WORDS.has(p));
  // Se todas forem stop words, usa as originais
  const palavras = palavrasFiltro.length > 0 ? palavrasFiltro : todasPalavras.filter(p => p.length >= 2);

  if (palavras.length === 0) return NextResponse.json({ ok: true, data: [] });

  try {
    // Busca IDs em catalog_master usando titulo_busca (unaccent + lower, sem acentos)
    let masterQuery = supabaseAdmin
      .from("catalog_master")
      .select("id, titulo_normalizado, tipo, cover_url, poster_tmdb_url, ano, sinopse, avaliacao, generos, total_temporadas, total_episodios, tmdb_confirmado")
      .limit(500);

    if (tipo !== "TODOS") masterQuery = masterQuery.eq("tipo", tipo);

    for (const palavra of palavras.slice(0, 4)) {
      masterQuery = masterQuery.ilike("titulo_busca", `%${palavra}%`);
    }

    const { data: masterData, error: masterErr } = await masterQuery;
    if (masterErr) throw masterErr;

    if (!masterData || masterData.length === 0) {
      return NextResponse.json({ ok: true, data: [], total: 0 });
    }

    // Busca disponibilidade dos IDs encontrados
    const ids = masterData.map((m: any) => m.id);
    let availQuery = supabaseAdmin
      .from("catalog_availability")
      .select("master_id, servidor, categoria_origem")
      .in("master_id", ids);

    if (servidor !== "TODOS") availQuery = availQuery.eq("servidor", servidor);

    const { data: availData } = await availQuery;

    // Monta mapa de disponibilidade
    const rotasPorId = new Map<string, { servidor: string; categoria: string }[]>();
    for (const row of (availData || [])) {
      const arr = rotasPorId.get(row.master_id) || [];
      arr.push({ servidor: row.servidor, categoria: row.categoria_origem });
      rotasPorId.set(row.master_id, arr);
    }

    // Filtra no JS com normalização completa
    const resultados = masterData.filter((item: any) => {
      if (servidor !== "TODOS" && !rotasPorId.has(item.id)) return false;
      const tituloNorm = normalizar(item.titulo_normalizado);
      return todasPalavras.every((p) => tituloNorm.includes(p));
    });

    // Agrupa por titulo_normalizado
    const agrupado = new Map<string, {
      item: any;
      rotas: { servidor: string; categoria: string }[];
    }>();

    for (const item of resultados) {
      const key = item.titulo_normalizado;
      const rotas = rotasPorId.get(item.id) || [];
      if (!agrupado.has(key)) {
        agrupado.set(key, { item, rotas });
      } else {
        // Acumula rotas de entradas duplicadas
        agrupado.get(key)!.rotas.push(...rotas);
      }
    }

    // Ordena: com poster TMDB primeiro, depois por avaliação
    const lista = [...agrupado.values()]
      .sort((a, b) => {
        // Prioriza quem tem poster_tmdb_url
        const aPoster = a.item.poster_tmdb_url ? 1 : 0;
        const bPoster = b.item.poster_tmdb_url ? 1 : 0;
        if (bPoster !== aPoster) return bPoster - aPoster;
        // Depois por avaliação
        return (b.item.avaliacao || 0) - (a.item.avaliacao || 0);
      })
      .slice(0, 60)
      .map(({ item, rotas }) => ({
        id:               item.id,
        titulo_normalizado: item.titulo_normalizado,
        tipo:             item.tipo,
        cover_url:        item.cover_url,
        poster_tmdb_url:  item.poster_tmdb_url,
        ano:              item.ano,
        sinopse:          item.sinopse,
        avaliacao:        item.avaliacao,
        generos:          item.generos,
        total_temporadas: item.total_temporadas,
        total_episodios:  item.total_episodios,
        tmdb_confirmado:  item.tmdb_confirmado,
        rotas,
      }));

    return NextResponse.json({ ok: true, data: lista, total: lista.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
