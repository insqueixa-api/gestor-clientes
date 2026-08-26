// lib/client-portal/fulfillment.ts
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { notify, resolveNotification, formatClientLabel } from "@/lib/notifications/notify";
import { APP_FIELD_LABELS, AppFieldType } from "@/lib/apps/field-types";
import { extractFieldByType, findFieldByType, extractDateOnly } from "@/lib/apps/panel";
import { solicitarAtivacao, consultarAtivacao, getAppativaApiKey, syncAppativaCredits } from "@/lib/integrations/appativa";
import { renewGpcRokuTenYears } from "@/lib/apps/gpc-roku-registry";
import { syncIptvRendimentos } from "@/lib/finance/sync-iptv-lancamentos";

// ============================================================
// Tipos
// ============================================================
export interface FulfillmentParams {
  supabaseAdmin: any;
  tenantId: string;
  origin: string;
  payment: any;
}

// ============================================================
// Helpers internos
// ============================================================
function safeServerLog(...args: any[]) {
  console.error(...args);
}

// ✅ Log estruturado para Vercel (sempre ativo, nunca vaza dados sensíveis)
export function prodLog(event: string, meta: Record<string, unknown> = {}) {
  const line = {
    ts: new Date().toISOString(),
    event,
    ...meta,
  };
  console.log("[FULFILLMENT]", JSON.stringify(line));
}

const MONTHS_BY_PERIOD: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export function toPeriodMonths(periodRaw: unknown) {
  const p = String(periodRaw || "").toUpperCase().trim();
  return MONTHS_BY_PERIOD[p] ?? 1;
}

// ============================================================
// Lock
// ============================================================
export async function tryAcquireFulfillmentLock(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string
) {
  const { data, error } = await supabaseAdmin.rpc(
    "client_portal_try_acquire_fulfillment_lock",
    {
      p_tenant_id: tenantId,
      p_payment_row_id: paymentRowId,
      p_zombie_seconds: 180,
    }
  );

  if (error) {
    safeServerLog("tryAcquireFulfillmentLock(rpc) error:", error.message);
    return { acquired: false, mode: "rpc_error" };
  }

  const acquired = Array.isArray(data) ? !!data[0]?.acquired : !!(data as any)?.acquired;
  return { acquired, mode: acquired ? "rpc_acquired" : "rpc_no_match" };
}

// ============================================================
// Mark done / error
// ============================================================
export async function markFulfillmentDone(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  newVencimentoISO: string | null
) {
  // ✅ AJUSTE FINO 1: Impede que o webhook marque como "done" se a renovação caiu para manual
  const { data: curr } = await supabaseAdmin.from("client_portal_payments").select("fulfillment_status").eq("id", paymentRowId).single();
  if (curr?.fulfillment_status === "manual_pending") return;

  await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "done",
      fulfilled_at: new Date().toISOString(),
      new_vencimento: newVencimentoISO,
      fulfillment_error: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

export async function markFulfillmentError(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  message: string
) {
  await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "error",
      fulfillment_error: message,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);

  // ✅ Pagamento aprovado que não conseguiu renovar sozinho — antes disso só
  // ficava visível pra quem abrisse a Auditoria por acaso (foi assim que 12
  // pagamentos ficaram presos meses sem ninguém notar). Agora dispara alerta
  // real via Sentry no momento em que acontece.
  Sentry.captureMessage(`fulfillment_error: ${message}`, {
    level: "error",
    tags: { kind: "fulfillment_error", tenant_id: tenantId },
    extra: { paymentRowId, message },
  });

  // ✅ NOVO (achado 08/08/2026, revisão do bot de atendimento): Sentry é
  // ferramenta de monitoramento técnico, NÃO é o sino nem o e-mail do
  // painel — o Márcio não via isso no fluxo normal. Pedido dele: erro de
  // integração/renovação de verdade precisa de sino E e-mail, sempre —
  // mesmo padrão já usado em manual_pending (notifyManual, mais acima
  // neste arquivo). Envolto em try/catch pra nunca quebrar o fluxo de
  // pagamento por causa de uma falha ao notificar.
  try {
    const { data: payment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("client_id, plan_label, period, price_amount, price_currency, mp_payment_id")
      .eq("id", paymentRowId)
      .maybeSingle();

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, server_username, servers(name)")
      .eq("id", payment?.client_id)
      .maybeSingle();
    const serverName = (client?.servers as any)?.name || "Desconhecido";

    await notify({
      tenantId,
      type: "fulfillment_error",
      title: "🔴 Falha técnica na renovação automática",
      message: `Pagamento de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment?.price_currency || "BRL" }).format(payment?.price_amount || 0)} confirmado para ${formatClientLabel(client?.display_name, client?.server_username, serverName)}, mas a renovação automática falhou: ${message}. Acesse a Auditoria pra concluir.`,
      link: "/admin/auditoria",
      sourceId: paymentRowId,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.UNIGESTOR_APP_URL || "https://unigestor.net.br";
    await fetch(`${baseUrl}/api/notifications/manual-renewal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": String(process.env.INTERNAL_API_SECRET) },
      body: JSON.stringify({
        clientName: client?.display_name,
        serverUsername: client?.server_username,
        serverName,
        planLabel: payment?.plan_label || payment?.period,
        amount: payment?.price_amount,
        currency: payment?.price_currency || "BRL",
        mpPaymentId: payment?.mp_payment_id,
        reason: message,
      }),
    });
  } catch (e) {
    safeServerLog("markFulfillmentError: failed to notify", (e as any)?.message);
  }
}

// ============================================================
// Pagamento avulso de licença de app (payment_type='app_renewal')
// ============================================================
// O pagamento em si é automático (MP/Stripe aprova sozinho), mas a
// RENOVAÇÃO de verdade fica pendente de ação manual (pedido do Márcio,
// 28/07/2026): o dinheiro que o cliente paga aqui é a margem/taxa de
// gerenciamento, não a licença em si — a licença de verdade é paga pelo
// Márcio direto ao desenvolvedor do app, por fora do sistema. Por isso
// "fulfillment" aqui só cai pra "manual_pending" (mesmo estado/badge roxo
// já usado pra renovação manual de assinatura IPTV) — a Auditoria mostra
// um botão "Concluir" que abre um painel com os dados do app (device
// id/key, vencimento antigo) e um "Atualizar" que consulta o vencimento
// real no painel do parceiro, depois de o Márcio já ter pago a licença
// por fora. NUNCA chama runFulfillment (isso é só pra assinatura IPTV) —
// pagar a licença de um app não renova a assinatura do cliente nem mexe em
// clients.vencimento.
export async function markAppRenewalPaid(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  origin?: string
) {
  const { data: payment } = await supabaseAdmin
    .from("client_portal_payments")
    .select("client_id, client_app_id, price_amount, price_currency, app_name_snapshot, mp_payment_id")
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId)
    .maybeSingle();

  // ✅ Idempotência (achado em 11/08/2026 — cliente recebeu 2 emails
  // idênticos pela mesma renovação de licença de app): essa função é
  // chamada por 4 caminhos diferentes que podem disparar pro MESMO
  // pagamento — webhook do Mercado Pago/Stripe (que pode reenviar o mesmo
  // evento) E o polling de /client-portal/payment-status (chamado repetidas
  // vezes pelo navegador do cliente enquanto aguarda a confirmação), às
  // vezes quase simultâneos. payment_type='app_renewal' nunca chega a
  // fulfillment_status='done' (fica em 'manual_pending' até o admin
  // concluir na Auditoria), então um guard tipo "só roda se != done" no
  // chamador NUNCA bloqueia reexecução. Update condicional (só troca se
  // ainda não tinha sido marcado) garante que só a primeira chamada de
  // verdade manda o sino + o email — as demais só encontram 0 linhas
  // afetadas e saem sem notificar de novo.
  //
  // ⚠️ INCIDENTE 15/08/2026: isso ERA um .update(...).or("fulfillment_status
  // .is.null,fulfillment_status.eq.pending") via supabase-js — o PostgREST
  // devolve erro ("column ... does not exist") pra essa combinação
  // específica de UPDATE + .or() nessa coluna (confirmado ao vivo: SELECT
  // com o mesmo .or() funciona, UPDATE sem .or() funciona, só a combinação
  // quebra — e o mesmo UPDATE via SQL puro funciona perfeito, então é bug/
  // limitação do PostgREST, não do Postgres). O código só olhava `data`, não
  // `error` — a falha do PostgREST fazia `data` vir null, e o guard tratava
  // isso EXATAMENTE igual a "já processado" — silencioso, sem log, sem
  // Sentry, indistinguível de comportamento normal. Um pagamento real
  // (Adenilson, DupleCast, R$30) ficou "processando" pra sempre até o
  // Márcio notar o badge "Travada" na Auditoria. Trocado pra uma função SQL
  // (mark_app_renewal_manual_pending, docs/sql/
  // fix_mark_app_renewal_postgrest_or_bug.sql) que faz o mesmo UPDATE
  // condicional via SQL puro dentro do Postgres — sem passar pelo filtro
  // .or() do PostgREST — e agora captura qualquer erro real no Sentry em
  // vez de engolir.
  const { data: wasUpdated, error: updateErr } = await supabaseAdmin.rpc(
    "mark_app_renewal_manual_pending",
    { p_payment_id: paymentRowId, p_tenant_id: tenantId },
  );

  if (updateErr) {
    safeServerLog("markAppRenewalPaid: update failed", updateErr.message);
    Sentry.captureException(
      new Error(`markAppRenewalPaid: falha ao marcar manual_pending — ${updateErr.message}`),
      { tags: { kind: "fulfillment_error", payment_type: "app_renewal" }, extra: { paymentRowId, tenantId } },
    );
    return;
  }

  if (!wasUpdated) {
    return; // já tinha sido processado por outra chamada — não notifica de novo
  }

  // ============================================================
  // Ativação automática via Appativa (achado 25/08/2026) — só entra em
  // ação quando o app renovado está mapeado (apps.appativa_app_id). Sem
  // mapeamento, comportamento ZERO-MUDANÇA: cai direto no fluxo manual de
  // sempre (sino+e-mail abaixo, admin conclui na Auditoria).
  //
  // A API da Appativa é ASSÍNCRONA — solicitar-ativacao só devolve um id
  // (fila deles), nunca o vencimento real. Por isso o fulfillment_status
  // continua 'manual_pending' mesmo numa solicitação aceita — quem conclui
  // de verdade (fulfillment_status='manual_done', vencimento real,
  // WhatsApp pro cliente) é o webhook (app/api/webhooks/appativa/route.ts,
  // quando chega) OU as 2 checagens automáticas (5s + 30s depois, agendadas
  // logo abaixo via `after()`) OU o botão "Ver status" manual no modal
  // "Concluir renovação" da Auditoria (app/api/admin/apps/
  // check-appativa-status). Sem volume que justifique um cron recorrente
  // (pedido do Márcio, 25/08/2026) — as 3 vias chamam a MESMA
  // resolveAppativaAppRenewal, então nunca duplicam a lógica de conclusão.
  // Fica dentro do guard `wasUpdated` de propósito — mesma proteção de
  // idempotência que já existe aqui evita chamar solicitar-ativacao 2x pro
  // mesmo pagamento numa corrida entre os 4 caminhos que chamam esta função.
  //
  // ✅ Achado 26/08/2026 (pedido do Márcio): quando a solicitação é aceita
  // e as checagens automáticas vão rodar, o sino/e-mail de "pendente" NÃO
  // dispara na hora — só se as checagens (5 em 5s por 1 min) terminarem sem
  // confirmar. Assim, no caso comum (Appativa confirma rápido), nunca chega
  // a aparecer como pendente pro admin. Em qualquer outro caminho (sem
  // mapeamento, sem MAC, falha ao solicitar, etc.) o aviso continua
  // disparando na hora, sem mudança.
  let deferManualPendingNotify = false;
  try {
    if (payment?.client_app_id) {
      const { data: appRow } = await supabaseAdmin
        .from("client_apps")
        .select("field_values, apps(appativa_app_id, fields_config, name)")
        .eq("id", payment.client_app_id)
        .maybeSingle();
      const appMeta = Array.isArray(appRow?.apps) ? appRow.apps[0] : appRow?.apps;
      const appativaAppId = appMeta?.appativa_app_id ? String(appMeta.appativa_app_id) : "";

      if (appativaAppId) {
        const fieldsConfig = Array.isArray(appMeta?.fields_config) ? appMeta.fields_config : [];
        const values = appRow?.field_values || {};
        const macApp = extractFieldByType(fieldsConfig, values, "mac");
        const keyApp = extractFieldByType(fieldsConfig, values, "device_key");

        if (!macApp) {
          // ✅ Sem MAC salvo — nem tenta chamar a Appativa, mesma mensagem
          // que checkClientAppValidity já usa nesse caso (lib/apps/
          // orchestration.ts) pra manter a linguagem consistente.
          await supabaseAdmin
            .from("client_portal_payments")
            .update({ fulfillment_error: "Preencha o Device ID (MAC) antes de renovar." })
            .eq("id", paymentRowId)
            .eq("tenant_id", tenantId);
        } else {
          const apiKey = await getAppativaApiKey(supabaseAdmin, tenantId);
          if (!apiKey) {
            safeServerLog("markAppRenewalPaid: Appativa mapeada mas sem parceiro ativo/chave configurada");
          } else {
            const result = await solicitarAtivacao(apiKey, {
              appativaAppId,
              macApp,
              keyApp: keyApp || undefined,
            });

            // ⚠️ Narrowing via `"data" in result`, de propósito — com
            // `strict: false` neste projeto (sem strictNullChecks), o TS
            // estreita mal uniões discriminadas por igualdade literal
            // (`if (result.ok)`) quando um ramo tem campo extra (mesmo bug
            // já documentado em couponRejectReason, lib/client-portal/
            // coupons.ts). Narrowing por `in` não tem esse problema.
            if ("data" in result) {
              await supabaseAdmin
                .from("client_portal_payments")
                .update({ appativa_historico_id: result.data.id, fulfillment_error: null })
                .eq("id", paymentRowId)
                .eq("tenant_id", tenantId);

              // ✅ Checagem automática de 5 em 5s por 1 min (achado
              // 26/08/2026, pedido do Márcio: uma renovação real levou ~2min
              // entre pago e confirmado — as antigas 2 tentativas, 5s+30s,
              // não alcançavam, só fechou quando ele clicou "Ver status" à
              // mão). Ainda sem cron recorrente — depois de 1 min sem
              // confirmar, fica manual pro botão "Ver status" resolver
              // quando o admin quiser. `after()` roda DEPOIS da resposta
              // HTTP já ter sido enviada — não atrasa o webhook do MP/Stripe
              // nem o polling do navegador do cliente. resolveAppativaAppRenewal
              // já sai cedo se já estiver manual_done, então cada tentativa
              // extra é barata quando uma anterior já resolveu.
              //
              // ⚠️ Achado 26/08/2026 (revisão pós-implementação, mesmo
              // anti-padrão caçado em docs/perf-audit-checklist.md): o sync
              // de créditos (achado anterior, mesmo dia — "saldo ficava
              // desatualizado") estava com `await` direto aqui, ANTES do
              // `after()`, atrasando a resposta ao navegador do cliente/
              // webhook do MP/Stripe por uma chamada de rede extra que não
              // tem nenhuma relação com o pagamento em si. Movido pra
              // dentro do `after()` (1ª coisa, antes do sleep de 5s) — só
              // bookkeeping, não precisa bloquear nada.
              deferManualPendingNotify = true;
              after(async () => {
                await syncAppativaCredits(supabaseAdmin, tenantId).catch((e: any) =>
                  prodLog("markAppRenewalPaid: sync de créditos falhou", { message: e?.message }),
                );
                try {
                  const POLL_INTERVAL_MS = 5_000;
                  const POLL_TOTAL_MS = 60_000;
                  const attempts = Math.floor(POLL_TOTAL_MS / POLL_INTERVAL_MS);
                  let resolved = false;
                  for (let i = 0; i < attempts; i++) {
                    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
                    const check = await resolveAppativaAppRenewal(supabaseAdmin, tenantId, paymentRowId);
                    if (check.outcome === "done") {
                      resolved = true;
                      break;
                    }
                  }

                  if (!resolved) {
                    // ✅ 1 min de tentativas automáticas não confirmou — só
                    // agora dispara o sino/e-mail de "pendente" (achado
                    // 26/08/2026: evita avisar o admin de algo que se resolve
                    // sozinho em segundos no caso comum).
                    await notifyAppRenewalManualPending(supabaseAdmin, tenantId, paymentRowId, payment, origin);
                  }
                } catch (e: any) {
                  prodLog("markAppRenewalPaid: checagem automática falhou", { message: e?.message });
                }
              });
            } else {
              await supabaseAdmin
                .from("client_portal_payments")
                .update({ fulfillment_error: `Appativa: ${result.error}` })
                .eq("id", paymentRowId)
                .eq("tenant_id", tenantId);
              Sentry.captureMessage("markAppRenewalPaid: solicitar-ativacao falhou", {
                level: "warning",
                tags: { kind: "client_portal_error", where: "appativa_solicitar_ativacao" },
                extra: { paymentRowId, tenantId, error: result.error },
              });
            }
          }
        }
      } else if (appMeta?.name === "GPC Roku") {
        // ============================================================
        // Renovação paga automática do GPC Roku (achado 26/08/2026, pedido
        // do Márcio — ver docs/sql/gpc_roku_activations.sql): diferente do
        // resto da família GerenciaApp (grátis de verdade), esse app tem
        // custo real pra ele. Ao pagar, marca o MAC como "pago" com
        // validade de 10 anos A CONTAR DO PAGAMENTO (não uma extensão a
        // partir do vencimento atual) e chama a MESMA action "renew" do
        // GerenciaApp (app/api/integrations/apps/gerenciaapp/route.ts),
        // agora aceitando uma data explícita — síncrono, sem precisar de
        // webhook/polling como a Appativa (o "renew" deles já confirma
        // dentro da própria chamada).
        const fieldsConfig = Array.isArray(appMeta?.fields_config) ? appMeta.fields_config : [];
        const values = appRow?.field_values || {};
        const macApp = extractFieldByType(fieldsConfig, values, "mac");

        if (!macApp) {
          await supabaseAdmin
            .from("client_portal_payments")
            .update({ fulfillment_error: "Preencha o Device ID (MAC) antes de renovar." })
            .eq("id", paymentRowId)
            .eq("tenant_id", tenantId);
        } else {
          // ✅ Núcleo (troca o vencimento no GerenciaApp + grava no
          // registro) compartilhado com o botão manual do admin
          // (app/api/admin/apps/gpc-roku/mark-paid/route.ts) — só o que vem
          // DEPOIS (marcar pagamento concluído, notificar, WhatsApp) é
          // específico do fluxo de pagamento, fica aqui.
          const result = await renewGpcRokuTenYears(supabaseAdmin, {
            tenantId,
            clientId: payment.client_id,
            clientAppId: payment.client_app_id,
            macValue: macApp,
            fieldsConfig,
            fieldValues: values,
          });

          // ⚠️ Narrowing via `"error" in result` (não `!result.ok`), mesmo
          // motivo documentado no branch da Appativa acima (strict:false não
          // estreita bem uniões discriminadas por negação de boolean).
          if (!("error" in result)) {
            // Mesmo guard atômico usado no sucesso da Appativa — evita
            // reenviar WhatsApp/log se outra chamada concorrente já
            // concluiu esse mesmo pagamento.
            const { data: claimedRows } = await supabaseAdmin
              .from("client_portal_payments")
              .update({ fulfillment_status: "manual_done", fulfilled_at: new Date().toISOString(), fulfillment_error: null })
              .eq("id", paymentRowId)
              .eq("tenant_id", tenantId)
              .eq("fulfillment_status", "manual_pending")
              .select("id");

            deferManualPendingNotify = true;

            if (claimedRows && claimedRows.length > 0) {
              await resolveNotification(tenantId, "manual_pending", paymentRowId);

              try {
                await supabaseAdmin.from("client_events").insert({
                  tenant_id: tenantId,
                  client_id: payment.client_id,
                  event_type: "APP_RENEWAL_AUTO",
                  message: `Renovação automática via GerenciaApp (GPC Roku) · ${payment.app_name_snapshot || "Aplicativo"}`,
                  meta: { payment_id: paymentRowId, mac: macApp, source: "gpc_roku_renew" },
                });

                const { data: client } = await supabaseAdmin
                  .from("clients")
                  .select("display_name, server_username, server_id, servers(name, whatsapp_session)")
                  .eq("id", payment.client_id)
                  .maybeSingle();
                const serverMeta = Array.isArray(client?.servers) ? client.servers[0] : client?.servers;

                if (origin) {
                  await sendAppRenewalWhatsapp(supabaseAdmin, {
                    tenantId,
                    clientId: payment.client_id,
                    paymentId: paymentRowId,
                    origin,
                    whatsappSession: (serverMeta as any)?.whatsapp_session || "default",
                    appName: payment.app_name_snapshot || "Aplicativo",
                    appVencimento: result.expireDate,
                  });
                }
              } catch (e: any) {
                prodLog("gpc_roku_renew.post_success_side_effects_failed", { paymentRowId, message: e?.message });
              }
            }
          } else {
            await supabaseAdmin
              .from("client_portal_payments")
              .update({ fulfillment_error: result.error })
              .eq("id", paymentRowId)
              .eq("tenant_id", tenantId);
          }
        }
      }
    }
  } catch (e) {
    safeServerLog("markAppRenewalPaid: falha na tentativa de ativação automática (Appativa)", (e as any)?.message);
  }

  // ✅ Sino + e-mail de "pendente" — disparado na hora pra todo caminho
  // exceto os que já concluíram sozinhos ou estão em checagem automática
  // (deferManualPendingNotify = true): Appativa em fila (só notifica se 1
  // min de tentativas não confirmar, ver dentro do after() acima) ou GPC
  // Roku já concluído de verdade nesta mesma chamada (síncrono).
  if (!deferManualPendingNotify) {
    await notifyAppRenewalManualPending(supabaseAdmin, tenantId, paymentRowId, payment, origin);
  }
}

// ✅ Sino de notificação — mesmo padrão do manual_pending de assinatura IPTV
// (notifyManual acima). Sem isso, o pagamento cai pra ação manual mas
// ninguém no admin fica sabendo até abrir a Auditoria por acaso. Extraída
// (26/08/2026) pra poder ser chamada tanto na hora (fluxo manual/sem
// Appativa) quanto de dentro do after() — só depois das 2 checagens
// automáticas da Appativa não confirmarem sozinhas.
async function notifyAppRenewalManualPending(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  payment: any,
  origin?: string,
) {
  try {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, server_username, servers(name)")
      .eq("id", payment?.client_id)
      .maybeSingle();
    const serverName = (client?.servers as any)?.name || "";

    await notify({
      tenantId,
      type: "manual_pending",
      title: "🟣 Renovação de licença de app pendente",
      message: `Pagamento de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment?.price_currency || "BRL" }).format(payment?.price_amount || 0)} confirmado para ${formatClientLabel(client?.display_name, client?.server_username, serverName)} — licença de "${payment?.app_name_snapshot || "aplicativo"}". Acesse a Auditoria pra concluir.`,
      link: "/admin/auditoria",
      sourceId: paymentRowId,
    });

    // ✅ Email "bonitinho" (pedido do Márcio, 06/08/2026) — antes só a
    // renovação manual de ASSINATURA IPTV mandava email (notifyManual mais
    // abaixo); a de licença de app ficava só no sino, fácil de passar batido.
    // Mesmos dados de configuração (MAC/Device Key/etc.) mostrados no modal
    // "Concluir renovação" da Auditoria — resolvidos aqui pelo
    // apps.fields_config, igual AplicativosLog.tsx faz no admin.
    if (origin) {
      try {
        let fields: { label: string; value: string }[] = [];
        if (payment?.client_app_id) {
          const { data: appRow } = await supabaseAdmin
            .from("client_apps")
            .select("field_values, apps(fields_config)")
            .eq("id", payment.client_app_id)
            .maybeSingle();
          const appMeta = Array.isArray(appRow?.apps) ? appRow.apps[0] : appRow?.apps;
          const fieldsConfig = Array.isArray((appMeta as any)?.fields_config)
            ? (appMeta as any).fields_config
            : [];
          const values = appRow?.field_values || {};
          fields = fieldsConfig
            .map((f: any) => {
              const raw = values[String(f.id)];
              if (!raw) return null;
              const label = String(f.label || "").trim() || APP_FIELD_LABELS[f.type as AppFieldType] || String(f.id);
              return { label, value: String(raw) };
            })
            .filter((f): f is { label: string; value: string } => !!f);
        }

        await fetch(`${origin}/api/notifications/app-renewal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": String(process.env.INTERNAL_API_SECRET) },
          body: JSON.stringify({
            clientName: client?.display_name || "Cliente",
            serverUsername: client?.server_username || "",
            serverName,
            appName: payment?.app_name_snapshot || "Aplicativo",
            amount: payment?.price_amount || 0,
            currency: payment?.price_currency || "BRL",
            paymentRef: payment?.mp_payment_id || null,
            fields,
          }),
        });
      } catch (e) {
        safeServerLog("Erro ao notificar email de renovação de app", e);
      }
    }
  } catch {
    // não bloqueia o fulfillment por falha na notificação
  }
}

function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  return appUrl.replace(/\/+$/, "");
}

const APPATIVA_SUCCESS_STATUSES = new Set(["ativado", "aprovado"]);
const APPATIVA_FAILURE_STATUSES = new Set(["incorreto", "reprovado"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Renovação é sempre anual ou vitalícia, e só é permitida com até 30 dias
// de antecedência do vencimento — uma data ANTIGA (ainda não renovada)
// nunca passa de +30 dias à frente. Exigir bem mais que isso separa com
// folga enorme uma confirmação de verdade de um valor velho/errado.
const APPATIVA_MIN_DAYS_FORWARD = 300;

// ✅ Mesma lógica de escolha de template que components/apps/
// AppRequestModal.tsx usa na conclusão manual (template "Aplicativo
// Renovado" + sorteio de variante), pro lado servidor. Fail-soft: nunca
// lança, só loga.
//
// ✅ {app_nome}/{app_vencimento} (achado 26/08/2026, pedido do Márcio): a
// mensagem agora informa direto qual app foi renovado e o vencimento novo
// — não precisa mais mandar o cliente entrar no portal pra conferir.
async function sendAppRenewalWhatsapp(
  supabaseAdmin: any,
  params: {
    tenantId: string;
    clientId: string;
    paymentId: string;
    origin: string;
    whatsappSession: string;
    appName: string;
    appVencimento: string | null;
  },
) {
  try {
    const { data: tmpl } = await supabaseAdmin
      .from("message_templates")
      .select("id, content, image_url")
      .eq("tenant_id", params.tenantId)
      .ilike("name", "%aplicativo renovado%")
      .maybeSingle();

    if (!tmpl?.content) return;

    let pickedContent = String(tmpl.content).trim();
    const { data: variants } = await supabaseAdmin
      .from("message_template_variants")
      .select("content")
      .eq("tenant_id", params.tenantId)
      .eq("template_id", tmpl.id);
    const pool = [tmpl.content, ...(variants || []).map((v: any) => v.content)].filter(
      (c: any): c is string => !!c && String(c).trim().length > 0,
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
        app_nome: params.appName,
        app_vencimento: params.appVencimento,
      }),
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || json?.ok === false) {
      prodLog("appativa_resolve.whatsapp_send_failed", { status: res.status });
      await supabaseAdmin.from("client_portal_payments").update({ whatsapp_status: "error" }).eq("id", params.paymentId);
      return;
    }

    // ✅ Mesma coluna/valores que a conclusão manual (AppRequestModal.tsx,
    // via RPC update_whatsapp_status) e a renovação automática de
    // assinatura (mais acima neste arquivo) usam — achado 26/08/2026: sem
    // isso, a coluna WHATSAPP da Auditoria ficava "—" mesmo com a mensagem
    // realmente entregue (só o envio em si estava sendo feito, nunca
    // registrado).
    await supabaseAdmin.from("client_portal_payments").update({ whatsapp_status: "sent" }).eq("id", params.paymentId);
  } catch (e: any) {
    prodLog("appativa_resolve.whatsapp_send_error", { message: e?.message });
    await supabaseAdmin.from("client_portal_payments").update({ whatsapp_status: "error" }).eq("id", params.paymentId);
  }
}

// ============================================================
// resolveAppativaAppRenewal — reconsulta a Appativa (/api/historico) pra
// confirmar/concluir um app_renewal pendente. Achado 25/08/2026 (Márcio, em
// produção): o webhook deles (app/api/webhooks/appativa/route.ts) pode
// demorar muito ou nunca disparar — o próprio /api/historico tem um campo
// `enviado_n8n` que ficou `false` minutos depois de uma ativação já
// confirmada do lado deles. Em vez de confiar só no push, essa função
// reconsulta direto na fonte (mesmo dado que aparece no dashboard deles,
// appativa.store/reseller/activations) — usada pelo webhook (quando chega),
// pelas 2 checagens automáticas (5s + 30s) agendadas em markAppRenewalPaid
// (via after(), acima) e pelo botão "Ver status" manual do admin
// (app/api/admin/apps/check-appativa-status/route.ts), pra nunca duplicar a
// lógica de conclusão. Sem cron recorrente de propósito (pedido do Márcio,
// 25/08/2026: volume baixo não justifica polling periódico).
//
// Fonte do vencimento aqui é a Appativa (data_expiracao_at do histórico
// dessa ativação específica), NÃO o painel do app em si — diferente de
// checkClientAppValidity (lib/apps/orchestration.ts), que faz login no
// painel de cada parceiro. Isso é uma vantagem, não uma limitação: funciona
// igual pra QUALQUER app mapeado (inclusive os que só dá pra checar por
// extensão, tipo Clouddy), porque não depende de handler próprio — é
// exatamente o dado que o Márcio já confere manualmente no dashboard deles
// hoje pra esses casos.
export async function resolveAppativaAppRenewal(
  supabaseAdmin: any,
  tenantId: string,
  paymentId: string,
): Promise<{ outcome: "done" | "pending" | "error" | "skipped" }> {
  const { data: payment } = await supabaseAdmin
    .from("client_portal_payments")
    .select("id, tenant_id, client_id, client_app_id, app_name_snapshot, price_currency, price_amount, fulfillment_status, appativa_historico_id")
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment || !payment.appativa_historico_id) return { outcome: "skipped" };
  if (payment.fulfillment_status === "manual_done") return { outcome: "done" };

  const apiKey = await getAppativaApiKey(supabaseAdmin, tenantId);
  if (!apiKey) return { outcome: "skipped" };

  const result = await consultarAtivacao(apiKey, payment.appativa_historico_id);
  if (!("data" in result)) {
    prodLog("appativa_resolve.consultar_falhou", { paymentId, message: result.error });
    // ✅ Achado 26/08/2026 (Márcio perguntou "por que o check de 30s não
    // pegou, se a Appativa confirmou em 23s?"): sem isso, uma falha real na
    // chamada (timeout, 5xx, lag de leitura logo após o solicitar-ativacao)
    // virava "pending" em silêncio — indistinguível de "ainda em fila do
    // lado deles" e só visível no console.log do Vercel (que não dá pra
    // consultar depois). Sentry (level warning, não crash) dá rastro
    // consultável via API pra próxima vez que isso acontecer. Esperado
    // aparecer 1-2x logo após o solicitar-ativacao (undocumented lag do
    // ?id= deles) — só vira sinal de alerta de verdade se repetir toda
    // tentativa de um mesmo pagamento.
    Sentry.captureMessage("appativa_resolve: consultar-ativacao falhou", {
      level: "warning",
      tags: { kind: "client_portal_error", where: "appativa_consultar_ativacao" },
      extra: { paymentId, tenantId, historicoId: payment.appativa_historico_id, error: result.error },
    });
    return { outcome: "pending" };
  }

  const item = result.data;
  const status = String(item.status_transacao || "").trim().toLowerCase();

  // ✅ Achado 26/08/2026 (pedido do Márcio: "se não confirmarmos lá, o ver
  // status vai confirmar... [créditos]"): o saldo pode só ser finalizado do
  // lado deles quando o status sai de "Solicitado/Pendente" pra um estado
  // definitivo (Ativado/Aprovado/Incorreto/Reprovado) — não necessariamente
  // já na hora do solicitar-ativacao. Sincroniza aqui, na MESMA função que
  // webhook/checagens automáticas/"Ver status" usam pra concluir, então
  // cobre os 3 caminhos de uma vez, sem duplicar em cada caller.
  if (APPATIVA_SUCCESS_STATUSES.has(status) || APPATIVA_FAILURE_STATUSES.has(status)) {
    try {
      await syncAppativaCredits(supabaseAdmin, tenantId);
    } catch (e: any) {
      prodLog("appativa_resolve.sync_credits_failed", { paymentId, message: e?.message });
    }
  }

  if (APPATIVA_FAILURE_STATUSES.has(status)) {
    await supabaseAdmin
      .from("client_portal_payments")
      .update({
        fulfillment_error: `Appativa recusou a ativação (status: "${item.status_transacao}"). Confira o Device ID (MAC) do aplicativo.`,
      })
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return { outcome: "error" };
  }

  if (!APPATIVA_SUCCESS_STATUSES.has(status)) {
    return { outcome: "pending" }; // ainda em fila do lado deles (Solicitado/Pendente/etc.)
  }

  const rawExpire = item.data_expiracao_at || item.data_expiracao || null;
  const dateOnly = extractDateOnly(rawExpire);
  const daysForward = dateOnly ? (new Date(`${dateOnly}T23:59:59`).getTime() - Date.now()) / MS_PER_DAY : -1;

  if (!dateOnly || daysForward < APPATIVA_MIN_DAYS_FORWARD) {
    await supabaseAdmin
      .from("client_portal_payments")
      .update({
        fulfillment_error:
          "Appativa confirmou a ativação, mas o vencimento devolvido não bateu com o esperado (renovação anual/vitalícia). Verifique e conclua manualmente.",
      })
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return { outcome: "error" };
  }

  // ✅ Persiste o vencimento confirmado em client_apps.field_values (mesmo
  // campo que checkClientAppValidity usa) — reflete na UI (portal, admin)
  // mesmo pra apps sem checagem automática própria.
  if (payment.client_app_id) {
    try {
      const { data: appRow } = await supabaseAdmin
        .from("client_apps")
        .select("field_values, apps(fields_config)")
        .eq("id", payment.client_app_id)
        .maybeSingle();
      const appMeta = Array.isArray(appRow?.apps) ? appRow.apps[0] : appRow?.apps;
      const fieldsConfig = Array.isArray(appMeta?.fields_config) ? appMeta.fields_config : [];
      const dateField = findFieldByType(fieldsConfig, "date");
      if (dateField && appRow) {
        const fieldKey = String(dateField.id || dateField.label);
        await supabaseAdmin
          .from("client_apps")
          .update({ field_values: { ...(appRow.field_values || {}), [fieldKey]: dateOnly } })
          .eq("id", payment.client_app_id);
      }
    } catch (e: any) {
      prodLog("appativa_resolve.persist_date_failed", { paymentId, message: e?.message });
    }
  }

  // ⚠️ Achado 26/08/2026 (revisão de corrida): o webhook e as 2 checagens
  // automáticas (5s/30s) podem, em teoria, cair quase juntos — os dois
  // já teriam lido fulfillment_status='manual_pending' antes de qualquer um
  // escrever. Guard atômico via .eq("fulfillment_status","manual_pending")
  // + .select(): só a PRIMEIRA chamada realmente conclui (Postgres serializa
  // o UPDATE); qualquer outra concorrente encontra 0 linhas e sai sem
  // reenviar o WhatsApp. Mesmo espírito do incidente de 11/08/2026
  // (mark_app_renewal_manual_pending) que motivou o guard condicional ali.
  const { data: claimedRows } = await supabaseAdmin
    .from("client_portal_payments")
    .update({ fulfillment_status: "manual_done", fulfilled_at: new Date().toISOString(), fulfillment_error: null })
    .eq("id", payment.id)
    .eq("tenant_id", tenantId)
    .eq("fulfillment_status", "manual_pending")
    .select("id");

  if (!claimedRows || claimedRows.length === 0) {
    return { outcome: "done" }; // outra chamada concorrente já concluiu — não repete WhatsApp/log
  }

  await resolveNotification(tenantId, "manual_pending", payment.id);

  try {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, server_username, server_id, servers(name, whatsapp_session)")
      .eq("id", payment.client_id)
      .maybeSingle();
    const serverMeta = Array.isArray(client?.servers) ? client.servers[0] : client?.servers;

    await supabaseAdmin.from("client_events").insert({
      tenant_id: tenantId,
      client_id: payment.client_id,
      event_type: "APP_RENEWAL_AUTO",
      message: `Renovação automática via Appativa · ${payment.app_name_snapshot || "Aplicativo"}`,
      meta: { payment_id: payment.id, appativa_historico_id: payment.appativa_historico_id, source: "appativa_resolve" },
    });

    const origin = getAppOrigin();
    if (origin) {
      await sendAppRenewalWhatsapp(supabaseAdmin, {
        tenantId,
        clientId: payment.client_id,
        paymentId: payment.id,
        origin,
        whatsappSession: (serverMeta as any)?.whatsapp_session || "default",
        appName: payment.app_name_snapshot || "Aplicativo",
        appVencimento: dateOnly,
      });
    }
  } catch (e: any) {
    prodLog("appativa_resolve.post_success_side_effects_failed", { paymentId, message: e?.message });
  }

  return { outcome: "done" };
}

// ============================================================
// runFulfillment
// ============================================================
export async function runFulfillment(params: FulfillmentParams) {
  const { supabaseAdmin, tenantId, origin, payment } = params;

  // 1) Carrega cliente
  const { data: client, error: cErr } = await supabaseAdmin
    .from("clients")
    .select("id,tenant_id,display_name,server_username,server_password,external_user_id,technology,server_id,whatsapp_username,price_currency,is_trial,screens")
    .eq("tenant_id", tenantId)
    .eq("id", payment.client_id)
    .single();

  if (cErr || !client) throw new Error("Cliente não encontrado para renovação.");
  prodLog("fulfillment.start", {
  tenant: tenantId.slice(-6),
  client_id: String(client.id).slice(-6),
  client_name: String((client as any).display_name || "").slice(0, 20),
  provider: "pending",
  period: payment.period,
  amount: payment.price_amount,
  currency: payment.price_currency,
  mp_payment_id: String(payment.mp_payment_id).slice(-6),
});

  // (correcao) Quita pendencias financeiras e grava resgate de cupom AQUI,
  // logo apos carregar o cliente — ANTES de qualquer caminho que possa
  // cair em notifyManual()/return antecipado (servidor sem integracao,
  // Elite, falha na chamada de renovacao) ou lancar excecao (linhas
  // abaixo). O lado financeiro (pendencia quitada, cupom usado) e
  // verdadeiro assim que o pagamento e confirmado, independente de o
  // provisionamento no painel IPTV ter sucesso na hora ou precisar de
  // acompanhamento manual depois. Fica dentro do runFulfillment (nao nos
  // webhooks) porque tanto o webhook quanto o polling de payment-status
  // chamam runFulfillment - so um deles de fato executa (o outro cai no
  // lock ocupado) - entao isso garante que roda exatamente uma vez, nao
  // importa qual caminho venceu a corrida NEM se o resto da funcao
  // depois cai no fluxo manual ou lanca erro.
  const settledAlertIds = (payment as any).settled_alert_ids || [];
  if (settledAlertIds.length) {
    await supabaseAdmin
      .from("client_alerts")
      .update({ status: "CLOSED", closed_at: new Date().toISOString() })
      .in("id", settledAlertIds)
      .eq("status", "OPEN");
  }

  // coupon_discount_amount NUNCA entra no price_amount do cliente (que usa
  // plan_price_amount, sem desconto, la embaixo) - o desconto vale so pra
  // essa cobranca. Guard por payment_id evita gravar 2x se runFulfillment
  // for chamado de novo pro mesmo pagamento depois de um erro mais abaixo
  // (ex: webhook reprocessando apos throw).
  const couponId = (payment as any).coupon_id || null;
  const couponDiscountAmount = Number((payment as any).coupon_discount_amount || 0);
  if (couponId && couponDiscountAmount > 0) {
    const { count: alreadyRedeemedCount } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("payment_id", payment.id);

    if (!alreadyRedeemedCount) {
      // ⚠️ coupon_redemptions tem UNIQUE(coupon_id, client_id) — rede de
      // segurança pro caso raro de 2 payments (ids diferentes, então locks
      // diferentes) do mesmo cupom+cliente terem sido criados em paralelo
      // antes de qualquer resgate existir (achado em auditoria de
      // segurança). Se cair aqui, o insert falha por violação de unique;
      // logamos em vez de deixar silencioso, mas NÃO travamos o
      // fulfillment por causa disso — o pagamento já foi cobrado/aprovado,
      // só o registro duplicado de resgate é que não deve existir.
      const { error: redeemErr } = await supabaseAdmin.from("coupon_redemptions").insert({
        tenant_id: tenantId,
        coupon_id: couponId,
        client_id: client.id,
        payment_id: payment.id,
        discount_amount: couponDiscountAmount,
        currency: payment.price_currency || (client as any).price_currency || "BRL",
      });

      if (redeemErr) {
        prodLog("fulfillment.coupon_redemption_insert_failed", {
          payment_id: String(payment.id).slice(-6),
          coupon_id: String(couponId).slice(-6),
          code: (redeemErr as any)?.code,
          message: redeemErr.message,
        });
        Sentry.captureMessage("fulfillment: coupon_redemption insert failed", {
          level: "warning",
          tags: { kind: "client_portal_error", where: "coupon_redemption_insert" },
          extra: { payment_id: payment.id, coupon_id: couponId, message: redeemErr.message, code: (redeemErr as any)?.code },
        });
      } else {
        // Cupom pessoal se autodesativa ao ser usado - o Marcio reativa
        // manualmente na proxima indicacao (documentado desde a Fase 1.5).
        const { data: couponRow } = await supabaseAdmin
          .from("coupons")
          .select("client_id")
          .eq("id", couponId)
          .maybeSingle();
        if (couponRow?.client_id) {
          await supabaseAdmin.from("coupons").update({ is_active: false }).eq("id", couponId);
        }
      }
    }
  }

  // ============================================================
  // Renovação de app embutida no pagamento combinado (achado 24/08/2026,
  // bundled_app_renewals — congelado em create-payment, NUNCA recalculado
  // aqui). Mesmo raciocínio do bloco de pendência/cupom acima: o dinheiro já
  // foi cobrado numa ÚNICA transação (mp/stripe) aprovada, então a
  // contabilização em 2 linhas precisa acontecer independente do resto do
  // fulfillment (renovação no painel IPTV) ter sucesso, cair pra manual, ou
  // lançar exceção mais abaixo.
  //
  // Idempotência: upsert com onConflict "parent_payment_id,client_app_id"
  // (ver docs/sql/client_portal_payments_bundled_app_renewal.sql) em vez de
  // insert simples — se runFulfillment for chamado de novo pro MESMO
  // payment.id (ex: botão "Reprocessar" da Auditoria depois de o servidor
  // IPTV ter falhado), a linha filha já existente é reaproveitada em vez de
  // duplicada. markAppRenewalPaid já é idempotente por conta própria (RPC
  // condicional), então chamar de novo pra uma filha já processada é seguro.
  // ============================================================
  const bundledAppRenewals: Array<{
    client_app_id: string;
    app_name: string;
    price_amount: number;
    price_currency: string;
  }> = Array.isArray((payment as any).bundled_app_renewals) ? (payment as any).bundled_app_renewals : [];

  for (const item of bundledAppRenewals) {
    const clientAppId = String(item?.client_app_id || "").trim();
    const priceAmount = Number(item?.price_amount);
    if (!clientAppId || !Number.isFinite(priceAmount) || priceAmount <= 0) {
      prodLog("fulfillment.bundled_app_renewal_skipped_invalid_item", {
        payment_id: String(payment.id).slice(-6),
        item,
      });
      continue;
    }

    const { data: childRow, error: childErr } = await supabaseAdmin
      .from("client_portal_payments")
      .upsert(
        {
          tenant_id: tenantId,
          client_id: payment.client_id,
          gateway_type: (payment as any).gateway_type || "mercadopago",
          payment_method: (payment as any).payment_method || "online",
          mp_payment_id: null,
          price_amount: priceAmount,
          price_currency: String(item.price_currency || "BRL"),
          status: "approved",
          payment_type: "app_renewal",
          client_app_id: clientAppId,
          app_name_snapshot: String(item.app_name || "Aplicativo"),
          parent_payment_id: payment.id,
        },
        { onConflict: "parent_payment_id,client_app_id" },
      )
      .select("id")
      .single();

    if (childErr || !childRow) {
      prodLog("fulfillment.bundled_app_renewal_insert_failed", {
        payment_id: String(payment.id).slice(-6),
        client_app_id: clientAppId.slice(-6),
        message: childErr?.message,
      });
      Sentry.captureMessage("fulfillment: bundled app renewal child insert failed", {
        level: "warning",
        tags: { kind: "client_portal_error", where: "bundled_app_renewal_insert" },
        extra: { payment_id: payment.id, client_app_id: clientAppId, message: childErr?.message },
      });
      continue; // não trava o fulfillment do plano por causa disso
    }

    await markAppRenewalPaid(supabaseAdmin, tenantId, childRow.id, origin);
  }

  const login = String((client as any).server_username || "").trim();
  if (!client.server_id || !login) {
    throw new Error("Cliente sem server_id/server_username para renovação.");
  }

  // 2) Servidor
  const { data: srv, error: sErr } = await supabaseAdmin
    .from("servers")
    .select("id,name,panel_integration,whatsapp_session,credits_available") // ✅ ADICIONADO: whatsapp_session + credits_available (necessário p/ alerta de saldo baixo)
    .eq("tenant_id", tenantId)
    .eq("id", client.server_id)
    .single();

  if (sErr || !srv) throw new Error("Servidor não encontrado para renovação.");

  // ============================================================
  // ✅ CHECAGEM DE SALDO BAIXO (≤15) — NÃO BLOQUEANTE
  // Roda assim que o servidor é carregado, independente de integração.
  // Sem await: dispara em background e NUNCA interfere na renovação.
  // Esta é a ÚNICA checagem de saldo do fluxo (a da seção 6 foi removida).
  // ============================================================
  try {
    const creditsNow = Number((srv as any).credits_available);
    if (Number.isFinite(creditsNow) && creditsNow <= 15) {
      prodLog("fulfillment.low_credits", {
        tenant: tenantId.slice(-6),
        server: srv.name,
        credits: creditsNow,
      });

      const lowCreditsSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
      fetch(`${origin}/api/notifications/low-credits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": lowCreditsSecret,
        },
        body: JSON.stringify({
          serverId: srv.id,
          serverName: srv.name,
          credits: creditsNow,
          tenantId: tenantId,
          reason: "Saldo de créditos atingiu o limite crítico de 15 ou menos.",
        }),
      }).catch((e) =>
        safeServerLog("Erro ao enviar e-mail de saldo baixo", e)
      );
    }
  } catch (e) {
    safeServerLog("fulfillment: failed low credits check", (e as any)?.message);
  }

  // ✅ HELPER: Atualiza o banco e dispara o email de alerta simultaneamente
  const notifyManual = async (reason: string) => {
    const manualRef = payment.mp_payment_id || `MAN${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    await supabaseAdmin.from("client_portal_payments").update({ 
      fulfillment_status: "manual_pending",
      // ✅ NÃO mexe no campo "status" — isso é do pagamento, não do fulfillment.
      // Se o pagamento já veio de gateway automático (MP/Stripe), o status
      // "approved" deve permanecer intacto.
      fulfillment_error: reason,
      mp_payment_id: manualRef 
    }).eq("id", payment.id);

    // ✅ NOVO: notificação no sino (tabela notifications)
    await notify({
      tenantId,
      type: "manual_pending",
      title: "🟣 Renovação Manual Pendente",
      message: `Pagamento de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: payment.price_currency || "BRL" }).format(payment.price_amount)} confirmado para ${formatClientLabel(client.display_name, login, srv.name)}. Acesse a Auditoria para liberar o cliente no servidor.`,
      link: "/admin/auditoria",
      sourceId: payment.id,
    });

    try {
      await fetch(`${origin}/api/notifications/manual-renewal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": String(process.env.INTERNAL_API_SECRET) },
        body: JSON.stringify({
          clientName: client.display_name,
          serverUsername: login,
          serverName: srv.name || "Desconhecido",
          planLabel: payment.plan_label || (client as any).plan_label || payment.period,
          amount: payment.price_amount,
          currency: payment.price_currency || "BRL",
          mpPaymentId: manualRef, // ✅ Passa o ID na notificação
          reason
        })
      });
    } catch (e) { safeServerLog("Erro ao notificar email", e); }

    // ========================================================================
    // ✅ REGISTRAR RENOVAÇÃO MANUAL (E FALLBACKS) COMO "PENDENTE"
    // ========================================================================
    const months = toPeriodMonths(payment.period);
    const totalPaid = payment.price_amount != null ? Number(payment.price_amount) : 0;
    const safeCurrency = String(payment.price_currency || client.price_currency || "BRL").toUpperCase().trim();
    const unitPrice = months > 0 ? Number((totalPaid / months).toFixed(2)) : totalPaid;
    const qtyScreens = Number((client as any).screens ?? 1);
    const clientName = String((client as any).display_name || "Cliente").trim();
    const formattedMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: safeCurrency }).format(totalPaid);

    try {
      await supabaseAdmin.from("client_events").insert({
        tenant_id: tenantId,
        client_id: client.id,
        event_type: "RENEWAL_MANUAL",
        message: `Renovação Manual Pendente · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney}`,
        meta: {
          reason,
          mp_payment_id: manualRef, // ✅ Registra o ID gerado nos eventos do cliente
          months,
          server_name: srv.name || null,
          source: "client_portal_manual",
        },
      });
    } catch (e) {
      safeServerLog("fulfillment: failed to insert manual client_events", (e as any)?.message);
    }

    try {
      await supabaseAdmin.from("client_renewals").insert({
        tenant_id: tenantId,
        client_id: client.id,
        server_id: client.server_id,
        months,
        screens: qtyScreens,
        currency: safeCurrency,
        unit_price: unitPrice,
        total_amount: totalPaid,
        credits_per_month: 1,
        credits_used: months * qtyScreens,
        status: "PENDING", 
        notes: `[RENOVAÇÃO MANUAL PENDENTE] · ${clientName} (${login}) · ${months} mês(es) · ${formattedMoney} · Ref: ${manualRef} · Motivo: ${reason}`, // ✅ Registra na nota para auditoria fácil
      });
    } catch (e) {
      safeServerLog("fulfillment: failed to insert manual client_renewals", (e as any)?.message);
    }

    // ✅ "IPTV - Rendimentos" sincroniza na hora (achado 26/08/2026, pedido
    // do Márcio: antes só recalculava quando alguém abria o Financeiro
    // Pessoal). Fail-soft — nunca bloqueia o fluxo de renovação por causa
    // disso.
    try {
      await syncIptvRendimentos(supabaseAdmin, tenantId);
    } catch (e) {
      safeServerLog("fulfillment: failed to sync IPTV rendimentos (manual)", (e as any)?.message);
    }
    // ========================================================================

    return { expDateISO: null };
  };
  
  if (!srv.panel_integration) return await notifyManual("Servidor sem integração configurada.");

  const integrationId = String(srv.panel_integration);

  const { data: integ, error: iErr } = await supabaseAdmin
    .from("server_integrations")
    .select("id,provider")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .single();

  if (iErr || !integ) return await notifyManual("Integração do servidor não encontrada.");

  const provider = String(integ.provider || "").toUpperCase();

  // Se for ELITE (que não tem API), aciona o fluxo manual com notificação
  if (provider === "ELITE") return await notifyManual("Servidor Elite requer renovação manual.");
  const months = toPeriodMonths(payment.period);
  prodLog("fulfillment.provider_resolved", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    provider,
    months,
    server_id: String(client.server_id).slice(-6),
  });

  // 3) Chamar renew
  let renewPath = "";
  if (provider === "FAST") renewPath = "/api/integrations/fast/renew-client";
  else if (provider === "NATV") renewPath = "/api/integrations/natv/renew-client";
  else if (provider === "ELITE") renewPath = "/api/integrations/elite/renew";
  else throw new Error(`Servidor não suportado: ${provider}`);

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
  if (!internalSecret) throw new Error("INTERNAL_API_SECRET missing");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-internal-secret": internalSecret,
  };

  const payload: any = {
    tenant_id: tenantId,
    integration_id: integrationId,
    username: login,
    months,
  };

  if (provider === "ELITE") {
    payload.external_user_id = client.external_user_id || login;
    payload.technology = client.technology || "IPTV";
  }

  const renewRes = await fetch(`${origin}${renewPath}`, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  const renewJson = await renewRes.json().catch(() => null);

if (!renewRes.ok || !renewJson?.ok) {
    prodLog("fulfillment.renew_failed", {
      tenant: tenantId.slice(-6),
      client_id: String(client.id).slice(-6),
      provider,
      http_status: renewRes.status,
    });
    const msg = renewJson?.error || `Falha ao renovar no servidor ${provider}. HTTP ${renewRes.status}`;
    return await notifyManual(msg);
  }

  let expDateISO = renewJson?.data?.exp_date_iso;
  let newPassword = provider === "NATV" ? (renewJson?.data?.password ?? null) : null;

  prodLog("fulfillment.renew_ok", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    provider,
    exp_date_found: !!expDateISO,
  });

  // Segunda chance Elite
  let newExternalId = null; // ✅ Preparado para capturar o ID
  if (!expDateISO && provider === "ELITE") {
    await new Promise(resolve => setTimeout(resolve, 1500));

    const syncRes = await fetch(`${origin}/api/integrations/elite/renew/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        integration_id: integrationId,
        external_user_id: client.external_user_id,
        username: login,
        technology: client.technology,
        tenant_id: tenantId,
      }),
    });

    const syncJson = await syncRes.json().catch(() => null);
    if (syncRes.ok && syncJson?.ok) {
      prodLog("fulfillment.elite_sync_ok", {
        tenant: tenantId.slice(-6),
        client_id: String(client.id).slice(-6),
        exp_date_found: !!(syncJson.expires_at_iso || syncJson.exp_date),
      });
      expDateISO = syncJson.expires_at_iso || syncJson.exp_date;
      if (syncJson.password) newPassword = syncJson.password;
      if (syncJson.external_user_id) newExternalId = syncJson.external_user_id; // ✅ Captura o ID real caçado!
    }
  }

// 3.5) Fallback de Segurança (Passo 3)
  if (!expDateISO) {
    prodLog("fulfillment.date_fallback_used", {
      tenant: tenantId.slice(-6),
      client_id: String(client.id).slice(-6),
      provider,
      fallback_months: months
    });
    
    // Calcula a data de segurança baseada no vencimento atual ou data de hoje
    const vencDate = (client as any).vencimento ? new Date((client as any).vencimento) : null;
    const isActive = vencDate != null && vencDate > new Date();
    const baseDate = isActive ? vencDate : new Date();
    
    const targetDate = new Date(baseDate);
    targetDate.setMonth(targetDate.getMonth() + months);
    
    expDateISO = targetDate.toISOString();
  }

  // 4) Atualizar cliente (Blindado)
  const updatePayload: any = {
    plan_label: payment.plan_label || (client as any).plan_label || null, // ✅ Protegido
    // (correcao) usa plan_price_amount (preco do PLANO, sem pendencia somada) -
    // nunca payment.price_amount direto, senao uma pendencia pontual de app
    // (ex: ativacao de R$30) vira o novo preco fixo do cliente pra sempre.
    // plan_price_amount pode ser null em pagamentos antigos (antes dessa
    // coluna existir), dai cai no price_amount mesmo.
    price_amount: payment.plan_price_amount ?? payment.price_amount ?? (client as any).price_amount ?? null,
    price_currency: payment.price_currency || (client as any).price_currency || "BRL",
    vencimento: expDateISO,
    updated_at: new Date().toISOString(),
  };

  updatePayload.is_trial = false;
updatePayload.is_archived = false;
if (newPassword) updatePayload.server_password = String(newPassword);
  if (newExternalId) updatePayload.external_user_id = String(newExternalId); // ✅ Salva o ID real no banco!

  const { error: upClientErr } = await supabaseAdmin
    .from("clients")
    .update(updatePayload)
    .eq("tenant_id", tenantId)
    .eq("id", client.id);

  if (upClientErr) throw new Error(`Falha ao atualizar cliente: ${upClientErr.message}`);
  prodLog("fulfillment.client_updated", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    new_vencimento: expDateISO,
    external_id_updated: !!newExternalId
  });

  // ✅ Teste virou cliente pago pelo portal — marca o histórico (papa_testes)
  // como convertido, mesmo motivo do update_client (RPC do painel). Casa por
  // WhatsApp + USERNAME exato: a mesma pessoa pode ter mais de um teste no mesmo
  // servidor com usuários diferentes, só o teste do username que converteu de
  // verdade deve virar "Convertido".
  const finalUsername = String((client as any).server_username || "").trim();
  if (updatePayload.is_trial === false && (client as any).whatsapp_username && finalUsername) {
    const { error: papaErr } = await supabaseAdmin
      .from("papa_testes")
      .update({ converted: true, converted_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("whatsapp_username", (client as any).whatsapp_username)
      .eq("username", finalUsername)
      .eq("converted", false);
    if (papaErr) {
      prodLog("fulfillment.papa_testes_mark_converted_failed", {
        tenant: tenantId.slice(-6),
        client_id: String(client.id).slice(-6),
        error: papaErr.message,
      });
    }
  }

  // 5) Logs
  const totalPaid = payment.price_amount != null ? Number(payment.price_amount) : 0;
  const safeCurrency = String(payment.price_currency || client.price_currency || "BRL").toUpperCase().trim();
  const unitPrice = months > 0 ? Number((totalPaid / months).toFixed(2)) : totalPaid;
  const qtyScreens = Number((client as any).screens ?? 1);
  const clientName = String((client as any).display_name || "Cliente").trim();
  const formattedMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: safeCurrency }).format(totalPaid);

  try {
    await supabaseAdmin.from("client_events").insert({
      tenant_id: tenantId,
      client_id: client.id,
      event_type: "RENEWAL",
      message: `Renovação via Portal do Cliente · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney}`,
      meta: {
        mp_payment_id: String(payment.mp_payment_id),
        months,
        provider,
        server_name: srv.name || null,
        new_vencimento: expDateISO,
        source: "client_portal",
      },
    });
  } catch (e) {
    safeServerLog("fulfillment: failed to insert client_events", (e as any)?.message);
  }

try {
    const { error: renErr } = await supabaseAdmin.from("client_renewals").insert({
      tenant_id: tenantId,
      client_id: client.id,
      server_id: client.server_id,
      months,
      screens: qtyScreens,
      currency: safeCurrency,
      unit_price: unitPrice,
      total_amount: totalPaid,
      credits_per_month: 1,
credits_used: months * qtyScreens,
      status: "PAID",
      // REMOVIDO: new_vencimento (Coluna não existe na tabela client_renewals no banco)
      notes: `Renovação via Portal do Cliente · ${clientName} (${login}) · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney} · MP: ${String(payment.mp_payment_id)}`,
    });

    if (renErr) {
      await supabaseAdmin.from("client_events").insert({
        tenant_id: tenantId,
        client_id: client.id,
        event_type: "SYSTEM",
        message: `[ERRO FINANCEIRO] Falha ao registrar renovação no Servidor: ${renErr.message}`,
      });
    }
  } catch (e) {
    safeServerLog("fulfillment: failed to insert client_renewals", (e as any)?.message);
  }

  // ✅ "IPTV - Rendimentos" sincroniza na hora (achado 26/08/2026, pedido
  // do Márcio: antes só recalculava quando alguém abria o Financeiro
  // Pessoal, deixando a Evolução Consolidada desatualizada até a próxima
  // visita). Fail-soft — nunca bloqueia a renovação do cliente por causa
  // disso.
  try {
    await syncIptvRendimentos(supabaseAdmin, tenantId);
  } catch (e) {
    safeServerLog("fulfillment: failed to sync IPTV rendimentos", (e as any)?.message);
  }

// 6) Sync e Alerta de Saldo Baixo (Gmail via API Interna)
  try {
    let syncPath = "";
    if (provider === "FAST") syncPath = "/api/integrations/fast/sync";
    else if (provider === "NATV") syncPath = "/api/integrations/natv/sync";
    else if (provider === "ELITE") syncPath = "/api/integrations/elite/sync";

    if (syncPath) {
      const syncRes = await fetch(`${origin}${syncPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: tenantId,
          integration_id: integrationId
        }),
      });

      // ✅ FALTAVA: o sync acima só atualiza
      // server_integrations.credits_last_known — servers.credits_available
      // (o que o card de saldo e o alerta de saldo baixo realmente leem)
      // nunca era tocado nas renovações automáticas via Portal do Cliente.
      // Mesmo passo que novo_servidor.tsx/recarga_servidor.tsx já fazem
      // manualmente. Update direto (não a RPC update_server_credits_manual —
      // ela exige auth.uid() contra tenant_members, que não existe neste
      // contexto server-side/service-role) — supabaseAdmin já ignora RLS.
      // Best-effort: não bloqueia a renovação, que já está concluída aqui.
      if (syncRes.ok) {
        const { data: afterSync } = await supabaseAdmin
          .from("server_integrations")
          .select("credits_last_known")
          .eq("id", integrationId)
          .eq("tenant_id", tenantId)
          .single();

        if (afterSync?.credits_last_known != null) {
          const { error: adjErr } = await supabaseAdmin
            .from("servers")
            .update({ credits_available: Number(afterSync.credits_last_known) })
            .eq("id", client.server_id)
            .eq("tenant_id", tenantId);
          if (adjErr) {
            safeServerLog("fulfillment: failed to push credits_available", adjErr.message);
          }
        }
      }
    }

  } catch (e) {
    safeServerLog("fulfillment: failed sync", (e as any)?.message);
  }

  // 7) WhatsApp
  let messageToSend = "";
  let imageToSend: string | null = null; // ✅ Variável para guardar a imagem
  let templateIdToSend: string | null = null; // ✅ Variável para guardar o ID do template
  const targetSession = srv.whatsapp_session || "default";

  try {
    const { data: tmpl } = await supabaseAdmin
      .from("message_templates")
      .select("id, content, image_url") // ✅ AGORA BUSCA A IMAGEM E O ID
      .eq("tenant_id", tenantId)
      .or("name.ilike.%pagamento%,name.ilike.%pago%,name.ilike.%realizado%")
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();

    // ✅ Sorteia entre o texto original e as variantes cadastradas (mesma
    // estratégia anti-detecção usada em billing_enqueue_scheduled) — sem
    // variantes, comportamento idêntico a antes (só o original).
    let pickedContent = String(tmpl?.content || "").trim();
    if (tmpl?.id) {
      const { data: variants } = await supabaseAdmin
        .from("message_template_variants")
        .select("content")
        .eq("tenant_id", tenantId)
        .eq("template_id", tmpl.id);
      const pool = [tmpl.content, ...(variants || []).map((v) => v.content)].filter(
        (c): c is string => !!c && String(c).trim().length > 0,
      );
      if (pool.length > 0) {
        pickedContent = pool[Math.floor(Math.random() * pool.length)].trim();
      }
    }

    messageToSend = pickedContent;
    imageToSend = tmpl?.image_url || null; // ✅ Guarda a imagem
    templateIdToSend = tmpl?.id || null;   // ✅ Guarda o ID
    if (!messageToSend) throw new Error("Template de pagamento não encontrado.");

    const waRes = await fetch(`${origin}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers: { ...headers, Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tenant_id: tenantId,
        client_id: client.id,
        message: messageToSend,
        image_url: imageToSend, // ✅ ENVIA A IMAGEM NO ENVIO IMEDIATO
        message_template_id: templateIdToSend, // ✅ OPCIONAL: Envia o ID para constar no histórico
        whatsapp_session: targetSession,
      }),
    });

    // Avalia se o servidor (VM) estava offline ou se deu erro 500
    const waJson = await waRes.json().catch(() => null);
    if (!waRes.ok || waJson?.ok === false) {
      throw new Error("A API de envio imediato recusou a mensagem ou VM estava offline.");
    }

    // ✅ NOVO: Se passou sem erros, atualiza a nova coluna whatsapp_status na tabela de auditoria para "sent"
    await supabaseAdmin.from("client_portal_payments").update({ whatsapp_status: "sent" }).eq("id", payment.id);

  } catch (e) {
    safeServerLog("fulfillment: failed whatsapp immediate", (e as any)?.message);
    
    // ✅ NOVO: Se caiu no catch, atualiza a tabela de auditoria como "error" (Mesmo o Plano B agendando depois)
    await supabaseAdmin.from("client_portal_payments").update({ whatsapp_status: "error" }).eq("id", payment.id);

    // ✅ NOVO: notificação no sino (tabela notifications)
    await notify({
      tenantId,
      type: "whatsapp_falha",
      title: "💬 Falha no WhatsApp",
      message: `Uma recarga foi efetuada para ${formatClientLabel(client.display_name, login, srv.name)}, mas o envio do comprovante pelo WhatsApp falhou. Reenvie pela Auditoria.`,
      link: "/admin/auditoria",
      sourceId: payment.id,
    });

    // ✅ PLANO B: Se falhou (mas temos a mensagem montada), salva direto na fila do Cron (+2 min)
    if (messageToSend) {
      try {
        const retryDate = new Date(Date.now() + 2 * 60 * 1000); // Exato momento de agora + 2 minutos
        
        await supabaseAdmin.from("client_message_jobs").insert({
          tenant_id: tenantId,
          client_id: client.id,
          message: messageToSend,
          image_url: imageToSend, // ✅ SALVA A IMAGEM NO AGENDAMENTO DO CRON
          message_template_id: templateIdToSend, // ✅ SALVA O ID DO TEMPLATE
          send_at: retryDate.toISOString(), // Salva em UTC corretamente
          status: "SCHEDULED",
          whatsapp_session: targetSession,
          created_by: "system_fulfillment" // Identifica que foi o robô quem agendou
        });
        
        prodLog("fulfillment.whatsapp_retry_scheduled", { 
          tenant: tenantId.slice(-6),
          client_id: String(client.id).slice(-6)
        });
      } catch (retryErr) {
        // Se der problema até pra salvar no banco, engole em silêncio. A TV já foi paga e liberada.
        safeServerLog("fulfillment: failed to schedule retry", (retryErr as any)?.message);
      }
    }
  }

  prodLog("fulfillment.done", {
    tenant: tenantId.slice(-6),
    client_id: String(client.id).slice(-6),
    provider,
    months,
    amount: payment.price_amount,
    currency: payment.price_currency,
  });

  return { expDateISO };
}