// app/api/admin/condominio/purge-pdfs/route.ts
// Cron diário (pg_cron, ver docs/sql/condominio_pdf_purge_cron.sql) — apaga
// do R2 os PDFs de Edições publicadas há mais de 6 meses e limpa a
// referência (condominio_edicoes.pdf_url = null). A linha da edição em si
// não é apagada, só o arquivo — mantém o histórico consultável mesmo sem
// o PDF baixável. Mesmo padrão de auth de cron (isCronRequest) e de delete
// no R2 (S3Client/DeleteObjectCommand) já usados no projeto (ver
// app/api/finance/snapshot-previsao/route.ts e app/api/upload/route.ts).
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { isCronRequest } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export async function POST(req: NextRequest) {
  if (!isCronRequest(req, "PDF_PURGE_CRON_SECRET")) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const seisMesesAtras = new Date();
  seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);

  const { data: edicoes, error } = await supabaseAdmin
    .from("condominio_edicoes")
    .select("id, pdf_url")
    .not("pdf_url", "is", null)
    .lt("published_at", seisMesesAtras.toISOString());

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let apagados = 0;
  const falhas: string[] = [];

  for (const edicao of edicoes || []) {
    try {
      const key = String(edicao.pdf_url).replace(
        `${process.env.NEXT_PUBLIC_R2_DEV_URL}/`,
        "",
      );
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME || "unigestor-media",
          Key: key,
        }),
      );
      const { error: updErr } = await supabaseAdmin
        .from("condominio_edicoes")
        .update({ pdf_url: null })
        .eq("id", edicao.id);
      if (updErr) throw updErr;
      apagados++;
    } catch (e: any) {
      falhas.push(`${edicao.id}: ${e?.message || e}`);
    }
  }

  return NextResponse.json({ ok: true, apagados, total: edicoes?.length || 0, falhas });
}
