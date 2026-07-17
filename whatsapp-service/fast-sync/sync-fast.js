// fast-sync/sync-fast.js
// Baixa o M3U do Fast direto da VM (IP não bloqueado) e envia para a API do Vercel
const https = require('https')
const http  = require('http')
const { parse } = require('url')

const API_BASE  = 'https://unigestor.net.br'
// ✅ Prioriza a variável de ambiente (mesma EPG_SYNC_CRON_SECRET que
// app/api/epg/sync-catalog/fast/route.ts já valida) — o valor literal abaixo
// fica só como fallback, pra não quebrar o cron se a variável não estiver
// definida no ambiente onde esse script roda hoje.
const API_TOKEN = process.env.EPG_SYNC_CRON_SECRET || '5f69b42084838eb6106b5eadea61265a1e3844b27fe4c28720b113bc3ad22f4e'
const LOTE      = 500

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

function post(path, body) {
  const data = JSON.stringify(body)
  return httpFetch(`${API_BASE}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${API_TOKEN}`,
      'Content-Length': Buffer.byteLength(data),
    },
    body: data,
  })
}

function normalizarTitulo(nome) {
  return nome
    .replace(/&amp;/gi, ' E ').replace(/&/g, ' E ')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, '')
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, '')
    .replace(/(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|WEB-DL|WEBRIP|H265|HEVC|REMUX|DIRECTORS?.?CUT)$/gi, '')
    .replace(/\s+(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|BLU-RAY|WEB-DL|WEBRIP|HDRIP|DVDRIP|BDRIP|H265|H\.265|HEVC|REMUX)\s*$/gi, '')
    .replace(/\s*\[L\]\s*/gi, ' ').replace(/\s*\[DUB\]\s*/gi, ' ')
    .replace(/\s+(DUAL AUDIO|DUAL|LEG|DUB|DUBLADO|LEGENDADO)\b/gi, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function main() {
  console.log('[FAST-SYNC] Iniciando —', new Date().toISOString())

  // 1. Busca m3u_url do banco via API
  console.log('[FAST-SYNC] Buscando m3u_url do banco...')
  const configRes = await httpFetch(`${API_BASE}/api/epg/sync-catalog/fast`, {
    headers: { 'Authorization': `Bearer ${API_TOKEN}` },
  })
  if (configRes.status !== 200) {
    console.error(`[FAST-SYNC] Erro ao buscar config: HTTP ${configRes.status}`)
    process.exit(1)
  }
  const config = configRes.json()
  const M3U_URL = config.m3u_url
  if (!M3U_URL) {
    console.error('[FAST-SYNC] m3u_url não encontrado no banco')
    process.exit(1)
  }
  console.log(`[FAST-SYNC] m3u_url: ${M3U_URL.replace(/password=[^&]+/, 'password=***')}`)

  // 2. Baixa M3U
  console.log('[FAST-SYNC] Baixando M3U...')
  const res = await httpFetch(M3U_URL, {
    headers: { 'User-Agent': 'IPTVSmartersPro', 'Accept': '*/*' },
  })
  if (res.status !== 200) {
    console.error(`[FAST-SYNC] Erro ao baixar M3U: HTTP ${res.status}`)
    process.exit(1)
  }
  const m3uText = res.text()
  console.log(`[FAST-SYNC] ${m3uText.length} bytes baixados`)

  // 2. Parseia
  const filmes       = new Map()
  const seriesMaster = new Map()
  const episodios    = []
  let ext = ''

  for (const line of m3uText.split(/\r?\n/)) {
    const l = line.trim()
    if (!l) continue
    if (l.startsWith('#EXTINF')) { ext = l; continue }
    if (!l.startsWith('http') || !ext) continue

    const isFilme = l.includes('/movie/')
    const isSerie = l.includes('/series/')
    if (!isFilme && !isSerie) { ext = ''; continue }

    const tvgNome = ext.match(/tvg-name="([^"]*)"/)?.[1]?.trim() || ''
    const tvgLogo = ext.match(/tvg-logo="([^"]*)"/)?.[1]?.trim() || ''
    const grupo   = ext.match(/group-title="([^"]*)"/)?.[1]?.trim() || ''
    ext = ''

    if (!tvgNome) continue
    const g = grupo.toUpperCase()
    if (g.includes('XXX') || g.includes('ADULTO') || g.includes('ADULT') || g.includes('18+')) continue

    const categoria = grupo.includes(' | ')
      ? grupo.split(' | ').slice(1).join(' | ').trim()
      : grupo.trim()

    if (isFilme) {
      const anoMatch = tvgNome.match(/[\[(](\d{4})[\])]/)?.[1]
      const titulo   = normalizarTitulo(tvgNome.replace(/[\[(]\d{4}[\])]/g, ''))
      if (!titulo || titulo.replace(/[^A-Z0-9]/g, '').length < 2) continue
      if (!filmes.has(titulo) || (!filmes.get(titulo).cover_url && tvgLogo)) {
        filmes.set(titulo, {
          titulo_normalizado: titulo, tipo: 'FILME',
          cover_url: tvgLogo || null,
          ano: anoMatch ? parseInt(anoMatch) : null,
          categoria_origem: categoria,
        })
      }
    } else {
      const seMatch  = tvgNome.match(/S(\d+)\s*E(\d+)/i)
      if (!seMatch) continue
      const anoMatch = tvgNome.match(/[\[(](\d{4})[\])]/)?.[1]
      const titulo   = normalizarTitulo(
        tvgNome.replace(/\s*S\d+\s*E\d+.*/i, '').replace(/[\[(]\d{4}[\])]\s*/g, '')
      )
      if (!titulo || titulo.replace(/[^A-Z0-9]/g, '').length < 2) continue
      if (!seriesMaster.has(titulo) || (!seriesMaster.get(titulo).cover_url && tvgLogo)) {
        seriesMaster.set(titulo, {
          titulo_normalizado: titulo, tipo: 'SERIE',
          cover_url: tvgLogo || null,
          ano: anoMatch ? parseInt(anoMatch) : null,
          categoria_origem: categoria,
        })
      }
      episodios.push({
        titulo_normalizado: titulo,
        temporada: parseInt(seMatch[1]),
        episodio:  parseInt(seMatch[2]),
        cover_url: tvgLogo || null,
      })
    }
  }

  // Deduplica por titulo_normalizado para evitar conflito no upsert
  const masterMap = new Map()
  for (const item of [...filmes.values(), ...seriesMaster.values()]) {
    const key = `${item.titulo_normalizado}|${item.tipo}`
    if (!masterMap.has(key) || (!masterMap.get(key).cover_url && item.cover_url)) {
      masterMap.set(key, item)
    }
  }
  const masterLista = [...masterMap.values()]
  console.log(`[FAST-SYNC] Parse: ${filmes.size} filmes, ${seriesMaster.size} séries, ${episodios.length} episódios`)

  // 3. Snapshot antes
  const iniciarRes = await post('/api/epg/sync-catalog/fast', { tipo: 'iniciar' })
  const { totalAvailAntes, totalEpisodiosAntes } = iniciarRes.json()
  console.log(`[FAST-SYNC] Snapshot antes: ${totalAvailAntes} títulos, ${totalEpisodiosAntes} episódios`)

  // 4. Master em lotes
  console.log(`[FAST-SYNC] Enviando ${masterLista.length} títulos master...`)
  for (let i = 0; i < masterLista.length; i += LOTE) {
    const r = await post('/api/epg/sync-catalog/fast', { tipo: 'master', lote: masterLista.slice(i, i + LOTE) })
    process.stdout.write(`\r  master: ${Math.min(i + LOTE, masterLista.length)}/${masterLista.length}   `)
    if (r.status !== 200) {
      console.error(`\n[FAST-SYNC] Erro no lote master ${i}:`, r.text())
      process.exit(1)
    }
  }
  console.log()

  // 5. Episódios em lotes
  console.log(`[FAST-SYNC] Enviando ${episodios.length} episódios...`)
  for (let i = 0; i < episodios.length; i += LOTE) {
    const r = await post('/api/epg/sync-catalog/fast', { tipo: 'episodios', lote: episodios.slice(i, i + LOTE) })
    process.stdout.write(`\r  episódios: ${Math.min(i + LOTE, episodios.length)}/${episodios.length}   `)
    if (r.status !== 200) {
      console.error(`\n[FAST-SYNC] Erro no lote episódios ${i}:`, r.text())
      process.exit(1)
    }
  }
  console.log()

  // 6. Finaliza
  console.log('[FAST-SYNC] Finalizando...')
  const finRes = await post('/api/epg/sync-catalog/fast', {
    tipo: 'finalizar',
    stats: { filmes: filmes.size, series: seriesMaster.size, episodios: episodios.length },
    totalAvailAntes,
    totalEpisodiosAntes,
  })
  const result = finRes.json()
  console.log('[FAST-SYNC] Concluído:', JSON.stringify(result, null, 2))
}

main().catch(e => {
  console.error('[FAST-SYNC] Erro fatal:', e.message)
  process.exit(1)
})