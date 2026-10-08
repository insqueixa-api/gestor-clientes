// app/api/reseller-portal/home/route.ts
// ✅ 06/10/2026: dados da tela inicial do Portal da Revenda (/revenda).
// Sessão própria (lib/reseller-portal/session.ts). Só leitura e só o que é
// DA revenda: nome, servidores vinculados (usuário e senha do painel DELA —
// pedido do Márcio, aparece oculta com o olho —, Telegram do servidor, último
// resumo do painel) e a Tabela Revenda (preço por faixa). Nunca devolve chave
// de API nem dados de outra revenda/cliente. Histórico de compras saiu da
// tela (pedido do Márcio, 06/10/2026).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateResellerSession, endResellerSession } from "@/lib/reseller-portal/session";
import { syncResellerPanels } from "@/lib/reseller-portal/sync";
import { creditUnitInCurrency, resellerCurrency } from "@/lib/reseller-portal/app-orders";

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
        .select("id, server_id, server_username, server_password, panel_stats, panel_stats_at, servers(name, logo_url, panel_telegram_group)")
        .eq("tenant_id", ctx.tenant_id)
        .eq("reseller_id", ctx.reseller_id),
    ]);
    const links = (linksRes.data || []) as any[];

    // ✅ Sync automático ao abrir (pedido do Márcio): a revenda vê o saldo e
    // os clientes atualizados sem botão. A tela chama 2x: primeiro sem sync
    // (abre na hora com o último resumo salvo), depois com sync:true e
    // atualiza os números. Dentro de 1 minuto do último Sync (limite do
    // relatório do NaTV) usa o salvo; se o NaTV falhar, fica o último salvo.
    if (body?.sync === true) await syncResellerPanels(sb, ctx.tenant_id, links);

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
    const serverIds = links.map((l) => l.server_id);

    const pkgRes = serverIds.length
      ? await sb
          .from("reseller_credit_packages")
          .select("server_id, position, credits, price_brl")
          .eq("tenant_id", ctx.tenant_id)
          .in("server_id", serverIds)
          .order("position", { ascending: true })
      : { data: [] as any[] };

    // ✅ 08/10/2026: moeda da revenda — preço do crédito convertido pelo câmbio
    // salvo e arredondado pra cima de 0,50 em 0,50 (mesma conta da cobrança)
    const currency = await resellerCurrency(sb, ctx.tenant_id, ctx.reseller_id);
    const unitDisplay = new Map<string, number>();
    await Promise.all(
      (pkgRes.data || []).map(async (p: any) => {
        if (Number(p.price_brl) > 0) unitDisplay.set(`${p.server_id}:${p.credits}`, await creditUnitInCurrency(sb, ctx.tenant_id, Number(p.price_brl), currency));
      }),
    );

    // Telegram do painel do servidor (@usuario ou link) → link do t.me
    const telegramUrl = (v: unknown) => {
      const s = String(v || "").trim();
      if (!s) return null;
      return s.startsWith("http") ? s : `https://t.me/${s.replace(/^@/, "")}`;
    };

    return NextResponse.json(
      {
        ok: true,
        reseller: { name: resRes.data?.display_name || "Revenda", since: resRes.data?.created_at || null },
        support_phone: supportPhone,
        currency,
        servers: links.map((l) => ({
          id: l.id,
          name: l.servers?.name || "Servidor",
          logo_url: l.servers?.logo_url || null,
          username: l.server_username || null,
          // senha do painel DELE (cadastro do vínculo) — só pra sessão da própria revenda
          password: l.server_password || null,
          telegram_url: telegramUrl(l.servers?.panel_telegram_group),
          stats: l.panel_stats || null,
          synced_at: l.panel_stats_at || null,
          prices: (pkgRes.data || [])
            .filter((p: any) => p.server_id === l.server_id && p.price_brl != null && Number(p.price_brl) > 0)
            .map((p: any) => {
              const unit = unitDisplay.get(`${p.server_id}:${p.credits}`) ?? Number(p.price_brl);
              // price = por crédito NA MOEDA da revenda; total = valor exato cobrado pelo pacote
              return { credits: Number(p.credits), price: unit, total: Number((unit * Number(p.credits)).toFixed(2)) };
            }),
        })),
      },
      { headers: NO_STORE },
    );
  } catch (e: any) {
    console.error("[reseller_portal:home]", { message: e?.message, kind: "reseller_portal_error" });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
