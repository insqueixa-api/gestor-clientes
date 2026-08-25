// app/api/webhooks/appativa/route.ts
//
// Recebe a confirmação assíncrona de ativação da Appativa (achado
// 25/08/2026 — ver plano/memória project_appativa_integration): a API
// deles é uma fila, solicitar-ativacao/reenviar-ativacao só devolvem um id
// (client_portal_payments.appativa_historico_id), o resultado de verdade
// (sucesso ou erro, com motivo) chega aqui.
//
// Payload deles: { id_cobranca, nome_app, MAC_app, KEY_app, status,
// valor_app, data }. "id_cobranca" é o mesmo id devolvido por
// solicitar-ativacao/reenviar-ativacao — é assim que achamos a linha de
// volta.
//
// ⚠️ Achado 25/08/2026 (produção, primeira ativação real): não confiamos
// mais no `status` do payload em si — nem por segurança (não é assinado)
// nem por confiabilidade (o próprio `enviado_n8n` do histórico deles pode
// ficar `false` por minutos numa ativação já confirmada, ou seja, o push em
// si pode atrasar/nunca chegar). Ao receber QUALQUER notificação pra um
// id_cobranca nosso, revalidamos direto na API deles (resolveAppativaAppRenewal,
// lib/client-portal/fulfillment.ts) — mesma função usada pelas 2 checagens
// automáticas (5s + 30s, agendadas em markAppRenewalPaid) e pelo botão
// "Ver status" manual do admin (app/api/admin/apps/check-appativa-status).
// Sem cron recorrente de propósito — volume baixo não justifica.
//
// URL cadastrada no painel da Appativa: https://unigestor.net.br/api/webhooks/appativa
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { resolveAppativaAppRenewal, prodLog } from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const idCobranca = String(body?.id_cobranca || "").trim();

    prodLog("appativa_webhook.received", { id_cobranca_suffix: idCobranca.slice(-6), status: body?.status });

    if (!idCobranca) return NextResponse.json({ ok: true });

    const { data: payment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, fulfillment_status")
      .eq("appativa_historico_id", idCobranca)
      .maybeSingle();

    // Sem match — evento de outra coisa (ou replay de algo já limpo).
    // Mesmo espírito "silencioso" dos webhooks MP/Stripe.
    if (!payment) return NextResponse.json({ ok: true });

    const result = await resolveAppativaAppRenewal(supabaseAdmin, payment.tenant_id, payment.id);
    prodLog("appativa_webhook.resolved", { payment_id: payment.id, outcome: result.outcome });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    Sentry.captureException(err, {
      tags: { kind: "webhook_handler_error", provider: "appativa" },
    });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Appativa ativo",
  });
}
