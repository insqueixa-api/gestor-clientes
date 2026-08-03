// Rechecagem do TMDB: para títulos que já têm tmdb_id confirmado mas ainda
// não têm titulo_alt_busca (o backlog anterior à feature bilíngue), busca os
// detalhes reais no TMDB (title/original_title ou name/original_name) e
// grava — em vez de depender de tradução manual/IA. Uso:
//   DATABASE_URL="..." TMDB_API_KEY="..." node tmdb_recheck.mjs [limite]
import pg from "pg";

const LIMITE = parseInt(process.argv[2] || "300", 10);
const TMDB_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE = "https://api.themoviedb.org/3";
const CONCORRENCIA = 5;
const SLEEP_MS = 100;

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

async function buscarDetalhes(tmdbId, tipo) {
  const endpoint = tipo === "FILME" ? `movie/${tmdbId}` : `tv/${tmdbId}`;
  const params = new URLSearchParams({ api_key: TMDB_KEY, language: "pt-BR" });
  const res = await fetch(`${TMDB_BASE}/${endpoint}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`tmdb status ${res.status}`);
  return { data: await res.json() };
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: CONCORRENCIA });

const { rows: titulos } = await pool.query(
  `select id, tmdb_id, tipo from catalog_master
   where tmdb_confirmado = true and titulo_alt_busca is null and tmdb_id is not null
   order by titulo_normalizado asc
   limit $1`,
  [LIMITE]
);

let atualizados = 0, sem_alternativa = 0, nao_encontrados = 0, erros = 0;

for (let i = 0; i < titulos.length; i += CONCORRENCIA) {
  const grupo = titulos.slice(i, i + CONCORRENCIA);
  await Promise.all(grupo.map(async (t) => {
    try {
      await sleep(SLEEP_MS);
      const { notFound, data } = await buscarDetalhes(t.tmdb_id, t.tipo);

      if (notFound) {
        nao_encontrados++;
        return;
      }

      const nomeLocalizado = t.tipo === "FILME" ? data.title : data.name;
      const tituloOriginal = t.tipo === "FILME" ? data.original_title : data.original_name;
      const altCandidatos = [...new Set([nomeLocalizado, tituloOriginal].filter(Boolean))];
      const alt = altCandidatos.length ? normalizarTituloBusca(altCandidatos.join(" ")) : "";

      if (!alt) sem_alternativa++;

      await pool.query(
        `update catalog_master set titulo_alt_busca = $1 where id = $2`,
        [alt, t.id]
      );
      atualizados++;
    } catch (e) {
      erros++;
    }
  }));
}

console.log(JSON.stringify({ processados: titulos.length, atualizados, sem_alternativa, nao_encontrados, erros }, null, 2));
await pool.end();
