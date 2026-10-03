// lib/r2-server.ts
// Upload pro R2 feito pelo SERVIDOR (sem presign/navegador) — ex: o sync da
// AtivaApp copiando a logo de cada app pro nosso bucket (03/10/2026). Mesma
// configuração de app/api/upload/presign/route.ts; mesmo cache longo
// (nome único por upload, conteúdo nunca muda na mesma URL).
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { R2_PUBLIC_CACHE_CONTROL } from "@/lib/r2-folders";

let client: S3Client | null = null;
function s3() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return client;
}

/** Sobe um arquivo pra `${folder}/${timestamp}-${aleatório}-${nome}` e devolve a URL pública. */
export async function uploadBufferToR2(
  body: Uint8Array,
  folder: string,
  fileName: string,
  contentType: string,
): Promise<string> {
  const safeName = fileName
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^a-zA-Z0-9.-]/g, "")
    .slice(0, 60) || "arquivo";
  const key = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e4)}-${safeName}`;
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME || "unigestor-media",
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: R2_PUBLIC_CACHE_CONTROL,
    }),
  );
  return `${process.env.NEXT_PUBLIC_R2_DEV_URL}/${key}`;
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/**
 * Baixa uma imagem de fora e copia pro R2. Só aceita imagem de verdade e até
 * 3 MB; qualquer problema devolve null (quem chama segue com a URL de fora).
 */
export async function copyRemoteImageToR2(url: string, folder: string, baseName: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = IMAGE_EXT[contentType];
    if (!ext) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > 3 * 1024 * 1024) return null;
    return await uploadBufferToR2(buf, folder, `${baseName}.${ext}`, contentType);
  } catch {
    return null;
  }
}
