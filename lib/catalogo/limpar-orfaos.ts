// lib/catalogo/limpar-orfaos.ts
// Lógica de limpeza de títulos órfãos (saíram do servidor desde o último
// sync) — extraída de app/api/catalogo/limpar/route.ts pra poder ser
// chamada tanto pela rota manual/cron quanto direto ao FINAL de cada sync
// de catálogo (elite/natv/fast). Ver docs/sql ou o achado de 05/08/2026:
// o cron diário de limpeza roda num horário fixo (06:20 UTC) que normalmente
// vem depois dos 3 syncs, mas se um sync FALHAR e for recuperado manualmente
// mais tarde no dia (ex: falha real de download de M3U do Fast em
// 01/08/2026), a limpeza automática já rodou antes e nunca pega os órfãos
// gerados por essa sincronização tardia — só o próximo dia, ou um clique
// manual em "Limpar Agora". Chamar isso no fim de cada sync bem-sucedido
// resolve isso: a limpeza sempre acontece logo depois do sync de verdade,
// não num horário só estimado.
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const SERVIDORES_CATALOGO = ["ELITE", "NATV", "FAST"] as const;
export type ServidorCatalogo = (typeof SERVIDORES_CATALOGO)[number];

function calcularCorte(ultimoSync: string): Date {
  // Corte = 1 hora antes do último sync (títulos que não apareceram nesse sync)
  const corte = new Date(ultimoSync);
  corte.setHours(corte.getHours() - 1);
  return corte;
}

/** Preview: quantos registros de catalog_availability seriam removidos hoje, por servidor. */
export async function previewOrfaos(): Promise<Record<string, number>> {
  const preview: Record<string, number> = {};

  for (const srv of SERVIDORES_CATALOGO) {
    const { data: maxRow } = await supabaseAdmin
      .from("catalog_availability")
      .select("sincronizado_em")
      .eq("servidor", srv)
      .order("sincronizado_em", { ascending: false })
      .limit(1)
      .single();

    if (!maxRow?.sincronizado_em) { preview[srv] = 0; continue; }

    const corte = calcularCorte(maxRow.sincronizado_em);
    const { count } = await supabaseAdmin
      .from("catalog_availability")
      .select("*", { count: "exact", head: true })
      .eq("servidor", srv)
      .lt("sincronizado_em", corte.toISOString());

    preview[srv] = count || 0;
  }

  return preview;
}

/** Remove os títulos órfãos (catalog_availability) e episódios órfãos de UM servidor. */
export async function limparOrfaosServidor(srv: ServidorCatalogo): Promise<{
  removidos: number;
  episodios_orfaos: number;
}> {
  const { data: maxRow } = await supabaseAdmin
    .from("catalog_availability")
    .select("sincronizado_em")
    .eq("servidor", srv)
    .order("sincronizado_em", { ascending: false })
    .limit(1)
    .single();

  if (!maxRow?.sincronizado_em) return { removidos: 0, episodios_orfaos: 0 };

  const corte = calcularCorte(maxRow.sincronizado_em);

  const { count: countAntes } = await supabaseAdmin
    .from("catalog_availability")
    .select("*", { count: "exact", head: true })
    .eq("servidor", srv)
    .lt("sincronizado_em", corte.toISOString());

  const { error } = await supabaseAdmin
    .from("catalog_availability")
    .delete()
    .eq("servidor", srv)
    .lt("sincronizado_em", corte.toISOString());

  let removidos = 0;
  if (error) {
    console.error(`[LIMPAR] Erro ao deletar ${srv}:`, error.message);
  } else {
    removidos = countAntes || 0;
  }

  const { data: episodiosRemovidos, error: epErr } = await supabaseAdmin
    .rpc("remover_episodios_orfaos", { p_servidor: srv });

  if (epErr) console.error(`[LIMPAR] Erro ao remover episódios órfãos de ${srv}:`, epErr.message);

  return { removidos, episodios_orfaos: episodiosRemovidos || 0 };
}

/** Remove órfãos de catalog_master (títulos sem nenhuma linha em catalog_availability). */
export async function limparMasterOrfaos(): Promise<number> {
  const { data } = await supabaseAdmin.rpc("remover_master_orfaos");
  return data || 0;
}

/**
 * Roda a limpeza completa de UM servidor (availability + episódios + master
 * órfãos) — usada logo após um sync bem-sucedido. Nunca lança: um erro aqui
 * não pode derrubar a resposta de sucesso do sync que acabou de rodar.
 */
export async function limparOrfaosAposSync(srv: ServidorCatalogo): Promise<void> {
  try {
    const r = await limparOrfaosServidor(srv);
    await limparMasterOrfaos();
    if (r.removidos || r.episodios_orfaos) {
      console.log(`[LIMPAR][pós-sync ${srv}] ${r.removidos} títulos + ${r.episodios_orfaos} episódios órfãos removidos`);
    }
  } catch (e: any) {
    console.error(`[LIMPAR][pós-sync ${srv}] falhou:`, e?.message);
  }
}
