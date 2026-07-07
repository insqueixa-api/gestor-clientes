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

const R2_BUCKET     = process.env.R2_BUCKET_NAME!
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_DEV_URL || ''
const RONIN_TOKEN   = 'cvKsCjKVUt6yIxLTK5aijmq6Td61bD'
const RONIN_BASE    = 'https://api2.roninmedia.io/2/fixtures/grouped'

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface RoninChannel {
  id: number
  name: string
  shortname: string
  url: string | null
  url_slug: string
  sprite_class: string
  is_streaming: boolean
}

interface RoninFixture {
  fixture_id: number
  title: string
  date: string
  status: string | null
  home_team: string
  home_team_id: number
  visiting_team: string
  visiting_team_id: number
  home_team_score: number | null
  visiting_team_score: number | null
  venue: string | null
  league_id: number
  sport_id: number
  channels: RoninChannel[]
}

interface RoninLeague {
  id: number
  name: string
  sport_id: number
  sport: string
  fixtures: RoninFixture[]
}

interface RoninSport {
  id: number
  name: string
  leagues: RoninLeague[]
}

interface RoninDay {
  date: string
  sports: RoninSport[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateForAPI(date: Date): string {
  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${d}`
}

function statusToGroup(status: string | null): number {
  if (status === 'inprogress')  return 3
  if (status === 'finished')    return 4
  return 2 // notstarted ou null
}

async function fetchRonin(date: string): Promise<RoninDay | null> {
  const url = `${RONIN_BASE}?token=${RONIN_TOKEN}&day=${date}&dayBreakHour=0&tz=America/Sao_Paulo`
  try {
    const res = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    // Estrutura: [ { sports: [ [ { date, sports: [...] } ] ] } ]
    return data?.[0]?.sports?.[0]?.[0] ?? null
  } catch {
    return null
  }
}

async function uploadToR2(key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket:       R2_BUCKET,
    Key:          key,
    Body:         body,
    ContentType:  'application/json',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }))
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const agora  = new Date()
  const hoje   = formatDateForAPI(agora)
  const amanha = new Date(agora)
  amanha.setDate(amanha.getDate() + 1)
  const dataAmanha = formatDateForAPI(amanha)

  console.log(`[sync-jogos-ronin] Iniciando sync para ${hoje} e ${dataAmanha}`)

  try {
    // ── 1. Busca hoje e amanhã em paralelo ──────────────────────────────────
    const [diaHoje, diaAmanha] = await Promise.all([
      fetchRonin(hoje),
      fetchRonin(dataAmanha),
    ])

    // ── 2. Extrai todos os fixtures com canais ───────────────────────────────
    const jogos: any[] = []
    const vistos = new Set<number>()

    for (const dia of [diaHoje, diaAmanha]) {
      if (!dia) continue
      for (const sport of dia.sports) {
        for (const liga of sport.leagues) {
          for (const fx of (liga.fixtures ?? [])) {
 if (!fx.channels?.length) continue  // só com transmissão
            if (!fx.home_team_id || !fx.visiting_team_id) continue  // ignora sem times
            if (vistos.has(fx.fixture_id)) continue
            vistos.add(fx.fixture_id)

            const statusGroup = statusToGroup(fx.status)
            const temPlacar   = statusGroup === 3 || statusGroup === 4

            jogos.push({
              game_id:          fx.fixture_id,
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
              score_home:       temPlacar ? fx.home_team_score : null,
              score_away:       temPlacar ? fx.visiting_team_score : null,
              tv_networks:      fx.channels.map((ch: RoninChannel) => ({
                id:           ch.id,
                name:         ch.name,
                shortname:    ch.shortname,
                logo_url:     null, // Roninmedia não tem URL de logo
              })),
              venue:            fx.venue ?? null,
              atualizado_em:    agora.toISOString(),
            })
          }
        }
      }
    }

    console.log(`[sync-jogos-ronin] Total jogos com transmissão: ${jogos.length}`)

    if (jogos.length === 0) {
      return NextResponse.json({ ok: true, message: 'Nenhum jogo com transmissão', date: hoje, total: 0 })
    }

    // ── 3. Upsert no Supabase ────────────────────────────────────────────────
    const { error: upsertError } = await supabaseAdmin
      .from('jogos_dia')
      .upsert(jogos, { onConflict: 'game_id' })

    if (upsertError) throw new Error(`Supabase upsert: ${upsertError.message}`)
    console.log(`[sync-jogos-ronin] ${jogos.length} jogos salvos no Supabase`)

    // ── 4. Monta JSON para R2 ────────────────────────────────────────────────
    const r2Payload = {
      generated_at: agora.toISOString(),
      date:         hoje,
      total:        jogos.length,
      sports:       [...new Set(jogos.map(j => j.sport_id))],
      jogos:        jogos.map(j => ({
        ...j,
        home_logo: null, // Roninmedia não tem logos de times
        away_logo: null,
      })),
    }

    // ── 5. Sobe para R2 ──────────────────────────────────────────────────────
    await uploadToR2('epg/jogos_dia.json', JSON.stringify(r2Payload))
    console.log(`[sync-jogos-ronin] JSON subido para R2`)

    return NextResponse.json({
      ok:     true,
      date:   hoje,
      total:  jogos.length,
      sports: r2Payload.sports,
      r2_url: `${R2_PUBLIC_URL}/epg/jogos_dia.json`,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync-jogos-ronin] Erro:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}