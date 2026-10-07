// app/api/reseller-portal/app-order/route.ts
// ✅ 07/10/2026 — Portal da Revenda, etapa 2: pagamento da ativação de app.
//   action "create" → reconfere a disponibilidade e gera o PIX
//                     (lib/reseller-portal/app-orders.ts); com client_app_id
//                     usa os dados SALVOS do app do cliente (Renovar do card)
//   action "status" → acompanhamento da tela: se pendente, reconsulta o
//                     gateway (cobre webhook atrasado/perdido); se pago,
//                     dispara a ativação (em segundo plano) — idempotente com
//                     o webhook; AtivaApp em andamento é reconsultada aqui.
// Sessão própria da revenda; o pedido precisa ser DELA.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateResellerSession } from "@/lib/reseller-portal/session";
import { confirmPaidAndFulfillApp, createAppOrder } from "@/lib/reseller-portal/app-orders";
import { RESELLER_APPS_MAINTENANCE_MESSAGE, resellerCanAddApps } from "@/lib/reseller-portal/apps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// DupleCast leva até ~90s na VM (roda em after(), dentro deste orçamento)
export const maxDuration = 150;

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
      // chave "Portal" do admin desligada → sem ativação nova (o "status" de pedido já pago segue normal)
      if (!(await resellerCanAddApps(sb, ctx.tenant_id, ctx.reseller_id))) return jsonError(503, RESELLER_APPS_MAINTENANCE_MESSAGE);
      const appId = String(body?.app_id || "").trim();
      const rowId = String(body?.client_app_id || "").trim();
      if (!UUID_RE.test(appId)) return jsonError(400, "Aplicativo inválido.");
      if (rowId && !UUID_RE.test(rowId)) return jsonError(400, "Aplicativo inválido.");
      const r = await createAppOrder(sb, {
        tenantId: ctx.tenant_id,
        resellerId: ctx.reseller_id,
        appId,
        fieldValues: body?.field_values,
        rowId: rowId || undefined,
        excludeGatewayType: String(body?.exclude_gateway_type || "").trim() || undefined,
      });
      if (r.ok === false) return jsonError(r.status, r.error);
      return NextResponse.json({ ok: true, ...r.pix }, { headers: NO_STORE });
    }

    if (action === "status") {
      const orderId = String(body?.order_id || "").trim();
      if (!UUID_RE.test(orderId)) return jsonError(400, "Pedido inválido.");
      const { data: own } = await sb
        .from("reseller_app_orders")
        .select("id, status, fulfillment_status")
        .eq("id", orderId)
        .eq("tenant_id", ctx.tenant_id)
        .eq("reseller_id", ctx.reseller_id)
        .maybeSingle();
      if (!own) return jsonError(404, "Pedido não encontrado.");

      if (own.status === "pending" || (own.status === "approved" && ["pending", "activating"].includes(String(own.fulfillment_status)))) {
        await confirmPaidAndFulfillApp(sb, orderId);
      }

      const { data: o } = await sb
        .from("reseller_app_orders")
        .select("id, app_name, amount_brl, status, fulfillment_status, new_expire_date, expires_at")
        .eq("id", orderId)
        .maybeSingle();
      const st = String(o?.status || "");
      const fs = String(o?.fulfillment_status || "");
      const state =
        st === "pending"
          ? o?.expires_at && new Date(o.expires_at).getTime() < Date.now()
            ? "expired"
            : "waiting"
          : st === "approved"
            ? fs === "done"
              ? "done"
              : fs === "error" || fs === "unknown"
                ? "failed"
                : "activating"
            : "expired";
      return NextResponse.json(
        { ok: true, state, app_name: o?.app_name, amount: Number(o?.amount_brl), new_expire_date: o?.new_expire_date || null },
        { headers: NO_STORE },
      );
    }

    return jsonError(400, "action inválida.");
  } catch (e: any) {
    console.error("[reseller_portal:app_order]", { message: e?.message, kind: "reseller_portal_error" });
    return jsonError(500, "Erro interno.");
  }
}
