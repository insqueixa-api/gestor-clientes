// app/api/catalogo/busca/route.ts
// Busca inteligente: ignora acentos, maiúsculas, pontuação
// GET ?q=the+walking+dead&servidor=TODOS&tipo=TODOS

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Normaliza string para comparação: remove acentos, pontuação, lowercase
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, " ")   // remove pontuação
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q        = (searchParams.get("q") || "").trim();
  const servidor = searchParams.get("servidor") || "TODOS";
  const tipo     = searchParams.get("tipo")     || "TODOS";

  if (q.length < 2) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const termoNorm = normalizar(q);
  const palavras  = termoNorm.split(" ").filter(Boolean);

  try {
    // Busca no banco usando ilike (case-insensitive)
    // Para acentos: usamos unaccent via ilike com o termo normalizado
    // Supabase/Postgres: a extensão unaccent precisa estar instalada
    // Fallback: buscamos por cada palavra separada e filtramos no JS
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
      .limit(200); // pega bastante para filtrar no JS

    // Filtra por tipo se especificado
    if (tipo !== "TODOS") {
      query = query.eq("tipo", tipo);
    }

    // Filtra por servidor se especificado
    if (servidor !== "TODOS") {
      query = query.eq("servidor", servidor);
    }

    // Busca pela primeira palavra (PostgreSQL ilike é case-insensitive mas não ignora acentos)
    // Usamos contains com a primeira palavra para reduzir o resultado
    if (palavras.length > 0) {
      query = query.ilike("titulo_normalizado", `%${palavras[0]}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Filtra no JS com normalização completa (acentos + pontuação)
    const resultados = (data || []).filter((item) => {
      const tituloNorm = normalizar(item.titulo_normalizado);
      return palavras.every((p) => tituloNorm.includes(p));
    });

    // Deduplica por titulo_normalizado (pode aparecer em múltiplos servidores)
    // Agrupa: id → lista de {servidor, categoria_origem}
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

    // Ordena: tmdb_confirmado primeiro, depois por avaliação desc
    const lista = [...agrupado.values()]
      .sort((a, b) => {
        if (a.item.tmdb_confirmado && !b.item.tmdb_confirmado) return -1;
        if (!a.item.tmdb_confirmado && b.item.tmdb_confirmado) return 1;
        return (b.item.avaliacao || 0) - (a.item.avaliacao || 0);
      })
      .slice(0, 50) // máx 50 resultados
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
        rotas,            // todos os servidores/categorias onde está disponível
      }));

    return NextResponse.json({ ok: true, data: lista, total: lista.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
