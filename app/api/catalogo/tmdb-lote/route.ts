// app/api/catalogo/tmdb-lote/route.ts
// Retorna um lote de títulos para revisão manual de TMDB
// GET ?tipo=FILME|SERIE&lote=10&sem_tmdb=true

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tipo     = searchParams.get("tipo")     || "FILME";
  const lote     = Math.min(30, Math.max(5, parseInt(searchParams.get("lote") || "10")));
  const semTmdb  = searchParams.get("sem_tmdb") === "true";

  try {
    let query = supabaseAdmin
      .from("catalog_master")
      .select("id, titulo_normalizado, tipo, tmdb_id, tmdb_confirmado, poster_tmdb_url, cover_url, ano")
      .eq("tipo", tipo)
      .order("atualizado_em", { ascending: false })
      .limit(lote);

    if (semTmdb) {
      query = query.eq("tmdb_confirmado", false);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, data: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
