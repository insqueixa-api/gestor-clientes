// app/api/cron/appativa-poll-pending/route.ts
//
// Fallback pro webhook da Appativa (app/api/webhooks/appativa/route.ts)
// atrasar ou nunca chegar — achado 25/08/2026 em produção (primeira
// ativação real): o /api/historico deles tem um campo `enviado_n8n` que
// ficou `false` por vários minutos numa ativação já confirmada do lado
// deles. Roda a cada 5min (ver docs/sql/appativa_poll_pending_cron.sql),
// reconsultando os pagamentos travados em manual_pending com
// appativa_historico_id via resolveAppativaAppRenewal (mesma lógica de
// conclusão que o webhook usa — nunca duplicada).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { isCronRequest } from "@/lib/internal-auth";
import { resolveAppativaAppRenewal, prodLog } from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  if (!isCronRequest(req, "APPATIVA_CRON_SECRET")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // ✅ Só pega pendências com pelo menos 2min — dá tempo do fluxo normal
  // (solicitar-ativacao -> confirmação -> webhook) terminar sozinho antes
  // de duplicar esforço contra a API deles.
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data: pending, error } = await supabaseAdmin
    .from("client_portal_payments")
    .select("id, tenant_id")
    .eq("payment_type", "app_renewal")
    .eq("fulfillment_status", "manual_pending")
    .not("appativa_historico_id", "is", null)
    .lte("created_at", cutoff)
    .limit(50);

  if (error) {
    Sentry.captureException(new Error(`appativa_poll_pending: falha ao listar pendências — ${error.message}`), {
      tags: { kind: "cron_error", provider: "appativa" },
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ payment_id: string; outcome: string; message?: string }> = [];
  for (const p of pending || []) {
    try {
      const r = await resolveAppativaAppRenewal(supabaseAdmin, p.tenant_id, p.id);
      results.push({ payment_id: p.id, outcome: r.outcome });
    } catch (e: any) {
      results.push({ payment_id: p.id, outcome: "error", message: e?.message });
      Sentry.captureException(e, {
        tags: { kind: "cron_error", provider: "appativa" },
        extra: { payment_id: p.id },
      });
    }
  }

  prodLog("appativa_poll_pending.done", { checked: (pending || []).length, results });

  return NextResponse.json({ ok: true, checked: (pending || []).length, results });
}
