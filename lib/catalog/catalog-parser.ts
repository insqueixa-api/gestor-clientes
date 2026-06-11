// lib/catalog/catalog-parser.ts
// Parser compartilhado para M3U dos 3 servidores (ELITE, NATV, FAST)
//
// Diferenças por servidor que este parser cobre:
//   ELITE: "Vikings [2013] S01 E01"  | grupos: "SERIES A", "ACAO", "LANCAMENTOS"
//   FAST:  "Vikings (2013) [L] S01E02" | grupos: "Series | Netflix", "Filmes | Drama", "Canais | Variedades"
//   NATV:  a ser confirmado (estrutura similar ao FAST ou ELITE)
//
// Tipo determinado pela URL:
//   /movie/  → FILME
//   /series/ → SERIE
//   nenhum   → CANAL

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
function qualidadePeso(nome: string): number {
  const u = nome.toUpperCase();
  if (u.includes("4K"))                       return 5;
  if (u.includes("FHD"))                      return 4;
  if (u.includes("H265") || u.includes("H.265")) return 3;
  if (u.includes("[HD]") || u.includes(" HD")) return 2;
  return 1;
}

// ─── Normalização de nome de canal ────────────────────────────────────────────
// Remove marcadores de qualidade, asteriscos, sufixos de região
function normalizarCanal(nome: string): string {
  return nome
    .toUpperCase()
    .replace(/\s*\[?(4K|FHD|FHD\*|FHDR|H265|H\.265|HD|SD)\]?\s*/gi, " ")
    .replace(/\s*\*+\s*$/g, "")
    .replace(/\s+(BR|H265²|HD²|²|³)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Normalização de nome de filme ────────────────────────────────────────────
// Cobre ambos os formatos:
//   ELITE: "MORTAL KOMBAT 2 (2026)" / "SETE SNIPERS (2026) LEG"
//   FAST:  "Os Boxtrolls [L]" / "Turma 94: O Grande Encontro"
function normalizarFilme(nome: string): { titulo: string; ano: number | null } {
  // Extrai ano: "(2026)" ou "[2026]"
  const anoMatch = nome.match(/[\[(](\d{4})[\])]/);
  const ano      = anoMatch ? parseInt(anoMatch[1]) : null;

  const titulo = nome
    .toUpperCase()
    .replace(/[\[(]\d{4}[\])]/g, "")     // remove (ano) ou [ano]
    .replace(/\s*\[L\]\s*/gi, " ")       // remove [L] de legendado (Fast)
    .replace(/\s*\[DUB\]\s*/gi, " ")     // remove [DUB]
    .replace(/\s+LEG\b/gi, "")           // remove LEG (Elite)
    .replace(/\s+DUB\b/gi, "")
    .replace(/\s+DUBLADO\b/gi, "")
    .replace(/\s+LEGENDADO\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return { titulo, ano };
}

// ─── Normalização de nome de série ────────────────────────────────────────────
// Cobre ambos os formatos:
//   ELITE: "Vikings [2013] S01 E01"       → S e E separados com espaço
//   FAST:  "Em Busca do Amor (2026) [L] S01E02" → S e E juntos, pode ter [L]
function normalizarSerie(nome: string): {
  titulo:    string;
  ano:       number | null;
  temporada: number | null;
  episodio:  number | null;
} {
  // Extrai S/E — aceita "S01 E01" (Elite) e "S01E02" (Fast)
  const seMatch = nome.match(/S(\d+)\s*E(\d+)/i);
  const temporada = seMatch ? parseInt(seMatch[1]) : null;
  const episodio  = seMatch ? parseInt(seMatch[2]) : null;

  // Extrai ano: "[2013]" ou "(2026)"
  const anoMatch = nome.match(/[\[(](\d{4})[\])]/);
  const ano      = anoMatch ? parseInt(anoMatch[1]) : null;

  // Título = tudo antes do S/E, com limpeza de sufixos
  const titulo = nome
    .replace(/\s*S\d+\s*E\d+.*/i, "")    // remove S01E01 em diante
    .replace(/[\[(]\d{4}[\])]\s*/g, "")   // remove [ano] / (ano)
    .replace(/\s*\[L\]\s*/gi, " ")        // remove [L] de legendado (Fast)
    .replace(/\s*\[DUB\]\s*/gi, " ")
    .replace(/\s+LEG\b/gi, "")
    .replace(/\s+DUB\b/gi, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  return { titulo, ano, temporada, episodio };
}

// ─── Normalização do grupo/categoria ─────────────────────────────────────────
// Fast usa prefixo: "Series | Netflix" → "Netflix"
//                   "Filmes | Drama"   → "Drama"
//                   "Canais | Variedades" → "Variedades"
// Elite usa direto: "SERIES A", "ACAO", "GLOBOS | CAPITAIS"
function normalizarGrupo(grupo: string): string {
  // Se o grupo tem " | " é padrão Fast — pega só a parte depois do pipe
  if (grupo.includes(" | ")) {
    return grupo.split(" | ").slice(1).join(" | ").trim();
  }
  return grupo.trim();
}

// ─── Filtro de conteúdo adulto ────────────────────────────────────────────────
function isAdulto(grupo: string): boolean {
  const g = grupo.toUpperCase();
  // Fast: "Filmes | [XXX] Adultos", "Canais | Adultos", "Canais | Adultos [OnlyFans]"
  // Elite: "XXX ADULTOS [18+]", "XXX ADULTOS [18]"
  if (g.includes("XXX"))     return true;
  if (g.includes("ADULTO"))  return true;
  if (g.includes("ADULT"))   return true;
  if (g.includes("18+"))     return true;
  if (g.includes("ONLYFANS")) return true;
  if (g.includes("PLAYBOY")) return true;
  if (g.includes("PRIVACY")) return true;
  return false;
}

// ─── Filtro de grupos irrelevantes ────────────────────────────────────────────
// Rádios, shows isolados etc. que não fazem sentido no catálogo
function isIrrelevante(grupo: string): boolean {
  const g = grupo.toUpperCase();
  if (g.includes("RADIO"))   return true;
  if (g.includes("RÁDIO"))   return true;
  return false;
}

// ─── Parser principal ─────────────────────────────────────────────────────────
export function parseM3U(conteudo: string): EntradaCatalogo[] {
  const linhas   = conteudo.split(/\r?\n/);
  const resultado: EntradaCatalogo[] = [];

  let extinf = "";

  for (const linha of linhas) {
    const l = linha.trim();

    if (l.startsWith("#EXTINF")) {
      extinf = l;
      continue;
    }

    if (!l.startsWith("http") || !extinf) continue;

    const url = l;

    // Extrair metadados
    const tvgNome = extinf.match(/tvg-name="([^"]*)"/)?.[1]?.trim()   || "";
    const tvgLogo = extinf.match(/tvg-logo="([^"]*)"/)?.[1]?.trim()   || "";
    const grupo   = extinf.match(/group-title="([^"]*)"/)?.[1]?.trim() || "";

    extinf = ""; // reset para próxima entrada

    if (!tvgNome) continue;

    // Filtros
    if (isAdulto(grupo))     continue;
    if (isIrrelevante(grupo)) continue;

    // Tipo pela URL
    let tipo: TipoConteudo;
    if (url.includes("/movie/"))   tipo = "FILME";
    else if (url.includes("/series/")) tipo = "SERIE";
    else tipo = "CANAL";

    const categoriaOrigem = normalizarGrupo(grupo);

    // ── CANAL — ignorado no catálogo (só filmes e séries são catalogados) ──────
    if (tipo === "CANAL") {
      continue;

    // ── FILME ────────────────────────────────────────────────────────────────
    } else if (tipo === "FILME") {
      const { titulo, ano } = normalizarFilme(tvgNome);
      if (!titulo) continue;

      resultado.push({
        titulo_normalizado: titulo,
        titulo_original:    tvgNome,
        tipo:               "FILME",
        cover_url:          tvgLogo,
        ano,
        categoria_origem:   categoriaOrigem,
      });

    // ── SERIE ────────────────────────────────────────────────────────────────
    } else {
      const { titulo, ano, temporada, episodio } = normalizarSerie(tvgNome);
      if (!titulo || temporada === null || episodio === null) continue;

      resultado.push({
        titulo_normalizado: titulo,
        titulo_original:    tvgNome,
        tipo:               "SERIE",
        cover_url:          tvgLogo,
        ano,
        categoria_origem:   categoriaOrigem,
        temporada,
        episodio,
      });
    }
  }

  return resultado;
}

// ─── Constrói URL do M3U ──────────────────────────────────────────────────────
// Todos os servidores usam o mesmo padrão de URL, mas sem &output=ts
// (o output=ts causa problema em alguns servidores como o Fast no browser)
export function buildM3UUrl(dns: string[], username: string, password: string): string {
  const base = dns[0].replace(/\/$/, "");
  return `${base}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus`;
}

// ─── Stats do parse para o log ────────────────────────────────────────────────
export function statsDoparse(entradas: EntradaCatalogo[]) {
  let canais = 0, filmes = 0, episodios = 0;
  const seriesUnicas = new Set<string>();
  for (const e of entradas) {
    if (e.tipo === "CANAL")       canais++;
    else if (e.tipo === "FILME")  filmes++;
    else { episodios++; seriesUnicas.add(e.titulo_normalizado); }
  }
  return { canais, filmes, episodios, series_unicas: seriesUnicas.size };
}
