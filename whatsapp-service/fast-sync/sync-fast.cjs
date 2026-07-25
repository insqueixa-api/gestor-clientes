// fast-sync/sync-fast.cjs
// Wrapper do cron (roda 1x/dia via crontab da VM, 3h Brasília) — só pra
// manter o log em fast-sync/sync.log. A lógica de verdade é toda na Vercel
// (app/api/epg/sync-catalog/fast), que busca o M3U através do relay desta
// própria VM (POST /fast-sync/proxy-m3u) numa única chamada — sem R2, sem
// proxy residencial, sem mandar dado de volta em centenas de requisições.
const API_BASE  = 'https://unigestor.net.br'
const API_TOKEN = process.env.EPG_SYNC_CRON_SECRET

async function main() {
  if (!API_TOKEN) {
    console.error('[FAST-SYNC] FATAL: EPG_SYNC_CRON_SECRET não definido no ambiente')
    process.exit(1)
  }
  console.log('[FAST-SYNC] Iniciando —', new Date().toISOString())

  const res = await fetch(`${API_BASE}/api/epg/sync-catalog/fast`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}` },
  })
  const result = await res.json().catch(() => ({}))

  if (!res.ok || result.error) {
    console.error('[FAST-SYNC] Falhou:', result.error || `HTTP ${res.status}`)
    process.exit(1)
  }

  console.log('[FAST-SYNC] Concluído:', JSON.stringify(result, null, 2))
}

main().catch(e => {
  console.error('[FAST-SYNC] Erro fatal:', e.message)
  process.exit(1)
})
