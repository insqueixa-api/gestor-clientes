// app/api/epg/sync-catalog/natv/route.ts
//
// Sincronização do catálogo — Servidor NATV
// Mesma estrutura da rota Elite — só filmes e séries, sem canais de TV.
//
// Fluxo:
//   GET  → status do último sync (log no R2)
//   POST → busca m3u_url do cliente NaTV no banco → baixa → parseia → upsert

import { NextRequest, NextResponse }   from "next/server";
import { createClient }                from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand }  from "@aws-sdk/client-s3";
import {
  parseM3U,
  statsDoparse,
  normalizarTituloBusca,
  type EntradaCatalogo,
} from "@/lib/catalog/catalog-parser";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

// ─── R2 ───────────────────────────────────────────────────────────────────────
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
const LOG_KEY   = "epg/catalog_natv_log.json";
const SERVIDOR  = "NATV" as const;
const CLIENT_ID = "f7e0b6e7-e7bb-486f-924c-5fc6704b94e9"; // cliente NaTV

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BATCH = 500;

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

// ─── POST — Sync completo ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const agora  = new Date().toISOString();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const log: Record<string, any> = {
    servidor: SERVIDOR, executado_em: agora,
    etapas: {}, resultado: {}, erro: null,
  };

  try {
    // ── 1. Busca m3u_url do cliente NaTV no banco ─────────────────────────────
    const { data: cliente, error: clienteErr } = await supabaseAdmin
      .from("clients")
      .select("m3u_url")
      .eq("id", CLIENT_ID)
      .single();

    if (clienteErr || !cliente?.m3u_url) {
      log.erro = `m3u_url do cliente NaTV não encontrado: ${clienteErr?.message}`;
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 500 });
    }

    const m3uUrl = cliente.m3u_url as string;
    log.etapas.credenciais = {
      ok: true,
      m3u_url: m3uUrl.replace(/password=[^&]+/, "password=***"),
    };

    // ── 2. Baixa o M3U ────────────────────────────────────────────────────────
    console.log(`[CATALOG-NATV] Baixando M3U...`);
    let m3uText = "";
    try {
      const resp = await fetch(m3uUrl, {
        signal:  AbortSignal.timeout(55_000),
        headers: { "User-Agent": "IPTVSmartersPro", "Accept": "*/*" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      m3uText = await resp.text();
    } catch (e: any) {
      log.erro = `Falha ao baixar M3U: ${e.message}`;
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 502 });
    }

    log.etapas.download = { ok: true, bytes: m3uText.length };
    console.log(`[CATALOG-NATV] ${m3uText.length} bytes baixados`);

    // ── 3. Parseia ────────────────────────────────────────────────────────────
    const entradas = parseM3U(m3uText);
    const stats    = statsDoparse(entradas);
    log.etapas.parse = { ok: true, ...stats, total_entradas: entradas.length };
    console.log(`[CATALOG-NATV] Parse:`, stats);

    // ── 4. Separa — só filmes e séries ────────────────────────────────────────
    const filmes       = entradas.filter(e => e.tipo === "FILME");
    const series       = entradas.filter(e => e.tipo === "SERIE");
    const filmesUnicos = deduplicarPorTitulo(filmes);
    const seriesUnicas = agruparSeries(series);
    const todasMaster  = [...filmesUnicos, ...seriesUnicas.master];

    // ── 4a. Upsert catalog_master por titulo_busca ────────────────────────────
    console.log(`[CATALOG-NATV] Upsert catalog_master: ${todasMaster.length}...`);

    const masterIdMap = new Map<string, string>(); // titulo_busca → id

    for (let i = 0; i < todasMaster.length; i += BATCH) {
      const lote     = todasMaster.slice(i, i + BATCH);
      const buscaKeys = lote.map(e => normalizarTituloBusca(e.titulo_normalizado));

      // Busca existentes por titulo_busca
      const { data: existentes } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_busca, tipo")
        .in("titulo_busca", buscaKeys);

      const existenteMap = new Map<string, string>();
      for (const row of existentes || []) {
        existenteMap.set(`${row.titulo_busca}|${row.tipo}`, row.id);
      }

      const agora2 = new Date().toISOString();
      const paraUpdate: Array<{ id: string; cover_url?: string; ano: number | null; atualizado_em: string }> = [];
      const paraInsert: Array<{ titulo_normalizado: string; tipo: string; cover_url?: string; ano: number | null; atualizado_em: string }> = [];

      for (let j = 0; j < lote.length; j++) {
        const e   = lote[j];
        const key = `${buscaKeys[j]}|${e.tipo}`;
        const id  = existenteMap.get(key);

        if (id) {
          masterIdMap.set(buscaKeys[j], id);
          paraUpdate.push({
            id,
            ...(e.cover_url ? { cover_url: e.cover_url } : {}),
            ano:           e.ano ?? null,
            atualizado_em: agora2,
          });
        } else {
          paraInsert.push({
            titulo_normalizado: e.titulo_normalizado,
            tipo:               e.tipo,
            ...(e.cover_url ? { cover_url: e.cover_url } : {}),
            ano:           e.ano ?? null,
            atualizado_em: agora2,
          });
        }
      }

      for (const upd of paraUpdate) {
        const { id, ...campos } = upd;
        const { error } = await supabaseAdmin
          .from("catalog_master")
          .update(campos)
          .eq("id", id);
        if (error) console.error(`[CATALOG-NATV] Erro update master ${id}:`, error.message);
      }

      if (paraInsert.length > 0) {
        const { data: inseridos, error } = await supabaseAdmin
          .from("catalog_master")
          .insert(paraInsert)
          .select("id, titulo_busca");
        if (error) {
          console.error(`[CATALOG-NATV] Erro insert master lote ${i}:`, error.message);
        } else {
          for (const row of inseridos || []) {
            masterIdMap.set(row.titulo_busca, row.id);
          }
        }
      }
    }

    log.etapas.master = {
      ok:                  true,
      titulos_processados: todasMaster.length,
      ids_encontrados:     masterIdMap.size,
    };
    console.log(`[CATALOG-NATV] IDs resolvidos: ${masterIdMap.size} de ${todasMaster.length}`);

    // ── 4c. Upsert catalog_availability ──────────────────────────────────────
    // ignoreDuplicates: true → preserva adicionado_em original
    const availRows = [...filmesUnicos, ...seriesUnicas.master]
      .map(e => {
        const master_id = masterIdMap.get(normalizarTituloBusca(e.titulo_normalizado));
        return master_id
          ? { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem }
          : null;
      })
      .filter(Boolean) as any[];

    for (let i = 0; i < availRows.length; i += BATCH) {
      const { error } = await supabaseAdmin
        .from("catalog_availability")
        .upsert(availRows.slice(i, i + BATCH), {
          onConflict: "master_id,servidor",
          ignoreDuplicates: true,
        });
      if (error) console.error(`[CATALOG-NATV] Erro availability lote ${i}:`, error.message);
    }

    // ── 4d. Upsert catalog_episodes ───────────────────────────────────────────
    const epRows = seriesUnicas.episodios
      .map(ep => {
const master_id = masterIdMap.get(normalizarTituloBusca(ep.titulo_normalizado));
        return master_id ? {
          master_id, servidor: SERVIDOR,
          temporada: ep.temporada!, episodio: ep.episodio!,
          cover_url: ep.cover_url || null,
        } : null;
      })
      .filter(Boolean) as any[];

    for (let i = 0; i < epRows.length; i += BATCH) {
      const { error } = await supabaseAdmin
        .from("catalog_episodes")
        .upsert(epRows.slice(i, i + BATCH), {
          onConflict: "master_id,servidor,temporada,episodio",
          ignoreDuplicates: true,
        });
      if (error) console.error(`[CATALOG-NATV] Erro episodes lote ${i}:`, error.message);
    }

    // ── 4e. Contadores ────────────────────────────────────────────────────────
    await supabaseAdmin.rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    // ── 5. Resultado ──────────────────────────────────────────────────────────
    const duracao = Math.round((Date.now() - inicio) / 1000);

    // Conta totais no banco após sync
    const { count: totalAvail }     = await supabaseAdmin
      .from("catalog_availability").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);
    const { count: totalEpisodios } = await supabaseAdmin
      .from("catalog_episodes").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);

    const totalEnviado = filmesUnicos.length + seriesUnicas.master.length;
    log.resultado = {
      duracao_s:           duracao,
      filmes:              filmesUnicos.length,
      series_unicas:       seriesUnicas.master.length,
      episodios:           epRows.length,
      novos_titulos:       Math.max(0, (totalAvail    || 0) - totalEnviado),
      novos_episodios:     Math.max(0, (totalEpisodios || 0) - epRows.length),
      banco_titulos:       totalAvail    || 0,
      banco_episodios:     totalEpisodios || 0,
    };

    await salvarLog(log);
    console.log(`[CATALOG-NATV] Concluído em ${duracao}s`, log.resultado);
    return NextResponse.json({ ok: true, ...log.resultado });

  } catch (e: any) {
    log.erro = e.message;
    await salvarLog(log);
    console.error(`[CATALOG-NATV] Erro fatal:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function deduplicarPorTitulo(filmes: EntradaCatalogo[]): EntradaCatalogo[] {
  const mapa = new Map<string, EntradaCatalogo>();
  for (const f of filmes) {
    const ex = mapa.get(f.titulo_normalizado);
    if (!ex || (!ex.cover_url && f.cover_url)) mapa.set(f.titulo_normalizado, f);
  }
  return [...mapa.values()];
}

function agruparSeries(series: EntradaCatalogo[]) {
  const masterMap = new Map<string, EntradaCatalogo>();
  for (const ep of series) {
    const ex = masterMap.get(ep.titulo_normalizado);
    if (!ex || (!ex.cover_url && ep.cover_url)) masterMap.set(ep.titulo_normalizado, ep);
  }
  return { master: [...masterMap.values()], episodios: series };
}

async function salvarLog(log: Record<string, any>) {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: LOG_KEY,
      Body: JSON.stringify(log, null, 2), ContentType: "application/json",
    }));
  } catch (e) { console.error("[CATALOG-NATV] Erro ao salvar log:", e); }
}
