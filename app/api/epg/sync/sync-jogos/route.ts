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

// ─── Config ──────────────────────────────────────────────────────────────────

const R2_BUCKET     = process.env.R2_BUCKET_NAME!
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_DEV_URL || ''

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

// 365scores
const API_BASE   = 'https://webws.365scores.com/web'
const TZ         = 'America%2FSao_Paulo'
const LANG       = 31
const COUNTRY    = 21
const APP_TYPE   = 5
const SPORTS     = '1,2,3,6,8'
const API_HEADERS = {
  'accept': '*/*',
  'accept-language': 'pt-BR,pt;q=0.9',
  'origin': 'https://www.365scores.com',
  'referer': 'https://www.365scores.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

// Roninmedia
const RONIN_TOKEN = 'cvKsCjKVUt6yIxLTK5aijmq6Td61bD'
const RONIN_BASE  = 'https://api2.roninmedia.io/2/fixtures/grouped'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Competitor {
  id: number; name: string; imageVersion?: number
  color?: string; awayColor?: string; score?: number
}
interface GameSummary {
  id: number; sportId: number; competitionId: number
  competitionDisplayName: string; stageName?: string
  startTime: string; statusGroup: number; statusText?: string
  hasTVNetworks: boolean
  homeCompetitor: Competitor; awayCompetitor: Competitor
}
interface TVNetwork {
  id: number; type: number; name: string; countryId: number
  website: string; bookmakerId: number; imageVersion: number
}
interface GameDetail extends GameSummary {
  tvNetworks: TVNetwork[]
  venue?: { id: number; name: string }
}
interface JogoDia {
  game_id: number; sport_id: number; competition_id: number
  competition_nome: string; stage_nome: string | null
  home_id: number; home_nome: string
  home_image_ver: number | null; home_color: string | null
  away_id: number; away_nome: string
  away_image_ver: number | null; away_color: string | null
  data_hora: string; status_group: number; status_text: string | null
  score_home: number | null; score_away: number | null
  tv_networks: any[]; venue: string | null; atualizado_em: string
  fonte?: 'ronin'
}

// ─── Helpers 365scores ───────────────────────────────────────────────────────

function formatDate365(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  return `${d}/${m}/${date.getFullYear()}`
}

async function pLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = []
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) { const t = queue.shift(); if (t) results.push(await t()) }
  })
  await Promise.all(workers)
  return results
}

async function fetchAllScores(date: string): Promise<GameSummary[]> {
  const url = `${API_BASE}/games/allscores/?appTypeId=${APP_TYPE}&langId=${LANG}&timezoneName=${TZ}&userCountryId=${COUNTRY}&sports=${SPORTS}&startDate=${date}&endDate=${date}&showOdds=false&onlyMajorGames=false`
  const res = await fetch(url, { headers: API_HEADERS })
  if (!res.ok) throw new Error(`allscores HTTP ${res.status}`)
  const data = await res.json()
  return (data.games ?? []) as GameSummary[]
}

async function fetchGameDetail(gameId: number): Promise<GameDetail | null> {
  const url = `${API_BASE}/game/?langId=${LANG}&timezoneName=${TZ}&userCountryId=${COUNTRY}&appTypeId=${APP_TYPE}&gameId=${gameId}`
  try {
    const res = await fetch(url, { headers: API_HEADERS })
    if (!res.ok) return null
    const data = await res.json()
    return (data.game ?? null) as GameDetail | null
  } catch { return null }
}

function toJogoDia(g: GameDetail): JogoDia {
  return {
    game_id: g.id, sport_id: g.sportId,
    competition_id: g.competitionId, competition_nome: g.competitionDisplayName,
    stage_nome: g.stageName ?? null,
    home_id: g.homeCompetitor.id, home_nome: g.homeCompetitor.name,
    home_image_ver: g.homeCompetitor.imageVersion ?? null,
    home_color: g.homeCompetitor.color ?? null,
    away_id: g.awayCompetitor.id, away_nome: g.awayCompetitor.name,
    away_image_ver: g.awayCompetitor.imageVersion ?? null,
    away_color: g.awayCompetitor.color ?? null,
    data_hora: g.startTime, status_group: g.statusGroup,
    status_text: g.statusText ?? null,
    score_home: g.homeCompetitor.score != null && g.homeCompetitor.score >= 0 ? g.homeCompetitor.score : null,
    score_away: g.awayCompetitor.score != null && g.awayCompetitor.score >= 0 ? g.awayCompetitor.score : null,
    tv_networks: g.tvNetworks ?? [], venue: g.venue?.name ?? null,
    atualizado_em: new Date().toISOString(),
  }
}

function tvNetworkLogoUrl(id: number, imageVersion: number): string {
  return `https://imagecache.365scores.com/image/upload/f_png,w_60,h_60,c_limit,q_auto:eco,dpr_2/v${imageVersion}/Networks/${id}`
}

function competitorLogoUrl(id: number, imageVersion: number): string {
  return `https://imagecache.365scores.com/image/upload/f_png,w_34,h_34,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png/v${imageVersion}/Competitors/${id}`
}

// ─── Helpers Roninmedia ──────────────────────────────────────────────────────

function formatDateRonin(date: Date): string {
  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${d}`
}

function roninStatusToGroup(status: string | null): number {
  if (status === 'inprogress') return 3
  if (status === 'finished')   return 4
  return 2
}

async function fetchRonin(date: string): Promise<any | null> {
  const url = `${RONIN_BASE}?token=${RONIN_TOKEN}&day=${date}&dayBreakHour=0&tz=America/Sao_Paulo`
  try {
    const res = await fetch(url, {
      headers: { 'accept': 'application/json', 'user-agent': 'Mozilla/5.0' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.[0]?.sports?.[0]?.[0] ?? null
  } catch { return null }
}

/** Normaliza nome para comparação — minúsculas, sem acentos, sem parênteses */
function normNome(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

/** Extrai só a data YYYY-MM-DD de uma ISO string */
function soData(iso: string): string {
  // Converte para data em SP (UTC-3) antes de comparar
  const d = new Date(iso)
  const spStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  return spStr // YYYY-MM-DD em SP
}

// ─── Handler Principal ───────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const agora    = new Date()
  const hoje365  = formatDate365(agora)
  const amanha365 = formatDate365(new Date(agora.getTime() + 86400000))
  const hojeRonin  = formatDateRonin(agora)
  const amanhaRonin = formatDateRonin(new Date(agora.getTime() + 86400000))

  console.log(`[sync-jogos] Iniciando sync para ${hoje365} + Roninmedia`)

  try {
    // ── 1. Busca 365scores e Roninmedia em paralelo ──────────────────────────
    const [games365Hoje, games365Amanha, roninHoje, roninAmanha] = await Promise.all([
      fetchAllScores(hoje365),
      fetchAllScores(amanha365),
      fetchRonin(hojeRonin),
      fetchRonin(amanhaRonin),
    ])

    // ── 2. Processa 365scores ────────────────────────────────────────────────
    const todos365 = [...games365Hoje, ...games365Amanha]
    const semDup365 = [...new Map(todos365.map(g => [g.id, g])).values()]
    const comTV365 = semDup365.filter(g => g.hasTVNetworks)
    console.log(`[sync-jogos] 365scores: ${comTV365.length} jogos com TV`)

    const tasks = comTV365.map(g => () => fetchGameDetail(g.id))
    const detalhes = await pLimit(tasks, 5)
    const validos365 = detalhes.filter((d): d is GameDetail => d !== null)
    const jogos365 = validos365.map(toJogoDia)

    // ── 3. Monta índice de deduplicação (3 chaves) ───────────────────────────
    // Para cada jogo do 365, registra: home+away+data, home+data, away+data
    // Índice: sport_id + nome do time + data — independente de home/away
    const idxTime = new Set<string>()

    for (const j of jogos365) {
      const data = soData(j.data_hora)
      const h = normNome(j.home_nome)
      const a = normNome(j.away_nome)
      idxTime.add(`${j.sport_id}|${h}|${data}`)
      idxTime.add(`${j.sport_id}|${a}|${data}`)
    }

    // ── 4. Processa Roninmedia — só adiciona jogos não duplicados ────────────
    const jogosRonin: JogoDia[] = []
    const vistosRonin = new Set<number>()

    for (const dia of [roninHoje, roninAmanha]) {
      if (!dia) continue
      for (const sport of (dia.sports ?? [])) {
        for (const liga of (sport.leagues ?? [])) {
          for (const fx of (liga.fixtures ?? [])) {
            if (!fx.channels?.length) continue
            if (!fx.home_team_id || !fx.visiting_team_id) continue
            if (vistosRonin.has(fx.fixture_id)) continue
            vistosRonin.add(fx.fixture_id)

            const data = soData(fx.date)
            const h = normNome(fx.home_team)
            const a = normNome(fx.visiting_team)

            // Se o 365 já tem qualquer jogo com esse time nesse sport+data, ignora
            if (
              idxTime.has(`${fx.sport_id}|${h}|${data}`) ||
              idxTime.has(`${fx.sport_id}|${a}|${data}`)
            ) {
              console.log(`[sync-jogos] Ronin duplicado ignorado: ${fx.home_team} x ${fx.visiting_team}`)
              continue
            }

            const statusGroup = roninStatusToGroup(fx.status)
            const temPlacar   = statusGroup === 3 || statusGroup === 4

            // ID negativo para não colidir com IDs do 365scores
            const gameId = -(fx.fixture_id)

            jogosRonin.push({
              game_id:          gameId,
              sport_id:         fx.sport_id,
              competition_id:   liga.id,
              competition_nome: liga.name,
              stage_nome:       null,
              home_id:          fx.home_team_id,
              home_nome:        fx.home_team,
              home_image_ver:   null,
              home_color:       null,
              away_id:          fx.visiting_team_id,
              away_nome:        fx.visiting_team,
              away_image_ver:   null,
              away_color:       null,
              data_hora:        fx.date,
              status_group:     statusGroup,
              status_text:      fx.status ?? null,
              score_home:       temPlacar ? (fx.home_team_score ?? null) : null,
              score_away:       temPlacar ? (fx.visiting_team_score ?? null) : null,
              tv_networks:      fx.channels.map((ch: any) => ({
                id:        ch.id,
                name:      ch.name,
                shortname: ch.shortname,
                logo_url:  null,
              })),
              venue:         fx.venue ?? null,
              atualizado_em: agora.toISOString(),
              
            })
          }
        }
      }
    }

    console.log(`[sync-jogos] Roninmedia: ${jogosRonin.length} jogos novos (sem duplicatas)`)

    // ── 5. Mescla tudo ───────────────────────────────────────────────────────
    const todosJogos = [...jogos365, ...jogosRonin]
      .sort((a, b) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime())

    if (todosJogos.length === 0) {
      return NextResponse.json({ ok: true, message: 'Nenhum jogo com TV hoje', date: hoje365, total: 0 })
    }

    // ── 6. Upsert no Supabase ────────────────────────────────────────────────
    const { error: upsertError } = await supabaseAdmin
      .from('jogos_dia')
      .upsert(todosJogos, { onConflict: 'game_id' })

    if (upsertError) throw new Error(`Supabase upsert: ${upsertError.message}`)
    console.log(`[sync-jogos] ${todosJogos.length} jogos salvos (${jogos365.length} 365 + ${jogosRonin.length} Ronin)`)

    // ── 7. Monta JSON para R2 ────────────────────────────────────────────────
    const r2Payload = {
      generated_at: agora.toISOString(),
      date:         hoje365,
      total:        todosJogos.length,
      total_365:    jogos365.length,
      total_ronin:  jogosRonin.length,
      sports:       [...new Set(todosJogos.map(j => j.sport_id))],
      jogos: todosJogos.map(j => ({
        ...j,
        home_logo: j.home_image_ver ? competitorLogoUrl(j.home_id, j.home_image_ver) : null,
        away_logo: j.away_image_ver ? competitorLogoUrl(j.away_id, j.away_image_ver) : null,
        tv_networks: j.tv_networks.map((tv: any) => ({
          id:        tv.id,
          name:      tv.name,
          shortname: tv.shortname ?? tv.name,
          logo_url:  null, // sem logo — só nome
          imageVersion: tv.imageVersion ?? null,
        })),
      })),
    }

    // ── 8. Sobe para R2 ──────────────────────────────────────────────────────
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: 'epg/jogos_dia.json',
      Body: JSON.stringify(r2Payload),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }))

    return NextResponse.json({
      ok:          true,
      date:        hoje365,
      total:       todosJogos.length,
      total_365:   jogos365.length,
      total_ronin: jogosRonin.length,
      sports:      r2Payload.sports,
      r2_url:      `${R2_PUBLIC_URL}/epg/jogos_dia.json`,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync-jogos] Erro:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}