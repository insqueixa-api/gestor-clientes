// app/api/webhooks/appativa/route.ts
//
// STUB (24/08/2026) — só recebe e loga por enquanto. A integração de
// verdade (marcar client_portal_payments/client_apps, atualizar vencimento,
// disparar WhatsApp) fica pra quando tivermos a documentação completa do
// parceiro (ver [[project_appativa_integration]] na memória) — em
// particular a seção "Webhook: Entregas de Eventos" da doc deles, que
// provavelmente explica COMO verificar que a chamada é legítima (a doc
// pública não mostra nenhuma assinatura/segredo no payload de exemplo:
// { id_cobranca, nome_app, MAC_app, KEY_app, status, valor_app, data } —
// PRECISA confirmar isso antes de confiar em qualquer dado daqui pra
// atualizar vencimento de cliente de verdade).
//
// URL cadastrada no painel da Appativa: https://unigestor.net.br/api/webhooks/appativa
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    console.log("[webhook:appativa] received", {
      id_cobranca: body?.id_cobranca,
      nome_app: body?.nome_app,
      status: body?.status,
      valor_app: body?.valor_app,
      data: body?.data,
    });

    // ✅ Sentry breadcrumb (não é erro) — só pra termos rastro de que
    // eventos reais estão chegando enquanto a integração não está pronta.
    Sentry.captureMessage("appativa_webhook_received_stub", {
      level: "info",
      tags: { kind: "integration_stub", provider: "appativa" },
      extra: { body },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
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
    message: "Webhook Appativa ativo (stub — integração ainda não implementada)",
  });
}
