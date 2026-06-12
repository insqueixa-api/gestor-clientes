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
    // Monta query com ilike para CADA palavra significativa no banco
    // Isso garante que "the walking dead" filtre corretamente
    let query = supabaseAdmin
      .from("vw_catalog_full")
      .select(`
        id, titulo_normalizado, tipo,
        cover_url, poster_tmdb_url,
        ano, sinopse, avaliacao, generos,
        total_temporadas, total_episodios,
        tmdb_id, tmdb_confirmado,
        servidor, categoria_origem, adicionado_em
      `)
      .limit(500); // limite maior para garantir que não corta

    // Filtra por tipo se especificado
    if (tipo !== "TODOS") query = query.eq("tipo", tipo);
    if (servidor !== "TODOS") query = query.eq("servidor", servidor);

    // Aplica ilike para cada palavra (todas devem estar no título)
    // Máximo 4 palavras para não criar query muito pesada
    for (const palavra of palavras.slice(0, 4)) {
      query = query.ilike("titulo_normalizado", `%${palavra}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Filtra no JS com normalização completa (valida TODAS as palavras originais)
    const resultados = (data || []).filter((item) => {
      const tituloNorm = normalizar(item.titulo_normalizado);
      return todasPalavras.every((p) => tituloNorm.includes(p));
    });

    // Agrupa por titulo_normalizado (mesmo título em múltiplos servidores)
    const agrupado = new Map<string, {
      item: typeof resultados[0];
      rotas: { servidor: string; categoria: string }[];
    }>();

    for (const item of resultados) {
      const key = item.titulo_normalizado;
      if (!agrupado.has(key)) {
        agrupado.set(key, { item, rotas: [] });
      }
      agrupado.get(key)!.rotas.push({
        servidor:  item.servidor,
        categoria: item.categoria_origem,
      });
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
