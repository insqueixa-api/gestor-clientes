import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// R2 client
// ============================================================

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || "unigestor-media";
const PUBLIC_BASE = String(process.env.NEXT_PUBLIC_R2_DEV_URL || "").replace(/\/$/, "");

/**
 * Extrai o "key" do R2 a partir da URL pública.
 * Espera URLs como: https://<PUBLIC_BASE>/<folder>/<arquivo.ext>
 * Retorna o trecho após PUBLIC_BASE/.
 */
function urlToR2Key(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  if (!PUBLIC_BASE) return null;
  if (!url.startsWith(PUBLIC_BASE)) return null;
  const rest = url.slice(PUBLIC_BASE.length).replace(/^\/+/, "");
  return rest || null;
}

// ============================================================
// POST
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // 1) Auth básica
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
    }

    // 2) Role check — só SUPERADMIN ou MASTER pode deletar tenant
    const { data: roleData } = await supabase.rpc("saas_my_role");
    const role = String(roleData ?? "USER").toUpperCase();
    if (role !== "SUPERADMIN" && role !== "MASTER") {
      return NextResponse.json({ ok: false, error: "Sem permissão." }, { status: 403 });
    }

    // 3) Body
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body?.tenant_id ?? "").trim();
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenant_id obrigatório." }, { status: 400 });
    }

    // 4) Chama RPC — retorna text[] com URLs do R2
    const { data: urls, error: rpcErr } = await supabase.rpc("saas_delete_tenant", {
      p_tenant_id: tenantId,
    });

    if (rpcErr) {
      console.error("[saas-delete-tenant] RPC falhou:", rpcErr.message);
      return NextResponse.json(
        { ok: false, error: rpcErr.message || "Falha ao deletar tenant." },
        { status: 500 }
      );
    }

    // 5) Cleanup R2 (best-effort — não falha se R2 tiver problema)
    const urlsList: string[] = Array.isArray(urls) ? urls : [];
    let deleted = 0;
    let failed = 0;
    const failedKeys: string[] = [];

    for (const url of urlsList) {
      const key = urlToR2Key(url);
      if (!key) continue;
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        deleted++;
      } catch (e: any) {
        failed++;
        failedKeys.push(key);
        console.error("[saas-delete-tenant] R2 delete falhou:", key, e?.message);
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        tenant_id: tenantId,
        r2_total:   urlsList.length,
        r2_deleted: deleted,
        r2_failed:  failed,
        ...(failed > 0 ? { r2_failed_keys: failedKeys } : {}),
      },
    });
  } catch (err: any) {
    console.error("[saas-delete-tenant] crash:", err?.message);
    return NextResponse.json({ ok: false, error: "Erro interno." }, { status: 500 });
  }
}