//app/api/whatsapp/envio_programado

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { makeSessionKey } from "@/lib/whatsapp/wa-context";
import {
  buildClientTemplateVars,
  buildResellerTemplateVars,
  fetchClientWhatsApp,
  fetchResellerWhatsApp,
  fetchManualPaymentVars,
  generatePortalLink,
  renderTemplate,
  getSPParts,
} from "@/lib/whatsapp/template-vars";

function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
  }
}

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

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
  const cronSecret = process.env.CRON_SECRET || null;
  const bearer = getBearerToken(req);
  const isCron = !!cronSecret && !!bearer && bearer === cronSecret;

  let authedUserId: string | null = null;

  if (!isCron) {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized: No Token" }, { status: 401 });
    }

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.id) {
      return NextResponse.json({ error: "Unauthorized: Invalid User" }, { status: 401 });
    }

    authedUserId = data.user.id;
  }

  // =========================
  // 2) CRON: enfileira automações + processa fila
  // =========================
  if (isCron) {
    // ============================================================
    // ✅ PASSO 0: ENFILEIRAR AUTOMAÇÕES
    // ============================================================
    try {
      const p = getSPParts(new Date());
      const fireDate = `${p.year}-${p.month}-${p.day}`; // YYYY-MM-DD (SP)

      const { data: tenants, error: tenantsErr } = await sb
        .from("billing_automations")
        .select("tenant_id")
        .eq("is_active", true)
        .eq("is_automatic", true)
        .eq("execution_status", "RUNNING");

      if (tenantsErr) {
        safeServerLog("[BILLING][get_tenants] erro:", tenantsErr.message);
      }

      const uniqueTenants = [...new Set((tenants || []).map((t) => t.tenant_id))];

      safeServerLog("[BILLING][enqueue] processando", uniqueTenants.length, "tenants no dia", fireDate);

      let totalJobsCreated = 0;
      for (const tenantId of uniqueTenants) {
        const { data: enqData, error: enqErr } = await sb.rpc("billing_enqueue_scheduled", {
          p_tenant_id: tenantId,
          p_fire_date: fireDate,
        });

        const jobsCreated = enqData ?? 0;
        totalJobsCreated += jobsCreated;

        safeServerLog("[BILLING][enqueue_scheduled]", {
          tenantId,
          fireDate,
          ok: !enqErr,
          enqErr: enqErr?.message ?? null,
          jobsCreated,
        });
      }

      safeServerLog("[BILLING][enqueue] ✅ CONCLUÍDO:", totalJobsCreated, "jobs criados no total");
    } catch (e: any) {
      safeServerLog("[BILLING][enqueue_scheduled] exception", e?.message ?? e);
    }

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
      created_by,
      automation_id,
      billing_automations (
        delay_min,
        is_active,
        is_automatic,
        execution_status,
        schedule_time
      )
    `
      )
      .in("status", ["QUEUED", "SCHEDULED"])
      .lte("send_at", new Date().toISOString())
      .order("send_at", { ascending: true })
      .limit(30);

    if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    if (!jobs?.length) return NextResponse.json({ ok: true, processed: 0 });

    let processed = 0;

    for (const job of jobs) {
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

        // Puxa Gateway Manual (PIX + Transferência Internacional) uma vez por envio
        let manualPaymentVars: Record<string, string> = {};
        try {
          manualPaymentVars = await fetchManualPaymentVars(sb, String(job.tenant_id));
        } catch (e) {}

        // ✅ Loop de envios para os contatos vinculados à conta
        for (const contact of wa.phones) {
          const vars =
            recipientType === "reseller"
              ? buildResellerTemplateVars({ resellerRow: wa.row })
              : buildClientTemplateVars({ clientRow: wa.row, isSecondary: contact.is_secondary });

          Object.assign(vars, manualPaymentVars);

          // ⚠️ Preserva o comportamento ORIGINAL do agendamento/cron: pin_cliente aqui
          // sempre foi os últimos 4 dígitos do telefone, nunca o PIN real (diferente
          // do envio manual). Mantido de propósito — não é descuido.
          vars.pin_cliente = contact.number && contact.number.length >= 4 ? contact.number.slice(-4) : "";

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

          const renderedMessage = renderTemplate(String(job.message ?? ""), vars);

          const sendController = new AbortController();
          const sendTimeout = setTimeout(() => sendController.abort(), 15_000);
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
          } else {
            successCount++;
          }
        }

        if (successCount === 0) {
          await sb.from("client_message_jobs").update({ status: "FAILED", error_message: String(lastError).slice(0, 500) }).eq("id", job.id);
          continue;
        }

        await sb.from("client_message_jobs").update({ status: "SENT", sent_at: new Date().toISOString(), error_message: null }).eq("id", job.id);

        // ✅ Grava o Log do disparo
        if ((job as any).automation_id) {
          const cName = String((wa as any).row?.display_name || (wa as any).row?.client_name || "Cliente").trim();
          await sb.from("billing_logs").insert({
            tenant_id: job.tenant_id,
            automation_id: (job as any).automation_id,
            client_id: job.client_id || null,
            client_name: cName,
            client_whatsapp: wa.phones.map((p: any) => p.number).join(", "),
            status: "SENT",
            sent_at: new Date().toISOString(),
          });

          await sb
            .from("billing_automations")
            .update({ last_run_at: new Date().toISOString() })
            .eq("id", (job as any).automation_id);
        }

        processed++;

        // ✅ delay entre envios (respeita delay_min do banco)
        if (processed < jobs.length) {
          const automationConfig = Array.isArray((job as any).billing_automations)
            ? (job as any).billing_automations[0]
            : (job as any).billing_automations;

          const dbDelay = automationConfig?.delay_min ? Number(automationConfig.delay_min) : 10;
          const safeDelay = Math.min(dbDelay, 10);
          const finalDelay = Math.max(safeDelay, 5);

          await sleep(finalDelay * 1000);
        }
      } catch (e: any) {
        const errorMsg = e?.message || "Falha ao processar job";

        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: errorMsg,
          })
          .eq("id", job.id);

        if ((job as any).automation_id) {
          await sb.from("billing_logs").insert({
            tenant_id: job.tenant_id,
            automation_id: (job as any).automation_id,
            client_name: "Falha no Envio",
            client_whatsapp: "-",
            status: "FAILED",
            sent_at: new Date().toISOString(),
            error_message: errorMsg.slice(0, 500),
          });
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
  const cronSecret = process.env.CRON_SECRET || null;
  const bearer = getBearerToken(req);

  function isCronAuth(bearer: string | null, secret: string | null): boolean {
    if (!bearer || !secret) return false;
    const a = Buffer.from(bearer);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  const isCron = isCronAuth(bearer, cronSecret);

  if (!isCron) {
    return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
  }

  return POST(req);
}