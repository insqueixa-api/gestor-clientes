// app/api/epg/sync/sync-jogos/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ─── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID!
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY!
const R2_BUCKET = process.env.R2_BUCKET_NAME!
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL! // ex: https://pub-xxx.r2.dev

const API_BASE = 'https://webws.365scores.com/web'
const TZ = 'America%2FSao_Paulo'
const LANG = 31
const COUNTRY = 21
const APP_TYPE = 5
// Sports: 1=Futebol, 2=Basquete, 3=Tênis, 8=Vôlei, 6=Futebol Americano
// Sem filtro fixo — a API retorna todos e filtramos por hasTVNetworks
const SPORTS = '1,2,3,6,8'

// Headers obrigatórios — sem eles a API retorna games: []
const API_HEADERS = {
  'accept': '*/*',
  'accept-language': 'pt-BR,pt;q=0.9',
  'origin': 'https://www.365scores.com',
  'referer': 'https://www.365scores.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

// ─── Tipos ──────────────────────────────────────────────────────────────────────

interface Competitor {
  id: number
  name: string
  imageVersion?: number
  color?: string
  awayColor?: string
  score?: number
}

interface GameSummary {
  id: number
  sportId: number
  competitionId: number
  competitionDisplayName: string
  stageName?: string
  startTime: string
  statusGroup: number
  statusText?: string
  gameTime?: number
  gameTimeDisplay?: string
  hasTVNetworks: boolean
  homeCompetitor: Competitor
  awayCompetitor: Competitor
}

interface TVNetwork {
  id: number
  type: number
  name: string
  countryId: number
  website: string
  bookmakerId: number
  imageVersion: number
}

interface GameDetail extends GameSummary {
  tvNetworks: TVNetwork[]
  venue?: { id: number; name: string }
}

interface JogoDia {
  game_id: number
  sport_id: number
  competition_id: number
  competition_nome: string
  stage_nome: string | null
  home_id: number
  home_nome: string
  home_image_ver: number | null
  home_color: string | null
  away_id: number
  away_nome: string
  away_image_ver: number | null
  away_color: string | null
  data_hora: string
  status_group: number
  status_text: string | null
  score_home: number | null
  score_away: number | null
  tv_networks: TVNetwork[]
  venue: string | null
  atualizado_em: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Formata data para o padrão esperado pela API: DD/MM/YYYY */
function formatDateForAPI(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}

/** Executa promises em paralelo com limite de concorrência */
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = []
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift()
      if (task) results.push(await task())
    }
  })
  await Promise.all(workers)
  return results
}

/** Busca lista de todos os jogos do dia */
async function fetchAllScores(date: string): Promise<GameSummary[]> {
  const url =
    `${API_BASE}/games/allscores/` +
    `?appTypeId=${APP_TYPE}` +
    `&langId=${LANG}` +
    `&timezoneName=${TZ}` +
    `&userCountryId=${COUNTRY}` +
    `&sports=${SPORTS}` +
    `&startDate=${date}` +
    `&endDate=${date}` +
    `&showOdds=false` +
    `&onlyMajorGames=false`

  const res = await fetch(url, { headers: API_HEADERS })
  if (!res.ok) throw new Error(`allscores HTTP ${res.status}`)
  const data = await res.json()
  return (data.games ?? []) as GameSummary[]
}

/** Busca detalhe de um jogo (inclui tvNetworks e venue) */
async function fetchGameDetail(gameId: number): Promise<GameDetail | null> {
  const url =
    `${API_BASE}/game/` +
    `?langId=${LANG}` +
    `&timezoneName=${TZ}` +
    `&userCountryId=${COUNTRY}` +
    `&appTypeId=${APP_TYPE}` +
    `&gameId=${gameId}`

  try {
    const res = await fetch(url, { headers: API_HEADERS })
    if (!res.ok) return null
    const data = await res.json()
    return (data.game ?? null) as GameDetail | null
  } catch {
    return null
  }
}

/** Converte GameDetail para o formato da tabela jogos_dia */
function toJogoDia(g: GameDetail): JogoDia {
  return {
    game_id: g.id,
    sport_id: g.sportId,
    competition_id: g.competitionId,
    competition_nome: g.competitionDisplayName,
    stage_nome: g.stageName ?? null,
    home_id: g.homeCompetitor.id,
    home_nome: g.homeCompetitor.name,
    home_image_ver: g.homeCompetitor.imageVersion ?? null,
    home_color: g.homeCompetitor.color ?? null,
    away_id: g.awayCompetitor.id,
    away_nome: g.awayCompetitor.name,
    away_image_ver: g.awayCompetitor.imageVersion ?? null,
    away_color: g.awayCompetitor.color ?? null,
    data_hora: g.startTime,
    status_group: g.statusGroup,
    status_text: g.statusText ?? null,
    score_home:
      g.homeCompetitor.score != null && g.homeCompetitor.score >= 0
        ? g.homeCompetitor.score
        : null,
    score_away:
      g.awayCompetitor.score != null && g.awayCompetitor.score >= 0
        ? g.awayCompetitor.score
        : null,
    tv_networks: g.tvNetworks ?? [],
    venue: g.venue?.name ?? null,
    atualizado_em: new Date().toISOString(),
  }
}

/** Gera URL do logo do canal via CDN 365scores */
export function tvNetworkLogoUrl(id: number, imageVersion: number): string {
  return `https://imagecache.365scores.com/image/upload/f_png,w_60,h_60,c_limit,q_auto:eco,dpr_2/v${imageVersion}/Networks/${id}`
}

/** Gera URL do escudo do time via CDN 365scores */
export function competitorLogoUrl(id: number, imageVersion: number): string {
  return `https://imagecache.365scores.com/image/upload/f_png,w_34,h_34,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png/v${imageVersion}/Competitors/${id}`
}

/** Sobe JSON para o R2 usando fetch com S3-compatible PUT */
async function uploadToR2(key: string, body: string): Promise<void> {
  // Usa o endpoint S3-compatible do Cloudflare R2
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`

  // Assina a requisição com AWS Signature V4
  const { AwsV4Signer } = await import('aws4fetch')
  const signer = new AwsV4Signer({
    url: endpoint,
    method: 'PUT',
    region: 'auto',
    service: 's3',
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
    body,
    headers: { 'content-type': 'application/json' },
  })

  const signed = await signer.sign()
  const res = await fetch(signed.url, {
    method: signed.method,
    headers: signed.headers,
    body,
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`R2 PUT falhou: ${res.status} — ${txt}`)
  }
}

// ─── Handler Principal ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Segurança: só roda com cron-secret ou em dev
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const agora = new Date()
  const hoje = formatDateForAPI(agora)

  console.log(`[sync-jogos] Iniciando sync para ${hoje}`)

  try {
    // ── 1. Busca todos os jogos do dia ──────────────────────────────────────
    const todosGames = await fetchAllScores(hoje)
    console.log(`[sync-jogos] Total de jogos: ${todosGames.length}`)

    // ── 2. Filtra só os que têm transmissão em TV ───────────────────────────
    const comTV = todosGames.filter((g) => g.hasTVNetworks)
    console.log(`[sync-jogos] Jogos com TV: ${comTV.length}`)

    if (comTV.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'Nenhum jogo com TV hoje',
        date: hoje,
        total: 0,
      })
    }

    // ── 3. Busca detalhes de cada jogo (tvNetworks + venue) ─────────────────
    // Concorrência limitada a 5 para não sobrecarregar a API
    const tasks = comTV.map((g) => () => fetchGameDetail(g.id))
    const detalhes = await pLimit(tasks, 5)

    const validos = detalhes.filter((d): d is GameDetail => d !== null)
    console.log(
      `[sync-jogos] Detalhes obtidos: ${validos.length}/${comTV.length}`
    )

    // ── 4. Converte para formato da tabela ──────────────────────────────────
    const jogos = validos.map(toJogoDia)

    // ── 5. Upsert no Supabase ───────────────────────────────────────────────
    const { error: upsertError } = await supabase
      .from('jogos_dia')
      .upsert(jogos, { onConflict: 'game_id' })

    if (upsertError) {
      console.error('[sync-jogos] Erro no upsert:', upsertError)
      throw new Error(`Supabase upsert: ${upsertError.message}`)
    }
    console.log(`[sync-jogos] ${jogos.length} jogos salvos no Supabase`)

    // ── 6. Monta JSON para o R2 ─────────────────────────────────────────────
    // Formato otimizado para o front-end consumir direto do CDN
    const r2Payload = {
      generated_at: agora.toISOString(),
      date: hoje,
      total: jogos.length,
      sports: [...new Set(jogos.map((j) => j.sport_id))],
      jogos: jogos.map((j) => ({
        ...j,
        // URL helpers pré-calculadas para o front não precisar montar
        home_logo: j.home_image_ver
          ? competitorLogoUrl(j.home_id, j.home_image_ver)
          : null,
        away_logo: j.away_image_ver
          ? competitorLogoUrl(j.away_id, j.away_image_ver)
          : null,
        tv_networks: j.tv_networks.map((tv) => ({
          ...tv,
          logo_url: tvNetworkLogoUrl(tv.id, tv.imageVersion),
        })),
      })),
    }

    // ── 7. Sobe para o R2 ───────────────────────────────────────────────────
    await uploadToR2('epg/jogos_dia.json', JSON.stringify(r2Payload))
    console.log(`[sync-jogos] JSON subido para R2: epg/jogos_dia.json`)

    return NextResponse.json({
      ok: true,
      date: hoje,
      total: jogos.length,
      sports: r2Payload.sports,
      r2_url: `${R2_PUBLIC_URL}/epg/jogos_dia.json`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync-jogos] Erro:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
