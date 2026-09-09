// app/api/client-portal/apps/eligible-coupon/route.ts
//
// Checagem "esse cliente tem cupom pra ESTE app?" — pra mostrar o popup de
// "Você tem um desconto disponível, quer aplicar?" antes de gerar o PIX.
// Nunca revela o código do cupom, só se existe e o valor do desconto (pedido
// do Márcio, 08/09/2026: "nem precisaria revelar o nome pra ele").
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { convertAmount } from "@/lib/fx";
import { findEligibleAppCoupon } from "@/lib/client-portal/coupons";

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

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, apps(name, cost_type, license_price)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const appName = (row as any).apps?.name || "";
    const costType = (row as any).apps?.cost_type;
    const licensePrice = Number((row as any).apps?.license_price || 0);
    if (costType !== "paid" || !(licensePrice > 0) || !appName) {
      return NextResponse.json({ ok: true, available: false }, { status: 200, headers: NO_STORE_HEADERS });
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, whatsapp_username, price_currency")
      .eq("id", client_id)
      .single();
    if (!client) return jsonError("Cliente não encontrado", 404);

    const currency = String(client.price_currency || "BRL").trim() || "BRL";
    const appPriceOnly =
      currency === "BRL" ? licensePrice : await convertAmount(supabaseAdmin, ctx.tenant_id, licensePrice, "BRL", currency);

    const result = await findEligibleAppCoupon({
      supabaseAdmin,
      tenantId: ctx.tenant_id,
      clientRow: client,
      appName,
      appPriceOnly,
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
