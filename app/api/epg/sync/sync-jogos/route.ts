// app/api/epg/sync/sync-jogos/route.ts
//
// Recebe os dados já processados pelo script da VM (sync-jogos-sofa.cjs) e faz
// a parte de persistência: Supabase (tabela jogos_dia) + upload pro R2. Mesmo
// padrão do /api/epg/sync-catalog/fast: a VM só busca e normaliza, o Vercel só
// grava. Protocolo em 3 passos via POST, no mesmo espírito do fast-sync:
//
//   { tipo: 'iniciar' }              → limpa a janela hoje+amanhã antes de começar
//   { tipo: 'lote', lote: [...] }    → upsert de um lote de jogos (repetir N vezes)
//   { tipo: 'finalizar' }            → cleanup de sobras + gera e sobe o R2 JSON
//
// Autenticação: Bearer EPG_SYNC_CRON_SECRET — MESMA variável de ambiente que o
// sync-jogos/route.ts (365scores) já usava. Preciso que essa variável exista
// também no .env da VM (hoje ela não está lá — ver instruções que te mandei
// junto com o sync-jogos-sofa.cjs).

import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const R2_BUCKET = process.env.R2_BUCKET_NAME!
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_DEV_URL || ''
const R2_KEY = 'epg/jogos_dia.json'

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

// ─── Tipos ──────────────────────────────────────────────────────────────────────

// Formato que a VM já envia pronto (ver sync-jogos-sofa.cjs) — colunas da
// tabela jogos_dia. home_logo/away_logo/tv_networks[].logo_url são recalculados
// aqui na hora de montar o R2, não ficam salvos na tabela (mesmo padrão do
// sync-jogos original: a tabela guarda os IDs, o R2 guarda as URLs prontas).
interface JogoDiaRow {
  game_id: number
  sport_id: number
  competition_id: number
  competition_nome: string
  stage_nome: string | null
  home_id: number
  home_nome: string
  home_color: string | null
  away_id: number
  away_nome: string
  away_color: string | null
  data_hora: string
  status_group: number
  status_text: string | null
  score_home: number | null
  score_away: number | null
  tv_networks: { id: number; name: string }[]
  venue: string | null
  atualizado_em: string
}

function sofaTeamLogoUrl(id: number): string {
  return `https://api.sofascore.app/api/v1/team/${id}/image`
}
function tvChannelLogoUrl(id: number): string {
  return `https://www.sofascore.com/api/v1/tv/channel/${id}/image`
}

function janelaHojeAmanha() {
  const agora = new Date()
  const inicio = new Date(agora); inicio.setHours(0, 0, 0, 0)
  const fim = new Date(agora); fim.setDate(fim.getDate() + 2); fim.setHours(0, 0, 0, 0)
  return { inicio, fim }
}

async function uploadToR2(key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }))
}

// ─── Handler ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido (esperado JSON)' }, { status: 400 })
  }

  const tipo = body?.tipo

  try {
    // ── iniciar: limpa a janela hoje+amanhã antes do primeiro lote ────────────
    if (tipo === 'iniciar') {
      const { inicio, fim } = janelaHojeAmanha()
      const { error } = await supabaseAdmin
        .from('jogos_dia')
        .delete()
        .gte('data_hora', inicio.toISOString())
        .lt('data_hora', fim.toISOString())
      if (error) throw new Error(`Supabase delete (iniciar): ${error.message}`)
      console.log('[sync-jogos-sofa/ingest] Janela hoje+amanhã limpa')
      return NextResponse.json({ ok: true, step: 'iniciar' })
    }

    // ── lote: upsert de um lote de jogos ──────────────────────────────────────
    if (tipo === 'lote') {
      const lote = (body?.lote ?? []) as JogoDiaRow[]
      if (lote.length === 0) return NextResponse.json({ ok: true, step: 'lote', total: 0 })

      const { error } = await supabaseAdmin
        .from('jogos_dia')
        .upsert(lote, { onConflict: 'game_id' })
      if (error) throw new Error(`Supabase upsert (lote): ${error.message}`)

      console.log(`[sync-jogos-sofa/ingest] Lote de ${lote.length} jogos gravado`)
      return NextResponse.json({ ok: true, step: 'lote', total: lote.length })
    }

    // ── finalizar: cleanup de sobras fora da janela + gera e sobe o R2 ────────
    if (tipo === 'finalizar') {
      const { inicio, fim } = janelaHojeAmanha()

      // Segurança extra: remove qualquer linha fora da janela (ex.: sobra de
      // um dia anterior que por algum motivo não foi limpa no "iniciar").
      const { error: delError } = await supabaseAdmin
        .from('jogos_dia')
        .delete()
        .or(`data_hora.lt.${inicio.toISOString()},data_hora.gte.${fim.toISOString()}`)
      if (delError) throw new Error(`Supabase delete (finalizar): ${delError.message}`)

      const { data: jogos, error: selError } = await supabaseAdmin
        .from('jogos_dia')
        .select('*')
        .gte('data_hora', inicio.toISOString())
        .lt('data_hora', fim.toISOString())
        .order('data_hora', { ascending: true })
      if (selError) throw new Error(`Supabase select (finalizar): ${selError.message}`)

      const jogosFinal = (jogos ?? []) as JogoDiaRow[]

      const r2Payload = {
        generated_at: new Date().toISOString(),
        date: inicio.toISOString().slice(0, 10),
        total: jogosFinal.length,
        sports: [...new Set(jogosFinal.map((j) => j.sport_id))],
        jogos: jogosFinal.map((j) => ({
          ...j,
          home_logo: sofaTeamLogoUrl(j.home_id),
          away_logo: sofaTeamLogoUrl(j.away_id),
          tv_networks: (j.tv_networks ?? []).map((tv) => ({
            ...tv,
            logo_url: tvChannelLogoUrl(tv.id),
          })),
        })),
      }

      await uploadToR2(R2_KEY, JSON.stringify(r2Payload))
      console.log(`[sync-jogos-sofa/ingest] R2 atualizado: ${jogosFinal.length} jogos`)

      return NextResponse.json({
        ok: true,
        step: 'finalizar',
        total: jogosFinal.length,
        r2_url: `${R2_PUBLIC_URL}/${R2_KEY}`,
      })
    }

    return NextResponse.json({ ok: false, error: `tipo inválido: ${tipo}` }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync-jogos-sofa/ingest] Erro:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
