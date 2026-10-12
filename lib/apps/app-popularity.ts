// lib/apps/app-popularity.ts
// ✅ 12/10/2026 (pedido do Márcio): o modal de apps ordena por estrelas →
// mais clientes usando → com integração → alfabética. Nos PORTAIS (cliente e
// revenda) o JSON não pode levar o número real de clientes do Márcio por app
// (qualquer um veria no DevTools) — então vai só uma pontuação de
// popularidade: maior = mais usado, empate = mesma pontuação. No admin
// (novo_cliente.tsx) usa o número real, tanto faz.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getAppPopularityScores(sb: SupabaseClient, tenantId: string): Promise<Record<string, number>> {
  try {
    const { data } = await sb.rpc("app_user_counts", { p_tenant_id: tenantId });
    const counts = ((data as any[]) || []).map((r) => ({ id: String(r.app_id), n: Number(r.users) || 0 }));
    // posição densa: contagens distintas em ordem crescente → 1, 2, 3...
    const levels = [...new Set(counts.map((c) => c.n))].sort((a, b) => a - b);
    const score: Record<string, number> = {};
    for (const c of counts) score[c.id] = levels.indexOf(c.n) + 1;
    return score;
  } catch {
    return {}; // sem pontuação = só estrelas → integração → alfabética
  }
}
