// fast-sync/sync-fast.cjs
// Script do cron (roda 1x/dia via crontab da VM, 3h Brasília). Só orquestra
// os 2 passos — a lógica de verdade mora em src/fast-r2.js (download+upload)
// e na rota /api/epg/sync-catalog/fast na Vercel (parse+upsert). Sem proxy,
// sem mandar dado em centenas de requisições — isso aqui é só 2 chamadas.
const API_BASE  = 'https://unigestor.net.br'
const API_TOKEN = process.env.EPG_SYNC_CRON_SECRET || '5f69b42084838eb6106b5eadea61265a1e3844b27fe4c28720b113bc3ad22f4e'

async function main() {
  console.log('[FAST-SYNC] Iniciando —', new Date().toISOString())

  // 1. Busca m3u_url do banco (via API, já autenticada com o secret de cron)
  console.log('[FAST-SYNC] Buscando m3u_url do banco...')
  const configRes = await fetch(`${API_BASE}/api/epg/sync-catalog/fast`, {
    headers: { 'Authorization': `Bearer ${API_TOKEN}` },
  })
  if (!configRes.ok) {
    console.error(`[FAST-SYNC] Erro ao buscar config: HTTP ${configRes.status}`)
    process.exit(1)
  }
  const config = await configRes.json()
  if (!config.m3u_url) {
    console.error('[FAST-SYNC] m3u_url não encontrado no banco')
    process.exit(1)
  }

  // 2. Passo 1: baixa o M3U (direto, IP da VM não é bloqueado) e sobe pro R2
  const { downloadFastM3uToR2 } = await import('../src/fast-r2.js')
  try {
    const r2Result = await downloadFastM3uToR2(config.m3u_url)
    console.log(`[FAST-SYNC] Passo 1 ok: ${r2Result.bytes} bytes em ${r2Result.bucket}/${r2Result.key}`)
  } catch (e) {
    console.error('[FAST-SYNC] Passo 1 (download→R2) falhou:', e.message)
    process.exit(1)
  }

  // 3. Passo 2: manda a Vercel ler do R2, parsear e gravar no banco
  console.log('[FAST-SYNC] Passo 2: acionando processamento na Vercel...')
  const processRes = await fetch(`${API_BASE}/api/epg/sync-catalog/fast`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}` },
  })
  const result = await processRes.json().catch(() => ({}))
  if (!processRes.ok || result.error) {
    console.error('[FAST-SYNC] Passo 2 (processar) falhou:', result.error || `HTTP ${processRes.status}`)
    process.exit(1)
  }

  console.log('[FAST-SYNC] Concluído:', JSON.stringify(result, null, 2))
}

main().catch(e => {
  console.error('[FAST-SYNC] Erro fatal:', e.message)
  process.exit(1)
})
