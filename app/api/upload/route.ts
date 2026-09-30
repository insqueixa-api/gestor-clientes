// app/api/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@/lib/supabase/server";
import { R2_DELETABLE_FOLDERS } from "@/lib/r2-folders";

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

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = formData.get("folder") as string || "geral"; 
    const isPrivate = formData.get("isPrivate") === "true";

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e4)}`;
    // ✅ mesma correção do presign (achado 30/08/2026) — normaliza NFKD e
    // tira só a marca diacrítica antes de filtrar, senão letra acentuada
    // sumia inteira do nome ("Vidamérica" virava "Vidamrica").
    const safeName = file.name
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "")
      .replace(/[^a-zA-Z0-9.-]/g, "");
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

  } catch {
    return NextResponse.json({ error: "Falha ao fazer upload na nuvem." }, { status: 500 });
  }
}

// ✅ Apaga do R2 arquivo(s) que deixaram de ser usados (troca de logo,
// foto removida, edição excluída...). Reescrito 30/09/2026 (achado do
// Márcio: trocar logo só acumulava no R2, nunca apagava a anterior):
// - só aceita URL do bucket PÚBLICO e das pastas que o sistema usa (antes
//   qualquer usuário logado apagava qualquer chave, inclusive do vault);
// - só apaga se r2_url_in_use (docs/sql/r2_url_in_use.sql) disser que
//   nenhuma linha do banco usa mais a URL — protege arquivo compartilhado
//   (ex: foto da Ação copiada pra uma Edição publicada, logo repetida em
//   2 servidores). Quem chama pode pedir sem medo; na dúvida, mantém.
// Body: { url } ou { urls: [] }.

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const urls: string[] = [
      ...(Array.isArray(body?.urls) ? body.urls : []),
      ...(body?.url ? [body.url] : []),
    ]
      .map((u: unknown) => String(u ?? "").trim())
      .filter(Boolean);

    if (urls.length === 0) {
      return NextResponse.json({ error: "URL não informada." }, { status: 400 });
    }

    const publicBase = String(process.env.NEXT_PUBLIC_R2_DEV_URL || "").replace(/\/+$/, "");
    const bucketName = process.env.R2_BUCKET_NAME || "unigestor-media";

    const deleted: string[] = [];
    const kept: string[] = [];
    const rejected: string[] = [];

    for (const url of [...new Set(urls)].slice(0, 50)) {
      if (!publicBase || !url.startsWith(`${publicBase}/`)) {
        rejected.push(url);
        continue;
      }
      const key = decodeURIComponent(url.slice(publicBase.length + 1));
      const folder = key.split("/")[0];
      if (!R2_DELETABLE_FOLDERS.has(folder) || key.includes("..") || key.split("/").length !== 2) {
        rejected.push(url);
        continue;
      }

      const { data: inUse, error: useErr } = await supabase.rpc("r2_url_in_use", { p_url: url });
      if (useErr || inUse !== false) {
        // erro na checagem = não apaga (arquivo órfão é barato, arquivo
        // em uso apagado quebra tela/PDF)
        kept.push(url);
        continue;
      }

      await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
      deleted.push(url);
    }

    return NextResponse.json({ success: true, deleted, kept, rejected });
  } catch {
    return NextResponse.json({ error: "Falha ao excluir arquivo da nuvem." }, { status: 500 });
  }
}
