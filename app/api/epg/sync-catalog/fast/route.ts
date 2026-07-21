// app/api/epg/sync-catalog/fast/route.ts
//
// Sincronização do catálogo — Servidor FAST
// Mesma estrutura da rota NaTV/Elite: tudo roda numa única invocação
// (baixa M3U → parseia → upsert em lotes direto no Supabase, sem sair pra
// internet de novo entre os passos). Migrado do fluxo antigo (VM baixava o
// M3U e mandava de volta em ~500 requisições HTTP separadas, uma por lote —
// era isso, não o download em si, que fazia o sync levar 30+ minutos e gerar
// centenas de logs na Vercel).
//
// O M3U do Fast É bloqueado (HTTP 403) quando o pedido sai da faixa de IP de
// datacenter da própria Vercel — mas NÃO é bloqueado saindo da VM. Em vez de
// pagar por proxy residencial (lento, ~5min pra 60MB, arriscava estourar o
// maxDuration) ou de fazer stage num storage intermediário (R2 — testado,
// funciona, mas soma o tempo de upload+download), a VM faz de relay puro:
// baixa o M3U e devolve na própria resposta HTTP (POST /fast-sync/proxy-m3u).
// Pra essa rota aqui é transparente — é só a URL de onde vem o fetch.
//
// Fluxo:
//   GET  → status do último sync (log no R2)
//   POST → busca m3u_url do cliente Fast → pede pra VM (relay) → parseia → upsert

import { NextRequest, NextResponse }   from "next/server";
import { createClient }                from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand }  from "@aws-sdk/client-s3";

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
const R2_BUCKET = process.env.R2_BUCKET_NAME || "unigestor-media";
const LOG_KEY   = "epg/catalog_fast_log.json";

const SERVIDOR  = "FAST" as const;
const CLIENT_ID = "aefcff7a-9b8f-46be-9a1b-155a73a472de";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BATCH = 500;

function limparTitulo(titulo: string): string {
  return titulo
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    .replace(/\s+4K\s+(DIRECTORS?.?CUT|HDRR|HDR|DV|HYBRID|HDCAM|CAM|REMUX|HEVC|H265).*$/gi, "")
    .replace(/(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|WEB-DL|WEBRIP|H265|HEVC|REMUX|DIRECTORS?.?CUT)$/gi, "")
    .replace(/\s+(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|BLU-RAY|WEB-DL|WEBRIP|HDRIP|DVDRIP|BDRIP|H265|H\.265|HEVC|REMUX|DIRECTORS?.?CUT)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Parse do M3U — portado do antigo whatsapp-service/fast-sync/sync-fast.cjs ──
// (mantido idêntico de propósito: já testado em produção, não é o gargalo)
function normalizarTitulo(nome: string): string {
  return nome
    .replace(/&amp;/gi, " E ").replace(/&/g, " E ")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    .replace(/\s*[\[(](4K[\s\w]*|FHD|HD|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|BLU.?RAY|BLURAY|WEB.?DL|WEBRIP|HDRIP|DVDRIP|BDRIP|TS|HDTV|FULL|ULTRA)[\])]/gi, "")
    .replace(/(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|WEB-DL|WEBRIP|H265|HEVC|REMUX|DIRECTORS?.?CUT)$/gi, "")
    .replace(/\s+(4K|FHD|HDRR|HDR|SDR|UHD|DV|HYBRID|HDCAM|CAM|FULL|ULTRA|BLURAY|BLU-RAY|WEB-DL|WEBRIP|HDRIP|DVDRIP|BDRIP|H265|H\.265|HEVC|REMUX)\s*$/gi, "")
    .replace(/\s*\[L\]\s*/gi, " ").replace(/\s*\[DUB\]\s*/gi, " ")
    .replace(/\s+(DUAL AUDIO|DUAL|LEG|DUB|DUBLADO|LEGENDADO)\b/gi, "")
    .replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

type MasterEntry = {
  titulo_normalizado: string;
  tipo: "FILME" | "SERIE";
  cover_url: string | null;
  ano: number | null;
  categoria_origem: string;
};
type EpisodioEntry = {
  titulo_normalizado: string;
  temporada: number;
  episodio: number;
  cover_url: string | null;
};

function parseM3UFast(m3uText: string) {
  const filmes       = new Map<string, MasterEntry>();
  const seriesMaster  = new Map<string, MasterEntry>();
  const episodios: EpisodioEntry[] = [];
  let ext = "";

  for (const line of m3uText.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (l.startsWith("#EXTINF")) { ext = l; continue; }
    if (!l.startsWith("http") || !ext) continue;

    const isFilme = l.includes("/movie/");
    const isSerie = l.includes("/series/");
    if (!isFilme && !isSerie) { ext = ""; continue; }

    const tvgNome = ext.match(/tvg-name="([^"]*)"/)?.[1]?.trim() || "";
    const tvgLogo = ext.match(/tvg-logo="([^"]*)"/)?.[1]?.trim() || "";
    const grupo   = ext.match(/group-title="([^"]*)"/)?.[1]?.trim() || "";
    ext = "";

    if (!tvgNome) continue;
    const g = grupo.toUpperCase();
    if (g.includes("XXX") || g.includes("ADULTO") || g.includes("ADULT") || g.includes("18+")) continue;

    const categoria = grupo.includes(" | ")
      ? grupo.split(" | ").slice(1).join(" | ").trim()
      : grupo.trim();

    if (isFilme) {
      const anoMatch = tvgNome.match(/[\[(](\d{4})[\])]/)?.[1];
      const titulo   = normalizarTitulo(tvgNome.replace(/[\[(]\d{4}[\])]/g, ""));
      if (!titulo || titulo.replace(/[^A-Z0-9]/g, "").length < 2) continue;
      if (!filmes.has(titulo) || (!filmes.get(titulo)!.cover_url && tvgLogo)) {
        filmes.set(titulo, {
          titulo_normalizado: titulo, tipo: "FILME",
          cover_url: tvgLogo || null,
          ano: anoMatch ? parseInt(anoMatch) : null,
          categoria_origem: categoria,
        });
      }
    } else {
      const seMatch = tvgNome.match(/S(\d+)\s*E(\d+)/i);
      if (!seMatch) continue;
      const anoMatch = tvgNome.match(/[\[(](\d{4})[\])]/)?.[1];
      const titulo   = normalizarTitulo(
        tvgNome.replace(/\s*S\d+\s*E\d+.*/i, "").replace(/[\[(]\d{4}[\])]\s*/g, "")
      );
      if (!titulo || titulo.replace(/[^A-Z0-9]/g, "").length < 2) continue;
      if (!seriesMaster.has(titulo) || (!seriesMaster.get(titulo)!.cover_url && tvgLogo)) {
        seriesMaster.set(titulo, {
          titulo_normalizado: titulo, tipo: "SERIE",
          cover_url: tvgLogo || null,
          ano: anoMatch ? parseInt(anoMatch) : null,
          categoria_origem: categoria,
        });
      }
      episodios.push({
        titulo_normalizado: titulo,
        temporada: parseInt(seMatch[1]),
        episodio:  parseInt(seMatch[2]),
        cover_url: tvgLogo || null,
      });
    }
  }

  const masterMap = new Map<string, MasterEntry>();
  for (const item of [...filmes.values(), ...seriesMaster.values()]) {
    const key = `${item.titulo_normalizado}|${item.tipo}`;
    if (!masterMap.has(key) || (!masterMap.get(key)!.cover_url && item.cover_url)) {
      masterMap.set(key, item);
    }
  }

  return {
    masterLista: [...masterMap.values()],
    episodios,
    stats: { filmes: filmes.size, series: seriesMaster.size },
  };
}

// ─── GET — Status do último sync ──────────────────────────────────────────────
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`;

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: cliente } = await supabaseAdmin
    .from("clients")
    .select("m3u_url")
    .eq("id", CLIENT_ID)
    .single();

  const { data: statsView } = await supabaseAdmin
    .from("catalog_stats_por_servidor")
    .select("filmes, series_unicas, episodios")
    .eq("servidor", SERVIDOR)
    .single();

  const { data: syncData } = await supabaseAdmin
    .from("catalog_availability")
    .select("sincronizado_em")
    .eq("servidor", SERVIDOR)
    .order("sincronizado_em", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    m3u_url: cliente?.m3u_url || null,
    executado_em: syncData?.sincronizado_em || null,
    resultado: {
      filmes:        statsView?.filmes        || 0,
      series_unicas: statsView?.series_unicas || 0,
      episodios:     statsView?.episodios     || 0,
    },
  });
}

// ─── POST — Sync completo (autocontido, igual NaTV/Elite) ─────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();
  const execTimestamp = new Date().toISOString();

  const authHeader = req.headers.get("authorization");
  const isCron = authHeader === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`;

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const log: Record<string, any> = {
    servidor: SERVIDOR, executado_em: execTimestamp,
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

    // ── 1. Busca m3u_url do cliente Fast no banco ─────────────────────────────
    const { data: cliente, error: clienteErr } = await supabaseAdmin
      .from("clients")
      .select("m3u_url")
      .eq("id", CLIENT_ID)
      .single();

    if (clienteErr || !cliente?.m3u_url) {
      log.erro = `m3u_url do cliente Fast não encontrado: ${clienteErr?.message}`;
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 500 });
    }
    const m3uUrl = cliente.m3u_url as string;

    const waBaseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
    const waToken   = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
    if (!waBaseUrl || !waToken) {
      log.erro = "Server misconfigured (VM).";
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 500 });
    }

    // ── 2. Baixa o M3U via relay da VM (IP dela não é bloqueado — a nossa é) ──
    console.log(`[CATALOG-FAST] Baixando M3U via relay da VM...`);
    let m3uText = "";
    const MAX_TENTATIVAS = 3;
    let ultimoErro: any = null;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        console.log(`[CATALOG-FAST] Tentativa ${tentativa}/${MAX_TENTATIVAS}...`);
        const resp = await fetch(`${waBaseUrl}/fast-sync/proxy-m3u`, {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${waToken}` },
          body:    JSON.stringify({ m3uUrl }),
          signal:  AbortSignal.timeout(120_000),
        });
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          throw new Error(j?.error || `HTTP ${resp.status}`);
        }
        m3uText = await resp.text();
        ultimoErro = null;
        break;
      } catch (e: any) {
        ultimoErro = e;
        console.warn(`[CATALOG-FAST] Tentativa ${tentativa} falhou: ${e.message}`);
        if (tentativa < MAX_TENTATIVAS) {
          await new Promise(r => setTimeout(r, 3_000));
        }
      }
    }

    if (ultimoErro || !m3uText) {
      log.erro = `Falha ao baixar M3U (via VM) após ${MAX_TENTATIVAS} tentativas: ${ultimoErro?.message || "arquivo vazio"}`;
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 502 });
    }
    console.log(`[CATALOG-FAST] ${m3uText.length} bytes baixados`);
    log.etapas.download = { ok: true, bytes: m3uText.length };

    // ── 3. Parseia ────────────────────────────────────────────────────────────
    const { masterLista, episodios, stats } = parseM3UFast(m3uText);
    console.log(`[CATALOG-FAST] Parse: ${stats.filmes} filmes, ${stats.series} séries, ${episodios.length} episódios`);
    log.etapas.parse = { ok: true, ...stats, total_entradas: masterLista.length + episodios.length };

    // ── 4a. Upsert master + availability, em lotes (direto no Supabase) ──────
    const agora = new Date().toISOString();
    const masterIdMap = new Map<string, string>();

    for (let i = 0; i < masterLista.length; i += BATCH) {
      const loteNorm = masterLista.slice(i, i + BATCH).map(e => ({
        ...e,
        titulo_normalizado: limparTitulo(e.titulo_normalizado),
      }));

      const batchMap = new Map<string, typeof loteNorm[number]>();
      for (const e of loteNorm) {
        const key = `${e.titulo_normalizado}|${e.tipo}`;
        if (!batchMap.has(key) || (!batchMap.get(key)!.cover_url && e.cover_url)) {
          batchMap.set(key, e);
        }
      }
      const masterRows = [...batchMap.values()].map(e => ({
        titulo_normalizado: e.titulo_normalizado,
        tipo:               e.tipo,
        ...(e.cover_url ? { cover_url: e.cover_url } : {}),
        ano:           e.ano ?? null,
        atualizado_em: agora,
      }));

      const { error } = await supabaseAdmin
        .from("catalog_master")
        .upsert(masterRows, { onConflict: "titulo_normalizado", ignoreDuplicates: false });
      if (error) {
        console.error(`[CATALOG-FAST] Erro master lote ${i}:`, error.message);
        log.erro = `Erro master lote ${i}: ${error.message}`;
        await salvarLog(log);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const titulos = [...new Set(loteNorm.map(e => e.titulo_normalizado))];
      const { data: idsRows } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_normalizado")
        .in("titulo_normalizado", titulos);
      for (const row of idsRows || []) masterIdMap.set(row.titulo_normalizado, row.id);

      // Dedup por master_id: como limparTitulo() normaliza mais agressivo que a
      // 1ª passada do parser, títulos DIFERENTES no M3U podem cair no mesmo
      // master_id aqui — sem isso, o upsert falha com "ON CONFLICT DO UPDATE
      // command cannot affect row a second time" (2 linhas do lote mirando o
      // mesmo master_id/servidor no mesmo upsert).
      const availMap = new Map<string, any>();
      for (const e of loteNorm) {
        const master_id = masterIdMap.get(e.titulo_normalizado);
        if (!master_id) continue;
        availMap.set(`${master_id}|${SERVIDOR}`, {
          master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem, sincronizado_em: agora,
        });
      }
      const availRows = [...availMap.values()];

      if (availRows.length > 0) {
        const { error: availErr } = await supabaseAdmin
          .from("catalog_availability")
          .upsert(availRows, { onConflict: "master_id,servidor", ignoreDuplicates: false });
        if (availErr) console.error(`[CATALOG-FAST] Erro availability lote ${i}:`, availErr.message);
      }
    }
    console.log(`[CATALOG-FAST] Master+availability: ${masterLista.length} títulos processados`);

    // ── 4b. Upsert episódios, em lotes ────────────────────────────────────────
    const masterIdsComEpisodioNovo = new Set<string>();

    for (let i = 0; i < episodios.length; i += BATCH) {
      const loteNorm = episodios.slice(i, i + BATCH).map(e => ({
        ...e,
        titulo_normalizado: limparTitulo(e.titulo_normalizado),
      }));

      const titulos = [...new Set(loteNorm.map(e => e.titulo_normalizado))];
      const idMap = new Map<string, string>();
      for (let j = 0; j < titulos.length; j += 500) {
        const { data } = await supabaseAdmin
          .from("catalog_master")
          .select("id, titulo_normalizado")
          .in("titulo_normalizado", titulos.slice(j, j + 500));
        for (const row of data || []) idMap.set(row.titulo_normalizado, row.id);
      }

      const epRows = loteNorm
        .map(e => {
          const master_id = idMap.get(e.titulo_normalizado);
          return master_id ? {
            master_id, servidor: SERVIDOR,
            temporada: e.temporada, episodio: e.episodio,
            cover_url: e.cover_url || null,
          } : null;
        })
        .filter(Boolean) as any[];

      if (epRows.length > 0) {
        const masterIdsDoLote = [...new Set(epRows.map((ep: any) => ep.master_id))];
        const { data: existentes } = await supabaseAdmin
          .from("catalog_episodes")
          .select("master_id, temporada, episodio")
          .eq("servidor", SERVIDOR)
          .in("master_id", masterIdsDoLote);

        const existenteSet = new Set(
          (existentes || []).map(e => `${e.master_id}|${e.temporada}|${e.episodio}`)
        );
        for (const ep of epRows as any[]) {
          const key = `${ep.master_id}|${ep.temporada}|${ep.episodio}`;
          if (!existenteSet.has(key)) masterIdsComEpisodioNovo.add(ep.master_id);
        }

        const { error } = await supabaseAdmin
          .from("catalog_episodes")
          .upsert(epRows, {
            onConflict:       "master_id,servidor,temporada,episodio",
            ignoreDuplicates: true,
          });
        if (error) {
          console.error(`[CATALOG-FAST] Erro episodes lote ${i}:`, error.message);
          log.erro = `Erro episodes lote ${i}: ${error.message}`;
          await salvarLog(log);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }
    console.log(`[CATALOG-FAST] Episódios: ${episodios.length} processados`);

    // Reabre o adicionado_em das séries que ganharam episódio novo — sem isso,
    // série existente que só recebeu episódio novo nunca reaparece em "novidades".
    if (masterIdsComEpisodioNovo.size > 0) {
      const idsArray = [...masterIdsComEpisodioNovo];
      const { error: reopenErr } = await supabaseAdmin
        .from("catalog_availability")
        .update({ adicionado_em: new Date().toISOString() })
        .eq("servidor", SERVIDOR)
        .in("master_id", idsArray);
      if (reopenErr) console.error(`[CATALOG-FAST] Erro ao reabrir adicionado_em:`, reopenErr.message);
    }

    // ── 5. Finaliza — contadores, refresh, snapshot depois ────────────────────
    const { error: rpcErr } = await supabaseAdmin
      .rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });
    if (rpcErr) console.error("[CATALOG-FAST] Erro RPC contadores:", rpcErr.message);

    await supabaseAdmin.rpc("refresh_catalog_stats");

    const [{ count: totalAvailDepois }, { count: totalEpisodiosDepois }] = await Promise.all([
      supabaseAdmin.from("catalog_availability").select("*", { count: "exact", head: true }).eq("servidor", SERVIDOR),
      supabaseAdmin.from("catalog_episodes").select("*", { count: "exact", head: true }).eq("servidor", SERVIDOR),
    ]);

    const duracao = Math.round((Date.now() - inicio) / 1000);
    const resultado = {
      duracao_s:       duracao,
      filmes:          stats.filmes,
      series_unicas:   stats.series,
      episodios:       episodios.length,
      novos_titulos:   Math.max(0, (totalAvailDepois    || 0) - (totalAvailAntes    || 0)),
      novos_episodios: Math.max(0, (totalEpisodiosDepois || 0) - (totalEpisodiosAntes || 0)),
      banco_titulos:   totalAvailDepois    || 0,
      banco_episodios: totalEpisodiosDepois || 0,
    };

    log.resultado = resultado;
    await salvarLog(log);
    console.log(`[CATALOG-FAST] Concluído em ${duracao}s`, resultado);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e: any) {
    log.erro = e.message;
    await salvarLog(log);
    console.error(`[CATALOG-FAST] Erro fatal:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function salvarLog(log: Record<string, any>) {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: LOG_KEY,
      Body: JSON.stringify(log, null, 2), ContentType: "application/json",
    }));
  } catch (e) { console.error("[CATALOG-FAST] Erro ao salvar log:", e); }
}
