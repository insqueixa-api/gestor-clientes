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
import { isCronRequest } from "@/lib/internal-auth";
import * as Sentry from "@sentry/nextjs";
import { limparOrfaosAposSync } from "@/lib/catalogo/limpar-orfaos";
import {
  parseM3U,
  statsDoparse,
  normalizarTituloBusca,
  type EntradaCatalogo,
} from "@/lib/catalog/catalog-parser";

export const dynamic     = "force-dynamic";
export const maxDuration = 300;

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
    const { data, error } = await supabaseAdmin
      .from("catalog_stats_por_servidor")
      .select("filmes, series_unicas, episodios")
      .eq("servidor", SERVIDOR)
      .single();

    if (error || !data) throw new Error(error?.message || "Servidor não encontrado na view");

    // Busca a data exata do último sync gravado no banco
    const { data: syncData } = await supabaseAdmin
      .from("catalog_availability")
      .select("sincronizado_em")
      .eq("servidor", SERVIDOR)
      .order("sincronizado_em", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      resultado: {
        filmes:        data.filmes        || 0,
        series_unicas: data.series_unicas || 0,
        episodios:     data.episodios     || 0,
      },
      executado_em: syncData?.sincronizado_em || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── POST — Sync completo ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const agora  = new Date().toISOString();

  const isCron = isCronRequest(req, "EPG_SYNC_CRON_SECRET")

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Sentry Cron Monitoring — só no disparo do pg_cron, pra alertar se a rota
  // não terminar (achado no incidente do timeout de 26/08/2026, que morreu
  // sem gerar nenhuma exceção no Sentry).
  const checkInId = isCron
    ? Sentry.captureCheckIn(
        { monitorSlug: "sync-catalog-natv", status: "in_progress" },
        {
          schedule: { type: "crontab", value: "50 5 * * *" },
          timezone: "UTC",
          checkinMargin: 5,
          maxRuntime: 6,
        }
      )
    : null;
  const finishCheckIn = (status: "ok" | "error") => {
    if (checkInId) Sentry.captureCheckIn({ checkInId, monitorSlug: "sync-catalog-natv", status });
  };

  const log: Record<string, any> = {
    servidor: SERVIDOR, executado_em: agora,
    etapas: {}, resultado: {}, erro: null,
  };

 try {
    // ── 0. Snapshot dos totais ANTES do sync ─────────────────────────────────
    const { count: totalAvailAntes } = await supabaseAdmin
      .from("catalog_availability").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);
    const { count: totalEpisodiosAntes } = await supabaseAdmin
      .from("catalog_episodes").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);

    // ── 1. Busca m3u_url do cliente NaTV no banco ─────────────────────────────
    const { data: cliente, error: clienteErr } = await supabaseAdmin
      .from("clients")
      .select("m3u_url")
      .eq("id", CLIENT_ID)
      .single();

    if (clienteErr || !cliente?.m3u_url) {
      log.erro = `m3u_url do cliente NaTV não encontrado: ${clienteErr?.message}`;
      await salvarLog(log);
      finishCheckIn("error");
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
    const MAX_TENTATIVAS = 3;
    let ultimoErro: any = null;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        console.log(`[CATALOG-NATV] Tentativa ${tentativa}/${MAX_TENTATIVAS}...`);
        const resp = await fetch(m3uUrl, {
          signal:  AbortSignal.timeout(180_000),
          headers: { "User-Agent": "IPTVSmartersPro", "Accept": "*/*" },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        m3uText = await resp.text();
        ultimoErro = null;
        break; // sucesso, sai do loop
      } catch (e: any) {
        ultimoErro = e;
        console.warn(`[CATALOG-NATV] Tentativa ${tentativa} falhou: ${e.message}`);
        if (tentativa < MAX_TENTATIVAS) {
          await new Promise(r => setTimeout(r, 5_000)); // espera 5s antes de tentar de novo
        }
      }
    }

    if (ultimoErro) {
      log.erro = `Falha ao baixar M3U após ${MAX_TENTATIVAS} tentativas: ${ultimoErro.message}`;
      await salvarLog(log);
      finishCheckIn("error");
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
      const paraUpdate: Array<{ id: string; cover_url?: string; ano: number | null; atualizado_em: string; titulo_exibicao?: string }> = [];
      const paraInsert: Array<{ titulo_normalizado: string; tipo: string; cover_url?: string; ano: number | null; atualizado_em: string; titulo_exibicao: string | null }> = [];

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
            ...(e.titulo_original ? { titulo_exibicao: e.titulo_original } : {}),
          });
        } else {
          paraInsert.push({
            titulo_normalizado: e.titulo_normalizado,
            tipo:               e.tipo,
            ...(e.cover_url ? { cover_url: e.cover_url } : {}),
            ano:           e.ano ?? null,
            atualizado_em: agora2,
            titulo_exibicao: e.titulo_original || null,
          });
        }
      }

      if (paraUpdate.length > 0) {
        const { error } = await supabaseAdmin
          .from("catalog_master")
          .upsert(paraUpdate, { onConflict: "id", ignoreDuplicates: false });
        if (error) console.error(`[CATALOG-NATV] Erro update master lote ${i}:`, error.message);
      }



if (paraInsert.length > 0) {
        const { data: inseridos, error } = await supabaseAdmin
          .from("catalog_master")
          .upsert(paraInsert, { onConflict: "titulo_normalizado", ignoreDuplicates: false })
          .select("id, titulo_busca");
        if (error) {
          throw new Error(`Upsert master lote ${i}: ${error.message} | code: ${error.code} | details: ${error.details}`);
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
          ? { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem, sincronizado_em: agora }
          : null;
      })
      .filter(Boolean) as any[];

    for (let i = 0; i < availRows.length; i += BATCH) {
      const { error } = await supabaseAdmin
        .from("catalog_availability")
.upsert(availRows.slice(i, i + BATCH), {
          onConflict: "master_id,servidor",
          ignoreDuplicates: false,
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

    // master_ids de séries que ganharam pelo menos 1 episódio genuinamente novo
    // nesta sincronização — usado depois pra "reabrir" o adicionado_em delas.
    const masterIdsComEpisodioNovo = new Set<string>();

    for (let i = 0; i < epRows.length; i += BATCH) {
      const lote = epRows.slice(i, i + BATCH);

      const masterIdsDoLote = [...new Set(lote.map((ep: any) => ep.master_id))];
      const { data: existentes } = await supabaseAdmin
        .from("catalog_episodes")
        .select("master_id, temporada, episodio")
        .eq("servidor", SERVIDOR)
        .in("master_id", masterIdsDoLote);

      const existenteSet = new Set(
        (existentes || []).map(e => `${e.master_id}|${e.temporada}|${e.episodio}`)
      );

      for (const ep of lote as any[]) {
        const key = `${ep.master_id}|${ep.temporada}|${ep.episodio}`;
        if (!existenteSet.has(key)) {
          masterIdsComEpisodioNovo.add(ep.master_id);
        }
      }

      const { error } = await supabaseAdmin
        .from("catalog_episodes")
        .upsert(lote, {
          onConflict: "master_id,servidor,temporada,episodio",
          ignoreDuplicates: true,
        });
      if (error) console.error(`[CATALOG-NATV] Erro episodes lote ${i}:`, error.message);
    }

    // ── 4d-bis. "Reabre" o adicionado_em das séries que ganharam episódio novo ─
    if (masterIdsComEpisodioNovo.size > 0) {
      const idsArray = [...masterIdsComEpisodioNovo];
      console.log(`[CATALOG-NATV] Reabrindo adicionado_em de ${idsArray.length} séries com episódio novo...`);
      const { error: reopenErr } = await supabaseAdmin
        .from("catalog_availability")
        .update({ adicionado_em: agora })
        .eq("servidor", SERVIDOR)
        .in("master_id", idsArray);
      if (reopenErr) console.error(`[CATALOG-NATV] Erro ao reabrir adicionado_em:`, reopenErr.message);
    }

    // ── 4e. Contadores ────────────────────────────────────────────────────────
await supabaseAdmin.rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    // Refresh da view materializada
    await supabaseAdmin.rpc("refresh_catalog_stats");

    // ── 5. Resultado
    const duracao = Math.round((Date.now() - inicio) / 1000);

    // Conta totais no banco após sync
    const { count: totalAvail }     = await supabaseAdmin
      .from("catalog_availability").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);
    const { count: totalEpisodios } = await supabaseAdmin
      .from("catalog_episodes").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);

    log.resultado = {
      duracao_s:       duracao,
      filmes:          filmesUnicos.length,
      series_unicas:   seriesUnicas.master.length,
      episodios:       epRows.length,
      novos_titulos:   Math.max(0, (totalAvail    || 0) - (totalAvailAntes    || 0)),
      novos_episodios: Math.max(0, (totalEpisodios || 0) - (totalEpisodiosAntes || 0)),
      banco_titulos:   totalAvail    || 0,
      banco_episodios: totalEpisodios || 0,
    };

    await salvarLog(log);
    console.log(`[CATALOG-NATV] Concluído em ${duracao}s`, log.resultado);

    // ✅ Limpeza de órfãos direto no fim do sync (05/08/2026) — não depende
    // mais só do cron diário de horário fixo, ver lib/catalogo/limpar-orfaos.ts.
    await limparOrfaosAposSync(SERVIDOR);

    finishCheckIn("ok");
    return NextResponse.json({ ok: true, ...log.resultado });

  } catch (e: any) {
    log.erro = e.message;
    await salvarLog(log);
    console.error(`[CATALOG-NATV] Erro fatal:`, e.message);
    Sentry.captureException(e, { tags: { kind: "cron_error", where: "sync-catalog-natv" } });
    finishCheckIn("error");
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
