// app/api/epg/sync-catalog/elite/route.ts
//
// Cron de sincronização do catálogo — Servidor ELITE
//
// Fluxo:
//   1. GET  → retorna status do último sync (lê log do R2)
//   2. POST → executa o sync completo:
//      a. Busca m3u_url direto da tabela clients pelo ID fixo do cliente Elite
//      b. Baixa o M3U usando exatamente esse link
//      c. Parseia entradas: CANAL / FILME / SERIE
//      d. Upsert em lote no Supabase
//      e. Salva log JSON no R2
//
// Endereço: POST /api/epg/sync-catalog/elite

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
const LOG_KEY   = "epg/catalog_elite_log.json";
const SERVIDOR  = "ELITE" as const;

// ─── supabaseAdmin (bypassa RLS) ──────────────────────────────────────────────
const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ─── Tamanho do lote para upsert ──────────────────────────────────────────────
const BATCH_MASTER       = 500;
const BATCH_AVAILABILITY = 500;
const BATCH_EPISODES     = 500;

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
    servidor:     SERVIDOR,
    executado_em: agora,
    etapas:       {},
    resultado:    {},
    erro:         null,
  };

 try {
    // ── 0. Snapshot dos totais ANTES do sync ─────────────────────────────────
    const { count: totalAvailAntes } = await supabaseAdmin
      .from("catalog_availability").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);
    const { count: totalEpisodiosAntes } = await supabaseAdmin
      .from("catalog_episodes").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);

    // ── 1. Busca m3u_url direto do cliente no banco ───────────────────────────
    const { data: cliente, error: clienteErr } = await supabaseAdmin
      .from("clients")
      .select("m3u_url")
      .eq("id", "27a871c0-4850-4bd0-8a5a-52609abe569f")
      .single();

    if (clienteErr || !cliente?.m3u_url) {
      log.erro = `m3u_url do cliente Elite não encontrado: ${clienteErr?.message}`;
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 500 });
    }

    const m3uUrl = cliente.m3u_url as string;
    log.etapas.credenciais = { ok: true, m3u_url: m3uUrl.replace(/password=[^&]+/, "password=***") };

    // ── 2. Baixar M3U ─────────────────────────────────────────────────────────
    console.log(`[CATALOG-ELITE] Baixando M3U...`);

    let m3uText = "";
    try {
      const resp = await fetch(m3uUrl, {
        signal:  AbortSignal.timeout(55_000),
        headers: { "User-Agent": "VLC/3.0.18 LibVLC/3.0.18" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      m3uText = await resp.text();
    } catch (e: any) {
      log.erro = `Falha ao baixar M3U: ${e.message}`;
      await salvarLog(log);
      return NextResponse.json({ error: log.erro }, { status: 502 });
    }

    log.etapas.download = { ok: true, bytes: m3uText.length };

    // ── 3. Parsear M3U ────────────────────────────────────────────────────────
    console.log(`[CATALOG-ELITE] Parseando ${m3uText.length} bytes...`);
    const entradas = parseM3U(m3uText);
    const stats    = statsDoparse(entradas);
    log.etapas.parse = { ok: true, ...stats, total_entradas: entradas.length };
    console.log(`[CATALOG-ELITE] Parse concluído:`, stats);

    // ── 4. Separar e deduplicar ───────────────────────────────────────────────
    // CANAIs são ignorados — o parser já os descarta, mas filtramos por segurança
    const filmes       = entradas.filter(e => e.tipo === "FILME");
    const series       = entradas.filter(e => e.tipo === "SERIE");
    const filmesUnicos = deduplicarPorTitulo(filmes);
    const seriesUnicas = agruparSeries(series);
    const todasMaster  = [...filmesUnicos, ...seriesUnicas.master];

// ── 4a. Upsert catalog_master por titulo_busca ────────────────────────────
    console.log(`[CATALOG-ELITE] Upsert catalog_master: ${todasMaster.length} títulos...`);

    const masterIdMap = new Map<string, string>(); // titulo_busca → id
    let novosTitulosContados   = 0;
    let novosEpisodiosContados = 0;

    
    for (let i = 0; i < todasMaster.length; i += BATCH_MASTER) {
      const lote = todasMaster.slice(i, i + BATCH_MASTER);

      // 1. Calcula titulo_busca de cada entrada do lote
      const buscaKeys = lote.map(e => normalizarTituloBusca(e.titulo_normalizado));

      // 2. Busca registros existentes por titulo_busca + tipo
      const { data: existentes } = await supabaseAdmin
        .from("catalog_master")
        .select("id, titulo_busca, tipo")
        .in("titulo_busca", buscaKeys);

      // Monta mapa: "titulo_busca|tipo" → id
      const existenteMap = new Map<string, string>();
      for (const row of existentes || []) {
        existenteMap.set(`${row.titulo_busca}|${row.tipo}`, row.id);
      }

      // 3. Separa em updates e inserts
      const agora = new Date().toISOString();
      const paraUpdate: Array<{ id: string; cover_url?: string; ano: number | null; atualizado_em: string }> = [];
      const paraInsert: Array<{ titulo_normalizado: string; tipo: string; cover_url?: string; ano: number | null; atualizado_em: string }> = [];

      for (let j = 0; j < lote.length; j++) {
        const e   = lote[j];
        const key = `${buscaKeys[j]}|${e.tipo}`;
        const id  = existenteMap.get(key);

        if (id) {
          // Já existe — UPDATE preservando o ID
          masterIdMap.set(buscaKeys[j], id);
          paraUpdate.push({
            id,
            ...(e.cover_url ? { cover_url: e.cover_url } : {}),
            ano:           e.ano ?? null,
            atualizado_em: agora,
          });
        } else {
          // Não existe — INSERT
          paraInsert.push({
            titulo_normalizado: e.titulo_normalizado,
            tipo:               e.tipo,
            ...(e.cover_url ? { cover_url: e.cover_url } : {}),
            ano:           e.ano ?? null,
            atualizado_em: agora,
          });
        }
      }

      // 4. Executa updates
      if (paraUpdate.length > 0) {
        const { error } = await supabaseAdmin
          .from("catalog_master")
          .upsert(paraUpdate, { onConflict: "id", ignoreDuplicates: false });
        if (error) console.error(`[CATALOG-ELITE] Erro update master lote ${i}:`, error.message);
      }

      // 5. Executa inserts e captura IDs gerados
      if (paraInsert.length > 0) {
        const { data: inseridos, error } = await supabaseAdmin
          .from("catalog_master")
          .insert(paraInsert)
          .select("id, titulo_normalizado");
        if (error) {
          console.error(`[CATALOG-ELITE] Erro insert master lote ${i}:`, error.message);
        } else {
          for (const row of inseridos || []) {
            // Calcula titulo_busca localmente — não depende do trigger via PostgREST
            masterIdMap.set(normalizarTituloBusca(row.titulo_normalizado), row.id);
          }
          novosTitulosContados += inseridos?.length ?? 0;
        }
      }
    }

    // ── 4b. Log de IDs encontrados ────────────────────────────────────────────
    console.log(`[CATALOG-ELITE] IDs resolvidos: ${masterIdMap.size} de ${todasMaster.length}`);

    log.etapas.master = {
      ok:                  true,
      titulos_processados: todasMaster.length,
      ids_encontrados:     masterIdMap.size,
    };

    // ── 4c. Upsert catalog_availability ──────────────────────────────────────
    // ignoreDuplicates: true → DO NOTHING se já existe (preserva adicionado_em original)
const availabilityRows = [...filmesUnicos, ...seriesUnicas.master]
      .map(e => {
        const master_id = masterIdMap.get(normalizarTituloBusca(e.titulo_normalizado));
        if (!master_id) return null;
        return { master_id, servidor: SERVIDOR, categoria_origem: e.categoria_origem, sincronizado_em: agora };
      })
      .filter(Boolean) as Array<{ master_id: string; servidor: string; categoria_origem: string }>;

    console.log(`[CATALOG-ELITE] Upsert catalog_availability: ${availabilityRows.length} entradas...`);
    let availabilityNovos = 0;
    for (let i = 0; i < availabilityRows.length; i += BATCH_AVAILABILITY) {
      const lote = availabilityRows.slice(i, i + BATCH_AVAILABILITY);
      const { error } = await supabaseAdmin
        .from("catalog_availability")
        .upsert(lote, {
          onConflict:       "master_id,servidor",
          ignoreDuplicates: false,
        });

      if (error) {
        console.error(`[CATALOG-ELITE] Erro availability lote ${i}:`, error.message);
      } else {
        availabilityNovos += lote.length;
      }
    }

    // ── 4d. Upsert catalog_episodes ───────────────────────────────────────────
    // ignoreDuplicates: true → DO NOTHING se episódio já existe (preserva adicionado_em)
    const episodeRows = seriesUnicas.episodios
      .map(ep => {
        const master_id = masterIdMap.get(normalizarTituloBusca(ep.titulo_normalizado));
        if (!master_id) return null;
        return {
          master_id,
          servidor:  SERVIDOR,
          temporada: ep.temporada!,
          episodio:  ep.episodio!,
          cover_url: ep.cover_url || null,
        };
      })
      .filter(Boolean) as Array<{
        master_id: string;
        servidor:  string;
        temporada: number;
        episodio:  number;
        cover_url: string | null;
      }>;

    console.log(`[CATALOG-ELITE] Upsert catalog_episodes: ${episodeRows.length} episódios...`);
    let episodiosNovos = 0;
    for (let i = 0; i < episodeRows.length; i += BATCH_EPISODES) {
      const lote = episodeRows.slice(i, i + BATCH_EPISODES);
      const { error } = await supabaseAdmin
        .from("catalog_episodes")
        .upsert(lote, {
          onConflict:       "master_id,servidor,temporada,episodio",
          ignoreDuplicates: true,
        });

      if (error) {
        console.error(`[CATALOG-ELITE] Erro episodes lote ${i}:`, error.message);
      } else {
        novosEpisodiosContados += lote.length; // mantém o nome consistente
      }
    }

    // ── 4e. Atualizar contadores de temporadas/episódios (RPC) ───────────────
    console.log(`[CATALOG-ELITE] Atualizando contadores...`);
    const { error: rpcErr } = await supabaseAdmin
      .rpc("catalog_atualizar_contadores", { p_servidor: SERVIDOR });

    if (rpcErr) console.error(`[CATALOG-ELITE] Erro RPC contadores:`, rpcErr.message);

    // ── 5. Resultado ──────────────────────────────────────────────────────────
    const duracao = Math.round((Date.now() - inicio) / 1000);

    // Conta totais no banco DEPOIS do sync
    const { count: totalAvailDepois } = await supabaseAdmin
      .from("catalog_availability").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);
    const { count: totalEpisodiosDepois } = await supabaseAdmin
      .from("catalog_episodes").select("*", { count: "exact", head: true })
      .eq("servidor", SERVIDOR);

    log.resultado = {
      duracao_s:       duracao,
      filmes:          filmesUnicos.length,
      series_unicas:   seriesUnicas.master.length,
      episodios:       episodeRows.length,
      novos_titulos:   Math.max(0, (totalAvailDepois    || 0) - (totalAvailAntes    || 0)),
      novos_episodios: Math.max(0, (totalEpisodiosDepois || 0) - (totalEpisodiosAntes || 0)),
      banco_titulos:   totalAvailDepois    || 0,
      banco_episodios: totalEpisodiosDepois || 0,
    };

    await salvarLog(log);
    console.log(`[CATALOG-ELITE] Concluído em ${duracao}s`, log.resultado);

    return NextResponse.json({ ok: true, ...log.resultado });

  } catch (e: any) {
    log.erro = e.message;
    await salvarLog(log);
    console.error(`[CATALOG-ELITE] Erro fatal:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Deduplicar filmes: mantém o primeiro com cover_url; se não tiver, mantém o primeiro */
function deduplicarPorTitulo(filmes: EntradaCatalogo[]): EntradaCatalogo[] {
  const mapa = new Map<string, EntradaCatalogo>();
  for (const f of filmes) {
    const existente = mapa.get(f.titulo_normalizado);
    if (!existente || (!existente.cover_url && f.cover_url)) {
      mapa.set(f.titulo_normalizado, f);
    }
  }
  return [...mapa.values()];
}

/**
 * Séries:
 *  master   → uma entrada por título único (catalog_master + catalog_availability)
 *  episodios → todos os episódios individuais (catalog_episodes)
 */
function agruparSeries(series: EntradaCatalogo[]): {
  master:    EntradaCatalogo[];
  episodios: EntradaCatalogo[];
} {
  const masterMap = new Map<string, EntradaCatalogo>();
  for (const ep of series) {
    const existente = masterMap.get(ep.titulo_normalizado);
    if (!existente || (!existente.cover_url && ep.cover_url)) {
      masterMap.set(ep.titulo_normalizado, ep);
    }
  }
  return {
    master:    [...masterMap.values()],
    episodios: series,
  };
}

/** Salva log de execução no R2 */
async function salvarLog(log: Record<string, any>): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         LOG_KEY,
      Body:        JSON.stringify(log, null, 2),
      ContentType: "application/json",
    }));
  } catch (e) {
    console.error("[CATALOG-ELITE] Erro ao salvar log no R2:", e);
  }
}
