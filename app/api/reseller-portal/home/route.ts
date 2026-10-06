// app/api/reseller-portal/home/route.ts
// ✅ 06/10/2026: dados da tela inicial do Portal da Revenda (/revenda).
// Sessão própria (lib/reseller-portal/session.ts). Só leitura e só o que é
// DA revenda: nome, servidores vinculados (usuário do painel + último resumo
// salvo pelo Sync), compras de crédito e a Tabela Revenda (preço por faixa).
// Nunca devolve senha do painel nem dados de outra revenda/cliente.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateResellerSession, endResellerSession } from "@/lib/reseller-portal/session";
import { loadNatvTokenForServer, syncNatvResellerStats } from "@/lib/integrations/natv-reseller-stats";

export const maxDuration = 60;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" };

export async function POST(req: NextRequest) {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const body = await req.json().catch(() => ({} as any));
    const sessionToken = String(body?.session_token || "").trim();

    if (body?.action === "logout") {
      await endResellerSession(sb, sessionToken);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    const ctx = await validateResellerSession(sb, sessionToken);
    if (!ctx) return NextResponse.json({ ok: false, error: "session_invalid" }, { status: 401, headers: NO_STORE });

    const [resRes, linksRes] = await Promise.all([
      sb.from("resellers").select("display_name, created_at").eq("id", ctx.reseller_id).eq("tenant_id", ctx.tenant_id).maybeSingle(),
      sb
        .from("reseller_servers")
        .select("id, server_id, server_username, panel_stats, panel_stats_at, servers(name, logo_url)")
        .eq("tenant_id", ctx.tenant_id)
        .eq("reseller_id", ctx.reseller_id),
    ]);
    const links = (linksRes.data || []) as any[];

    // ✅ Sync automático ao abrir (pedido do Márcio): a revenda vê o saldo e
    // os clientes atualizados sem botão. A tela chama 2x: primeiro sem sync
    // (abre na hora com o último resumo salvo), depois com sync:true e
    // atualiza os números. Dentro de 1 minuto do último Sync (limite do
    // relatório do NaTV) usa o salvo; se o NaTV falhar, fica o último salvo.
    if (body?.sync === true) await Promise.all(
      links.map(async (l) => {
        try {
          const username = String(l.server_username || "").trim();
          if (!username) return;
          const token = await loadNatvTokenForServer(sb, ctx.tenant_id, l.server_id);
          if (!token) return;
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
          console.error("[reseller_portal:home:auto_sync]", { message: e?.message, kind: "reseller_portal_error" });
        }
      }),
    );

    // WhatsApp do suporte (mesma regra do portal do cliente: o do admin)
    let supportPhone: string | null = null;
    try {
      const { data: m } = await sb
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", ctx.tenant_id)
        .in("role", ["ADMIN", "admin", "owner"])
        .limit(1);
      if (m?.[0]?.user_id) {
        const { data: p } = await sb.from("profiles").select("whatsapp_username").eq("id", m[0].user_id).limit(1);
        supportPhone = p?.[0]?.whatsapp_username || null;
      }
    } catch {}
    const linkIds = links.map((l) => l.id);
    const serverIds = links.map((l) => l.server_id);

    const [salesRes, pkgRes] = await Promise.all([
      linkIds.length
        ? sb
            .from("server_credit_sales")
            .select("reseller_server_id, credits_sold, total_amount_brl, created_at")
            .eq("tenant_id", ctx.tenant_id)
            .in("reseller_server_id", linkIds)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] as any[] }),
      serverIds.length
        ? sb
            .from("reseller_credit_packages")
            .select("server_id, position, credits, price_brl")
            .eq("tenant_id", ctx.tenant_id)
            .in("server_id", serverIds)
            .order("position", { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const nameByLink = new Map(links.map((l) => [l.id, l.servers?.name || "Servidor"]));
    return NextResponse.json(
      {
        ok: true,
        reseller: { name: resRes.data?.display_name || "Revenda", since: resRes.data?.created_at || null },
        support_phone: supportPhone,
        servers: links.map((l) => ({
          id: l.id,
          name: l.servers?.name || "Servidor",
          logo_url: l.servers?.logo_url || null,
          username: l.server_username || null,
          stats: l.panel_stats || null,
          synced_at: l.panel_stats_at || null,
          prices: (pkgRes.data || [])
            .filter((p: any) => p.server_id === l.server_id && p.price_brl != null && Number(p.price_brl) > 0)
            .map((p: any) => ({ credits: Number(p.credits), price: Number(p.price_brl) })),
        })),
        purchases: (salesRes.data || []).map((s: any) => ({
          server: nameByLink.get(s.reseller_server_id) || "Servidor",
          credits: Number(s.credits_sold),
          total: Number(s.total_amount_brl),
          at: s.created_at,
        })),
      },
      { headers: NO_STORE },
    );
  } catch (e: any) {
    console.error("[reseller_portal:home]", { message: e?.message, kind: "reseller_portal_error" });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
