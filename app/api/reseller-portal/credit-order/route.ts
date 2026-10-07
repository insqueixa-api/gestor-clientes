// app/api/reseller-portal/credit-order/route.ts
// ✅ 06/10/2026: compra de créditos pelo Portal da Revenda.
//   action "create" → gera o PIX (lib/reseller-portal/credit-orders.ts)
//   action "status" → acompanhamento da tela: se ainda pendente, reconsulta o
//                     gateway (cobre webhook atrasado/perdido) e, se pago,
//                     dispara o envio do crédito — idempotente com o webhook.
// Sessão própria da revenda; o pedido precisa ser DELA.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateResellerSession } from "@/lib/reseller-portal/session";
import { confirmPaidAndFulfill, createCreditOrder } from "@/lib/reseller-portal/credit-orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const body = await req.json().catch(() => ({} as any));
    const ctx = await validateResellerSession(sb, String(body?.session_token || "").trim());
    if (!ctx) return jsonError(401, "session_invalid");
    const action = String(body?.action || "");

    if (action === "create") {
      const resellerServerId = String(body?.reseller_server_id || "").trim();
      if (!UUID_RE.test(resellerServerId)) return jsonError(400, "Servidor inválido.");
      const r = await createCreditOrder(sb, {
        tenantId: ctx.tenant_id,
        resellerId: ctx.reseller_id,
        resellerServerId,
        credits: Number(body?.credits),
        excludeGatewayType: String(body?.exclude_gateway_type || "").trim() || undefined,
      });
      if (r.ok === false) return jsonError(r.status, r.error);
      return NextResponse.json({ ok: true, ...r.pix }, { headers: NO_STORE });
    }

    if (action === "status") {
      const orderId = String(body?.order_id || "").trim();
      if (!UUID_RE.test(orderId)) return jsonError(400, "Pedido inválido.");
      const { data: own } = await sb
        .from("reseller_credit_orders")
        .select("id, status, fulfillment_status")
        .eq("id", orderId)
        .eq("tenant_id", ctx.tenant_id)
        .eq("reseller_id", ctx.reseller_id)
        .maybeSingle();
      if (!own) return jsonError(404, "Pedido não encontrado.");

      if (own.status === "pending" || (own.status === "approved" && own.fulfillment_status === "pending")) {
        await confirmPaidAndFulfill(sb, orderId);
      }

      const { data: order } = await sb
        .from("reseller_credit_orders")
        .select("id, credits, amount_brl, status, fulfillment_status, expires_at")
        .eq("id", orderId)
        .maybeSingle();
      const { data: transfer } = await sb
        .from("reseller_credit_transfers")
        .select("recipient_credits_after")
        .eq("id", orderId)
        .maybeSingle();
      return NextResponse.json(
        {
          ok: true,
          status: order?.status,
          fulfillment_status: order?.fulfillment_status ?? null,
          credits: order?.credits,
          amount: Number(order?.amount_brl),
          expires_at: order?.expires_at,
          new_balance: order?.fulfillment_status === "done" ? transfer?.recipient_credits_after ?? null : null,
        },
        { headers: NO_STORE },
      );
    }

    return jsonError(400, "action inválida.");
  } catch (e: any) {
    console.error("[reseller_portal:credit-order]", { message: e?.message, kind: "reseller_portal_error" });
    return jsonError(500, "Erro interno.");
  }
}
