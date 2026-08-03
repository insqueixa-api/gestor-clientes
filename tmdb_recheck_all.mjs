// Roda tmdb_recheck em lotes contínuos até não sobrar nenhum pendente.
// Uso: DATABASE_URL="..." TMDB_API_KEY="..." node tmdb_recheck_all.mjs
import pg from "pg";

const TMDB_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE = "https://api.themoviedb.org/3";
const CONCORRENCIA = 8;
const SLEEP_MS = 60;
const LOTE = 500;

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

let totalAtualizados = 0, totalSemAlt = 0, totalNaoEncontrados = 0, totalErros = 0, rodada = 0;
let progressoAnterior = -1, rodadasSemProgresso = 0;
const inicio = Date.now();

while (true) {
  // IMPORTANTE: só titulo_alt_busca IS NULL — nunca reincluir '' aqui.
  // '' é um resultado terminal válido (ex: título original em escrita não-
  // latina, que normalizarTituloBusca reduz a vazio de propósito). Se '' voltasse
  // a entrar neste filtro, uma linha que já processamos corretamente como
  // vazia seria selecionada de novo na rodada seguinte — loop infinito
  // (bug real que já aconteceu aqui: ver histórico).
  const { rows: titulos } = await pool.query(
    `select id, tmdb_id, tipo from catalog_master
     where tmdb_confirmado = true and tmdb_id is not null
       and titulo_alt_busca is null
     order by titulo_normalizado asc
     limit $1`,
    [LOTE]
  );

  if (titulos.length === 0) break;
  rodada++;

  for (let i = 0; i < titulos.length; i += CONCORRENCIA) {
    const grupo = titulos.slice(i, i + CONCORRENCIA);
    await Promise.all(grupo.map(async (t) => {
      try {
        await sleep(SLEEP_MS);
        const { notFound, data } = await buscarDetalhes(t.tmdb_id, t.tipo);

        if (notFound) {
          // tmdb_id inválido/apagado no TMDB — reseta pra cair no fluxo de
          // re-busca (tmdb_research_notfound.mjs / cron diário) em vez de
          // ficar preso pra sempre neste filtro (bug corrigido: antes não
          // gravava nada aqui, causando loop infinito no mesmo lote).
          await pool.query(
            `update catalog_master set tmdb_id = null, tmdb_confirmado = false, tmdb_buscado_em = now() where id = $1`,
            [t.id]
          );
          totalNaoEncontrados++;
          return;
        }

        const nomeLocalizado = t.tipo === "FILME" ? data.title : data.name;
        const tituloOriginal = t.tipo === "FILME" ? data.original_title : data.original_name;
        const altCandidatos = [...new Set([nomeLocalizado, tituloOriginal].filter(Boolean))];
        const alt = altCandidatos.length ? normalizarTituloBusca(altCandidatos.join(" ")) : "";

        if (!alt) totalSemAlt++;

        await pool.query(`update catalog_master set titulo_alt_busca = $1 where id = $2`, [alt, t.id]);
        totalAtualizados++;
      } catch {
        totalErros++;
      }
    }));
  }

  const elapsedMin = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log(`[rodada ${rodada}] atualizados=${totalAtualizados} sem_alt=${totalSemAlt} nao_encontrados=${totalNaoEncontrados} erros=${totalErros} (${elapsedMin} min)`);

  // Trava de segurança: se uma rodada inteira não gravar nada no banco
  // (nem sucesso, nem reset de 404), para em vez de girar pra sempre.
  const progresso = totalAtualizados + totalNaoEncontrados;
  if (progresso === progressoAnterior) {
    rodadasSemProgresso++;
    if (rodadasSemProgresso >= 2) {
      console.log(`PARADO: 2 rodadas seguidas sem progresso (possível problema persistente). erros=${totalErros}`);
      break;
    }
  } else {
    rodadasSemProgresso = 0;
  }
  progressoAnterior = progresso;
}

console.log(`CONCLUIDO: atualizados=${totalAtualizados} sem_alt=${totalSemAlt} nao_encontrados=${totalNaoEncontrados} erros=${totalErros}`);
await pool.end();
