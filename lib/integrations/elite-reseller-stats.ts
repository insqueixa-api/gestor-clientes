// lib/integrations/elite-reseller-stats.ts
// ✅ 09/10/2026: resumo da revenda no Elite (saldo + situação da conta) salvo
// em reseller_servers.panel_stats — mesmo lugar do resumo do NaTV
// (natv-reseller-stats.ts). A API do Elite NÃO lista clientes de sub-revenda
// (só os da própria conta), então aqui não há total/ativos/vencidos:
// clients_available=false e as telas escondem o bloco "Seus Clientes".
// O Márcio pediu pra não chamar o Elite à toa: no máximo 1 consulta a cada
// 5 minutos por revenda (dentro disso devolve o salvo).
import type { SupabaseClient } from "@supabase/supabase-js";
import { eliteFindSubreseller } from "@/lib/integrations/elite-transfer";
import type { EliteIntegration } from "@/lib/integrations/elite-api";

export const ELITE_MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type EliteResellerStats = {
  credits: number;
  account_status: "ativa" | "bloqueada";
  clients_available: false;
};

export async function syncEliteResellerStats(
  admin: SupabaseClient,
  params: { resellerServerId: string; integ: EliteIntegration; username: string; lastSyncAt: string | null; cached: any },
): Promise<{ stats: any; synced_at: string | null; throttled: boolean }> {
  if (params.lastSyncAt && Date.now() - new Date(params.lastSyncAt).getTime() < ELITE_MIN_SYNC_INTERVAL_MS) {
    return { stats: params.cached, synced_at: params.lastSyncAt, throttled: true };
  }
  const sub = await eliteFindSubreseller(params.integ, params.username);
  if (!sub) throw new Error(`"${params.username}" não aparece como sub-revenda direta da sua conta no Elite.`);
  const stats: EliteResellerStats = {
    credits: Number(sub.credits ?? 0),
    account_status: sub.active ? "ativa" : "bloqueada",
    clients_available: false,
  };
  const synced_at = new Date().toISOString();
  await admin.from("reseller_servers").update({ panel_stats: stats, panel_stats_at: synced_at }).eq("id", params.resellerServerId);
  return { stats, synced_at, throttled: false };
}

/** Integração Elite ativa do servidor (null = servidor não é Elite / sem chave). */
export async function loadEliteIntegrationForServer(admin: SupabaseClient, tenantId: string, serverId: string): Promise<EliteIntegration | null> {
  const { data: server } = await admin.from("servers").select("panel_integration").eq("id", serverId).eq("tenant_id", tenantId).maybeSingle();
  if (!server?.panel_integration) return null;
  const { data: integ } = await admin
    .from("server_integrations")
    .select("id, tenant_id, provider, api_token, is_active, api_base_url, integration_name, proxy_url")
    .eq("id", server.panel_integration)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!integ || String(integ.provider).toUpperCase() !== "ELITE" || integ.is_active === false || !String(integ.api_token || "").trim()) return null;
  return integ as any;
}
