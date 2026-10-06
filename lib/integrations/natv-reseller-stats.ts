// lib/integrations/natv-reseller-stats.ts
// ✅ 06/10/2026: resumo do painel de uma revenda (créditos, clientes
// ativos/expirados/bloqueados, quem vence em 2 dias) salvo em
// reseller_servers.panel_stats. Usado pelo botão Sync do admin
// (app/api/integrations/natv/reseller-stats) e pelo Portal da Revenda, que
// sincroniza sozinho ao abrir (app/api/reseller-portal/home).
// Só leitura no NaTV; o relatório de clientes só aceita 1 chamada por minuto,
// então dentro de 60s devolve o resumo salvo. Nunca guarda senha de cliente.
import type { SupabaseClient } from "@supabase/supabase-js";
import { natvAllUsersReport, natvFindSubreseller } from "@/lib/integrations/natv-credits";

export const MIN_SYNC_INTERVAL_MS = 60 * 1000;
const SOON_MS = 2 * 24 * 60 * 60 * 1000;

export type ResellerPanelStats = {
  credits: number;
  account_status: "ativa" | "bloqueada";
  total: number;
  active: number;
  expired: number;
  blocked: number;
  expiring_2d: { username: string; expires_at: string | null }[];
};

// "2026-10-15 18:19:18" (horário do painel, Brasil) → epoch ms
function parsePanelDate(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}-03:00`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Consulta o NaTV e salva o resumo. Dentro de 60s do último Sync devolve o
 * salvo (throttled=true). Lança erro com mensagem amigável se o NaTV falhar.
 */
export async function syncNatvResellerStats(
  admin: SupabaseClient,
  params: { resellerServerId: string; token: string; username: string; lastSyncAt: string | null; cached: ResellerPanelStats | null },
): Promise<{ stats: ResellerPanelStats | null; synced_at: string | null; throttled: boolean }> {
  if (params.lastSyncAt && Date.now() - new Date(params.lastSyncAt).getTime() < MIN_SYNC_INTERVAL_MS) {
    return { stats: params.cached, synced_at: params.lastSyncAt, throttled: true };
  }
  const sub = await natvFindSubreseller(params.token, params.username);
  if (!sub) throw new Error(`"${params.username}" não aparece como sub-revenda direta da sua conta no NaTV.`);
  await new Promise((r) => setTimeout(r, 200)); // intervalo global do NaTV (150ms)
  const report = await natvAllUsersReport(params.token);

  const now = Date.now();
  const mine = report.filter((u) => u.reseller.toLowerCase() === params.username.toLowerCase());
  const expiring_2d = mine
    .map((u) => ({ u, t: parsePanelDate(u.expiresAt) }))
    .filter(({ u, t }) => t !== null && t >= now && t <= now + SOON_MS && !u.blocked)
    .sort((a, b) => (a.t as number) - (b.t as number))
    .map(({ u }) => ({ username: u.username, expires_at: u.expiresAt }));

  const stats: ResellerPanelStats = {
    credits: sub.credits,
    account_status: sub.status === 1 ? "ativa" : "bloqueada",
    total: mine.length,
    active: mine.filter((u) => u.status.toLowerCase() === "ativo" && !u.blocked).length,
    expired: mine.filter((u) => u.status.toLowerCase() !== "ativo" && !u.blocked).length,
    blocked: mine.filter((u) => u.blocked).length,
    expiring_2d,
  };
  const synced_at = new Date().toISOString();
  await admin.from("reseller_servers").update({ panel_stats: stats, panel_stats_at: synced_at }).eq("id", params.resellerServerId);
  return { stats, synced_at, throttled: false };
}

/** Chave do NaTV do servidor do vínculo (null = servidor sem integração NaTV ativa). */
export async function loadNatvTokenForServer(admin: SupabaseClient, tenantId: string, serverId: string): Promise<string | null> {
  const { data: server } = await admin.from("servers").select("panel_integration").eq("id", serverId).eq("tenant_id", tenantId).maybeSingle();
  if (!server?.panel_integration) return null;
  const { data: integ } = await admin
    .from("server_integrations")
    .select("provider, api_token, is_active")
    .eq("id", server.panel_integration)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!integ || String(integ.provider).toUpperCase() !== "NATV" || integ.is_active === false) return null;
  const token = String(integ.api_token || "").trim();
  return token || null;
}
