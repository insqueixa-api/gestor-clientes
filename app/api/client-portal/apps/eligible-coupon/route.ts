// app/api/client-portal/apps/eligible-coupon/route.ts
//
// Checagem "esse cliente tem cupom pra ESTE app?" — pra mostrar o popup de
// "Você tem um desconto disponível, quer aplicar?" antes de gerar o PIX.
// Nunca revela o código do cupom, só se existe e o valor do desconto (pedido
// do Márcio, 08/09/2026: "nem precisaria revelar o nome pra ele").
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { findEligibleAppCoupon } from "@/lib/client-portal/coupons";
import { getAppRenewalCharges } from "@/lib/client-portal/app-renewal-charges";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) return jsonError("Erro interno", 500);

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const client_app_id = normalizeStr(body?.client_app_id);
    // ✅ 30/09/2026: várias instalações de uma vez (carrinho / apps marcados
    // no pagamento do sinal) — o desconto volta somado em todas as cobertas.
    const client_app_ids: string[] = [
      ...new Set<string>(
        [client_app_id, ...(Array.isArray(body?.client_app_ids) ? body.client_app_ids : [])]
          .map((v: unknown) => normalizeStr(v))
          .filter(Boolean),
      ),
    ].slice(0, 10);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_ids.length) return jsonError("client_app_id é obrigatório", 400);

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, whatsapp_username, price_currency")
      .eq("id", client_id)
      .single();
    if (!client) return jsonError("Cliente não encontrado", 404);

    const currency = String(client.price_currency || "BRL").trim() || "BRL";
    // Mesma validação de posse/elegibilidade/preço da cobrança de verdade
    // (só apps pagos e ativos deste cliente; preço convertido pra moeda dele).
    const charges = await getAppRenewalCharges(supabaseAdmin, ctx.tenant_id, client_id, client_app_ids, currency);
    if (!charges.items.length) {
      return NextResponse.json({ ok: true, available: false }, { status: 200, headers: NO_STORE_HEADERS });
    }

    const result = await findEligibleAppCoupon({
      supabaseAdmin,
      tenantId: ctx.tenant_id,
      clientRow: client,
      items: charges.items,
    });

    if (!result) {
      return NextResponse.json({ ok: true, available: false }, { status: 200, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { ok: true, available: true, discountAmount: result.discountAmount, currency },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: any) {
    console.error("[apps/eligible-coupon] unexpected", err?.message);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
