// app/api/catalogo/limpar/route.ts
//
// GET  → preview: quantos seriam deletados por servidor
// POST → executa limpeza: remove títulos que não apareceram no último sync
//
// Lógica (corrigido 05/08/2026 — o comentário antigo aqui descrevia "corte
// na meia-noite do dia anterior", mas o código sempre fez outra coisa):
//   - Pega o MAX(sincronizado_em) de cada servidor
//   - Deleta tudo com sincronizado_em mais de 1h ANTES desse máximo (ou seja,
//     tudo que não fez parte do sync mais recente)
//   - Remove episódios órfãos e órfãos do catalog_master
//
// Lógica de verdade agora mora em lib/catalogo/limpar-orfaos.ts — essa rota
// só orquestra (preview no GET, execução no POST). Além do cron diário
// (sync_catalog_limpar_daily, roda 1x às 06:20 UTC), essa mesma limpeza
// agora também dispara automaticamente logo no fim de CADA sync bem-sucedido
// (elite/natv/fast) — achado 05/08/2026: se um sync falhar (ex: Fast não
// conseguiu baixar o M3U em 01/08/2026) e for recuperado manualmente mais
// tarde no dia, o cron diário (que já rodou de manhã) nunca pegava os
// órfãos daquele sync tardio — só no dia seguinte, ou com um clique manual
// aqui. Chamar a limpeza direto no fim do sync fecha esse buraco.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isCronRequest } from "@/lib/internal-auth";
import {
  SERVIDORES_CATALOGO,
  type ServidorCatalogo,
  previewOrfaos,
  limparOrfaosServidor,
  limparMasterOrfaos,
} from "@/lib/catalogo/limpar-orfaos";

export async function GET(req: NextRequest) {
  const isCron = isCronRequest(req, "EPG_SYNC_CRON_SECRET");
  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const preview = await previewOrfaos();
  return NextResponse.json({ ok: true, preview });
}

export async function POST(req: NextRequest) {
  const isCron = isCronRequest(req, "EPG_SYNC_CRON_SECRET");

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}))
  const { servidor } = body
  if (!servidor) return NextResponse.json({ error: "servidor obrigatório" }, { status: 400 });

  const alvos: ServidorCatalogo[] = servidor === "TODOS" ? [...SERVIDORES_CATALOGO] : [servidor as ServidorCatalogo];
  const resultado: Record<string, number> = {};

  for (const srv of alvos) {
    const r = await limparOrfaosServidor(srv);
    resultado[srv] = r.removidos;
    resultado[`${srv}_episodios_orfaos`] = r.episodios_orfaos;
  }

  const orfaosRemovidos = await limparMasterOrfaos();

  return NextResponse.json({ ok: true, resultado, orfaos_removidos: orfaosRemovidos });
}