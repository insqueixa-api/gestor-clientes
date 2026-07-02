import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

const API_BASE    = 'https://webws.365scores.com/web'
const TZ          = 'America%2FSao_Paulo'
const LANG        = 31
const COUNTRY     = 21
const APP_TYPE    = 5
const SPORTS      = '1,2,3,6,8'
const R2_BUCKET   = process.env.R2_BUCKET_NAME!
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_DEV_URL || ''

const API_HEADERS = {
  'accept': '*/*',
  'accept-language': 'pt-BR,pt;q=0.9',
  'origin': 'https://www.365scores.com',
  'referer': 'https://www.365scores.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

function formatDateForAPI(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}

export async function GET(request: Request) {
  // Auth: Bearer token (cron/front) OU sessão admin
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`

  if (!isCron) {
    // Chamada vinda do front — aceita sem auth (é só leitura pública do 365scores)
    // mas limita a não fazer rebuild completo
  }

  try {
    const agora = new Date()
    const hoje  = formatDateForAPI(agora)
    const amanha = new Date(agora)
    amanha.setDate(amanha.getDate() + 1)
    const dataAmanha = formatDateForAPI(amanha)

    // ── 1. Busca allscores (hoje + amanhã) — UMA chamada por dia, sem detalhes ──
    const [gamesHoje, gamesAmanha] = await Promise.all([
      fetch(
        `${API_BASE}/games/allscores/?appTypeId=${APP_TYPE}&langId=${LANG}&timezoneName=${TZ}&userCountryId=${COUNTRY}&sports=${SPORTS}&startDate=${hoje}&endDate=${hoje}&showOdds=false&onlyMajorGames=false`,
        { headers: API_HEADERS }
      ).then(r => r.ok ? r.json() : { games: [] }),
      fetch(
        `${API_BASE}/games/allscores/?appTypeId=${APP_TYPE}&langId=${LANG}&timezoneName=${TZ}&userCountryId=${COUNTRY}&sports=${SPORTS}&startDate=${dataAmanha}&endDate=${dataAmanha}&showOdds=false&onlyMajorGames=false`,
        { headers: API_HEADERS }
      ).then(r => r.ok ? r.json() : { games: [] }),
    ])

    const todosGames = [
      ...(gamesHoje.games ?? []),
      ...(gamesAmanha.games ?? []),
    ]

    const gamesSemDup = [...new Map(todosGames.map((g: any) => [g.id, g])).values()]

    if (gamesSemDup.length === 0) {
      return NextResponse.json({ ok: true, atualizados: 0 })
    }

    // ── 2. Upsert só dos campos de placar/status ────────────────────────────────
    const updates = gamesSemDup
      .filter((g: any) => g.hasTVNetworks)
      .map((g: any) => ({
        game_id:          g.id,
        // Campos obrigatórios da tabela — precisam vir mesmo no upsert parcial
        sport_id:         g.sportId,
        competition_id:   g.competitionId,
        competition_nome: g.competitionDisplayName ?? '',
        home_id:          g.homeCompetitor?.id,
        home_nome:        g.homeCompetitor?.name ?? '',
        away_id:          g.awayCompetitor?.id,
        away_nome:        g.awayCompetitor?.name ?? '',
        data_hora:        g.startTime,
        // Campos de placar/status que queremos atualizar
        status_group:     g.statusGroup,
        status_text:      g.statusText ?? null,
        score_home:
          (g.statusGroup === 3 || g.statusGroup === 4) &&
          g.homeCompetitor?.score != null && g.homeCompetitor.score >= 0
            ? g.homeCompetitor.score : null,
        score_away:
          (g.statusGroup === 3 || g.statusGroup === 4) &&
          g.awayCompetitor?.score != null && g.awayCompetitor.score >= 0
            ? g.awayCompetitor.score : null,
        atualizado_em:    agora.toISOString(),
      }))

    const { error: upsertError } = await supabaseAdmin
      .from('jogos_dia')
      .upsert(updates, { onConflict: 'game_id', ignoreDuplicates: false })

    if (upsertError) throw new Error(`upsert: ${upsertError.message}`)

    // ── 3. Busca o JSON atual do R2, atualiza placares em memória e regravar ───
    // Estratégia: não reconstruir do Supabase (evita perder jogos por filtro de data)
    // Apenas patch dos campos de status/placar nos jogos já existentes no JSON
    const r2Url = `${R2_PUBLIC_URL}/epg/jogos_dia.json`
    const r2Res = await fetch(`${r2Url}?t=${Date.now()}`, { cache: 'no-store' })
    if (!r2Res.ok) throw new Error(`R2 fetch: HTTP ${r2Res.status}`)
    const r2Json = await r2Res.json()

    // Monta mapa de updates por game_id para lookup O(1)
    const updatesMap = new Map(updates.map(u => [u.game_id, u]))

    // Aplica patch só nos campos de placar/status — preserva todos os outros campos (tv_networks, logos, etc.)
    const jogosAtualizados = (r2Json.jogos ?? []).map((jogo: any) => {
      const update = updatesMap.get(jogo.game_id)
      if (!update) return jogo // jogo não veio no allscores — mantém como estava
      return {
        ...jogo,
        status_group: update.status_group,
        status_text:  update.status_text,
        score_home:   update.score_home,
        score_away:   update.score_away,
        atualizado_em: update.atualizado_em,
      }
    })

    const r2Payload = {
      ...r2Json,
      generated_at: agora.toISOString(),
      jogos: jogosAtualizados,
    }

    await s3.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         'epg/jogos_dia.json',
      Body:        JSON.stringify(r2Payload),
      ContentType: 'application/json',
      CacheControl:'no-cache, no-store, must-revalidate',
    }))

    return NextResponse.json({
      ok: true,
      atualizados: updates.length,
      ao_vivo: updates.filter(u => u.status_group === 3).length,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}