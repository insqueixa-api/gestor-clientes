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
// e do Elite ("SERIES A" → já vai filtrado ou com label genérico)
function limparLabel(cat: string, servidor: string): string {
  let label = cat;
  // NaTV: remove prefixo "FILMES: " ou "SÉRIES: "
  label = label.replace(/^FILMES:\s*/i, "").replace(/^SÉRIES?:\s*/i, "");
  // Capitaliza primeira letra de cada palavra
  label = label
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    // corrige siglas conhecidas
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

// Filtra categorias espúrias (SERIES A, B, C... com poucos títulos no Elite)
function isCategoriaPrincipal(cat: string, total: number): boolean {
  // Elite usa "SERIES X" como categorias de séries por letra — filtra as com < 5 títulos
  if (/^SERIES [A-Z0-9]$/i.test(cat) && total < 10) return false;
  if (/^SERIES 0 a 9$/i.test(cat) && total < 10) return false;
  return true;
}

// Emoji por categoria
function emojiCategoria(cat: string): string {
  const c = cat.toUpperCase();
  if (c.includes("NETFLIX"))          return "🔴";
  if (c.includes("HBO"))              return "🟣";
  if (c.includes("DISNEY"))           return "🔵";
  if (c.includes("AMAZON") || c.includes("PRIME")) return "🟡";
  if (c.includes("APPLE"))            return "⚪";
  if (c.includes("GLOBO"))            return "🌐";
  if (c.includes("PARAMOUNT"))        return "⭐";
  if (c.includes("ANIME") || c.includes("CRUNCHYROLL")) return "🎌";
  if (c.includes("DORAMA"))           return "🎎";
  if (c.includes("NOVELA"))           return "💃";
  if (c.includes("KIDS") || c.includes("INFANTIL")) return "🧒";
  if (c.includes("DOCUMENT"))         return "🎥";
  if (c.includes("ACAO") || c.includes("AÇÃO") || c.includes("ACTION")) return "💥";
  if (c.includes("COMEDIA") || c.includes("COMÉDIA")) return "😂";
  if (c.includes("DRAMA"))            return "🎭";
  if (c.includes("TERROR"))           return "👻";
  if (c.includes("ROMANCE"))          return "❤️";
  if (c.includes("SUSPENSE"))         return "🔍";
  if (c.includes("FICCAO") || c.includes("FICÇÃO")) return "🚀";
  if (c.includes("MARVEL") || c.includes("DC"))     return "🦸";
  if (c.includes("LANCAMENTO") || c.includes("LANÇAMENTO")) return "🆕";
  if (c.includes("NACIONAL"))         return "🇧🇷";
  if (c.includes("4K"))               return "4️⃣";
  if (c.includes("LEGENDA"))          return "📝";
  if (c.includes("NATALINO"))         return "🎄";
  if (c.includes("GUERRA"))           return "⚔️";
  if (c.includes("WESTERN") || c.includes("FAROESTE")) return "🤠";
  if (c.includes("FAMILIA") || c.includes("FAMÍLIA")) return "👨‍👩‍👧";
  if (c.includes("ANIMACAO") || c.includes("ANIMAÇÃO")) return "🎨";
  if (c.includes("MUSIC") || c.includes("MÚSICA")) return "🎵";
  if (c.includes("CRIME"))            return "🔫";
  if (c.includes("HISTORY") || c.includes("HISTÓRIA")) return "📜";
  if (c.includes("CLASSICO") || c.includes("CLÁSSICO")) return "🎞️";
  if (c.includes("REALITY"))          return "📸";
  if (c.includes("LEGENDA"))          return "📝";
  return "🎬";
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
        label:  limparLabel(c.categoria_origem, servidor),
        emoji:  emojiCategoria(c.categoria_origem),
        total:  c.total_titulos,
      }));

    return NextResponse.json({ ok: true, data: categorias });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
