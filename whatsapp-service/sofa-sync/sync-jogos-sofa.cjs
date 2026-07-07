// sofa-sync/sync-jogos-sofa.cjs
//
// Busca "Jogos do Dia" no Sofascore (fonte ÚNICA, substitui 365scores) e envia
// os lotes prontos pra API do Vercel gravar (Supabase + R2).
//
// ⚠️ MUDANÇA IMPORTANTE (v2): chamadas HTTP simples (curl, Node https/fetch)
// levam 403 do Sofascore mesmo com headers de navegador corretos — confirmado
// que NÃO é bloqueio de IP (testado da VM e de uma rede residencial, os dois
// levaram 403 idêntico). É bloqueio por fingerprint de TLS/HTTP2, que só um
// motor de navegador real reproduz corretamente. Por isso agora usamos
// Puppeteer (Chromium headless): as chamadas à API do Sofascore rodam DENTRO
// de uma página real, via fetch() no contexto do navegador. O envio pra API
// do Vercel (seu próprio servidor) continua via https puro — não tem
// fingerprinting lá, isso não muda.
//
// ─── SETUP (uma vez, antes do primeiro run) ─────────────────────────────────────
//
// 1) Dependências de sistema do Chromium (Ubuntu 24.04):
//    sudo apt-get update && sudo apt-get install -y \
//      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
//      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
//      libpango-1.0-0 libpangocairo-1.0-0 libgtk-3-0
//
// 2) Instalar o Puppeteer (usa o package.json que te mandei junto, isolado do
//    package.json principal do whatsapp-service):
//    cd /opt/whatsapp-service/sofa-sync
//    npm install
//    (isso baixa o Chromium sozinho, ~200MB — normal demorar um pouco)
//
// 3) Rodar manualmente pra validar antes de por no cron:
//    node sync-jogos-sofa.cjs

const https = require('https')
const http  = require('http')
const { parse } = require('url')
const puppeteer = require('puppeteer')

const API_BASE  = 'https://unigestor.net.br'
// ⚠️ MESMO VALOR da env var EPG_SYNC_CRON_SECRET configurada no Vercel.
const SYNC_SECRET = 'COLE_AQUI_O_VALOR_DE_EPG_SYNC_CRON_SECRET'

const LOTE = 300 // tamanho do lote enviado por POST

const SOFA_BASE = 'https://www.sofascore.com/api/v1'
const UTC_OFFSET = '-10800' // America/Sao_Paulo, sem DST desde 2019

// IDs nativos de esporte do Sofascore (confirmados). Só os que seguem o fluxo
// liga/rodada (categorias → uniqueTournament → scheduled-events).
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

// Ritmo de chamadas — mesmo com Chromium real, mantemos pacing conservador no
// primeiro run. Se passar limpo sem 403, dá pra afrouxar depois.
const SOFA_CONCURRENCY = 4
const SOFA_DELAY_MS = 300

// ─── HTTP genérico (só usado pra falar com a SUA própria API, sem fingerprint) ──

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
        resolve({ status: res.statusCode, text: () => text, json: () => JSON.parse(text) })
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
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

// ─── Fetch via Chromium real (contorna o fingerprint) ──────────────────────────

// Roda fetch() DENTRO da página do navegador — é o motor de rede do Chromium
// fazendo a chamada, não o Node. Retorna {status, body} ou null em erro de rede.
async function sofaFetchBrowser(page, path) {
  const url = `${SOFA_BASE}${path}`
  try {
    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u)
        const text = await res.text()
        return { status: res.status, body: text }
      } catch (e) {
        return { status: 0, body: '', erro: String(e) }
      }
    }, url)
    return result
  } catch (e) {
    console.warn(`[SOFA-SYNC] Falha no fetch via browser (${path}):`, e.message)
    return { status: 0, body: '' }
  }
}

async function fetchBRChannelsMap(page) {
  const map = new Map()
  const r = await sofaFetchBrowser(page, '/tv/country/BR/channels')
  if (r.status !== 200) {
    console.error(`[SOFA-SYNC] Falha ao buscar canais BR: HTTP ${r.status}`)
    return map
  }
  try {
    const data = JSON.parse(r.body)
    for (const ch of data.channels ?? []) {
      if (ch?.id != null && ch?.name) map.set(ch.id, ch.name)
    }
  } catch (e) {
    console.error('[SOFA-SYNC] Erro ao parsear canais BR:', e.message)
  }
  return map
}

async function fetchUniqueTournamentIds(page, sportSlug, date) {
  const r = await sofaFetchBrowser(page, `/sport/${sportSlug}/${date}/${UTC_OFFSET}/categories`)
  if (r.status !== 200) {
    console.warn(`[SOFA-SYNC] categorias ${sportSlug}/${date}: HTTP ${r.status}`)
    return []
  }
  try {
    const data = JSON.parse(r.body)
    const ids = new Set()
    for (const c of data.categories ?? []) {
      for (const id of c.uniqueTournamentIds ?? []) ids.add(id)
    }
    return [...ids]
  } catch (e) {
    console.warn(`[SOFA-SYNC] Erro ao parsear categorias ${sportSlug}/${date}:`, e.message)
    return []
  }
}

async function fetchTournamentEvents(page, uniqueTournamentId, date) {
  const r = await sofaFetchBrowser(page, `/unique-tournament/${uniqueTournamentId}/scheduled-events/${date}`)
  if (r.status !== 200) return []
  try {
    return JSON.parse(r.body).events ?? []
  } catch {
    return []
  }
}

async function fetchEventBRChannelIds(page, eventId) {
  const r = await sofaFetchBrowser(page, `/tv/event/${eventId}/country-channels`)
  if (r.status !== 200) return []
  try {
    return JSON.parse(r.body)?.countryChannels?.BR ?? []
  } catch {
    return []
  }
}

// ─── Montagem do registro final ────────────────────────────────────────────────

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

  console.log('[SOFA-SYNC] Abrindo Chromium headless...')
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    // Navega pro domínio real primeiro — estabelece origem/cookies como um
    // acesso normal de navegador antes de disparar as chamadas de API.
    await page.goto('https://www.sofascore.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(1000)

    // 1. Canais BR
    const canaisMap = await fetchBRChannelsMap(page)
    console.log(`[SOFA-SYNC] ${canaisMap.size} canais BR carregados`)

    if (canaisMap.size === 0) {
      console.error('[SOFA-SYNC] Não conseguiu carregar canais BR — abortando (provável bloqueio ainda ativo)')
      await browser.close()
      process.exit(1)
    }

    // 2. Torneios únicos por esporte (sequencial por esporte pra não sobrecarregar a página)
    const torneios = []
    for (const { slug, sportId } of SOFA_SPORTS) {
      const idsHoje = await fetchUniqueTournamentIds(page, slug, hoje)
      const idsAmanha = await fetchUniqueTournamentIds(page, slug, dataAmanha)
      const ids = [...new Set([...idsHoje, ...idsAmanha])]
      console.log(`[SOFA-SYNC] ${slug}: ${ids.length} torneios únicos`)
      for (const id of ids) torneios.push({ sportId, tid: id })
      await sleep(SOFA_DELAY_MS)
    }
    console.log(`[SOFA-SYNC] Total de torneios a consultar: ${torneios.length}`)

    // 3. Eventos de cada torneio (hoje + amanhã), ritmo controlado
    const tarefasEventos = torneios.map(({ sportId, tid }) => async () => {
      const eHoje = await fetchTournamentEvents(page, tid, hoje)
      const eAmanha = await fetchTournamentEvents(page, tid, dataAmanha)
      return [...eHoje, ...eAmanha].map((ev) => ({ ev, sportId }))
    })
    const eventosBrutos = (await pLimit(tarefasEventos, SOFA_CONCURRENCY, SOFA_DELAY_MS)).flat()
    const eventosUnicos = [...new Map(eventosBrutos.map((e) => [e.ev.id, e])).values()]
    console.log(`[SOFA-SYNC] ${eventosUnicos.length} eventos únicos no total`)

    if (eventosUnicos.length === 0) {
      console.log('[SOFA-SYNC] Nenhum evento encontrado — encerrando sem chamar a API')
      await browser.close()
      return
    }

    // 4. Canais BR por evento
    const tarefasCanais = eventosUnicos.map(({ ev }) => async () => fetchEventBRChannelIds(page, ev.id))
    const canaisPorEvento = await pLimit(tarefasCanais, SOFA_CONCURRENCY, SOFA_DELAY_MS)

    const comCanalBR = eventosUnicos
      .map((item, i) => ({ ...item, canaisBR: canaisPorEvento[i] }))
      .filter((item) => item.canaisBR.length > 0)

    console.log(`[SOFA-SYNC] ${comCanalBR.length}/${eventosUnicos.length} eventos com transmissão no Brasil`)

    const jogos = comCanalBR.map(({ ev, sportId, canaisBR }) => toJogoDia(ev, sportId, canaisBR, canaisMap))

    await browser.close()
    console.log('[SOFA-SYNC] Chromium fechado, enviando dados pra API...')

    // 5. Envia pra API do Vercel gravar: iniciar → lotes → finalizar
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

    const rFinal = await postIngest('finalizar')
    if (rFinal.status !== 200) {
      console.error('[SOFA-SYNC] Erro no "finalizar":', rFinal.text())
      process.exit(1)
    }

    const duracaoSeg = ((Date.now() - inicioExec) / 1000).toFixed(1)
    console.log('[SOFA-SYNC] Concluído:', rFinal.text(), `(${duracaoSeg}s de execução)`)
  } catch (e) {
    await browser.close().catch(() => {})
    throw e
  }
}

main().catch(e => {
  console.error('[SOFA-SYNC] Erro fatal:', e.message)
  process.exit(1)
})
