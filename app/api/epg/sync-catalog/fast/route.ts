// app/api/epg/sync-catalog/fast/route.ts
//
// Sincronização do catálogo — Servidor FAST
//
// Diferente de Elite e NaTV, o Fast bloqueia IPs de datacenter.
// A extensão do Chrome baixa o M3U com o IP do usuário, parseia e
// envia os dados em lotes para esta rota via POST.
//
// POST body:
//   { tipo: "master",    lote: EntradaMaster[]  }
//   { tipo: "episodios", lote: EntradaEpisodio[] }
//
// GET → status do último sync (log no R2)

import { NextRequest, NextResponse }   from "next/server";
import { createClient }                from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand }  from "@aws-sdk/client-s3";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

const s3 = new S3Client({
  region:   "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME        || "unigestor-media";
const R2_URL    = process.env.NEXT_PUBLIC_R2_DEV_URL || "";
const LOG_KEY   = "epg/catalog_fast_log.json";
const SERVIDOR  = "FAST" as const;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ─── GET — Status do último sync ──────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const res = await fetch(`${R2_URL}/${LOG_KEY}`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ status: "Nenhum sync realizado ainda" });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ status: "Log não encontrado" });
  }
}

// ─── POST — Recebe lotes da extensão e grava no Supabase ─────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const { tipo, lote } = body as { tipo: "master" | "episodios" | "finalizar"; lote?: any[] };

  // ── Lote de master (filmes + séries) ─────────────────────────────────────
  if (tipo === "master" && Array.isArray(lote) && lote.length > 0) {
    const agora = new Date().toISOString();

    // 1. Upsert catalog_master
    const masterRows = lote.map(e => ({
      titulo_normalizado: e.titulo_normalizado,
      tipo:               e.tipo,
      ...(e.cover_url ? { cover_url: e.cover_url } : {}),
      ano:          e.ano ?? null,
      atualizado_em: agora,
    }));

    const { error: masterErr } = await supabaseAdmin
      .from("catalog_master")
      .upsert(masterRows, { onConflict: "titulo_normalizado", ignoreDuplicates: false });

    if (masterErr) {
      console.error("[CATALOG-FAST] Erro master:", masterErr.message);
      return NextResponse.json({ error: masterErr.message }, { status: 500 });
    }

    // 2. Busca IDs gerados
    const titulos = lote.map(e => e.titulo_normalizado);
    const { data: masterData } = await supabaseAdmin
      .from("catalog_master")
      .select("id, titulo_normalizado")
      .in("titulo_normalizado", titulos);

    const idMap = new Map<string, string>();
    for (const row of masterData || []) idMap.set(row.titulo_normalizado, row.id);

    // 3. Upsert catalog_availability
    const availRows = lote
      .map(e => {
        const master_id = idMap.get(e.titulo_normalizado);
        return master_id
          ? { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem }
          : null;
      })
      .filter(Boolean) as any[];

    if (availRows.length > 0) {
      await supabaseAdmin
        .from("catalog_availability")
        .upsert(availRows, { onConflict: "master_id,servidor", ignoreDuplicates: true });
    }

    return NextResponse.json({ ok: true, processados: lote.length });
  }

  // ── Lote de episódios ─────────────────────────────────────────────────────
  if (tipo === "episodios" && Array.isArray(lote) && lote.length > 0) {
    const titulos = [...new Set(lote.map(e => e.titulo_normalizado))];

    // Busca IDs das séries já inseridas
    const { data: masterData } = await supabaseAdmin
      .from("catalog_master")
      .select("id, titulo_normalizado")
      .in("titulo_normalizado", titulos);

    const idMap = new Map<string, string>();
    for (const row of masterData || []) idMap.set(row.titulo_normalizado, row.id);

    const epRows = lote
      .map(e => {
        const master_id = idMap.get(e.titulo_normalizado);
        return master_id ? {
          master_id,
          servidor:  SERVIDOR,
          temporada: e.temporada,
          episodio:  e.episodio,
          cover_url: e.cover_url || null,
        } : null;
      })
      .filter(Boolean) as any[];

    if (epRows.length > 0) {
      const { error: epErr } = await supabaseAdmin
        .from("catalog_episodes")
        .upsert(epRows, {
          onConflict:       "master_id,servidor,temporada,episodio",
          ignoreDuplicates: true,
        });

      if (epErr) {
        console.error("[CATALOG-FAST] Erro episodes:", epErr.message);
        return NextResponse.json({ error: epErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, processados: epRows.length });
  }

  // ── Finalizar: atualiza contadores e salva log ────────────────────────────
  if (tipo === "finalizar") {
    await supabaseAdmin.rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    const log = {
      servidor:     SERVIDOR,
      executado_em: new Date().toISOString(),
      resultado:    body.stats || {},
      erro:         null,
    };

    try {
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: LOG_KEY,
        Body: JSON.stringify(log, null, 2), ContentType: "application/json",
      }));
    } catch (e) { console.error("[CATALOG-FAST] Erro ao salvar log:", e); }

    return NextResponse.json({ ok: true, finalizado: true });
  }

  return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
}
