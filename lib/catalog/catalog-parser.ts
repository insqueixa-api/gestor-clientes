// lib/catalog/catalog-parser.ts
// Parser compartilhado para M3U dos 3 servidores (ELITE, NATV, FAST)
// Determina tipo pela URL: /movie/ → FILME | /series/ → SERIE | nenhum → CANAL

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type TipoConteudo = "CANAL" | "FILME" | "SERIE";
export type Servidor     = "ELITE" | "NATV" | "FAST";

export type EntradaCatalogo = {
  titulo_normalizado: string;
  titulo_original:    string;   // tvg-name original, para debug
  tipo:               TipoConteudo;
  cover_url:          string;
  ano:                number | null;
  categoria_origem:   string;   // group-title exato do M3U
  // Só para SERIE:
  temporada?:         number;
  episodio?:          number;
};

// ─── Qualidade: peso para desduplicar canais ──────────────────────────────────
// Mantemos só a entrada de maior qualidade por título normalizado de canal

function qualidadePeso(nome: string): number {
  const u = nome.toUpperCase();
  if (u.includes("4K"))    return 5;
  if (u.includes("FHD"))   return 4;
  if (u.includes("H265") || u.includes("H.265")) return 3;
  if (u.includes(" HD"))   return 2;
  return 1; // SD ou sem marcação
}

// ─── Normalização de nome de canal ────────────────────────────────────────────
// Remove marcadores de qualidade, asteriscos, sufixos de região duplicados

function normalizarCanal(nome: string): string {
  return nome
    .toUpperCase()
    // Remove qualidade
    .replace(/\s*\[?(4K|FHD|FHD\*|FHDR|H265|H\.265|HD|SD)\]?\s*/gi, " ")
    // Remove asterisco de backup
    .replace(/\s*\*+\s*$/g, "")
    // Remove sufixos BR, BR, H265²
    .replace(/\s+(BR|H265²|HD²|²|³)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Normalização de nome de filme ────────────────────────────────────────────
// Remove " LEG", " DUB", "(AAAA)" mantendo título limpo

function normalizarFilme(nome: string): { titulo: string; ano: number | null } {
  // Extrai ano: "(2026)" ou "[2026]"
  const anoMatch = nome.match(/[\[(](\d{4})[\])]/);
  const ano      = anoMatch ? parseInt(anoMatch[1]) : null;

  const titulo = nome
    .toUpperCase()
    .replace(/[\[(]\d{4}[\])]/g, "")       // remove ano
    .replace(/\s+LEG\b/g, "")              // remove LEG
    .replace(/\s+DUB\b/g, "")             // remove DUB
    .replace(/\s+DUBLADO\b/g, "")
    .replace(/\s+LEGENDADO\b/g, "")
    .replace(/\s+\d{4}\b/g, "")           // remove ano solto
    .replace(/\s+/g, " ")
    .trim();

  return { titulo, ano };
}

// ─── Normalização de nome de série ────────────────────────────────────────────
// Extrai: título, ano, temporada, episódio
// Formato: "Vikings [2013] S01 E01" ou "A História de Ester [2010] S01 E01"

function normalizarSerie(nome: string): {
  titulo:    string;
  ano:       number | null;
  temporada: number | null;
  episodio:  number | null;
} {
  // Extrai S/E
  const seMatch = nome.match(/S(\d+)\s*E(\d+)/i);
  const temporada = seMatch ? parseInt(seMatch[1]) : null;
  const episodio  = seMatch ? parseInt(seMatch[2]) : null;

  // Extrai ano
  const anoMatch = nome.match(/[\[(](\d{4})[\])]/);
  const ano      = anoMatch ? parseInt(anoMatch[1]) : null;

  // Título = tudo antes do ano ou do S/E, o que vier primeiro
  let titulo = nome
    .replace(/[\[(]\d{4}[\])]\s*/g, "")    // remove [ano]
    .replace(/\s*S\d+\s*E\d+.*/i, "")      // remove S01 E01 em diante
    .replace(/\s+LEG\b/gi, "")
    .replace(/\s+DUB\b/gi, "")
    .toUpperCase()
    .trim();

  return { titulo, ano, temporada, episodio };
}

// ─── Grupos que são conteúdo adulto — filtrar ─────────────────────────────────
const GRUPOS_ADULTO = new Set([
  "XXX ADULTOS [18+]",
  "XXX ADULTOS [18]",
  "XXX",
  "ADULTOS",
  "ADULT",
  "PLAYBOY",
]);

function isAdulto(grupo: string): boolean {
  const g = grupo.toUpperCase();
  if (GRUPOS_ADULTO.has(g)) return true;
  if (g.includes("XXX") || g.includes("ADULT") || g.includes("18+")) return true;
  return false;
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseM3U(conteudo: string): EntradaCatalogo[] {
  const linhas = conteudo.split(/\r?\n/);
  const resultado: EntradaCatalogo[] = [];

  // Para canais: deduplicar por título normalizado, mantendo maior qualidade
  const canalVisto = new Map<string, { peso: number; idx: number }>();

  let extinf = "";

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();

    if (linha.startsWith("#EXTINF")) {
      extinf = linha;
      continue;
    }

    if (!linha.startsWith("http") || !extinf) continue;

    const url = linha;
    extinf     = extinf;

    // Extrair metadados do EXTINF
    const tvgNome  = extinf.match(/tvg-name="([^"]*)"/)?.[1]?.trim()  || "";
    const tvgLogo  = extinf.match(/tvg-logo="([^"]*)"/)?.[1]?.trim()  || "";
    const grupo    = extinf.match(/group-title="([^"]*)"/)?.[1]?.trim() || "";

    extinf = ""; // reset

    if (!tvgNome) continue;

    // Filtrar adulto
    if (isAdulto(grupo)) continue;

    // Determinar tipo pela URL
    let tipo: TipoConteudo;
    if (url.includes("/movie/"))  tipo = "FILME";
    else if (url.includes("/series/")) tipo = "SERIE";
    else tipo = "CANAL";

    // Processar conforme tipo
    if (tipo === "CANAL") {
      const tituloNorm = normalizarCanal(tvgNome);
      if (!tituloNorm) continue;

      const peso = qualidadePeso(tvgNome);
      const existente = canalVisto.get(tituloNorm);

      if (existente) {
        // Só substitui se a nova qualidade for maior
        if (peso > existente.peso) {
          resultado[existente.idx] = {
            titulo_normalizado: tituloNorm,
            titulo_original:    tvgNome,
            tipo:               "CANAL",
            cover_url:          tvgLogo,
            ano:                null,
            categoria_origem:   grupo,
          };
          canalVisto.set(tituloNorm, { peso, idx: existente.idx });
        }
        // Se qualidade igual ou menor, ignora
      } else {
        const idx = resultado.length;
        resultado.push({
          titulo_normalizado: tituloNorm,
          titulo_original:    tvgNome,
          tipo:               "CANAL",
          cover_url:          tvgLogo,
          ano:                null,
          categoria_origem:   grupo,
        });
        canalVisto.set(tituloNorm, { peso, idx });
      }

    } else if (tipo === "FILME") {
      const { titulo, ano } = normalizarFilme(tvgNome);
      if (!titulo) continue;

      resultado.push({
        titulo_normalizado: titulo,
        titulo_original:    tvgNome,
        tipo:               "FILME",
        cover_url:          tvgLogo,
        ano,
        categoria_origem:   grupo,
      });

    } else {
      // SERIE
      const { titulo, ano, temporada, episodio } = normalizarSerie(tvgNome);
      if (!titulo || temporada === null || episodio === null) continue;

      resultado.push({
        titulo_normalizado: titulo,
        titulo_original:    tvgNome,
        tipo:               "SERIE",
        cover_url:          tvgLogo,
        ano,
        categoria_origem:   grupo,
        temporada,
        episodio,
      });
    }
  }

  return resultado;
}

// ─── Constrói a URL do M3U a partir das credenciais do cliente ─────────────────
// O tipo de URL varia por servidor:
//   ELITE: http://chinaz.asia:80/get.php?username=X&password=Y&type=m3u_plus&output=ts
//   NATV:  http://rj98.eu/get.php?username=X&password=Y&type=m3u_plus&output=ts
//   FAST:  http://psbox.top/get.php?username=X&password=Y&type=m3u_plus&output=ts

export function buildM3UUrl(
  dns: string[],
  username: string,
  password: string,
): string {
  const base = dns[0].replace(/\/$/, "");
  return `${base}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`;
}

// ─── Stats do parse para o log ────────────────────────────────────────────────
export function statsDoparse(entradas: EntradaCatalogo[]) {
  let canais = 0, filmes = 0, series = 0;
  const seriesUnicas = new Set<string>();
  for (const e of entradas) {
    if (e.tipo === "CANAL")  canais++;
    else if (e.tipo === "FILME") filmes++;
    else { series++; seriesUnicas.add(e.titulo_normalizado); }
  }
  return { canais, filmes, episodios: series, series_unicas: seriesUnicas.size };
}
