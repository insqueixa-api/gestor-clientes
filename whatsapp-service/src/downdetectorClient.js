// whatsapp-service/src/downdetectorClient.js
//
// Downdetector bloqueia acesso direto (403, proteção anti-bot) — mesmo
// problema do Duplecast (ver duplecastClient.js), mesma solução: o
// FlareSolverr (container local, docker-compose.yml) resolve o desafio numa
// única chamada.
//
// A página é um Next.js com estado interno minificado (muda a cada build
// deles) — em vez de tentar reconstruir o número a partir desse JSON,
// aproveita um aria-label pronto e estável que a própria página já expõe no
// gráfico de relatos: "Gráfico de relatos das últimas 24 horas com pico de
// N relatos, status: X" (X = "sem problemas" | "possíveis problemas" |
// "problemas detectados"). Achado e confirmado ao vivo em 02/09/2026 contra
// downdetector.com.br/fora-do-ar/cloudflare/.

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || "http://flaresolverr:8191/v1";

async function solveChallengeOnce(url, maxTimeout) {
  const res = await fetch(FLARESOLVERR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout }),
  });
  if (!res.ok) throw new Error(`FlareSolverr HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "ok") throw new Error(`FlareSolverr: ${json.message || "falha desconhecida ao resolver o Cloudflare"}`);
  return json.solution?.response || "";
}

// Mesmo padrão de retry do duplecastClient.js — o tempo pra resolver o
// desafio varia, ocasionalmente estoura o orçamento enxuto da 1ª tentativa.
async function solveChallenge(url) {
  try {
    return await solveChallengeOnce(url, 20000);
  } catch (firstErr) {
    console.error("[DOWNDETECTOR] 1ª tentativa de resolver o Cloudflare falhou, tentando de novo:", firstErr?.message);
    return await solveChallengeOnce(url, 25000);
  }
}

function parseStatus(html) {
  const m = html.match(/Gr[aá]fico de relatos das últimas 24 horas com pico de (\d+) relatos?,\s*status:\s*([^"\\]+)/i);
  if (!m) return null;
  return { peakReports24h: Number(m[1]), status: m[2].trim() };
}

export async function checkDowndetectorStatus(slug) {
  const url = `https://downdetector.com.br/fora-do-ar/${slug}/`;
  const html = await solveChallenge(url);
  const parsed = parseStatus(html);
  if (!parsed) throw new Error("Não encontrou o resumo de status na página (layout do Downdetector pode ter mudado).");
  return parsed;
}
