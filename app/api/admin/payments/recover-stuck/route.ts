// app/api/admin/payments/recover-stuck/route.ts
//
// Rede de segurança pro caso documentado em getFulfillmentBucket/
// isStuckFulfillment (app/admin/auditoria/page.tsx): o fulfillment de um
// pagamento aprovado só roda via webhook do gateway OU polling do
// navegador do cliente — se os dois falharem (cliente fecha a aba logo
// depois de pagar, webhook atrasa/não chega), o pagamento fica preso em
// "pending"/"processing" pra sempre e SÓ aparece como "Travada" se o admin
// abrir a Auditoria e reparar. Sem isso, nada notifica sozinho.
//
// Achado no incidente de 15/08/2026 (licença de app do Adenilson travada,
// sem sino nem email): existia um botão "Reprocessar" manual pra esse
// exato cenário desde 24/07/2026, mas nada disparava ele sozinho. Este
// cron roda de tempos em tempos, encontra qualquer pagamento aprovado
// preso a mais de STUCK_THRESHOLD_MS e reprocessa sozinho — mesma lógica
// de app/api/admin/payments/retry-fulfillment/route.ts, só que disparada
// automaticamente em vez de por clique do admin.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isCronRequest } from "@/lib/internal-auth";
import {
  runFulfillment,
  markFulfillmentDone,
  markFulfillmentError,
  tryAcquireFulfillmentLock,
  markAppRenewalPaid,
} from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Mesmo limiar da badge "Travada" na Auditoria (STUCK_THRESHOLD_MS,
// app/admin/auditoria/page.tsx) — os dois nunca podem discordar sobre o
// que conta como "travado".
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  return appUrl ? appUrl.replace(/\/+$/, "") : "";
}

export async function POST(req: NextRequest) {
  if (!isCronRequest(req, "RECOVER_STUCK_PAYMENTS_CRON_SECRET")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const origin = getAppOrigin();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

  const { data: stuckPayments, error } = await supabaseAdmin
    .from("client_portal_payments")
    .select(
      "id,tenant_id,client_id,mp_payment_id,status,period,plan_label,price_amount,plan_price_amount,price_currency,new_vencimento,fulfillment_status,fulfillment_error,settled_alert_ids,coupon_id,coupon_discount_amount,payment_type,created_at"
    )
    .in("status", ["approved", "PAGO", "manual_approved"])
    .or("fulfillment_status.is.null,fulfillment_status.eq.pending,fulfillment_status.eq.processing")
    .lt("created_at", cutoff);

  if (error) {
    Sentry.captureException(new Error(`recover-stuck: falha ao buscar pagamentos travados — ${error.message}`), {
      tags: { kind: "fulfillment_error" },
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: any[] = [];

  for (const payment of stuckPayments || []) {
    try {
      if (payment.payment_type === "app_renewal") {
        await markAppRenewalPaid(supabaseAdmin, payment.tenant_id, payment.id, origin);
        results.push({ id: payment.id, payment_type: "app_renewal", outcome: "manual_pending" });
        continue;
      }

      if (!origin) {
        results.push({ id: payment.id, outcome: "skipped_no_origin" });
        continue;
      }

      const lock = await tryAcquireFulfillmentLock(supabaseAdmin, payment.tenant_id, payment.id);
      if (!lock.acquired) {
        results.push({ id: payment.id, outcome: "lock_busy" });
        continue;
      }

      const { expDateISO } = await runFulfillment({
        supabaseAdmin,
        tenantId: payment.tenant_id,
        origin,
        payment,
      });

      const { data: post } = await supabaseAdmin
        .from("client_portal_payments")
        .select("fulfillment_status")
        .eq("id", payment.id)
        .single();

      if (String(post?.fulfillment_status || "").toLowerCase() === "manual_pending") {
        results.push({ id: payment.id, outcome: "manual_pending" });
      } else {
        await markFulfillmentDone(supabaseAdmin, payment.tenant_id, payment.id, expDateISO);
        results.push({ id: payment.id, outcome: "done" });
      }
    } catch (e: any) {
      const msg = e?.message || "Falha ao reprocessar pagamento travado.";
      await markFulfillmentError(supabaseAdmin, payment.tenant_id, payment.id, msg).catch(() => {});
      Sentry.captureException(new Error(`recover-stuck: falha ao reprocessar ${payment.id} — ${msg}`), {
        tags: { kind: "fulfillment_error" },
        extra: { payment_id: payment.id, payment_type: payment.payment_type },
      });
      results.push({ id: payment.id, outcome: "error", error: msg });
    }
  }

  return NextResponse.json({ ok: true, checked: stuckPayments?.length || 0, results });
}
