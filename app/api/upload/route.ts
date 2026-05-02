import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// 1. Inicializamos o cliente de conexão com o seu cofre (as chaves do .env)
const s3Client = new S3Client({
  region: "auto", // O Cloudflare R2 sempre usa "auto"
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export async function POST(req: NextRequest) {
  try {
    // 2. Recebemos os dados enviados pelo formulário
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    
    // Pegamos qual é o módulo/contexto e se é privado
    const folder = formData.get("folder") as string || "geral"; 
    const isPrivate = formData.get("isPrivate") === "true"; // ✅ NOVO: Flag de privacidade

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    // 3. Transformamos o arquivo em Buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    
    // 4. Criamos um nome único
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, ""); 
    const filename = `${folder}/${uniqueSuffix}-${safeName}`;

    // ✅ NOVO: Lógica que decide a gaveta com base no "isPrivate"
    const bucketName = isPrivate 
      ? process.env.R2_VAULT_BUCKET_NAME || "unigestor-vault"
      : process.env.R2_BUCKET_NAME || "unigestor-media";

    // 5. Mandamos o arquivo para o Cloudflare
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: filename,
        Body: buffer,
        ContentType: file.type,
      })
    );

    // ✅ NOVO: Se for privado, devolve só o nome do arquivo. Se for público, devolve a URL completa.
    const finalUrl = isPrivate 
      ? filename // Salva só o caminho no banco (ex: contratos/123-doc.pdf)
      : `${process.env.NEXT_PUBLIC_R2_DEV_URL}/${filename}`;

    return NextResponse.json({ success: true, url: finalUrl, isPrivate });

  } catch (error: any) {
    console.error("Erro no upload R2:", error);
    return NextResponse.json({ error: "Falha ao fazer upload na nuvem." }, { status: 500 });
  }
}