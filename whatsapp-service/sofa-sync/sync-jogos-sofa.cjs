// sofa-sync/sync-jogos-sofa.cjs
// Busca "Jogos do Dia" no Sofascore (fonte ÚNICA, substitui 365scores) e envia
// os lotes prontos pra API do Vercel gravar (Supabase + R2). Mesmo padrão do
// fast-sync/sync-fast.cjs: a VM só busca e normaliza, o Vercel só grava.
// Roda direto na VM porque o volume de chamadas (1 request de country-channels
// POR JOGO candidato, sem endpoint em lote) não cabe no timeout de uma função
// serverless nem deveria ser disparado em rajada.

const https = require('https')
const http  = require('http')
const { parse } = require('url')

const API_BASE  = 'https://unigestor.net.br'
// ⚠️ MESMO VALOR da env var EPG_SYNC_CRON_SECRET configurada no Vercel — cole
// o valor real aqui antes de enviar pra VM. Se preferir, também dá pra ler de
// process.env (exportando antes do node no crontab), mas sigo aqui o mesmo
// padrão hardcoded que o sync-fast.cjs já usa pro API_TOKEN.
const SYNC_SECRET = '5f69b42084838eb6106b5eadea61265a1e3844b27fe4c28720b113bc3ad22f4e'

const LOTE = 300 // tamanho do lote enviado por POST — mesma ideia do LOTE=500 do fast-sync

const SOFA_BASE = 'https://www.sofascore.com/api/v1'
const UTC_OFFSET = '-10800' // America/Sao_Paulo, sem DST desde 2019

const SOFA_HEADERS = {
  'accept': '*/*',
  'accept-language': 'pt-BR,pt;q=0.9',
  'referer': 'https://www.sofascore.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
}

// IDs nativos de esporte do Sofascore (confirmados). Só os que seguem o fluxo
// liga/rodada (categorias → uniqueTournament → scheduled-events). Tênis, MMA,
// motorsport, boxe, snooker, badminton, table-tennis, esports usam torneio
// individual/chaveamento — fluxo diferente, fica pra depois de validar.
const SOFA_SPORTS = [
  { slug: 'football', sportId: 1 },
  { slug: 'basketball', sportId: 2 },
  { slug: 'ice-hockey', sportId: 4 },
  { slug: 'handball', sportId: 6 },
  { slug: 'volleyball', sportId: 23 },
  { slug: 'american-football', sportId: 63 },
  { slug: 'baseball', sportId: 64 },
  { slug: 'cricket', sportId: 62 },
]

// Ritmo de chamadas contra o Sofascore — ajustar conforme o primeiro run real
// (ver log de HTTP != 200; se aparecer 403/429, baixar SOFA_CONCURRENCY e/ou
// subir SOFA_DELAY_MS).
const SOFA_CONCURRENCY = 8
const SOFA_DELAY_MS = 150

// ─── HTTP genérico (idêntico em espírito ao sync-fast.cjs) ─────────────────────

function httpFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = parse(url)
    const lib     = url.startsWith('https') ? https : http
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.path,
      method:   opts.method || 'GET',
      headers:  opts.headers || {},
    }
    const req = lib.request(options, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode,
          text:   () => text,
          json:   () => JSON.parse(text),
        })
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

function sofaGet(path) {
  return httpFetch(`${SOFA_BASE}${path}`, { headers: SOFA_HEADERS })
}

function postIngest(tipo, extra = {}) {
  const data = JSON.stringify({ tipo, ...extra })
  return httpFetch(`${API_BASE}/api/epg/sync/sync-jogos`, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${SYNC_SECRET}`,
      'Content-Length': Buffer.byteLength(data),
    },
    body: data,
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function pLimit(tasks, limit, delayMs) {
  const results = []
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift()
      if (task) {
        results.push(await task())
        if (delayMs > 0) await sleep(delayMs)
      }
    }
  })
  await Promise.all(workers)
  return results
}

function formatDateISO(date) {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear()
  return `${y}-${m}-${d}`
}

function toStatusGroup(statusType) {
  switch (statusType) {
    case 'inprogress': return 3
    case 'finished':   return 4
    case 'notstarted': return 1
    default:           return 1
  }
}

// ─── Fetchers Sofascore ─────────────────────────────────────────────────────────

async function fetchBRChannelsMap() {
  const res = await sofaGet('/tv/country/BR/channels')
  const map = new Map()
  if (res.status === 200) {
    const data = res.json()
    for (const ch of data.channels ?? []) {
      if (ch?.id != null && ch?.name) map.set(ch.id, ch.name)
    }
  } else {
    console.error(`[SOFA-SYNC] Falha ao buscar canais BR: HTTP ${res.status}`)
  }
  return map
}

async function fetchUniqueTournamentIds(sportSlug, date) {
  try {
    const res = await sofaGet(`/sport/${sportSlug}/${date}/${UTC_OFFSET}/categories`)
    if (res.status !== 200) {
      console.warn(`[SOFA-SYNC] categorias ${sportSlug}/${date}: HTTP ${res.status}`)
      return []
    }
    const data = res.json()
    const ids = new Set()
    for (const c of data.categories ?? []) {
      for (const id of c.uniqueTournamentIds ?? []) ids.add(id)
    }
    return [...ids]
  } catch (e) {
    console.warn(`[SOFA-SYNC] Falha categorias ${sportSlug}/${date}:`, e.message)
    return []
  }
}

async function fetchTournamentEvents(uniqueTournamentId, date) {
  try {
    const res = await sofaGet(`/unique-tournament/${uniqueTournamentId}/scheduled-events/${date}`)
    if (res.status !== 200) return []
    return res.json().events ?? []
  } catch (e) {
    console.warn(`[SOFA-SYNC] Falha eventos torneio ${uniqueTournamentId}/${date}:`, e.message)
    return []
  }
}

async function fetchEventBRChannelIds(eventId) {
  try {
    const res = await sofaGet(`/tv/event/${eventId}/country-channels`)
    if (res.status !== 200) return []
    return res.json()?.countryChannels?.BR ?? []
  } catch {
    return []
  }
}

// ─── Montagem do registro final (mesmo shape que a rota de ingest espera) ─────

function toJogoDia(ev, sportId, canaisBR, canaisMap) {
  const stageNome = ev.roundInfo?.name ?? (ev.roundInfo?.round ? `Rodada ${ev.roundInfo.round}` : null)
  return {
    game_id: ev.id,
    sport_id: sportId,
    competition_id: ev.tournament?.uniqueTournament?.id ?? 0,
    competition_nome: ev.tournament?.uniqueTournament?.name ?? ev.tournament?.name ?? 'Sofascore',
    stage_nome: stageNome,
    home_id: ev.homeTeam.id,
    home_nome: ev.homeTeam.name,
    home_color: ev.homeTeam.teamColors?.primary ?? null,
    away_id: ev.awayTeam.id,
    away_nome: ev.awayTeam.name,
    away_color: ev.awayTeam.teamColors?.primary ?? null,
    data_hora: new Date(ev.startTimestamp * 1000).toISOString(),
    status_group: toStatusGroup(ev.status?.type),
    status_text: ev.status?.description ?? null,
    score_home: ev.homeScore?.current ?? null,
    score_away: ev.awayScore?.current ?? null,
    tv_networks: canaisBR.map((id) => ({ id, name: canaisMap.get(id) ?? `Canal ${id}` })),
    venue: ev.venue?.stadium?.name ?? ev.venue?.name ?? null,
    atualizado_em: new Date().toISOString(),
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const inicioExec = Date.now()
  const agora = new Date()
  const hoje = formatDateISO(agora)
  const amanha = new Date(agora)
  amanha.setDate(amanha.getDate() + 1)
  const dataAmanha = formatDateISO(amanha)

  console.log(`[SOFA-SYNC] Iniciando —`, new Date().toISOString(), `(${hoje} + ${dataAmanha})`)

  // 1. Canais BR
  const canaisMap = await fetchBRChannelsMap()
  console.log(`[SOFA-SYNC] ${canaisMap.size} canais BR carregados`)

  // 2. Torneios únicos por esporte (todas as categorias, sem filtro de país)
  const tarefasTorneios = SOFA_SPORTS.map(({ slug, sportId }) => async () => {
    const [idsHoje, idsAmanha] = await Promise.all([
      fetchUniqueTournamentIds(slug, hoje),
      fetchUniqueTournamentIds(slug, dataAmanha),
    ])
    const ids = [...new Set([...idsHoje, ...idsAmanha])]
    console.log(`[SOFA-SYNC] ${slug}: ${ids.length} torneios únicos`)
    return ids.map((id) => ({ sportId, tid: id }))
  })
  const torneios = (await pLimit(tarefasTorneios, SOFA_SPORTS.length, 0)).flat()
  console.log(`[SOFA-SYNC] Total de torneios a consultar: ${torneios.length}`)

  // 3. Eventos de cada torneio (hoje + amanhã), ritmo controlado
  const tarefasEventos = torneios.map(({ sportId, tid }) => async () => {
    const [eHoje, eAmanha] = await Promise.all([
      fetchTournamentEvents(tid, hoje),
      fetchTournamentEvents(tid, dataAmanha),
    ])
    return [...eHoje, ...eAmanha].map((ev) => ({ ev, sportId }))
  })
  const eventosBrutos = (await pLimit(tarefasEventos, SOFA_CONCURRENCY, SOFA_DELAY_MS)).flat()
  const eventosUnicos = [...new Map(eventosBrutos.map((e) => [e.ev.id, e])).values()]
  console.log(`[SOFA-SYNC] ${eventosUnicos.length} eventos únicos no total`)

  if (eventosUnicos.length === 0) {
    console.log('[SOFA-SYNC] Nenhum evento encontrado — encerrando sem chamar a API')
    return
  }

  // 4. Canais BR por evento — é aqui que mora o volume real de chamadas
  const tarefasCanais = eventosUnicos.map(({ ev }) => async () => fetchEventBRChannelIds(ev.id))
  const canaisPorEvento = await pLimit(tarefasCanais, SOFA_CONCURRENCY, SOFA_DELAY_MS)

  const comCanalBR = eventosUnicos
    .map((item, i) => ({ ...item, canaisBR: canaisPorEvento[i] }))
    .filter((item) => item.canaisBR.length > 0)

  console.log(`[SOFA-SYNC] ${comCanalBR.length}/${eventosUnicos.length} eventos com transmissão no Brasil`)

  const jogos = comCanalBR.map(({ ev, sportId, canaisBR }) => toJogoDia(ev, sportId, canaisBR, canaisMap))

  // 5. Envia pra API do Vercel gravar: iniciar → lotes → finalizar
  console.log('[SOFA-SYNC] Chamando "iniciar" na API...')
  const rIniciar = await postIngest('iniciar')
  if (rIniciar.status !== 200) {
    console.error('[SOFA-SYNC] Erro no "iniciar":', rIniciar.text())
    process.exit(1)
  }

  console.log(`[SOFA-SYNC] Enviando ${jogos.length} jogos em lotes de ${LOTE}...`)
  for (let i = 0; i < jogos.length; i += LOTE) {
    const lote = jogos.slice(i, i + LOTE)
    const r = await postIngest('lote', { lote })
    process.stdout.write(`\r  lote: ${Math.min(i + LOTE, jogos.length)}/${jogos.length}   `)
    if (r.status !== 200) {
      console.error(`\n[SOFA-SYNC] Erro no lote ${i}:`, r.text())
      process.exit(1)
    }
  }
  console.log()

  console.log('[SOFA-SYNC] Chamando "finalizar" na API...')
  const rFinal = await postIngest('finalizar')
  if (rFinal.status !== 200) {
    console.error('[SOFA-SYNC] Erro no "finalizar":', rFinal.text())
    process.exit(1)
  }

  const duracaoSeg = ((Date.now() - inicioExec) / 1000).toFixed(1)
  console.log('[SOFA-SYNC] Concluído:', rFinal.text(), `(${duracaoSeg}s de execução)`)
}

main().catch(e => {
  console.error('[SOFA-SYNC] Erro fatal:', e.message)
  process.exit(1)
})
