// scripts/sync-natv-manual.js
//
// Sync manual do catálogo NaTV — rodar no seu próprio PC (não na Vercel, não
// na VM). Uso: `node scripts/sync-natv-manual.js` a partir da raiz do repo.
//
// Por quê existe: NaTV passou a bloquear qualquer IP que não seja brasileiro
// de verdade (08/09/2026) — nem a Vercel nem a VM Hetzner (Finlândia)
// conseguem baixar o M3U deles mais, e não tem proxy residencial disponível
// (o único da VM já está ocupado pela sessão do WhatsApp) nem como fazer o
// browser do admin baixar direto (NaTV não manda Access-Control-Allow-Origin,
// então o navegador bloqueia a leitura). O cron automático (pg_cron) foi
// pausado — ver `cron.job.active=false` pra 'sync_catalog_natv_daily'.
//
// O que este script faz:
//   1. Busca o m3u_url do cliente NaTV no Supabase.
//   2. Baixa o M3U direto daqui (seu IP residencial de verdade), simulando
//      um app de IPTV — exatamente como funcionava antes do bloqueio.
//   3. Sobe o conteúdo pro R2 (mesmo bucket que os logs de sync já usam).
//   4. Chama a rota de sempre (app/api/epg/sync-catalog/natv) passando só a
//      chave do R2 — ela lê de lá em vez de tentar baixar ela mesma, e faz
//      o resto (parse + upsert no Supabase) exatamente igual ao fluxo
//      automático de sempre.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
const { Client } = require("pg");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const CLIENT_ID = "f7e0b6e7-e7bb-486f-924c-5fc6704b94e9"; // cliente NaTV
const API_BASE  = "https://unigestor.net.br";
const R2_KEY    = "epg/natv_manual_upload.m3u";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const cronSecret = process.env.EPG_SYNC_CRON_SECRET;
  if (!dbUrl || !cronSecret) {
    console.error("Faltam DATABASE_URL e/ou EPG_SYNC_CRON_SECRET no .env.local");
    process.exit(1);
  }

  console.log("[1/4] Buscando m3u_url do cliente NaTV...");
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const { rows } = await db.query("select m3u_url from clients where id = $1", [CLIENT_ID]);
  await db.end();
  const m3uUrl = rows[0]?.m3u_url;
  if (!m3uUrl) {
    console.error("m3u_url não encontrado pro cliente NaTV.");
    process.exit(1);
  }

  console.log("[2/4] Baixando M3U (seu IP, simulando app de IPTV)...");
  const started = Date.now();
  const resp = await fetch(m3uUrl, {
    headers: { "User-Agent": "IPTVSmartersPro", Accept: "*/*" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) {
    console.error(`Falha ao baixar M3U: HTTP ${resp.status}`);
    console.error("Se isso falhar aqui também, o bloqueio evoluiu — pare e avise.");
    process.exit(1);
  }
  const m3uText = await resp.text();
  console.log(`   ${m3uText.length} bytes baixados em ${Date.now() - started}ms`);

  console.log("[3/4] Subindo pro R2...");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  });
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME || "unigestor-media",
    Key: R2_KEY,
    Body: m3uText,
    ContentType: "text/plain; charset=utf-8",
  }));

  console.log("[4/4] Chamando a rota de sync (parse + upsert no Supabase)...");
  const syncStarted = Date.now();
  const syncResp = await fetch(`${API_BASE}/api/epg/sync-catalog/natv`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ fromR2Key: R2_KEY }),
    signal: AbortSignal.timeout(280_000),
  });
  const result = await syncResp.json().catch(() => ({}));
  const elapsed = Math.round((Date.now() - syncStarted) / 1000);

  if (!syncResp.ok || result.error) {
    console.error(`Sync falhou (${elapsed}s):`, result.error || `HTTP ${syncResp.status}`);
    process.exit(1);
  }
  console.log(`Sync concluído em ${elapsed}s:`, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error("Erro fatal:", e.message);
  process.exit(1);
});
