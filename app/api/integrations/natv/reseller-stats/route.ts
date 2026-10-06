// app/api/integrations/natv/reseller-stats/route.ts
// ✅ 06/10/2026, pedido do Márcio: botão "Sync" no servidor vinculado à
// revenda — créditos da revenda, clientes ativos/expirados/bloqueados e quem
// vence nos próximos 2 dias, direto do painel do NaTV.
//   action "get"  → último resumo salvo (reseller_servers.panel_stats), sem
//                   chamar o NaTV;
//   action "sync" → consulta o NaTV e salva. O relatório de clientes do NaTV
//                   só pode ser chamado 1x por minuto — Sync repetido em menos
//                   de 60s devolve o resumo salvo.
// Só leitura no NaTV. Nunca guarda/devolve senha de cliente.
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";
import { natvAllUsersReport, natvFindSubreseller } from "@/lib/integrations/natv-credits";
import { supportsCreditTransfer } from "@/lib/integrations/credit-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SYNC_INTERVAL_MS = 60 * 1000;
const SOON_MS = 2 * 24 * 60 * 60 * 1000;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// "2026-10-15 18:19:18" (horário do painel, Brasil) → epoch ms
function parsePanelDate(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}-03:00`);
  return Number.isFinite(t) ? t : null;
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUser = await createSupabaseServer();
    const { data: auth } = await supabaseUser.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return jsonError(401, "Unauthorized");

    const admin = createSupabaseAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action || "get");
    const rsId = String(body?.reseller_server_id || "").trim();
    if (!UUID_RE.test(rsId)) return jsonError(400, "reseller_server_id inválido.");

    const { data: rs } = await admin
      .from("reseller_servers")
      .select("id, tenant_id, server_id, server_username, panel_stats, panel_stats_at")
      .eq("id", rsId)
      .maybeSingle();
    if (!rs) return jsonError(404, "Vínculo não encontrado.");
    const { data: member } = await admin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", rs.tenant_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) return jsonError(404, "Vínculo não encontrado.");

    const { data: server } = await admin
      .from("servers")
      .select("panel_integration")
      .eq("id", rs.server_id)
      .eq("tenant_id", rs.tenant_id)
      .maybeSingle();
    const { data: integ } = server?.panel_integration
      ? await admin
          .from("server_integrations")
          .select("id, provider, api_token, is_active")
          .eq("id", server.panel_integration)
          .eq("tenant_id", rs.tenant_id)
          .maybeSingle()
      : { data: null as any };
    const provider = String(integ?.provider || "").toUpperCase();
    if (provider !== "NATV" || !supportsCreditTransfer(provider)) {
      return NextResponse.json({ ok: true, supported: false });
    }

    const cached = { ok: true, supported: true, stats: rs.panel_stats ?? null, synced_at: rs.panel_stats_at ?? null };
    if (action === "get") return NextResponse.json(cached);
    if (action !== "sync") return jsonError(400, "action inválida.");

    if (rs.panel_stats_at && Date.now() - new Date(rs.panel_stats_at).getTime() < MIN_SYNC_INTERVAL_MS) {
      return NextResponse.json({ ...cached, note: "Sincronizado há menos de 1 minuto (limite do NaTV) — mostrando o último resumo." });
    }

    const token = String(integ?.api_token || "").trim();
    if (!token || integ?.is_active === false) return jsonError(400, "Integração NaTV sem chave ou desativada.");
    const username = String(rs.server_username || "").trim();
    if (!username) return jsonError(400, "A revenda não tem usuário do painel cadastrado nesse servidor.");

    const sub = await natvFindSubreseller(token, username);
    if (!sub) return jsonError(404, `"${username}" não aparece como sub-revenda direta da sua conta no NaTV.`);
    await new Promise((r) => setTimeout(r, 200)); // intervalo global do NaTV (150ms)
    const report = await natvAllUsersReport(token);

    const now = Date.now();
    const mine = report.filter((u) => u.reseller.toLowerCase() === username.toLowerCase());
    const expiringSoon = mine
      .map((u) => ({ u, t: parsePanelDate(u.expiresAt) }))
      .filter(({ u, t }) => t !== null && t >= now && t <= now + SOON_MS && !u.blocked)
      .sort((a, b) => (a.t as number) - (b.t as number))
      .map(({ u }) => ({ username: u.username, expires_at: u.expiresAt }));

    const stats = {
      credits: sub.credits,
      account_status: sub.status === 1 ? "ativa" : "bloqueada",
      total: mine.length,
      active: mine.filter((u) => u.status.toLowerCase() === "ativo" && !u.blocked).length,
      expired: mine.filter((u) => u.status.toLowerCase() !== "ativo" && !u.blocked).length,
      blocked: mine.filter((u) => u.blocked).length,
      expiring_2d: expiringSoon,
    };
    const syncedAt = new Date().toISOString();
    await admin.from("reseller_servers").update({ panel_stats: stats, panel_stats_at: syncedAt }).eq("id", rs.id);

    return NextResponse.json({ ok: true, supported: true, stats, synced_at: syncedAt });
  } catch (e: any) {
    console.error("[integration_error:natv:reseller-stats]", { message: e?.message, kind: "integration_error", provider: "natv" });
    return jsonError(502, e?.message || "Falha ao consultar o NaTV.");
  }
}
