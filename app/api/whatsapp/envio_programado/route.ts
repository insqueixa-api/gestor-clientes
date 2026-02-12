import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const TZ_SP = "America/Sao_Paulo";

// ==========================================
// ✅ 1. FUNÇÃO DE PAUSA (Faltava isso no seu)
// ==========================================
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeSessionKey(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}`).digest("hex");
}

function normalizeToPhone(usernameRaw: unknown): string {
  const s = String(usernameRaw ?? "").trim();
  const digits = s.replace(/[^\d]/g, "");
  return digits;
}

function getSPParts(d: Date) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ_SP,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  return map as {
    day: string;
    month: string;
    year: string;
    hour: string;
    minute: string;
    second: string;
  };
}

function toBRDate(d: Date) {
  const p = getSPParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

function toBRTime(d: Date) {
  const p = getSPParts(d);
  return `${p.hour}:${p.minute}`;
}

function weekdayPtBR(d: Date) {
  const s = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ_SP, weekday: "long" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function saudacaoTempo(d: Date) {
  const p = getSPParts(d);
  const h = Number(p.hour);
  if (h >= 4 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

function spDayKey(d: Date) {
  const p = getSPParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

function diffDays(a: Date, b: Date) {
  const aKey = spDayKey(a);
  const bKey = spDayKey(b);
  const aUtc = new Date(`${aKey}T00:00:00.000Z`);
  const bUtc = new Date(`${bKey}T00:00:00.000Z`);
  const ms = aUtc.getTime() - bUtc.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function safeDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function renderTemplate(text: string, vars: Record<string, string>) {
  if (!text) return "";
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    const k = String(key || "").trim();
    if (!k) return full;
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : full;
  });
}

function buildTemplateVars(params: { recipientType: "client" | "reseller"; recipientRow: any }) {
  const now = new Date();
  const row = params.recipientRow || {};

  const displayName = String(row.client_name ?? row.name ?? "").trim();
  const primeiroNome = displayName.split(" ")[0] || "";
  const namePrefix = String(row.name_prefix ?? row.saudacao ?? "").trim();
  const saudacao = namePrefix || (displayName ? displayName : "");

  const createdAt = safeDate(row.created_at);
  const dueAt = safeDate(row.vencimento);
  const daysSinceCadastro = createdAt ? Math.max(0, diffDays(now, createdAt)) : 0;

  let diasParaVencimento = "0";
  let diasAtraso = "0";

  if (dueAt) {
    const d = diffDays(dueAt, now);
    if (d >= 0) {
      diasParaVencimento = String(d);
    } else {
      diasAtraso = String(Math.abs(d));
    }
  }

  const appUrl = "https://unigestor.net.br";
  const cleanPhone = normalizeToPhone(row.whatsapp_username || row.whatsapp_e164 || "");
  const linkPagamento = cleanPhone ? `${appUrl}/p/${cleanPhone}` : "";
  const priceVal = row.price_amount ? Number(row.price_amount) : 0;
  const valorFaturaStr = priceVal > 0 ? `R$ ${priceVal.toFixed(2).replace('.', ',')}` : "";

  return {
    saudacao_tempo: saudacaoTempo(now),
    dias_desde_cadastro: String(daysSinceCadastro),
    dias_para_vencimento: diasParaVencimento,
    dias_atraso: diasAtraso,
    hoje_data: toBRDate(now),
    hoje_dia_semana: weekdayPtBR(now),
    hora_agora: toBRTime(now),
    saudacao: saudacao,
    primeiro_nome: primeiroNome,
    nome_completo: displayName,
    whatsapp: row.whatsapp_username || "",
    observacoes: row.notes || "",
    data_cadastro: createdAt ? toBRDate(createdAt) : "",
    usuario_app: row.username || "",
    senha_app: row.server_password || "",
    plano_nome: row.plan_name || "",
    telas_qtd: String(row.screens || ""),
    tecnologia: row.technology || "",
    servidor_nome: row.server_name || "",
    data_vencimento: dueAt ? toBRDate(dueAt) : "",
    hora_vencimento: dueAt ? toBRTime(dueAt) : "",
    dia_da_semana_venc: dueAt ? weekdayPtBR(dueAt) : "",
    revenda_nome: row.reseller_name || "",
    revenda_site: row.reseller_panel_url || "",
    revenda_telegram: row.reseller_telegram || "",
    revenda_dns: row.reseller_dns || "",
    link_pagamento: linkPagamento,
    pix_copia_cola: row.pix_code || "",
    chave_pix_manual: row.pix_manual || "",
    valor_fatura: valorFaturaStr,
    nome: displayName,
    tipo_destino: params.recipientType,
  };
}

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
  message: string;
  send_at: string;
  whatsapp_session?: string | null;
  automation_id?: string;
};

async function fetchClientWhatsApp(sb: any, tenantId: string, clientId: string) {
  const { data, error } = await sb
    .from("vw_clients_list")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Cliente não encontrado na vw_clients_list");

  const phone = normalizeToPhone(data.whatsapp_username);
  return {
    phone,
    whatsapp_opt_in: data.whatsapp_opt_in === true,
    dont_message_until: data.dont_message_until as string | null,
    row: data,
  };
}

async function fetchResellerWhatsApp(sb: any, tenantId: string, resellerId: string) {
  const tryViews = ["vw_resellers_list_active", "vw_resellers_list_archived"];
  let lastErr: any = null;

  for (const view of tryViews) {
    const { data, error } = await sb
      .from(view)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", resellerId)
      .maybeSingle();

    if (error) {
      lastErr = error;
      continue;
    }

    if (data) {
      const phone = normalizeToPhone((data as any).whatsapp_username);
      return {
        phone,
        whatsapp_opt_in: (data as any).whatsapp_opt_in === true,
        dont_message_until: ((data as any).whatsapp_snooze_until as string | null) ?? null,
        row: data,
      };
    }
  }

  if (lastErr) throw new Error(lastErr.message);
  throw new Error("Revenda não encontrada nas views de revenda");
}

function hasTzDesignator(s: string) {
  return /([zZ]|[+\-]\d{2}:\d{2})$/.test(s);
}

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

  const utcMs = Date.UTC(year, month - 1, day, hour + 3, minute, second, 0);
  const d = new Date(utcMs);
  if (isNaN(d.getTime())) throw new Error(`send_at inválido após conversão: ${s}`);

  return d.toISOString();
}

export async function POST(req: Request) {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL!;
  const waToken = process.env.UNIGESTOR_WA_TOKEN!;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const sb = createClient(supabaseUrl, serviceKey);
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  let authedUserId: string | null = null;

  if (!isCron) {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized: No Token" }, { status: 401 });

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.id) return NextResponse.json({ error: "Unauthorized: Invalid User" }, { status: 401 });

    authedUserId = data.user.id;
  }

  if (isCron) {
    await sb
      .from("client_message_jobs")
      .update({ status: "QUEUED", error_message: null })
      .eq("status", "SENDING")
      .lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

    // ✅ 2. SELECT COM JOIN (Faltava isso no seu)
    const { data: jobs, error: jobsErr } = await sb
      .from("client_message_jobs")
      .select(`
        id, 
        tenant_id, 
        client_id, 
        reseller_id, 
        whatsapp_session, 
        message, 
        send_at, 
        created_by, 
        automation_id,
        billing_automations ( delay_min )
      `)
      .in("status", ["QUEUED", "SCHEDULED"])
      .lte("send_at", new Date().toISOString())
      .order("send_at", { ascending: true })
      .limit(10); // Lote pequeno por segurança

    if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    if (!jobs?.length) return NextResponse.json({ ok: true, processed: 0 });

    let processed = 0;

    for (const job of jobs) {
      try {
        const { data: locked, error: lockErr } = await sb
          .from("client_message_jobs")
          .update({ status: "SENDING", error_message: null })
          .eq("id", job.id)
          .in("status", ["QUEUED", "SCHEDULED"])
          .select("id")
          .maybeSingle();

        if (lockErr) throw new Error(lockErr.message);
        if (!locked) continue;

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
            .update({ status: "FAILED", error_message: "Job sem destino" })
            .eq("id", job.id);
          continue;
        }

        const wa = recipientType === "reseller"
          ? await fetchResellerWhatsApp(sb, job.tenant_id, recipientId)
          : await fetchClientWhatsApp(sb, job.tenant_id, recipientId);

        if (!wa.phone || !wa.whatsapp_opt_in) {
          await sb.from("client_message_jobs").update({ status: "FAILED", error_message: "Sem Whats ou Opt-in" }).eq("id", job.id);
          continue;
        }

        if (wa.dont_message_until) {
          const until = new Date(wa.dont_message_until);
          if (isNaN(until.getTime()) || until > new Date()) {
            await sb.from("client_message_jobs").update({ status: "FAILED", error_message: "Pausa ativa" }).eq("id", job.id);
            continue;
          }
        }

        const sessionUserId = String(job.created_by || "system");
        const sessionKey = makeSessionKey(job.tenant_id, sessionUserId);

        const vars = buildTemplateVars({
          recipientType,
          recipientRow: (wa as any).row,
        });

        const renderedMessage = renderTemplate(String(job.message ?? ""), vars);

        const res = await fetch(`${baseUrl}/send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${waToken}`,
            "x-session-key": sessionKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            phone: wa.phone,
            message: renderedMessage,
          }),
        });

        const raw = await res.text();
        if (!res.ok) {
          await sb.from("client_message_jobs").update({ status: "FAILED", error_message: raw.slice(0, 500) }).eq("id", job.id);
          continue;
        }

        await sb.from("client_message_jobs").update({ status: "SENT", sent_at: new Date().toISOString(), error_message: null }).eq("id", job.id);

        if ((job as any).automation_id) {
          const clientName = String((wa as any).row?.display_name || (wa as any).row?.client_name || "Cliente").trim();
          await sb.from("billing_logs").insert({
            tenant_id: job.tenant_id,
            automation_id: (job as any).automation_id,
            client_name: clientName,
            client_whatsapp: wa.phone,
            status: "SENT",
            sent_at: new Date().toISOString(),
            error_message: null
          });
        }

        processed++;

        // ✅ 3. PAUSA INTELIGENTE (Agora vai funcionar)
        if (processed < jobs.length) {
            const automationConfig = Array.isArray((job as any).billing_automations) 
                ? (job as any).billing_automations[0] 
                : (job as any).billing_automations;
            
            const dbDelay = automationConfig?.delay_min ? Number(automationConfig.delay_min) : 3;
            const safeDelay = Math.min(dbDelay, 10);
            const finalDelay = Math.max(safeDelay, 2);

            await sleep(finalDelay * 1000);
        }

      } catch (e: any) {
        const errorMsg = e?.message || "Falha desconhecida";
        await sb.from("client_message_jobs").update({ status: "FAILED", error_message: errorMsg }).eq("id", job.id);

        if ((job as any).automation_id) {
           await sb.from("billing_logs").insert({
               tenant_id: job.tenant_id,
               automation_id: (job as any).automation_id,
               client_name: "Falha",
               client_whatsapp: "-",
               status: "FAILED",
               sent_at: new Date().toISOString(),
               error_message: errorMsg.slice(0, 500)
           });
        }
      }
    }

    return NextResponse.json({ ok: true, processed });
  }

  // Lógica de agendamento manual (mantida igual)
  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String((body as any).tenant_id || "").trim();
  const message = String((body as any).message || "").trim();
  const sendAtRaw = String((body as any).send_at || "").trim();
  const rawClientId = String((body as any).client_id || "").trim();
  const rawResellerId = String((body as any).reseller_id || "").trim();
  const rawRecipientId = String((body as any).recipient_id || "").trim();
  const rawRecipientType = String((body as any).recipient_type || "").trim();

  let recipientType: "client" | "reseller" | null = null;
  let recipientId = "";

  if (rawRecipientId && (rawRecipientType === "client" || rawRecipientType === "reseller")) {
    recipientType = rawRecipientType as any;
    recipientId = rawRecipientId;
  } else if (rawResellerId) {
    recipientType = "reseller";
    recipientId = rawResellerId;
  } else if (rawClientId) {
    recipientType = "client";
    recipientId = rawClientId;
  }

  if (!tenantId || !message || !sendAtRaw || !recipientType || !recipientId) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  let sendAtUtc: string;
  try {
    sendAtUtc = normalizeSendAtToUtcISOString(sendAtRaw);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "send_at inválido" }, { status: 400 });
  }

  const wa = recipientType === "reseller"
    ? await fetchResellerWhatsApp(sb, tenantId, recipientId)
    : await fetchClientWhatsApp(sb, tenantId, recipientId);

  if (!wa.phone || !wa.whatsapp_opt_in) return NextResponse.json({ error: "Sem Whats/Opt-in" }, { status: 400 });

  if (wa.dont_message_until) {
    const until = new Date(wa.dont_message_until);
    if (isNaN(until.getTime()) || until > new Date()) return NextResponse.json({ error: "Pausa ativa" }, { status: 409 });
  }

  const insertPayload: any = {
    tenant_id: tenantId,
    message,
    send_at: sendAtUtc,
    status: "SCHEDULED",
    whatsapp_session: (body as any).whatsapp_session ?? "default",
    created_by: authedUserId,
  };

  if (recipientType === "reseller") insertPayload.reseller_id = recipientId;
  else insertPayload.client_id = recipientId;

  if ((body as any).automation_id) {
     insertPayload.automation_id = (body as any).automation_id;
  }

  const { error: insErr } = await sb.from("client_message_jobs").insert(insertPayload);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, send_at: sendAtUtc });
}

export async function GET(req: Request) {
  return POST(req);
}