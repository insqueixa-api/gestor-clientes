// app/api/integrations/natv/reseller-stats/route.ts
// ✅ 06/10/2026, pedido do Márcio: botão "Sync" no servidor vinculado à
// revenda — créditos da revenda, clientes ativos/expirados/bloqueados e quem
// vence nos próximos 2 dias, direto do painel do NaTV.
//   action "get"  → último resumo salvo (reseller_servers.panel_stats), sem
//                   chamar o NaTV;
//   action "sync" → consulta o NaTV e salva (lib/integrations/natv-reseller-stats,
//                   a mesma usada pelo Portal da Revenda ao abrir).
// Só leitura no NaTV. Nunca guarda/devolve senha de cliente.
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";
import { loadNatvTokenForServer, syncNatvResellerStats } from "@/lib/integrations/natv-reseller-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
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

    const token = await loadNatvTokenForServer(admin, rs.tenant_id, rs.server_id);
    if (!token) return NextResponse.json({ ok: true, supported: false });

    const cached = { ok: true, supported: true, stats: rs.panel_stats ?? null, synced_at: rs.panel_stats_at ?? null };
    if (action === "get") return NextResponse.json(cached);
    if (action !== "sync") return jsonError(400, "action inválida.");

    const username = String(rs.server_username || "").trim();
    if (!username) return jsonError(400, "A revenda não tem usuário do painel cadastrado nesse servidor.");

    const r = await syncNatvResellerStats(admin, {
      resellerServerId: rs.id,
      token,
      username,
      lastSyncAt: rs.panel_stats_at ?? null,
      cached: rs.panel_stats ?? null,
    });
    return NextResponse.json({
      ok: true,
      supported: true,
      stats: r.stats,
      synced_at: r.synced_at,
      ...(r.throttled ? { note: "Sincronizado há menos de 1 minuto (limite do NaTV) — mostrando o último resumo." } : {}),
    });
  } catch (e: any) {
    console.error("[integration_error:natv:reseller-stats]", { message: e?.message, kind: "integration_error", provider: "natv" });
    return jsonError(502, e?.message || "Falha ao consultar o NaTV.");
  }
}
