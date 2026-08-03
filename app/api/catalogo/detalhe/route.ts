// app/api/catalogo/detalhe/route.ts
// Retorna detalhe completo de um título + temporadas (se série) + todos os servidores
// GET ?id=UUID

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ ok: false, error: "id obrigatório" }, { status: 400 });
  }

  try {
    // 1. Dados do título
    const { data: titulo, error: tErr } = await supabaseAdmin
      .from("catalog_master")
      .select(`
        id, titulo_normalizado, titulo_exibicao, tipo,
        cover_url, poster_tmdb_url,
        ano, sinopse, avaliacao, generos,
        total_temporadas, total_episodios,
        tmdb_id, tmdb_confirmado
      `)
      .eq("id", id)
      .single();

    if (tErr || !titulo) throw new Error("Título não encontrado");

    // 2. Disponibilidade (todos os servidores e categorias)
    const { data: disponibilidade } = await supabaseAdmin
      .from("catalog_availability")
      .select("servidor, categoria_origem, adicionado_em")
      .eq("master_id", id)
      .order("servidor");

    // 3. Se for série: temporadas agrupadas
    let temporadas: { temporada: number; total_episodios: number; servidores: string[] }[] = [];

    if (titulo.tipo === "SERIE") {
      const { data: eps } = await supabaseAdmin
        .from("catalog_episodes")
        .select("temporada, episodio, servidor")
        .eq("master_id", id)
        .order("temporada")
        .order("episodio");

      if (eps && eps.length > 0) {
        // Agrupa por temporada
        const tempMap = new Map<number, { epCount: number; servidores: Set<string> }>();
        for (const ep of eps) {
          if (!tempMap.has(ep.temporada)) {
            tempMap.set(ep.temporada, { epCount: 0, servidores: new Set() });
          }
          const t = tempMap.get(ep.temporada)!;
          t.epCount++;
          t.servidores.add(ep.servidor);
        }
        temporadas = [...tempMap.entries()]
          .sort(([a], [b]) => a - b)
          .map(([temporada, { epCount, servidores }]) => ({
            temporada,
            total_episodios: epCount,
            servidores: [...servidores],
          }));
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        ...titulo,
        disponibilidade: disponibilidade || [],
        temporadas,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
