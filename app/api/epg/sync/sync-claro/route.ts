// app/api/epg/sync/sync-claro/route.ts
//
// GET  → status: total de canais e programas no banco
// POST → sync completo:
//   1. Busca programação da Claro (hoje + amanhã, cidade 22 = RJ)
//   2. Filtra só os canais da nossa lista (epg_canais)
//   3. Upsert em epg_programas (fallback HD se SD vazio)
//   4. Deleta programas encerrados há mais de 1h
//   5. Monta JSON e sobe no R2

import { NextRequest, NextResponse } from "next/server";
import { createClient }              from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand }  from "@aws-sdk/client-s3";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
const EPG_KEY   = "epg/epg_claro.json";

const CIDADES = ["22", "1"]; // RJ e SP — Globo/SBT/Record/Band têm afiliadas regionais
const IMG_BASE  = "https://getcdn.nowonline.com.br/images_epg/360_540";

function montarImagemUrl(eventimagename: string): string | null {
  if (!eventimagename?.trim()) return null;
  // Mantém o ID exatamente como veio da Claro, sem padding
  return eventimagename.trim();
}

function janelaDatas(): { inicio: string; fim: string } {
  const agora  = new Date();
  const hoje   = new Date(agora);
  hoje.setUTCHours(0, 0, 0, 0);

  const amanha = new Date(hoje);
  amanha.setUTCDate(amanha.getUTCDate() + 2); // hoje + amanhã completo
  amanha.setUTCHours(23, 59, 59, 0);

  return {
    inicio: hoje.toISOString().replace(".000Z", "Z"),
    fim:    amanha.toISOString().replace(".000Z", "Z"),
  };
}

// ─── GET — Status ─────────────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const [{ count: totalCanais }, { count: totalProgramas }] = await Promise.all([
    supabaseAdmin.from("epg_canais").select("*", { count: "exact", head: true }).eq("ativo", true),
    supabaseAdmin.from("epg_programas").select("*", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    ok: true,
    total_canais:    totalCanais    || 0,
    total_programas: totalProgramas || 0,
    executado_em:    new Date().toISOString(),
  });
}

// ─── POST — Sync ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const inicio = Date.now();

  // Permite cron sem sessão via secret no header
  const cronAuth = req.headers.get("authorization");
  const isCron   = cronAuth === `Bearer ${process.env.EPG_SYNC_CRON_SECRET}`;

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    // ── 1. Busca canais ativos do banco ──────────────────────────────────────
    const { data: canaisDb, error: canaisErr } = await supabaseAdmin
      .from("epg_canais")
      .select("id_canal, nome, categoria, url_logo, cn_canal, id_canal_hd, ativo")
      .eq("ativo", true);

    if (canaisErr || !canaisDb?.length) {
      return NextResponse.json({ error: "Falha ao buscar canais do banco" }, { status: 500 });
    }

    // Mapa id_canal → canal (inclui HD para fallback)
    const todosCanaisIds = new Set<number>();
    const canaisMap = new Map<number, typeof canaisDb[0]>();
    for (const c of canaisDb) {
      canaisMap.set(c.id_canal, c);
      todosCanaisIds.add(c.id_canal);
      if (c.id_canal_hd) todosCanaisIds.add(c.id_canal_hd);
    }

    // ── 2. Busca programação da Claro (múltiplas cidades: RJ + SP) ────────
    const { inicio: dtInicio, fim: dtFim } = janelaDatas();
    console.log(`[EPG-CLARO] Buscando programação: ${dtInicio} → ${dtFim}`);

    const programacaoClaro: any[] = [];
    for (const cidade of CIDADES) {
      const url = `https://programacao.claro.com.br/gatekeeper/exibicao/select?q=id_cidade:${cidade}&wt=json&rows=100000&sort=id_canal+asc,dh_inicio+asc&fl=id_exibicao,id_canal,titulo,dh_inicio,dh_fim,genero,eventimagename,elenco,diretor&fq=dh_inicio:[${dtInicio}+TO+${dtFim}]`;
      try {
        const resp = await fetch(url, {
          signal:  AbortSignal.timeout(30_000),
          headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const docs = json?.response?.docs || [];
        programacaoClaro.push(...docs);
        console.log(`[EPG-CLARO] Cidade ${cidade}: ${docs.length} programas`);
      } catch (e: any) {
        console.error(`[EPG-CLARO] Falha cidade ${cidade}: ${e.message}`);
        // Não aborta o sync inteiro se uma cidade falhar — segue com a outra
      }
    }

    if (programacaoClaro.length === 0) {
      return NextResponse.json({
        error: `Falha ao buscar Claro: nenhuma cidade retornou dados`,
        dica:  "A API da Claro pode estar bloqueando requisições do servidor Vercel.",
      }, { status: 502 });
    }

    console.log(`[EPG-CLARO] ${programacaoClaro.length} programas recebidos da Claro (todas as cidades)`);

    // ── 3. Filtra e monta programas ───────────────────────────────────────
    // Agrupa por canal para fazer fallback HD → SD
    const programasPorCanal = new Map<number, any[]>();
    for (const p of programacaoClaro) {
      const idCanal = parseInt(p.id_canal);
      if (!todosCanaisIds.has(idCanal)) continue;
      const arr = programasPorCanal.get(idCanal) || [];
      arr.push(p);
      programasPorCanal.set(idCanal, arr);
    }

    // Para cada canal principal, usa HD se disponível como fallback
    const programasParaUpsert: any[] = [];
    const canaisPrincipais = canaisDb.filter(c => c.categoria !== "HD");

    for (const canal of canaisPrincipais) {
      const progsSD = programasPorCanal.get(canal.id_canal) || [];
      const progsHD = canal.id_canal_hd ? (programasPorCanal.get(canal.id_canal_hd) || []) : [];

      // Usa SD se tiver, senão HD como fallback
      const progs = progsSD.length > 0 ? progsSD : progsHD;

      for (const p of progs) {
        programasParaUpsert.push({
          id_exibicao: p.id_exibicao,
          id_canal:    canal.id_canal, // sempre o canal principal
          titulo:      p.titulo || "",
          inicio:      p.dh_inicio ? p.dh_inicio.replace("Z", "-03:00") : null,
          fim:         p.dh_fim ? p.dh_fim.replace("Z", "-03:00") : null,
          genero:      p.genero || null,
          imagem_url:  montarImagemUrl(p.eventimagename),
          elenco:      p.elenco?.trim() || null,
          diretor:     p.diretor?.trim() || null,
        });
      }
    }

    console.log(`[EPG-CLARO] ${programasParaUpsert.length} programas para upsert`);

    // ── 4. Upsert em lotes de 500 ─────────────────────────────────────────
    const BATCH = 500;
    let erros = 0;
    for (let i = 0; i < programasParaUpsert.length; i += BATCH) {
      const { error } = await supabaseAdmin
        .from("epg_programas")
        .upsert(programasParaUpsert.slice(i, i + BATCH), {
          onConflict:       "id_exibicao",
          ignoreDuplicates: false,
        });
      if (error) {
        console.error(`[EPG-CLARO] Erro upsert lote ${i}:`, error.message);
        erros++;
      }
    }

    // ── 5. Deleta programas encerrados há mais de 3h ──────────────────────
    const corte = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { error: deleteErr } = await supabaseAdmin
      .from("epg_programas")
      .delete()
      .lt("fim", corte);

    if (deleteErr) console.error(`[EPG-CLARO] Erro ao deletar passados:`, deleteErr.message);

// ── 6. Atualiza logos dos canais via API Claro (RJ + SP) ──────────────
    // Ignora logos genéricas da Claro (fallback "claro.svg") para não sobrescrever
    // correções manuais aplicadas quando a API não retorna a logo real do canal.
    function isLogoGenerica(url: string): boolean {
      return /\/claro\.svg(\?|$)/i.test(url.trim());
    }

    try {
      const logosMap = new Map<number, string>();
      for (const cidade of CIDADES) {
        const resCanais = await fetch(
          `https://programacao.claro.com.br/gatekeeper/canal/select?q=id_cidade:${cidade}&wt=json&rows=1000&sort=cn_canal+asc&fl=id_canal,url_imagem&fq=nome:*`,
          { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (!resCanais.ok) continue;
        const jsonCanais = await resCanais.json();
        for (const c of jsonCanais?.response?.docs || []) {
          if (!c.id_canal || !c.url_imagem) continue;
          if (isLogoGenerica(c.url_imagem)) continue; // pula logo genérica, mantém a atual
          const id = parseInt(c.id_canal);
          if (!logosMap.has(id)) logosMap.set(id, c.url_imagem);
        }
      }

      const canaisComLogo = canaisPrincipais.filter(c => logosMap.has(c.id_canal));
      if (canaisComLogo.length > 0) {
        const updates = canaisComLogo.map(c => ({
          id_canal:      c.id_canal,
          nome:          c.nome,
          categoria:     c.categoria,
          url_logo:      logosMap.get(c.id_canal)!,
          atualizado_em: new Date().toISOString(),
        }));
        await supabaseAdmin
          .from("epg_canais")
          .upsert(updates, { onConflict: "id_canal", ignoreDuplicates: false });
      }
      console.log(`[EPG-CLARO] Logos atualizadas: ${canaisComLogo.length} canais (genéricas ignoradas)`);
    } catch (e: any) {
      console.warn(`[EPG-CLARO] Falha ao atualizar logos:`, e.message);
    }

// ── 7. Monta JSON para R2 ─────────────────────────────────────────────
    // Rebusca canais com logos atualizadas
    const { data: canaisComLogosAtualizadas } = await supabaseAdmin
      .from("epg_canais")
      .select("id_canal, nome, categoria, url_logo, cn_canal")
      .eq("ativo", true)
      .neq("categoria", "HD");

// Busca paginada para superar o limite de 1000 do PostgREST
    const programasDb: any[] = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data: lote, error } = await supabaseAdmin
        .from("epg_programas")
        .select("id_canal, inicio, fim, titulo, genero, imagem_url, elenco, diretor")
        .order("id_canal", { ascending: true })
        .order("inicio",   { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error || !lote?.length) break;
      programasDb.push(...lote);
      if (lote.length < PAGE) break;
      offset += PAGE;
    }

    const payload = {
      gerado_em:       new Date().toISOString(),
      fonte:           "Claro",
      cidade:          "Rio de Janeiro",
      total_canais:    canaisPrincipais.length,
      total_programas: programasDb?.length || 0,
canais: (canaisComLogosAtualizadas || canaisPrincipais).map(c => ({
  id:           String(c.id_canal),
  display_name: c.nome,
  nome:         c.nome,
  categoria:    c.categoria,
  icon:         c.url_logo || "",
  servidor:     "CLARO",
  cn_canal:     c.cn_canal,
})),
programas: (programasDb || []).map(p => ({
  channel_id:   String(p.id_canal),
  channel_nome: "", // preenchido pelo front via canal
  categoria:    "",
        start:        p.inicio,
        stop:         p.fim,
        title:        p.titulo,
        genero:       p.genero,
        prog_icon:    p.imagem_url,
        desc:         [p.elenco, p.diretor].filter(Boolean).join(" | ") || "",
      })),
    };

    await s3.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         EPG_KEY,
      Body:        JSON.stringify(payload),
      ContentType: "application/json",
      CacheControl: "no-cache, no-store, must-revalidate",
    }));

    const duracao = Math.round((Date.now() - inicio) / 1000);
    console.log(`[EPG-CLARO] Concluído em ${duracao}s — ${programasParaUpsert.length} programas`);

    return NextResponse.json({
      ok:              true,
      duracao_s:       duracao,
      total_programas: programasParaUpsert.length,
      erros_lote:      erros,
      janela:          { inicio: dtInicio, fim: dtFim },
    });

  } catch (e: any) {
    console.error(`[EPG-CLARO] Erro fatal:`, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}