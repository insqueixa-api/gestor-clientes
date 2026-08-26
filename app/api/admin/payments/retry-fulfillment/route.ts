// app/api/admin/payments/retry-fulfillment/route.ts
//
// Botão "Reprocessar" da Auditoria — para pagamentos aprovados que ficaram
// travados em fulfillment_status "pending"/"processing" sem nunca ter
// terminado (achado em auditoria 24/07/2026: o fulfillment só roda via
// webhook do MP ou polling do navegador; se os dois falharem/não
// acontecerem — cliente fecha a aba logo após pagar, por exemplo — nada
// reprocessa sozinho e o pagamento fica invisível na Auditoria, com o
// mesmo badge neutro "Processando" de um pagamento normal em andamento).
//
// Reaproveita exatamente a mesma sequência de app/api/client-portal/
// payment-status/route.ts (lock -> runFulfillment -> mark done/error), só
// que disparada manualmente pelo admin em vez de por um cliente com a aba
// aberta. Mesmo padrão de auth de app/api/admin/coupons/redeem-manual
// (Bearer = access_token da sessão do admin, checa tenant_members).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import {
  runFulfillment,
  markFulfillmentDone,
  markFulfillmentError,
  tryAcquireFulfillmentLock,
  markAppRenewalPaid,
} from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// ✅ Cobre as 2 checagens automáticas da Appativa agendadas via after() em
// markAppRenewalPaid (5s + 30s + margem) — não atrasa a resposta ao admin.
// ✅ 90s (achado 26/08/2026): a checagem automática da Appativa (after(), em
// markAppRenewalPaid) agora tenta de 5 em 5s por até 1 min — precisa de
// espaço além dos 60s antigos pra rodar até o fim antes do Vercel matar a
// function.
export const maxDuration = 90;

function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  if (!appUrl) return "";
  return appUrl.replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: supabaseAdmin, tenant_id: authTenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const tenantId = String(body?.tenant_id || "").trim();
  const paymentId = String(body?.payment_id || "").trim();
  if (!tenantId || !paymentId) {
    return NextResponse.json({ error: "Parâmetros incompletos" }, { status: 400 });
  }

  if (tenantId !== authTenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const origin = getAppOrigin();
  if (!origin) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const { data: payment, error: payErr } = await supabaseAdmin
    .from("client_portal_payments")
    .select(
      "id,tenant_id,client_id,mp_payment_id,status,period,plan_label,price_amount,plan_price_amount,price_currency,new_vencimento,fulfillment_status,fulfillment_error,fulfillment_started_at,settled_alert_ids,coupon_id,coupon_discount_amount,payment_type,bundled_app_renewals,gateway_type,payment_method"
    )
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .single();

  if (payErr || !payment) return NextResponse.json({ error: "Pagamento não encontrado" }, { status: 404 });

  // ✅ só reprocessa pagamento realmente aprovado — nunca dispara renovação
  // por engano num pagamento ainda pendente/recusado.
  if (String(payment.status).toLowerCase() !== "approved") {
    return NextResponse.json({ error: "Esse pagamento não está aprovado." }, { status: 400 });
  }

  // ✅ Pagamento avulso de licença de app — NUNCA pode cair no
  // runFulfillment de assinatura IPTV (renovaria a conta do cliente sem
  // relação nenhuma com o valor pago). Cai pra ação manual — ver comentário
  // em markAppRenewalPaid (lib/client-portal/fulfillment.ts).
  if (payment.payment_type === "app_renewal") {
    await markAppRenewalPaid(supabaseAdmin, tenantId, payment.id, origin);
    return NextResponse.json({ ok: true, outcome: "manual_pending" });
  }

  const lock = await tryAcquireFulfillmentLock(supabaseAdmin, tenantId, payment.id);
  if (!lock.acquired) {
    return NextResponse.json({ error: "Já está sendo processado agora — tente de novo em alguns segundos." }, { status: 409 });
  }

  try {
    const { expDateISO } = await runFulfillment({ supabaseAdmin, tenantId, origin, payment });

    const { data: post } = await supabaseAdmin
      .from("client_portal_payments")
      .select("fulfillment_status, fulfillment_error, new_vencimento")
      .eq("tenant_id", tenantId)
      .eq("id", payment.id)
      .single();

    if (String(post?.fulfillment_status || "").toLowerCase() === "manual_pending") {
      return NextResponse.json({ ok: true, outcome: "manual_pending" });
    }

    await markFulfillmentDone(supabaseAdmin, tenantId, payment.id, expDateISO);
    return NextResponse.json({ ok: true, outcome: "done", new_vencimento: expDateISO });
  } catch (e: any) {
    const msg = e?.message || "Falha ao reprocessar. Tente de novo ou renove manualmente.";
    console.error("[retry-fulfillment]", { payment_id: payment.id, message: msg });
    await markFulfillmentError(supabaseAdmin, tenantId, payment.id, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
