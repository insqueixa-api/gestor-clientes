// lib/catalog/catalog-parser.ts
// Parser compartilhado para M3U dos 3 servidores (ELITE, NATV, FAST)
//
// FIXES aplicados:
//   1. normalizarFilme: remove sufixos de qualidade (4K, HD, HDR, BluRay, [4K], etc.)
//   2. normalizarSerie: idem
//   3. normalizarFilme/Serie: normaliza acentos (NFD → remove diacríticos → volta pra maiúscula)
//      → "007 PERMISSÃO" e "007 PERMISSAO" viram o mesmo título
//   4. normalizarFilme: remove sufixos de servidor (FULL, ULTRA, DL, CAM, TS, WEB-DL)
//   5. normalizarGrupo: remove sufixos de qualidade do grupo também

export type TipoConteudo = "CANAL" | "FILME" | "SERIE";
export type Servidor     = "ELITE" | "NATV" | "FAST";

export type EntradaCatalogo = {
  titulo_normalizado: string;
  titulo_original:    string;
  tipo:               TipoConteudo;
  cover_url:          string;
  ano:                number | null;
  categoria_origem:   string;
  temporada?:         number;
  episodio?:          number;
};

// ─── Qualidade: peso para desduplicar canais ──────────────────────────────────
function qualidadePeso(nome: string): number {
  const u = nome.toUpperCase();
  if (u.includes("4K"))                          return 5;
  if (u.includes("FHD"))                         return 4;
  if (u.includes("H265") || u.includes("H.265")) return 3;
  if (u.includes("[HD]") || u.includes(" HD"))   return 2;
  return 1;
}

// ─── Normalização de nome de canal ────────────────────────────────────────────
function normalizarCanal(nome: string): string {
  return nome
    .toUpperCase()
    .replace(/\s*\[?(4K|FHD|FHD\*|FHDR|H265|H\.265|HD|SD)\]?\s*/gi, " ")
    .replace(/\s*\*+\s*$/g, "")
    .replace(/\s+(BR|H265²|HD²|²|³)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Remove acentos e normaliza para comparação ───────────────────────────────
// Garante que "PERMISSÃO" e "PERMISSAO" viram o mesmo título no banco
function removerAcentos(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // remove diacríticos
    .replace(/ł/g, "l")               // polonês
    .replace(/ø/g, "o")               // norueguês
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss");
}

// ─── Remove sufixos de qualidade de títulos ───────────────────────────────────
function removerQualidade(titulo: string): string {
  return titulo
    // Entre colchetes/parênteses (com ou sem espaço antes): [4K], [HDR], [4K][HDR], [4KHDR]
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    // Múltiplos blocos colados: [4K][HDR], [4K][HYBRID] — roda de novo após o primeiro pass
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    // Sufixos grudados sem espaço no final: "TITULO4K", "TITULO4KHDR"
    .replace(/(4K|FHD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|WEB-DL|WEBRIP|H265|HEVC|REMUX)$/gi, "")
    // Sufixos soltos no final com espaço: "FILME 4K", "FILME HDR"
    .replace(/\s+(4K|FHD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|BLU-RAY|WEB-DL|WEBRIP|HDRIP|DVDRIP|BDRIP|H265|H\.265|HEVC|REMUX)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Normaliza pontuação — remove TUDO que não é letra, número ou espaço ──────
// Cobre: . , ; : - / \ | ? ! @ # $ % & * ( ) [ ] { } ~ ^ ' " + = _
// Garante que "S.W.A.T." = "SWAT", "AMOR & GELATO" = "AMOR E GELATO" = "AMOR GELATO"
function normalizarPontuacao(titulo: string): string {
  return titulo
    .replace(/[^A-Z0-9 ]/g, " ")  // remove tudo que não é letra maiúscula, número ou espaço
    .replace(/\s+/g, " ")          // colapsa espaços múltiplos
    .trim();
}
// ─── Normalização de nome de filme ────────────────────────────────────────────
function normalizarFilme(nome: string): { titulo: string; ano: number | null } {
  const anoMatch = nome.match(/[\[(](\d{4})[\])]/);
  const ano      = anoMatch ? parseInt(anoMatch[1]) : null;

  let titulo = nome
    .replace(/&amp;/gi, " E ")     // HTML entity → E
    .replace(/&/g, " E ")           // & → E
    .toUpperCase()
    .replace(/[\[(]\d{4}[\])]/g, "")
    .replace(/\s*\[L\]\s*/gi, " ")
    .replace(/\s*\[DUB\]\s*/gi, " ")
    .replace(/\s+LEG\b/gi, "")
    .replace(/\s+DUB\b/gi, "")
    .replace(/\s+DUBLADO\b/gi, "")
    .replace(/\s+LEGENDADO\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  titulo = removerQualidade(titulo);
  titulo = removerAcentos(titulo);
  titulo = normalizarPontuacao(titulo); // remove toda pontuação restante

  if (!titulo || titulo.replace(/[^A-Z0-9]/g, "").length < 2) return { titulo: "", ano };
  return { titulo, ano };
}

// ─── Normalização de nome de série ────────────────────────────────────────────
function normalizarSerie(nome: string): {
  titulo:    string;
  ano:       number | null;
  temporada: number | null;
  episodio:  number | null;
} {
  const seMatch   = nome.match(/S(\d+)\s*E(\d+)/i);
  const temporada = seMatch ? parseInt(seMatch[1]) : null;
  const episodio  = seMatch ? parseInt(seMatch[2]) : null;

  const anoMatch = nome.match(/[\[(](\d{4})[\])]/);
  const ano      = anoMatch ? parseInt(anoMatch[1]) : null;

  let titulo = nome
    .replace(/&amp;/gi, " E ")     // HTML entity → E
    .replace(/&/g, " E ")           // & → E
    .replace(/\s*S\d+\s*E\d+.*/i, "")
    .replace(/[\[(]\d{4}[\])]\s*/g, "")
    .replace(/\s*\[L\]\s*/gi, " ")
    .replace(/\s*\[DUB\]\s*/gi, " ")
    .replace(/\s+LEG\b/gi, "")
    .replace(/\s+DUB\b/gi, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  titulo = removerQualidade(titulo);
  titulo = removerAcentos(titulo);
  titulo = normalizarPontuacao(titulo); // remove toda pontuação restante

  if (!titulo || titulo.replace(/[^A-Z0-9]/g, "").length < 2) return { titulo: "", ano, temporada, episodio };
  return { titulo, ano, temporada, episodio };
}

// ─── Normalização do grupo/categoria ─────────────────────────────────────────
function normalizarGrupo(grupo: string): string {
  // Fast usa prefixo: "Series | Netflix" → "Netflix"
  if (grupo.includes(" | ")) {
    return grupo.split(" | ").slice(1).join(" | ").trim();
  }
  return grupo.trim();
}

// ─── Filtro de conteúdo adulto ────────────────────────────────────────────────
function isAdulto(grupo: string): boolean {
  const g = grupo.toUpperCase();
  if (g.includes("XXX"))      return true;
  if (g.includes("ADULTO"))   return true;
  if (g.includes("ADULT"))    return true;
  if (g.includes("18+"))      return true;
  if (g.includes("ONLYFANS")) return true;
  if (g.includes("PLAYBOY"))  return true;
  if (g.includes("PRIVACY"))  return true;
  return false;
}

// ─── Filtro de grupos irrelevantes ────────────────────────────────────────────
function isIrrelevante(grupo: string): boolean {
  const g = grupo.toUpperCase();
  if (g.includes("RADIO"))  return true;
  if (g.includes("RÁDIO"))  return true;
  return false;
}

// ─── Parser principal ─────────────────────────────────────────────────────────
export function parseM3U(conteudo: string): EntradaCatalogo[] {
  const linhas    = conteudo.split(/\r?\n/);
  const resultado: EntradaCatalogo[] = [];
  let extinf = "";

  for (const linha of linhas) {
    const l = linha.trim();

    if (l.startsWith("#EXTINF")) { extinf = l; continue; }
    if (!l.startsWith("http") || !extinf) continue;

    const url     = l;
    const tvgNome = extinf.match(/tvg-name="([^"]*)"/)?.[1]?.trim()    || "";
    const tvgLogo = extinf.match(/tvg-logo="([^"]*)"/)?.[1]?.trim()    || "";
    const grupo   = extinf.match(/group-title="([^"]*)"/)?.[1]?.trim() || "";
    extinf = "";

    if (!tvgNome) continue;
    if (isAdulto(grupo))      continue;
    if (isIrrelevante(grupo)) continue;

    let tipo: TipoConteudo;
    if (url.includes("/movie/"))       tipo = "FILME";
    else if (url.includes("/series/")) tipo = "SERIE";
    else                               tipo = "CANAL";

    const categoriaOrigem = normalizarGrupo(grupo);

    if (tipo === "CANAL") {
      continue;

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

// ─── Normaliza para comparação com titulo_busca do banco ──────────────────────
// Deve ser idêntica à função unaccent_immutable do Supabase
export function normalizarTituloBusca(titulo: string): string {
  return titulo
    .replace(/&amp;/gi, " e ")
    .replace(/&/g, " e ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Constrói URL do M3U ──────────────────────────────────────────────────────
export function buildM3UUrl(dns: string[], username: string, password: string): string {
  const base = dns[0].replace(/\/$/, "");
  return `${base}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus`;
}

// ─── Stats do parse para o log ────────────────────────────────────────────────
export function statsDoparse(entradas: EntradaCatalogo[]) {
  let filmes = 0, episodios = 0;
  const seriesUnicas = new Set<string>();
  for (const e of entradas) {
    if (e.tipo === "FILME") filmes++;
    else { episodios++; seriesUnicas.add(e.titulo_normalizado); }
  }
  return { filmes, episodios, series_unicas: seriesUnicas.size };
}
