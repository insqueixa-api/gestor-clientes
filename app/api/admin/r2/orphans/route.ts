// app/api/admin/r2/orphans/route.ts
//
// Varredura de "lixo" no bucket público do R2 (30/09/2026, pedido do
// Márcio: trocar logo nunca apagava a anterior — ficaram arquivos
// acumulados de antes do fix em lib/r2-upload.ts).
//
// Roda aqui (e não por script local) porque as credenciais do R2 são
// "sensitive" na Vercel — não dá pra ler de fora, nem pela API.
//
// GET  → só LISTA os órfãos (nada é apagado)
// POST → { confirm: "APAGAR" } apaga os órfãos listados pelo mesmo critério
//
// Órfão = objeto numa pasta conhecida (lib/r2-folders.ts), com mais de 24h
// (não pega upload de modal ainda aberto), cuja URL não aparece em nenhuma
// coluna do banco (public._r2_refs_blob — mesma fonte de r2_url_in_use).
// Auth: Authorization: Bearer <CRON_SECRET> (mesmo padrão dos crons).
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { isCronRequest } from "@/lib/internal-auth";
import { R2_DELETABLE_FOLDERS } from "@/lib/r2-folders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_AGE_MS = 24 * 60 * 60 * 1000;

function s3() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  });
}

async function scan() {
  const client = s3();
  const bucket = process.env.R2_BUCKET_NAME || "unigestor-media";
  const base = String(process.env.NEXT_PUBLIC_R2_DEV_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_R2_DEV_URL não configurada.");

  const objects: { Key: string; Size: number; LastModified?: Date }[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const o of r.Contents || []) {
      if (o.Key) objects.push({ Key: o.Key, Size: o.Size || 0, LastModified: o.LastModified });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  const supabaseAdmin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: refs, error } = await supabaseAdmin.rpc("_r2_refs_blob");
  if (error || typeof refs !== "string") {
    throw new Error(`Falha ao ler referências do banco: ${error?.message || "vazio"}`);
  }

  const now = Date.now();
  const porPasta: Record<string, { total: number; em_uso: number; orfaos: number; kb_orfaos: number; outros: number }> = {};
  const orfaos: { key: string; kb: number; data: string | null }[] = [];

  for (const o of objects) {
    const folder = o.Key.includes("/") ? o.Key.split("/")[0] : "(raiz)";
    const p = (porPasta[folder] ??= { total: 0, em_uso: 0, orfaos: 0, kb_orfaos: 0, outros: 0 });
    p.total++;

    const url = `${base}/${o.Key}`;
    if (refs.includes(url) || refs.includes(o.Key)) {
      p.em_uso++;
      continue;
    }
    const recente = o.LastModified && now - o.LastModified.getTime() < MIN_AGE_MS;
    if (!R2_DELETABLE_FOLDERS.has(folder) || recente) {
      p.outros++; // pasta desconhecida ou upload recente — nunca apaga
      continue;
    }
    p.orfaos++;
    p.kb_orfaos += Math.round(o.Size / 1024);
    orfaos.push({
      key: o.Key,
      kb: Math.round(o.Size / 1024),
      data: o.LastModified ? o.LastModified.toISOString().slice(0, 10) : null,
    });
  }

  return { client, bucket, total: objects.length, porPasta, orfaos };
}

export async function GET(req: NextRequest) {
  if (!isCronRequest(req, "CRON_SECRET")) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  try {
    const { bucket, total, porPasta, orfaos } = await scan();
    return NextResponse.json({ ok: true, bucket, total, porPasta, orfaos });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isCronRequest(req, "CRON_SECRET")) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({} as any));
  if (body?.confirm !== "APAGAR") {
    return NextResponse.json(
      { ok: false, error: 'Envie { "confirm": "APAGAR" } pra apagar. GET só lista.' },
      { status: 400 },
    );
  }
  try {
    const { client, bucket, orfaos } = await scan();
    const apagados: string[] = [];
    const falhas: string[] = [];
    for (let i = 0; i < orfaos.length; i += 1000) {
      const lote = orfaos.slice(i, i + 1000);
      const r = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: lote.map((o) => ({ Key: o.key })), Quiet: false },
        }),
      );
      for (const d of r.Deleted || []) if (d.Key) apagados.push(d.Key);
      for (const e of r.Errors || []) falhas.push(`${e.Key}: ${e.Message}`);
    }
    return NextResponse.json({ ok: true, apagados: apagados.length, falhas, lista: apagados });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha" }, { status: 500 });
  }
}
