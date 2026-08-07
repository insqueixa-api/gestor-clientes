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

// ✅ Relevância (25/07/2026) — antes a ordenação só olhava poster+nota, então
// um resultado "meio a ver" com poster bonito passava na frente de um match
// bem mais próximo. Isso pesava principalmente contra animes com título
// gigante e descritivo (ex: "RICH GIRL CARETAKER: I'M SECRETLY THE
// CAREGIVER OF..."): uma busca curta que bate numa palavra solta lá dentro
// aparecia como se fosse "lixo" sem relação nenhuma com a busca. Agora o
// título mais PARECIDO com o termo digitado vem primeiro, sempre.
// ✅ Match "certeiro" (02/08/2026) — titulo_alt_busca junta pt-BR + título
// original numa string só (ex: "com as proprias maos 2 o troco walking tall
// the payback"). Uma busca genérica de uma palavra ("walking") batia nesse
// campo com a mesma nota fixa de um match muito mais específico, então um
// filme sem nenhuma relação aparecia lado a lado com o resultado certo. No
// título principal (secundario=false) mantém a nota fixa — não mexe no caso
// dos animes de título gigante, que essa mesma função já corrigiu antes.
function relevancia(tituloNorm: string, termoNorm: string, secundario = false): number {
  if (!tituloNorm || !termoNorm) return 0;
  if (tituloNorm === termoNorm) return 100;
  if (tituloNorm.startsWith(termoNorm)) return 80;
  if (tituloNorm.includes(termoNorm)) {
    if (!secundario) return 60;
    // Campo alternativo: proporcional a quanto do texto o termo representa,
    // pra uma palavra solta perdida numa string longa não empatar com um
    // match que é praticamente o campo inteiro.
    return Math.round(60 * (termoNorm.length / tituloNorm.length));
  }
  // Todas as palavras batem, mas espalhadas pelo título — quanto mais curto
  // o título em relação ao termo buscado, mais provável que seja o match
  // certo (e não uma palavra solta perdida num título gigante).
  return Math.round(40 * (termoNorm.length / tituloNorm.length));
}

// Palavras que sozinhas não servem como filtro no banco
const STOP_WORDS = new Set(["a","o","e","i","u","as","os","de","do","da","dos","das","em","na","no","nas","nos","the","and","of","to","in","is","it","for"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q        = (searchParams.get("q") || "").trim();
  const servidor = searchParams.get("servidor") || "TODOS";
  const tipo     = searchParams.get("tipo")     || "TODOS";

  // ✅ Mínimo de 3 caracteres — abaixo disso o índice GIN trigram
  // (idx_catalog_master_titulo_busca) não tem nenhum trigrama completo pra
  // usar e cai pra scan sequencial nas 34 mil linhas do catálogo, então 1-2
  // letras ficava lento OU retornava vazio sem avisar por quê (a tela
  // mostrava "Nenhum resultado encontrado" igual a uma busca que realmente
  // não achou nada — parecia que a busca "não funcionava").
  if (q.length < 3)
    return NextResponse.json({ ok: true, data: [], tooShort: true });

  const termoNorm = normalizar(q);
  const todasPalavras = termoNorm.split(" ").filter(Boolean);
  
  // Palavras significativas para filtrar no banco (sem stop words, mínimo 2 chars)
  const palavrasFiltro = todasPalavras.filter(p => p.length >= 2 && !STOP_WORDS.has(p));
  // Se todas forem stop words, usa as originais
  const palavras = palavrasFiltro.length > 0 ? palavrasFiltro : todasPalavras.filter(p => p.length >= 2);

  if (palavras.length === 0) return NextResponse.json({ ok: true, data: [] });

  try {
    // Busca IDs em catalog_master usando titulo_busca (unaccent + lower, sem
    // acentos) OU titulo_alt_busca (título no outro idioma — pt-BR/original,
    // preenchido pelo enriquecimento TMDB) — cada palavra precisa aparecer em
    // pelo menos uma das duas colunas, pra achar tanto quem catalogou em
    // português quanto quem catalogou em inglês.
    let masterQuery = supabaseAdmin
      .from("catalog_master")
      .select("id, titulo_normalizado, titulo_exibicao, titulo_alt_busca, tipo, cover_url, poster_tmdb_url, ano, sinopse, avaliacao, generos, total_temporadas, total_episodios, tmdb_confirmado")
      .limit(500);

    if (tipo !== "TODOS") masterQuery = masterQuery.eq("tipo", tipo);

    for (const palavra of palavras.slice(0, 4)) {
      masterQuery = masterQuery.or(`titulo_busca.ilike.%${palavra}%,titulo_alt_busca.ilike.%${palavra}%`);
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

    // Filtra no JS com normalização completa — bate se TODAS as palavras da
    // busca aparecem no título catalogado OU no título alternativo (outro
    // idioma), não precisa ser a mesma coluna pra cada palavra.
    const resultados = masterData.filter((item: any) => {
      if (servidor !== "TODOS" && !rotasPorId.has(item.id)) return false;
      const tituloNorm = normalizar(item.titulo_normalizado);
      const altNorm = normalizar(item.titulo_alt_busca || "");
      return todasPalavras.every((p) => tituloNorm.includes(p) || altNorm.includes(p));
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

    // Ordena por relevância (o quão perto o título/título alternativo está
    // do termo buscado) primeiro, depois poster TMDB, depois avaliação.
    const lista = [...agrupado.values()]
      .sort((a, b) => {
        const relA = Math.max(
          relevancia(normalizar(a.item.titulo_normalizado), termoNorm),
          relevancia(normalizar(a.item.titulo_alt_busca || ""), termoNorm, true),
        );
        const relB = Math.max(
          relevancia(normalizar(b.item.titulo_normalizado), termoNorm),
          relevancia(normalizar(b.item.titulo_alt_busca || ""), termoNorm, true),
        );
        if (relB !== relA) return relB - relA;
        // Empate de relevância — prioriza quem tem poster_tmdb_url
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
        // Texto cru do m3u (acentos, cedilha, etc.) — usar para exibir ao
        // cliente. titulo_normalizado continua existindo só para quem ainda
        // depende dele; linhas que nunca passaram por um sync novo caem no
        // fallback (titulo_normalizado) até o próximo sync preencher.
        titulo_exibicao:  item.titulo_exibicao || item.titulo_normalizado,
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
