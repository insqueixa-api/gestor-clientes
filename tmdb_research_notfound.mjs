// Reprocessa títulos sem tmdb_id (já tentados antes e não encontrados),
// ignorando a trava de 30 dias do cron — mesma lógica de busca/score do
// app/api/epg/sync-tmdb/route.ts. Uso:
//   DATABASE_URL="..." TMDB_API_KEY="..." node tmdb_research_notfound.mjs
import pg from "pg";

const TMDB_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const CONCORRENCIA = 8;
const SLEEP_MS = 60;
const LOTE = 300;

if (!TMDB_KEY) throw new Error("TMDB_API_KEY não definida");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizarTituloBusca(titulo) {
  return titulo
    .replace(/&amp;/gi, " e ")
    .replace(/&/g, " e ")
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normComp(s) {
  return s.toLowerCase()
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ").trim();
}

function similaridade(a, b) {
  if (!a || !b) return 0;
  const wa = new Set(normComp(a).split(" ").filter(Boolean));
  const wb = new Set(normComp(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersecao = [...wa].filter(w => wb.has(w)).length;
  return intersecao / Math.max(wa.size, wb.size);
}

function melhorScore(busca, resultado, tipo) {
  const candidatos = [
    tipo === "FILME" ? resultado.title : resultado.name,
    tipo === "FILME" ? resultado.original_title : resultado.original_name,
  ].filter(Boolean);
  return Math.max(...candidatos.map((c) => similaridade(busca, c)));
}

async function buscarTMDB(titulo, tipo, ano) {
  const endpoint = tipo === "FILME" ? "search/movie" : "search/tv";
  const tentativas = ano
    ? [{ api_key: TMDB_KEY, query: titulo, language: "pt-BR", include_adult: "false", year: String(ano) },
       { api_key: TMDB_KEY, query: titulo, language: "pt-BR", include_adult: "false" }]
    : [{ api_key: TMDB_KEY, query: titulo, language: "pt-BR", include_adult: "false" }];

  for (const p of tentativas) {
    const res = await fetch(`${TMDB_BASE}/${endpoint}?${new URLSearchParams(p)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) continue;
    const data = await res.json();
    const resultados = data.results || [];
    let melhor = null, melhorScoreVal = 0;
    for (const r of resultados.slice(0, 5)) {
      const score = melhorScore(titulo, r, tipo);
      if (score > melhorScoreVal) { melhorScoreVal = score; melhor = r; }
    }
    if (melhor && melhorScoreVal >= 0.5) return { resultado: melhor, score: melhorScoreVal };
  }
  return null;
}

async function buscarDetalhes(tmdbId, tipo) {
  const endpoint = tipo === "FILME" ? `movie/${tmdbId}` : `tv/${tmdbId}`;
  const params = new URLSearchParams({ api_key: TMDB_KEY, language: "pt-BR" });
  const res = await fetch(`${TMDB_BASE}/${endpoint}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return await res.json();
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: CONCORRENCIA });

let totalEncontrados = 0, totalNaoEncontrados = 0, totalErros = 0, rodada = 0;
const inicio = Date.now();

while (true) {
  // tmdb_buscado_em vai sendo atualizado a cada tentativa desta rodada, então
  // sempre pega os que ainda não foram tocados nesta execução.
  const { rows: titulos } = await pool.query(
    `select id, titulo_normalizado as titulo, tipo, ano from catalog_master
     where tmdb_id is null and (tmdb_buscado_em is null or tmdb_buscado_em < $1)
     order by titulo_normalizado asc
     limit $2`,
    [new Date(inicio).toISOString(), LOTE]
  );

  if (titulos.length === 0) break;
  rodada++;

  for (let i = 0; i < titulos.length; i += CONCORRENCIA) {
    const grupo = titulos.slice(i, i + CONCORRENCIA);
    await Promise.all(grupo.map(async (t) => {
      const agora = new Date().toISOString();
      try {
        await sleep(SLEEP_MS);
        const tmdbRes = await buscarTMDB(t.titulo, t.tipo, t.ano);

        if (!tmdbRes) {
          await pool.query(`update catalog_master set tmdb_buscado_em = $1 where id = $2`, [agora, t.id]);
          totalNaoEncontrados++;
          return;
        }

        const { resultado, score } = tmdbRes;
        const detalhes = await buscarDetalhes(resultado.id, t.tipo);

        const nomeResultado = t.tipo === "FILME" ? resultado.title : resultado.name;
        const generosList = (detalhes?.genres || []).map((g) => g.name);
        const poster = resultado.poster_path ? `${TMDB_IMG}${resultado.poster_path}` : null;
        const sinopse = detalhes?.overview || resultado.overview || null;
        const avaliacao = resultado.vote_average ? parseFloat(resultado.vote_average.toFixed(1)) : null;
        const confirmado = score >= 0.8;

        const tituloOriginal = t.tipo === "FILME" ? resultado.original_title : resultado.original_name;
        const altCandidatos = [...new Set([nomeResultado, tituloOriginal].filter(Boolean))];
        const titulo_alt_busca = altCandidatos.length ? normalizarTituloBusca(altCandidatos.join(" ")) : null;

        await pool.query(
          `update catalog_master set
             tmdb_id = $1, sinopse = $2, avaliacao = $3, generos = $4,
             poster_tmdb_url = $5, tmdb_confirmado = $6, tmdb_buscado_em = $7,
             titulo_alt_busca = $8
           where id = $9`,
          [resultado.id, sinopse || null, avaliacao, generosList.length ? generosList : null,
           poster, confirmado, agora, titulo_alt_busca, t.id]
        );
        totalEncontrados++;
      } catch {
        await pool.query(`update catalog_master set tmdb_buscado_em = $1 where id = $2`, [agora, t.id]).catch(() => {});
        totalErros++;
      }
    }));
  }

  const elapsedMin = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log(`[rodada ${rodada}] encontrados=${totalEncontrados} nao_encontrados=${totalNaoEncontrados} erros=${totalErros} (${elapsedMin} min)`);
}

console.log(`CONCLUIDO: encontrados=${totalEncontrados} nao_encontrados=${totalNaoEncontrados} erros=${totalErros}`);
await pool.end();
