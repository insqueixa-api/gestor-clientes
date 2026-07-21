// src/fast-r2.js
// Baixa o M3U cru do Fast (IP da VM não é bloqueado — confirmado) e sobe pro
// R2, sempre sobrescrevendo o mesmo arquivo. A Vercel não consegue baixar
// esse M3U direto (IP de datacenter dela é bloqueado, HTTP 403), mas consegue
// ler do R2 numa boa — é só armazenamento, não passa pelo Cloudflare do Fast.
// Sem proxy nenhum: nem aqui (VM já é livre) nem na Vercel (lê do R2, não do
// painel). Substitui o fluxo antigo que mandava os dados já processados em
// ~500 requisições HTTP separadas — agora é só 1 download + 1 upload aqui,
// e o parse/upsert inteiro roda na Vercel numa invocação só (igual NaTV/Elite).
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const R2_KEY = "epg/fast_m3u_raw.m3u";

function getS3Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID     || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  });
}

export async function downloadFastM3uToR2(m3uUrl) {
  console.log("[FAST-R2] Baixando M3U de", m3uUrl.replace(/password=[^&]+/, "password=***"));

  const res = await fetch(m3uUrl, {
    headers: { "User-Agent": "IPTVSmartersPro", "Accept": "*/*" },
  });
  if (!res.ok) {
    throw new Error(`Falha ao baixar M3U: HTTP ${res.status}`);
  }
  const m3uText = await res.text();
  console.log(`[FAST-R2] ${m3uText.length} bytes baixados, subindo pro R2...`);

  const bucket = process.env.R2_BUCKET_NAME || "unigestor-media";
  const s3 = getS3Client();
  await s3.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         R2_KEY,
    Body:        m3uText,
    ContentType: "text/plain; charset=utf-8",
  }));

  console.log(`[FAST-R2] Upload concluído: ${bucket}/${R2_KEY}`);
  return { bytes: m3uText.length, key: R2_KEY, bucket };
}
