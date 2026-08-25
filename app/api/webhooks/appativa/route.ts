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
// ⚠️ Autenticidade: a doc pública não mostra assinatura/segredo no
// payload. A defesa que temos é correlação — só agimos em eventos cujo
// id_cobranca bate com um appativa_historico_id que NÓS mesmos geramos
// numa chamada real (índice único garante isso). Não é criptográfico;
// registrado como limitação conhecida.
//
// URL cadastrada no painel da Appativa: https://unigestor.net.br/api/webhooks/appativa
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { resolveNotification } from "@/lib/notifications/notify";
import { loadClientApp, checkClientAppValidity } from "@/lib/apps/orchestration";
import { extractDateOnly } from "@/lib/apps/panel";
import { prodLog } from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Status que a Appativa manda que contam como sucesso/erro definitivo.
// Qualquer outro valor (ex: "Solicitado", "Pendente") ainda está em
// andamento — só confirma recebimento, sem mudar nada.
const SUCCESS_STATUSES = new Set(["ativado", "aprovado"]);
const FAILURE_STATUSES = new Set(["incorreto", "reprovado"]);

function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  return appUrl.replace(/\/+$/, "");
}

// ✅ Mesma lógica de escolha de template que components/apps/
// AppRequestModal.tsx usa na conclusão manual (template "Renovação de
// Aplicativo" + sorteio de variante) — replicada aqui pro lado servidor,
// já que aqui não tem sessão de admin/browser pra reaproveitar o código
// client-side. Fail-soft: nunca lança, só loga.
async function sendAppRenewalWhatsapp(params: {
  tenantId: string;
  clientId: string;
  origin: string;
  whatsappSession: string;
}) {
  try {
    const { data: tmpl } = await supabaseAdmin
      .from("message_templates")
      .select("id, content, image_url")
      .eq("tenant_id", params.tenantId)
      .ilike("name", "%renovação de aplicativo%")
      .maybeSingle();

    if (!tmpl?.content) return;

    let pickedContent = String(tmpl.content).trim();
    const { data: variants } = await supabaseAdmin
      .from("message_template_variants")
      .select("content")
      .eq("tenant_id", params.tenantId)
      .eq("template_id", tmpl.id);
    const pool = [tmpl.content, ...(variants || []).map((v: any) => v.content)].filter(
      (c): c is string => !!c && String(c).trim().length > 0,
    );
    if (pool.length > 0) pickedContent = pool[Math.floor(Math.random() * pool.length)].trim();

    const res = await fetch(`${params.origin}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": String(process.env.INTERNAL_API_SECRET || ""),
      },
      cache: "no-store",
      body: JSON.stringify({
        tenant_id: params.tenantId,
        client_id: params.clientId,
        message: pickedContent,
        image_url: tmpl.image_url || null,
        message_template_id: tmpl.id,
        whatsapp_session: params.whatsappSession,
      }),
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || json?.ok === false) {
      prodLog("appativa_webhook.whatsapp_send_failed", { status: res.status });
    }
  } catch (e: any) {
    prodLog("appativa_webhook.whatsapp_send_error", { message: e?.message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const idCobranca = String(body?.id_cobranca || "").trim();
    const status = String(body?.status || "").trim().toLowerCase();

    prodLog("appativa_webhook.received", { id_cobranca_suffix: idCobranca.slice(-6), status });

    if (!idCobranca) return NextResponse.json({ ok: true });

    const { data: payment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, client_id, client_app_id, app_name_snapshot, fulfillment_status")
      .eq("appativa_historico_id", idCobranca)
      .maybeSingle();

    // Sem match — evento de outra coisa (ou replay de algo já limpo).
    // Mesmo espírito "silencioso" dos webhooks MP/Stripe.
    if (!payment) return NextResponse.json({ ok: true });

    // Já concluído (webhook duplicado/reentrega) — não repete WhatsApp nem
    // reprocessa.
    if (payment.fulfillment_status === "manual_done") {
      return NextResponse.json({ ok: true });
    }

    if (SUCCESS_STATUSES.has(status)) {
      const origin = getAppOrigin();

      // ✅ Achado 25/08/2026 (Márcio): a Appativa confirmar a ativação é só
      // a LICENÇA — o cliente só pode ser avisado depois que a gente
      // CONFIRMAR, de verdade, que o vencimento real (no painel do app)
      // avançou. Não basta "não vencido": o portal deixa renovar com até 30
      // dias de antecedência (ver RenewClient.tsx), e toda ativação é
      // ANUAL ou VITALÍCIA — então uma renovação de verdade sempre resulta
      // em pelo menos ~335 dias à frente (renovando no dia do vencimento,
      // +365; renovando 30 dias antes, +395). Uma data ANTIGA que o
      // parceiro ainda não atualizou (ex: DUPLEXTV quase nunca devolve data
      // nova, ou o painel do parceiro demora a propagar) nunca passa de
      // +30 dias, porque só foi possível renovar justamente por já estar
      // dentro dessa janela. Por isso exige bem mais que "no futuro" —
      // MIN_DAYS_FORWARD, com folga enorme entre os dois casos.
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const MIN_DAYS_FORWARD = 300;
      let confirmedFutureExpiry = false;
      let fulfillmentErrorMessage =
        "Appativa confirmou a ativação, mas não foi possível confirmar automaticamente o novo vencimento. Verifique e conclua manualmente.";

      if (payment.client_app_id) {
        try {
          const row = await loadClientApp(supabaseAdmin, {
            clientAppId: payment.client_app_id,
            tenantId: payment.tenant_id,
          });
          if (row) {
            const result = await checkClientAppValidity(supabaseAdmin, row);
            // ⚠️ Narrowing via `"expireDate" in result` — mesmo bug de
            // strict:false já documentado (couponRejectReason, e no
            // markAppRenewalPaid mais cedo hoje).
            if ("expireDate" in result) {
              if (result.rawExpireDate) {
                const dateOnly = extractDateOnly(result.rawExpireDate);
                const daysForward = dateOnly
                  ? (new Date(`${dateOnly}T23:59:59`).getTime() - Date.now()) / MS_PER_DAY
                  : -1;
                if (daysForward >= MIN_DAYS_FORWARD) {
                  confirmedFutureExpiry = true;
                } else {
                  fulfillmentErrorMessage =
                    "Appativa confirmou a ativação, mas o vencimento no painel do aplicativo ainda não avançou (pode levar um tempo pra propagar do lado do parceiro). Verifique e conclua manualmente.";
                }
              } else {
                fulfillmentErrorMessage =
                  "Appativa confirmou a ativação, mas o parceiro não devolveu um vencimento novo. Verifique e conclua manualmente.";
              }
            } else if (result.error === "Verificação de validade não disponível para este aplicativo.") {
              // ✅ Apps sem checagem automática (ex: só dá pra ver o
              // vencimento pela extensão do navegador) — a ativação em si
              // foi confirmada pela Appativa, só falta o admin confirmar o
              // vencimento novo por fora antes de concluir/avisar o cliente.
              fulfillmentErrorMessage =
                "Appativa confirmou a ativação — este aplicativo não tem verificação automática de vencimento. Confira pela extensão e conclua manualmente para notificar o cliente.";
            } else if (result.error) {
              fulfillmentErrorMessage = `Appativa confirmou a ativação, mas ${result.error} Verifique e conclua manualmente.`;
            }
          }
        } catch (e: any) {
          prodLog("appativa_webhook.check_validity_failed", { message: e?.message });
        }
      }

      if (!confirmedFutureExpiry) {
        // ✅ Ativação aceita pela Appativa, mas não deu pra confirmar
        // automaticamente que o vencimento avançou de verdade (~1 ano) —
        // NÃO conclui nem avisa o cliente sozinho. Fica visível pro admin
        // (fulfillment_error) pra conferir/concluir manualmente na
        // Auditoria (o modal "Concluir" já tem "Verificar validade" +
        // "Salvar", cobre esse caso sem precisar de nada novo).
        await supabaseAdmin
          .from("client_portal_payments")
          .update({ fulfillment_error: fulfillmentErrorMessage })
          .eq("id", payment.id)
          .eq("tenant_id", payment.tenant_id);
        return NextResponse.json({ ok: true });
      }

      // ✅ Update direto (nunca a RPC update_fulfillment_status — exige
      // auth.uid() de sessão de admin real, sempre falha com a
      // service_role; mesmo achado do sync de créditos, 25/08/2026).
      await supabaseAdmin
        .from("client_portal_payments")
        .update({ fulfillment_status: "manual_done", fulfilled_at: new Date().toISOString() })
        .eq("id", payment.id)
        .eq("tenant_id", payment.tenant_id);

      // ✅ Resolve o sino "renovação pendente" — mesmo type/sourceId que
      // markAppRenewalPaid usou pra criar (type: "manual_pending",
      // sourceId: payment.id) e que a conclusão manual já resolve hoje.
      // resolveNotification já existe pronta em lib/notifications/notify.ts
      // (mesmo update direto que markei hoje — sem passar pela RPC
      // resolve_notification, que exige auth.uid() de sessão de admin real
      // e sempre falha com a service_role).
      //
      // ⚠️ De propósito: NENHUM notify() novo aqui pro caso de sucesso —
      // mesmo padrão "sucesso é silencioso" que a renovação automática de
      // ASSINATURA já usa (runFulfillment nunca manda sino em caminho
      // feliz, só em erro/manual). Chamar notify() com o MESMO
      // (tenant,type,source_id) que acabou de ser resolvido reabriria a
      // notificação como não-lida sem querer (o upsert de notify() não
      // mexe em resolved_at, então o registro ficaria "resolvido" mas com
      // texto de sucesso — confuso). O rastro de sucesso fica em
      // client_events (Auditoria/histórico), não no sino.
      await resolveNotification(payment.tenant_id, "manual_pending", payment.id);

      // ✅ Rastro de auditoria distinguindo conclusão automática (via
      // Appativa) de manual — Auditoria não precisa mudar, já sabe
      // renderizar manual_done igual pros dois casos.
      try {
        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("display_name, server_username, server_id, servers(name, whatsapp_session)")
          .eq("id", payment.client_id)
          .maybeSingle();
        const serverMeta = Array.isArray(client?.servers) ? client.servers[0] : client?.servers;

        await supabaseAdmin.from("client_events").insert({
          tenant_id: payment.tenant_id,
          client_id: payment.client_id,
          event_type: "APP_RENEWAL_AUTO",
          message: `Renovação automática via Appativa · ${payment.app_name_snapshot || "Aplicativo"}`,
          meta: { payment_id: payment.id, appativa_historico_id: idCobranca, source: "appativa_webhook" },
        });

        if (origin) {
          await sendAppRenewalWhatsapp({
            tenantId: payment.tenant_id,
            clientId: payment.client_id,
            origin,
            whatsappSession: (serverMeta as any)?.whatsapp_session || "default",
          });
        }
      } catch (e: any) {
        prodLog("appativa_webhook.post_success_side_effects_failed", { message: e?.message });
      }

      return NextResponse.json({ ok: true });
    }

    if (FAILURE_STATUSES.has(status)) {
      await supabaseAdmin
        .from("client_portal_payments")
        .update({
          fulfillment_error: `Appativa recusou a ativação (status: "${body?.status}"). Confira o Device ID (MAC) do aplicativo.`,
        })
        .eq("id", payment.id)
        .eq("tenant_id", payment.tenant_id);

      return NextResponse.json({ ok: true });
    }

    // Status intermediário (ex: "Solicitado"/"Pendente") — só confirma
    // recebimento, sem mudar nada ainda.
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
