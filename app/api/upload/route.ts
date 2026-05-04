import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Configuração para aumentar o limite de tamanho do corpo da requisição para 10MB
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = formData.get("folder") as string || "geral"; 
    const isPrivate = formData.get("isPrivate") === "true";

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, ""); 
    const filename = `${folder}/${uniqueSuffix}-${safeName}`;

    const bucketName = isPrivate 
      ? process.env.R2_VAULT_BUCKET_NAME || "unigestor-vault"
      : process.env.R2_BUCKET_NAME || "unigestor-media";

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: filename,
        Body: buffer,
        ContentType: file.type,
      })
    );

    const finalUrl = isPrivate 
      ? filename 
      : `${process.env.NEXT_PUBLIC_R2_DEV_URL}/${filename}`;

    return NextResponse.json({ success: true, url: finalUrl, isPrivate });

  } catch (error: any) {
    console.error("Erro no upload R2:", error);
    return NextResponse.json({ error: "Falha ao fazer upload na nuvem." }, { status: 500 });
  }
}

// ✅ NOVA FUNÇÃO: Deleta o arquivo do Cloudflare R2
export async function DELETE(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "URL não informada." }, { status: 400 });
    }

    // 1. Identifica se o arquivo é público ou privado para escolher o bucket
    const isPublic = url.startsWith(process.env.NEXT_PUBLIC_R2_DEV_URL || "");
    const bucketName = isPublic 
      ? process.env.R2_BUCKET_NAME || "unigestor-media"
      : process.env.R2_VAULT_BUCKET_NAME || "unigestor-vault";

    // 2. Extrai a "Key" (caminho do arquivo) da URL
    let key = url;
    if (isPublic) {
      // Remove a parte da URL base para sobrar apenas o caminho: "pasta/arquivo.jpg"
      key = url.replace(`${process.env.NEXT_PUBLIC_R2_DEV_URL}/`, "");
    }
    
    // Decodifica caracteres especiais (como espaços ou acentos na URL)
    key = decodeURIComponent(key);

    // 3. Comando de exclusão
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );

    return NextResponse.json({ success: true, message: "Arquivo excluído do R2." });

  } catch (error: any) {
    console.error("Erro ao excluir do R2:", error);
    return NextResponse.json({ error: "Falha ao excluir arquivo da nuvem." }, { status: 500 });
  }
}