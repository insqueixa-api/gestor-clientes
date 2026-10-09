// lib/reseller-portal/sync.ts
// ✅ 07/10/2026: sincroniza o painel de TODOS os servidores da revenda
// (resumo + espelho de clientes reseller_end_clients). Usado ao abrir o
// portal (home) e ao abrir "Gerenciar clientes e aplicativos". Dentro de 1
// minuto do último Sync (limite do relatório do NaTV) usa o salvo; se o
// painel falhar, fica o último salvo (nunca derruba a tela).
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNatvTokenForServer, syncNatvResellerStats } from "@/lib/integrations/natv-reseller-stats";
import { loadEliteIntegrationForServer, syncEliteResellerStats } from "@/lib/integrations/elite-reseller-stats";

export type ResellerLinkRow = {
  id: string;
  server_id: string;
  server_username: string | null;
  panel_stats: any;
  panel_stats_at: string | null;
};

/** Atualiza (no lugar) panel_stats/panel_stats_at de cada vínculo. */
export async function syncResellerPanels(sb: SupabaseClient, tenantId: string, links: ResellerLinkRow[]) {
  await Promise.all(
    links.map(async (l) => {
      try {
        const username = String(l.server_username || "").trim();
        if (!username) return;
        const token = await loadNatvTokenForServer(sb, tenantId, l.server_id);
        if (!token) {
          // ✅ 09/10/2026: Elite — só saldo/situação (a API não lista clientes de sub-revenda)
          const integ = await loadEliteIntegrationForServer(sb, tenantId, l.server_id);
          if (!integ) return;
          const e = await syncEliteResellerStats(sb, {
            resellerServerId: l.id,
            integ,
            username,
            lastSyncAt: l.panel_stats_at ?? null,
            cached: l.panel_stats ?? null,
          });
          l.panel_stats = e.stats;
          l.panel_stats_at = e.synced_at;
          return;
        }
        const r = await syncNatvResellerStats(sb, {
          resellerServerId: l.id,
          token,
          username,
          lastSyncAt: l.panel_stats_at ?? null,
          cached: l.panel_stats ?? null,
        });
        l.panel_stats = r.stats;
        l.panel_stats_at = r.synced_at;
      } catch (e: any) {
        console.error("[reseller_portal:auto_sync]", { message: e?.message, kind: "reseller_portal_error" });
      }
    }),
  );
}
