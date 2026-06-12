// app/api/catalogo/categorias/route.ts
// Retorna categorias disponíveis para um servidor+tipo
// GET ?servidor=ELITE|NATV|FAST&tipo=FILME|SERIE

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Limpa labels feias do NaTV ("FILMES: DRAMA" → "Drama")
function limparLabel(cat: string): string {
  let label = cat;
  label = label.replace(/^FILMES:\s*/i, "").replace(/^SÉRIES?:\s*/i, "");
  label = label
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bHbo\b/g, "HBO")
    .replace(/\bHbo Max\b/g, "HBO Max")
    .replace(/\bTv\b/g, "TV")
    .replace(/\bAmazon Prime Video\b/g, "Amazon Prime")
    .replace(/\bApple Tv\b/g, "Apple TV")
    .replace(/\b4k\b/g, "4K")
    .replace(/\bSbt\b/g, "SBT")
    .replace(/\bAmC\b/g, "AMC")
    .replace(/\bDc\b/g, "DC");
  return label;
}

// Filtra categorias espúrias
function isCategoriaPrincipal(cat: string, total: number): boolean {
  if (/^SERIES [A-Z0-9]$/i.test(cat) && total < 10) return false;
  if (/^SERIES 0 a 9$/i.test(cat) && total < 10) return false;
  return true;
}

// Ícone neutro por categoria — sem emojis de marca
function iconeCategoria(cat: string): string {
  const c = cat.toUpperCase();
  if (c.includes("ANIME") || c.includes("CRUNCHYROLL")) return "anime";
  if (c.includes("DORAMA"))                              return "dorama";
  if (c.includes("NOVELA"))                              return "novela";
  if (c.includes("KIDS") || c.includes("INFANTIL"))     return "kids";
  if (c.includes("DOCUMENT"))                            return "doc";
  if (c.includes("ACAO") || c.includes("AÇÃO") || c.includes("ACTION")) return "action";
  if (c.includes("COMEDIA") || c.includes("COMÉDIA"))   return "comedy";
  if (c.includes("DRAMA"))                               return "drama";
  if (c.includes("TERROR"))                              return "horror";
  if (c.includes("ROMANCE"))                             return "romance";
  if (c.includes("SUSPENSE"))                            return "thriller";
  if (c.includes("FICCAO") || c.includes("FICÇÃO"))     return "scifi";
  if (c.includes("MARVEL") || c.includes("DC"))         return "superhero";
  if (c.includes("LANCAMENTO") || c.includes("LANÇAMENTO")) return "new";
  if (c.includes("NACIONAL"))                            return "national";
  if (c.includes("4K"))                                  return "4k";
  if (c.includes("GUERRA"))                              return "war";
  if (c.includes("WESTERN") || c.includes("FAROESTE"))  return "western";
  if (c.includes("FAMILIA") || c.includes("FAMÍLIA"))   return "family";
  if (c.includes("ANIMACAO") || c.includes("ANIMAÇÃO")) return "animation";
  if (c.includes("MUSIC") || c.includes("MÚSICA"))      return "music";
  if (c.includes("CRIME"))                               return "crime";
  if (c.includes("HISTORY") || c.includes("HISTÓRIA"))  return "history";
  if (c.includes("CLASSICO") || c.includes("CLÁSSICO")) return "classic";
  if (c.includes("REALITY"))                             return "reality";
  if (c.includes("AVENTURA"))                            return "adventure";
  if (c.includes("FANTASIA"))                            return "fantasy";
  if (c.includes("MISTERIO") || c.includes("MISTÉRIO")) return "mystery";
  if (c.includes("RELIGIOSO"))                           return "religious";
  if (c.includes("ESPORTE") || c.includes("SPORT"))     return "sport";
  if (c.includes("BIOGRA"))                              return "biography";
  return "general";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const servidor = searchParams.get("servidor") || "ELITE";
  const tipo     = searchParams.get("tipo")     || "FILME";

  try {
    const { data, error } = await supabaseAdmin
      .from("vw_catalog_categorias")
      .select("categoria_origem, total_titulos")
      .eq("servidor", servidor)
      .eq("tipo", tipo)
      .order("total_titulos", { ascending: false });

    if (error) throw error;

    const categorias = (data || [])
      .filter((c) => isCategoriaPrincipal(c.categoria_origem, c.total_titulos))
      .map((c) => ({
        categoria_origem: c.categoria_origem,
        label:  limparLabel(c.categoria_origem),
        emoji:  iconeCategoria(c.categoria_origem), // agora é um slug, não emoji
        total:  c.total_titulos,
      }));

    return NextResponse.json({ ok: true, data: categorias });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
