// app/api/whatsapp/envio_programado/route.ts
//app/api/whatsapp/envio_programado

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";
import { isCronRequest } from "@/lib/internal-auth";
import { makeSessionKey } from "@/lib/whatsapp/wa-context";
import {
  buildClientTemplateVars,
  buildResellerTemplateVars,
  fetchClientWhatsApp,
  fetchResellerWhatsApp,
  fetchManualPaymentVars,
  generatePortalLink,
  renderTemplate,
  pickRandomDns,
  toolConsultarPrecosTexto,
} from "@/lib/whatsapp/template-vars";
import { notify } from "@/lib/notifications/notify";
import { isWhatsAppDisconnectedResponse, reportWhatsAppDisconnected, reportWhatsAppReconnected } from "@/lib/whatsapp/disconnect-alert";
import { reportSessionHealthFromSend } from "@/lib/whatsapp/session-health-alert";
import { getCouponPhraseForClient, getPendencyPhraseForClient, fetchActiveCoupons, type CouponRow } from "@/lib/client-portal/coupons";
import {
  normalizeSecondaryContactDelay,
  DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS,
  DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS,
} from "@/lib/admin/billing-campaign-window";

function safeServerLog(...args: any[]) {
  console.error(...args);
}

export const dynamic = "force-dynamic";
// ✅ Rede de segurança contra invocação presa (achado em 04/08/2026: sem
// isso, a função herdava o timeout padrão da Vercel e podia ficar pendurada
// indefinidamente se algo travasse no meio do processamento).
// ✅ 30/08/2026: 120s → 300s. O checkpoint de SENT (ver loop abaixo) já
// elimina o risco de DUPLICAR mensagem se a função for morta pelo timeout
// — mas com só 120s, o delay entre contato principal/secundário (até 120s,
// configurável) sozinho já quase estourava o orçamento, fazendo o contato
// secundário frequentemente nem ser tentado. Mais fôlego reduz isso sem
// reintroduzir risco de duplicar (esse risco já não existe mais).
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ScheduleBody = {
  tenant_id: string;
  client_id?: string;
  reseller_id?: string;
  recipient_id?: string;
  recipient_type?: "client" | "reseller";
  message_template_id?: string;
  message: string;
  send_at: string;
  whatsapp_session?: string | null;
  image_url?: string | null;
};

// =========================
// ✅ send_at sempre normalizado para UTC
// (quando vier sem TZ, interpreta como São Paulo)
// =========================

function hasTzDesignator(s: string) {
  return /([zZ]|[+\-]\d{2}:\d{2})$/.test(s);
}

/**
 * Normaliza send_at para UTC ISO string.
 *
 * - Se já vier com timezone (Z ou +hh:mm), usa Date() normal.
 * - Se vier SEM timezone (ex: "2026-02-08T10:00" ou "2026-02-08 10:00"),
 *   interpreta como horário de São Paulo (UTC-3) e converte para UTC.
 */
function normalizeSendAtToUtcISOString(sendAtRaw: string): string {
  const s = String(sendAtRaw || "").trim();
  if (!s) throw new Error("send_at vazio");

  if (hasTzDesignator(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) throw new Error(`send_at inválido: ${s}`);
    return d.toISOString();
  }

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const d = new Date(s);
    if (isNaN(d.getTime())) throw new Error(`send_at inválido: ${s}`);
    return d.toISOString();
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || "0");

  // São Paulo = UTC-3 -> SP -> UTC: soma 3h
  const utcMs = Date.UTC(year, month - 1, day, hour + 3, minute, second, 0);
  const d = new Date(utcMs);
  if (isNaN(d.getTime())) throw new Error(`send_at inválido após conversão: ${s}`);

  return d.toISOString();
}

// ✅ Mesma conversão fixa UTC-3 usada em normalizeSendAtToUtcISOString acima
// (Brasil não tem mais horário de verão desde 2019) — replica em JS o
// `(timezone('America/Sao_Paulo', x))::date` usado no SQL de enfileiramento,
// pra comparar datas de referência sem depender de biblioteca de timezone.
function toSpDateOnlyKey(isoOrDate: string | Date): string {
  const d = new Date(isoOrDate);
  const spMs = d.getTime() - 3 * 60 * 60 * 1000;
  const sp = new Date(spMs);
  return `${sp.getUTCFullYear()}-${String(sp.getUTCMonth() + 1).padStart(2, "0")}-${String(sp.getUTCDate()).padStart(2, "0")}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// ✅ NOVO: notifica o sino IMEDIATAMENTE quando um job de automação falha.
// Recalcula a contagem real de falhas ainda pendentes pra essa automação,
// pra mensagem sempre refletir o total atual (não duplica notificação —
// upsert pela unique constraint tenant_id+type+source_id).
async function notifyAutomationFailure(sb: any, tenantId: string, automationId: string) {
  try {
    const { count } = await sb
      .from("client_message_jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("automation_id", automationId)
      .eq("status", "FAILED");

    const { data: auto } = await sb
      .from("billing_automations")
      .select("name")
      .eq("id", automationId)
      .single();

    const automationName = auto?.name || "Automação";
    const total = count || 1;

    await notify({
      tenantId,
      type: "automacao_falha",
      title: `🤖 Falha: ${automationName}`,
      message: `${total} mensagem(ns) falharam na automação "${automationName}". Veja os logs para reenviar.`,
      link: "/admin/gerenciador/cobranca",
      sourceId: automationId,
    });
  } catch (e) {
    safeServerLog("[BILLING] falha ao notificar sino:", e);
  }
}

export async function POST(req: Request) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!baseUrl || !waToken || !supabaseUrl || !serviceKey) {
    safeServerLog("[WA][scheduled] Server misconfigured", {
      hasBaseUrl: !!baseUrl,
      hasWaToken: !!waToken,
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceKey: !!serviceKey,
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // =========================
  // 1) Autorização BLINDADA: CRON ou USER
  // =========================
  const isCron = isCronRequest(req, "CRON_SECRET");

  let authedUserId: string | null = null;
  let authTenantId: string | null = null;

  // ✅ USER: exige Bearer + role de admin em tenant_members — mesma fonte
  // de verdade usada no resto do painel (lib/api/auth.ts).
  if (!isCron) {
    const auth = await requireAdminTenant(req);
    if (!auth.ok) return auth.res;
    authedUserId = auth.user_id;
    authTenantId = auth.tenant_id;
  }

  // =========================
  // 2) CRON: enfileira automações + processa fila
  // =========================
  if (isCron) {
    // ✅ TRAVA ANTI-SOBREPOSIÇÃO: se existe um job em SENDING atualizado há
    // menos de 90s, outra invocação desta rota está processando agora — sai
    // sem fazer nada e deixa o próximo tick (5 ou 15min) cuidar do resto.
    // Achado em 04/08/2026: a função ficava presa em sleeps longos entre
    // envios e, com o cron batendo a cada 5min no horário de pico, várias
    // invocações se empilhavam rodando em paralelo, multiplicando consumo
    // de Active CPU à toa.
    const { count: activeNow } = await sb
      .from("client_message_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "SENDING")
      .gte("updated_at", new Date(Date.now() - 90_000).toISOString());

    if ((activeNow || 0) > 0) {
      return NextResponse.json({ ok: true, skipped: "outra execução em andamento" });
    }

    // ✅ 29/08/2026: enfileiramento saiu daqui — quem decide o que entra na
    // fila agora é o pg_cron billing_enqueue_daily (6h/7h/12h SP), direto em
    // SQL, sem passar por esta rota. Ver docs/sql/billing_native_cron_migration.sql.

    // ✅ SELF-HEALING: revive jobs travados em SENDING (crash/restart)
    await sb
      .from("client_message_jobs")
      .update({ status: "QUEUED", error_message: null })
      .eq("status", "SENDING")
      .lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

    // ✅ busca jobs prontos para enviar
    const { data: jobs, error: jobsErr } = await sb
      .from("client_message_jobs")
      .select(
        `
      id,
      tenant_id,
      client_id,
      reseller_id,
      whatsapp_session,
      message,
      image_url,
      send_at,
      created_at,
      created_by,
      automation_id,
      billing_automations (
        delay_min,
        is_active,
        is_automatic,
        execution_status,
        schedule_time,
        target_status,
        rule_date_field,
        rule_days_diff
      )
    `
      )
      .in("status", ["QUEUED", "SCHEDULED"])
      .lte("send_at", new Date().toISOString())
      .order("send_at", { ascending: true })
      // ✅ Lote pequeno (era 30) — agora que o cron roda de 5 em 5min no
      // pico, não precisa de uma invocação longa processando dezenas de
      // jobs; o próprio ritmo do cron cuida do resto da fila no próximo tick.
      .limit(5);

    if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    if (!jobs?.length) return NextResponse.json({ ok: true, processed: 0 });

    let processed = 0;

    // ✅ Cache por tenant, só pra este tick do cron (Map local, some sozinho
    // no fim da função) — cupons ativos e dados de gateway manual são
    // idênticos pra todo destinatário do mesmo tenant no mesmo lote, então
    // evita refazer a mesma busca a cada job/contato. A elegibilidade de
    // cada CLIENTE continua sendo checada individualmente dentro de
    // getCouponPhraseForClient (status, se já usou, regras de data) — só a
    // lista "quais cupons existem" é reaproveitada, nunca o resultado da
    // elegibilidade em si.
    const couponsCache = new Map<string, CouponRow[]>();
    const manualPaymentVarsCache = new Map<string, Record<string, string>>();
    async function getCachedCoupons(tenantId: string): Promise<CouponRow[]> {
      if (!couponsCache.has(tenantId)) {
        couponsCache.set(tenantId, await fetchActiveCoupons(sb, tenantId));
      }
      return couponsCache.get(tenantId)!;
    }
    async function getCachedManualPaymentVars(tenantId: string): Promise<Record<string, string>> {
      if (!manualPaymentVarsCache.has(tenantId)) {
        try {
          manualPaymentVarsCache.set(tenantId, await fetchManualPaymentVars(sb, tenantId));
        } catch {
          manualPaymentVarsCache.set(tenantId, {});
        }
      }
      return manualPaymentVarsCache.get(tenantId)!;
    }

    // ✅ Intervalo entre contato primário e secundário — sorteado dentro da
    // faixa configurada em billing_campaign_settings (era 10s fixo).
    const secondaryDelayRangeCache = new Map<string, { minSecs: number; maxSecs: number }>();
    async function getCachedSecondaryContactDelayRange(tenantId: string) {
      if (!secondaryDelayRangeCache.has(tenantId)) {
        const { data } = await sb
          .from("billing_campaign_settings")
          .select("secondary_contact_delay_min_secs, secondary_contact_delay_max_secs")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        secondaryDelayRangeCache.set(
          tenantId,
          normalizeSecondaryContactDelay(
            data?.secondary_contact_delay_min_secs ?? DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS,
            data?.secondary_contact_delay_max_secs ?? DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS,
          ),
        );
      }
      return secondaryDelayRangeCache.get(tenantId)!;
    }

    for (const job of jobs) {
      // ✅ Declarado FORA do try — precisa ser visível no catch também (ver
      // uso lá embaixo: um erro depois do checkpoint não pode sobrescrever
      // o SENT já gravado).
      let checkpointed = false;
      try {
        // ✅ LOCK ANTI DUPLICAÇÃO (CRON SAFE)
        const { data: locked, error: lockErr } = await sb
          .from("client_message_jobs")
          .update({ status: "SENDING", error_message: null })
          .eq("id", job.id)
          .in("status", ["QUEUED", "SCHEDULED"])
          .select("id")
          .maybeSingle();

        if (lockErr) throw new Error(lockErr.message);
        if (!locked) continue;

        // ✅ BLOQUEIO: não envia job automático se a automação não estiver RUNNING
        const automationConfig = Array.isArray((job as any).billing_automations)
          ? (job as any).billing_automations[0]
          : (job as any).billing_automations;

        if ((job as any).automation_id && automationConfig) {
          const aIsActive = automationConfig.is_active === true;
          const aIsAutomatic = automationConfig.is_automatic === true;
          const aStatus = String(automationConfig.execution_status || "IDLE").toUpperCase();

          if (!aIsActive) {
            await sb
              .from("client_message_jobs")
              .update({ status: "CANCELLED", error_message: "Automação desativada (is_active=false)" })
              .eq("id", job.id);
            continue;
          }

          if (aIsAutomatic && aStatus !== "RUNNING") {
            await sb
              .from("client_message_jobs")
              .update({
                status: "CANCELLED",
                error_message: `Automação não executando (execution_status=${aStatus})`,
              })
              .eq("id", job.id);
            continue;
          }
        }

        // resolve destino
        const rawClientId = String((job as any).client_id || "").trim();
        const rawResellerId = String((job as any).reseller_id || "").trim();

        let recipientType: "client" | "reseller" | null = null;
        let recipientId = "";

        if (rawResellerId) {
          recipientType = "reseller";
          recipientId = rawResellerId;
        } else if (rawClientId) {
          recipientType = "client";
          recipientId = rawClientId;
        }

        if (!recipientType || !recipientId) {
          await sb
            .from("client_message_jobs")
            .update({ status: "FAILED", error_message: "Job sem destino (client_id/reseller_id ausente)" })
            .eq("id", job.id);
          continue;
        }

        // ✅ Recheca elegibilidade AGORA, na hora do envio — o enfileiramento
        // de manhã (billing_enqueue_scheduled) só sabe o status/vencimento do
        // cliente NAQUELE instante. 2 formas de ficar inelegível depois:
        // (a) status muda de categoria (ex: OVERDUE paga -> ACTIVE, sai da
        //     lista de status alvo da automação);
        // (b) status continua o MESMO (ex: automação "Vence Hoje" mira
        //     ACTIVE) mas o cliente renovou adiantado — vencimento moveu pra
        //     frente, então a condição de data que o enfileirou hoje
        //     (base_date_sp + rule_days_diff = dia do disparo) não bate mais.
        // Replica a MESMA fórmula do CTE `impacted` de billing_enqueue_
        // scheduled (docs/sql/), usando dado fresco em vez do snapshot de
        // manhã. Só se aplica a jobs automáticos mirando cliente — reseller
        // não tem vencimento/target_status.
        if ((job as any).automation_id && automationConfig && recipientType === "client") {
          const targetStatus: string[] = Array.isArray(automationConfig.target_status) ? automationConfig.target_status : [];
          const ruleDateField = String(automationConfig.rule_date_field || "").toLowerCase();
          const ruleDaysDiff = Number(automationConfig.rule_days_diff ?? 0);

          const { data: freshClient } = await sb
            .from("clients")
            .select("vencimento, created_at, is_archived, is_trial")
            .eq("id", recipientId)
            .maybeSingle();

          if (!freshClient || freshClient.is_archived) {
            await sb
              .from("client_message_jobs")
              .update({ status: "CANCELLED", error_message: "Cliente arquivado/removido antes do envio" })
              .eq("id", job.id);
            continue;
          }

          const currentStatus = freshClient.is_trial
            ? "TRIAL"
            : freshClient.vencimento && new Date(freshClient.vencimento) < new Date()
              ? "OVERDUE"
              : "ACTIVE";

          if (targetStatus.length > 0 && !targetStatus.includes(currentStatus)) {
            await sb
              .from("client_message_jobs")
              .update({ status: "CANCELLED", error_message: `Cliente não é mais elegível (status atual: ${currentStatus})` })
              .eq("id", job.id);
            continue;
          }

          // ✅ mesma fórmula do CASE de base_date_sp no enfileiramento: só
          // usa vencimento se rule_date_field for literalmente "vencimento",
          // qualquer outro valor (created_at/cadastro/vazio) cai pra created_at.
          const baseDateField = ruleDateField === "vencimento" ? freshClient.vencimento : freshClient.created_at;
          if (baseDateField) {
            const baseDateSp = toSpDateOnlyKey(baseDateField);
            const recomputedFireDateSp = addDaysToDateKey(baseDateSp, ruleDaysDiff);
            const jobFireDateSp = toSpDateOnlyKey((job as any).created_at || job.send_at);
            if (recomputedFireDateSp !== jobFireDateSp) {
              await sb
                .from("client_message_jobs")
                .update({ status: "CANCELLED", error_message: "Cliente não é mais elegível (data de referência mudou — provável renovação)" })
                .eq("id", job.id);
              continue;
            }
          }
        }

        // ✅ pega WhatsApp e linha pra tags
        let wa: any;
        if (recipientType === "reseller") {
          wa = await fetchResellerWhatsApp(sb, job.tenant_id, recipientId);
        } else {
          wa = await fetchClientWhatsApp(sb, job.tenant_id, recipientId);
        }

        // ✅ validações
        if (!wa.phones || wa.phones.length === 0) {
          await sb.from("client_message_jobs").update({ status: "FAILED", error_message: "Conta sem whatsapp_username" }).eq("id", job.id);
          continue;
        }

        if (!wa.whatsapp_opt_in) {
          await sb.from("client_message_jobs").update({ status: "FAILED", error_message: "Conta não opt-in" }).eq("id", job.id);
          continue;
        }

        if (wa.dont_message_until) {
          const until = new Date(wa.dont_message_until);
          if (!isNaN(until.getTime()) && until > new Date()) {
            await sb
              .from("client_message_jobs")
              .update({ status: "FAILED", error_message: `Conta em pausa até ${wa.dont_message_until}` })
              .eq("id", job.id);
            continue;
          }
        }

        // ✅ CRON FIX BLINDADO: Se o job foi criado pelo robô (null), busca o ID do dono da empresa
        let sessionUserId = job.created_by;
        if (!sessionUserId) {
          const { data: owner } = await sb
            .from("tenant_members")
            .select("user_id")
            .eq("tenant_id", job.tenant_id)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          sessionUserId = owner?.user_id || "system";
        }
        const sessionUserIdStr = String(sessionUserId);

        // ✅ Avalia qual sessão o envio pediu e gera a chave correta
        const targetSession = String((job as any).whatsapp_session || "default");
        const sessionKey = makeSessionKey(job.tenant_id, sessionUserIdStr, targetSession === "session2" ? 2 : 1);

        let successCount = 0;
        let lastError = "";

        // Puxa Gateway Manual (PIX + Transferência Internacional) — 1x por
        // tenant no tick inteiro, não 1x por job (cache acima).
        const manualPaymentVars = await getCachedManualPaymentVars(String(job.tenant_id));

        // ✅ {dns_servidor}/{tabela_precos}/{pendencia_detalhe} — mesmas
        // funções que o bot de atendimento já usa (toolConsultarPrecosTexto,
        // getPendencyPhraseForClient); antes só existiam lá, então um
        // template de envio agendado usando essas tags mandava o texto cru
        // "{tabela_precos}" pro cliente. Calculado 1x por job, não muda
        // entre o contato principal/secundário do mesmo cliente.
        let dnsServidor = "";
        let tabelaPrecos = "";
        let pendenciaDetalhe = "";
        if (recipientType !== "reseller") {
          try {
            // ✅ As 3 buscas são independentes entre si — rodavam em
            // sequência (await um, depois o outro), agora rodam juntas.
            const [srvResult, tabelaPrecosResult, pendenciaDetalheResult] = await Promise.all([
              wa.row?.server_id
                ? sb.from("servers").select("dns").eq("id", wa.row.server_id).maybeSingle()
                : Promise.resolve({ data: null }),
              toolConsultarPrecosTexto(sb, String(job.tenant_id), wa.row),
              getPendencyPhraseForClient(sb, String(job.tenant_id), wa.row.id, wa.row.price_currency || "BRL"),
            ]);
            dnsServidor = pickRandomDns(Array.isArray(srvResult?.data?.dns) ? srvResult.data.dns : []);
            tabelaPrecos = tabelaPrecosResult;
            pendenciaDetalhe = pendenciaDetalheResult;
          } catch (e: any) {
            safeServerLog("[WA][envio_programado][dns_tabela_pendencia] falhou", e?.message ?? e);
          }
        }

        // ✅ 30/08/2026, CRÍTICO — achado real (Erick/João Batista receberam
        // a mesma cobrança 2x): o delay entre contato principal/secundário
        // (configurável, hoje até 120s) rodava ANTES do job ser gravado
        // como SENT. Como maxDuration é 120s, a função podia ser matada
        // pela Vercel bem no meio desse sleep — o job ficava preso em
        // SENDING, a auto-recuperação de 5min devolvia pra fila, e o
        // PRÓXIMO tick reenviava tudo de novo (mensagem duplicada de
        // verdade, já entregue nas duas vezes). Agora: assim que o
        // PRIMEIRO envio bem-sucedido acontece, o job já é gravado como
        // SENT ali mesmo, antes de qualquer sleep — mesmo que a função
        // morra depois disso (tentando o contato seguinte), o job nunca
        // mais é repescado (nem pela seleção normal nem pela
        // auto-recuperação). Pior caso possível agora: o contato seguinte
        // não recebe naquela rodada — nunca mais um duplicado.
        async function writeSentCheckpoint() {
          const nowIso = new Date().toISOString();
          const bookkeepingWrites: PromiseLike<any>[] = [
            sb.from("client_message_jobs").update({ status: "SENT", sent_at: nowIso, error_message: null }).eq("id", job.id),
          ];
          if ((job as any).automation_id) {
            const cName = String((wa as any).row?.display_name || (wa as any).row?.client_name || "Cliente").trim();
            bookkeepingWrites.push(
              sb.from("billing_logs").insert({
                tenant_id: job.tenant_id,
                automation_id: (job as any).automation_id,
                client_id: job.client_id || null,
                client_name: cName,
                client_whatsapp: wa.phones.map((p: any) => p.number).join(", "),
                status: "SENT",
                sent_at: nowIso,
              }),
              sb.from("billing_automations").update({ last_run_at: nowIso }).eq("id", (job as any).automation_id),
            );
          }
          await Promise.all(bookkeepingWrites);
          checkpointed = true;
          processed++;
        }

        // ✅ Loop de envios para os contatos vinculados à conta
        for (let i = 0; i < wa.phones.length; i++) {
          const contact = wa.phones[i];

          const vars =
            recipientType === "reseller"
              ? buildResellerTemplateVars({ resellerRow: wa.row })
              : buildClientTemplateVars({ clientRow: wa.row, isSecondary: contact.is_secondary });

          if (recipientType !== "reseller") {
            (vars as any).dns_servidor = dnsServidor;
            (vars as any).tabela_precos = tabelaPrecos;
            (vars as any).pendencia_detalhe = pendenciaDetalhe;
          }

          Object.assign(vars, manualPaymentVars);

          // Gera o link do portal — SEM expiração (igual ao envio manual).
          // ⚠️ O original tinha 30 dias aqui; removido a pedido — o link nunca deve expirar.
          // ✅ Usa safeUuidOrNull internamente: corrige o caso de job.created_by vir
          // como "system_fulfillment" (não-UUID), que antes quebrava o RPC em silêncio.
          if (contact.number) {
            vars.link_pagamento = await generatePortalLink(sb, {
              tenantId: String(job.tenant_id),
              contact: { number: contact.number, username: contact.username, is_secondary: contact.is_secondary },
              createdBy: job.created_by,
              label: contact.is_secondary ? "Cobranca automatica Secundario" : "Cobranca automatica",
              expiresAt: null,
              onLog: safeServerLog,
            });
          }

          if (recipientType !== "reseller") {
            vars.cupom_frase = await getCouponPhraseForClient(sb, String(job.tenant_id), wa.row, {
              preloadedCoupons: await getCachedCoupons(String(job.tenant_id)),
            });
          }

          const renderedMessage = renderTemplate(String(job.message ?? ""), vars);

          const sendController = new AbortController();
          // ✅ 30s (era 15s) — a VM agora simula "digitando..." (2-5s) + presença
          // "disponível" antes de mandar (pedido do Márcio, 26/07/2026), então o
          // envio real passou a demorar mais só nesse preparo, sem contar a rede.
          const sendTimeout = setTimeout(() => sendController.abort(), 30_000);
          let res: Response;
          try {
            res = await fetch(`${baseUrl}/send`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${waToken}`,
                "x-session-key": sessionKey,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                phone: contact.number,
                message: renderedMessage,
                ...((job as any).image_url ? { image_url: String((job as any).image_url) } : {}),
              }),
              signal: sendController.signal,
            });
          } finally {
            clearTimeout(sendTimeout);
          }

          if (!res.ok) {
            lastError = await res.text();
            // ✅ 29/08/2026: sinal de verdade (503 + status da VM) — só esse
            // envio (o único do cron sem classificação de erro nenhuma até
            // então) dispara o alerta de desconexão por e-mail.
            if (isWhatsAppDisconnectedResponse(res.status, lastError)) {
              await reportWhatsAppDisconnected(String(job.tenant_id), targetSession, "envio_programado");
            }
          } else {
            successCount++;
            await reportWhatsAppReconnected(String(job.tenant_id), targetSession);
            // ✅ 05/09/2026: "durante o envio checa e grava" — sem timer
            // separado, aproveita o resultado embutido na resposta do /send.
            const okRaw = await res.text().catch(() => "");
            let okParsed: any = null;
            try { okParsed = okRaw ? JSON.parse(okRaw) : null; } catch {}
            await reportSessionHealthFromSend(String(job.tenant_id), targetSession, okParsed?.sessionHealth);
          }

          // ✅ Checkpoint no PRIMEIRO sucesso — ver comentário grande acima
          // do loop. Precisa acontecer ANTES do sleep abaixo.
          if (successCount === 1 && !checkpointed) {
            await writeSentCheckpoint();
          }

          // ✅ Delay entre telefone primário e secundário do mesmo cliente
          // (só aplica se houver mais um contato depois deste), sorteado
          // dentro da faixa configurada em billing_campaign_settings.
          if (i < wa.phones.length - 1) {
            const { minSecs, maxSecs } = await getCachedSecondaryContactDelayRange(String(job.tenant_id));
            const delaySecs = minSecs + Math.floor(Math.random() * Math.max(maxSecs - minSecs + 1, 1));
            await sleep(delaySecs * 1000);
          }
        }

        if (!checkpointed) {
          // ninguém teve sucesso — nenhum checkpoint rodou, job segue como
          // FAILED de verdade (nada foi entregue).
          await sb.from("client_message_jobs").update({ status: "FAILED", error_message: String(lastError).slice(0, 500) }).eq("id", job.id);

          // ✅ NOVO: notifica o sino AGORA, na hora, não espera cron nenhum
          if ((job as any).automation_id) {
            await notifyAutomationFailure(sb, String(job.tenant_id), String((job as any).automation_id));
          }

          continue;
        }

        // ✅ delay curto entre envios do MESMO tick, sorteado (era 1-3min
        // fixo) — reduzido em 04/08/2026: com o cron agora de 5 em 5min e o
        // send_at de cada job já espaçado em 5-10min na origem
        // (billing_enqueue_scheduled), o espaçamento anti-padrão principal
        // vem da própria cadência do cron, não precisa mais segurar a
        // invocação por minutos. Isso é só o "respiro" entre 2 envios que
        // raramente caem no mesmo tick.
        if (processed < jobs.length) {
          const randomDelaySecs = 8 + Math.random() * 7;
          await sleep(randomDelaySecs * 1000);
        }
      } catch (e: any) {
        const errorMsg = e?.message || "Falha ao processar job";

        // ✅ 30/08/2026: se o checkpoint (envio ao 1º contato) já rodou, o
        // job já está corretamente SENT — um erro tentando o contato
        // seguinte (ou qualquer coisa depois) NÃO pode sobrescrever isso
        // pra FAILED, senão o cliente que JÁ recebeu a mensagem apareceria
        // como falha (e ainda dispararia notificação de falha indevida).
        if (checkpointed) {
          safeServerLog("[BILLING] job já tinha checkpoint SENT, erro depois disso (contato seguinte?):", errorMsg);
          continue;
        }

        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: errorMsg,
          })
          .eq("id", job.id);

        if ((job as any).automation_id) {
          const { error: logErr } = await sb.from("billing_logs").insert({
            tenant_id: job.tenant_id,
            automation_id: (job as any).automation_id,
            client_id: job.client_id,
            client_name: "Falha no Envio",
            client_whatsapp: "-",
            status: "FAILED",
            sent_at: new Date().toISOString(),
            error_message: errorMsg.slice(0, 500),
          });
          if (logErr) safeServerLog("[BILLING] falha ao gravar log de erro:", logErr.message);

          // ✅ NOVO: notifica o sino AGORA, na hora
          await notifyAutomationFailure(sb, String(job.tenant_id), String((job as any).automation_id));
        }
      }
    }

    return NextResponse.json({ ok: true, processed });
  }

  // =========================
  // 3) FRONT: agenda (insere job)
  // =========================
  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String((body as any).tenant_id || "").trim();
  const message = String((body as any).message || "").trim();
  const messageTemplateId = String((body as any).message_template_id || "").trim();
  let imageUrl = String((body as any).image_url || "").trim() || null;

  if (!imageUrl && messageTemplateId) {
    try {
      const { data: tpl } = await sb.from("message_templates").select("image_url").eq("id", messageTemplateId).single();
      if (tpl?.image_url) imageUrl = tpl.image_url;
    } catch (e) {
      safeServerLog("[WA][scheduled] falha ao buscar imagem do template", e);
    }
  }

  const sendAtRaw = String((body as any).send_at || "").trim();

  const rawClientId = String((body as any).client_id || "").trim();
  const rawResellerId = String((body as any).reseller_id || "").trim();
  const rawTestId = String((body as any).test_id || "").trim();
  const rawRecipientId = String((body as any).recipient_id || "").trim();
  const rawRecipientType = String((body as any).recipient_type || "").trim();

  let recipientType: "client" | "reseller" | null = null;
  let recipientId = "";

  if (rawRecipientId && (rawRecipientType === "client" || rawRecipientType === "reseller" || rawRecipientType === "test")) {
    recipientType = rawRecipientType === "reseller" ? "reseller" : "client";
    recipientId = rawRecipientId;
  } else if (rawResellerId) {
    recipientType = "reseller";
    recipientId = rawResellerId;
  } else if (rawClientId) {
    recipientType = "client";
    recipientId = rawClientId;
  } else if (rawTestId) {
    recipientType = "client";
    recipientId = rawTestId;
  }

  if (!tenantId || !message || !sendAtRaw || !recipientType || !recipientId) {
    return NextResponse.json({ error: "tenant_id, message, send_at e destino válido são obrigatórios" }, { status: 400 });
  }

  // =========================
  // Validação de que o tenant do body é o mesmo do usuário autenticado (apenas USER, não-cron)
  // =========================
  if (!isCron && tenantId !== authTenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let sendAtUtc: string;
  try {
    sendAtUtc = normalizeSendAtToUtcISOString(sendAtRaw);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "send_at inválido" }, { status: 400 });
  }

  let wa: any;
  if (recipientType === "reseller") wa = await fetchResellerWhatsApp(sb, tenantId, recipientId);
  else wa = await fetchClientWhatsApp(sb, tenantId, recipientId);

  if (!wa.phones || wa.phones.length === 0) {
    return NextResponse.json({ error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} sem whatsapp_username` }, { status: 400 });
  }

  if (!wa.whatsapp_opt_in) {
    return NextResponse.json({ error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não permite receber mensagens` }, { status: 400 });
  }

  if (wa.dont_message_until) {
    const until = new Date(wa.dont_message_until);
    if (!isNaN(until.getTime()) && until > new Date()) {
      return NextResponse.json({ error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não quer receber mensagens (em pausa)` }, { status: 409 });
    }
  }

  const insertPayload: any = {
    tenant_id: tenantId,
    message,
    image_url: imageUrl,
    send_at: sendAtUtc,
    status: "SCHEDULED",
    whatsapp_session: (body as any).whatsapp_session ?? "default",
    created_by: authedUserId,
  };

  const mtid = String((body as any).message_template_id || "").trim();
  if (mtid) insertPayload.message_template_id = mtid;

  if (recipientType === "reseller") insertPayload.reseller_id = recipientId;
  else insertPayload.client_id = recipientId;

  const { error: insErr } = await sb.from("client_message_jobs").insert(insertPayload);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, send_at: sendAtUtc });
}

// ============================================================================
// ✅ O Vercel Cron SEMPRE faz requisições GET.
// Redirecionamos o GET para a sua função POST, onde a segurança já está pronta.
// ============================================================================
export async function GET(req: Request) {
  const isCron = isCronRequest(req, "CRON_SECRET");

  if (!isCron) {
    return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
  }

  return POST(req);
}