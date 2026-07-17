// app/api/epg/sync/sync-jogos/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'


const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── Config ────────────────────────────────────────────────────────────────────


const R2_BUCKET = process.env.R2_BUCKET_NAME!
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_DEV_URL || ''

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

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

// Canais que não fazem parte do seu catálogo — jogos que só tenham transmissão
// por eles são descartados do sync (não é canal de TV real pro seu uso: VBTV
// e Antel são de outros países, bet365 é casa de apostas, não canal).
const CANAIS_BLOQUEADOS = ['vbtv', 'GETV', 'Youtube UOL', 'bet365', 'Youtube UOL', 'Fanatiz', 'antel tv internacional', 'Youtube Metrópoles']

function canalBloqueado(nome: string): boolean {
  const n = nome.toLowerCase()
  return CANAIS_BLOQUEADOS.some((b) => n.includes(b))
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
function tvNetworkLogoUrl(id: number, imageVersion: number): string {
  return `https://imagecache.365scores.com/image/upload/f_png,w_60,h_60,c_limit,q_auto:eco,dpr_2/v${imageVersion}/Networks/${id}`
}

/** Gera URL do escudo do time via CDN 365scores */
function competitorLogoUrl(id: number, imageVersion: number): string {
  return `https://imagecache.365scores.com/image/upload/f_png,w_34,h_34,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png/v${imageVersion}/Competitors/${id}`
}

/** Sobe JSON para o R2 usando fetch com S3-compatible PUT */
async function uploadToR2(key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket:       R2_BUCKET,
    Key:          key,
    Body:         body,
    ContentType:  'application/json',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }))
}

// ─── Handler Principal ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Aceita cron via Bearer token OU admin logado via sessão (igual ao sync-claro)
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const agora = new Date()
  const hoje = formatDateForAPI(agora)
  const amanha = new Date(agora)
  amanha.setDate(amanha.getDate() + 1)
  const dataAmanha = formatDateForAPI(amanha)

  console.log(`[sync-jogos] Iniciando sync para ${hoje}`)

  try {
// ── 1. Busca jogos de hoje e amanhã em paralelo ─────────────────────────
    const [gamesHoje, gamesAmanha] = await Promise.all([
      fetchAllScores(hoje),
      fetchAllScores(dataAmanha),
    ])
    const todosGames = [...gamesHoje, ...gamesAmanha]
    // Deduplica por game_id (caso a API retorne o mesmo jogo nos dois ranges)
    const gamesSemDup = [...new Map(todosGames.map(g => [g.id, g])).values()]
    console.log(`[sync-jogos] Total de jogos (hoje+amanhã): ${gamesSemDup.length}`)

    // ── 2. Filtra só os que têm transmissão em TV ───────────────────────────
    const comTV = gamesSemDup.filter((g) => g.hasTVNetworks)

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

    // ── 3b. Remove canais bloqueados e descarta jogo se ficar sem transmissão ──
    const validosFiltrados = validos
      .map((g) => ({
        ...g,
        tvNetworks: (g.tvNetworks ?? []).filter((tv) => !canalBloqueado(tv.name)),
      }))
      .filter((g) => g.tvNetworks.length > 0)

    console.log(
      `[sync-jogos] Após remover canais bloqueados: ${validosFiltrados.length}/${validos.length}`
    )

    // ── 4. Converte para formato da tabela ──────────────────────────────────
    const jogos = validosFiltrados.map(toJogoDia)

    // ── 5. Upsert no Supabase ───────────────────────────────────────────────
    const { error: upsertError } = await supabaseAdmin
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
