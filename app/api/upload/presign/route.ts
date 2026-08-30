// app/api/upload/presign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@/lib/supabase/server";

const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const { fileName, contentType, folder } = await req.json();

    if (!fileName || !contentType) {
      return NextResponse.json({ error: "fileName e contentType são obrigatórios." }, { status: 400 });
    }

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    // ✅ 30/08/2026, achado do Márcio: apagar tudo fora de a-zA-Z0-9.- direto
    // apagava a LETRA inteira de acento (ex: "é" sumia, "Vidamérica" virava
    // "Vidamrica") — normaliza NFKD e tira só a marca diacrítica antes,
    // mesma receita já usada no serviço de PDF (docs/vm-pdf-service/server.js).
    const safeName = fileName
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "")
      .replace(/[^a-zA-Z0-9.-]/g, "");
    const key = `${folder || "geral"}/${uniqueSuffix}-${safeName}`;
    const bucketName = process.env.R2_BUCKET_NAME || "unigestor-media";

    const presignedUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 300 } // 5 minutos
    );

    const publicUrl = `${process.env.NEXT_PUBLIC_R2_DEV_URL}/${key}`;

    return NextResponse.json({ presignedUrl, publicUrl });
  } catch {
    return NextResponse.json({ error: "Falha ao gerar URL de upload." }, { status: 500 });
  }
}