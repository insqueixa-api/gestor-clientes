import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
    const { fileName, contentType, folder } = await req.json();

    if (!fileName || !contentType) {
      return NextResponse.json({ error: "fileName e contentType são obrigatórios." }, { status: 400 });
    }

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, "");
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
  } catch (error: any) {
    console.error("Erro ao gerar presigned URL:", error);
    return NextResponse.json({ error: "Falha ao gerar URL de upload." }, { status: 500 });
  }
}