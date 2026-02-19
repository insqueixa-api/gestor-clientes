import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TZ_SP = "America/Sao_Paulo";

function makeSessionKey(tenantId: string, userId: string) {
  return crypto.createHash("sha256").update(`${tenantId}:${userId}`).digest("hex");
}

function normalizeToPhone(usernameRaw: unknown): string {
  // username hoje = telefone (pode vir com +, espaços, etc)
  const s = String(usernameRaw ?? "").trim();
  const digits = s.replace(/[^\d]/g, "");
  return digits;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Extrai partes de data/hora no fuso de SP com Intl (server-safe).
 * Retorna strings já com zero-pad quando aplicável.
 */
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
  // ✅ SP fixo
  const p = getSPParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

function toBRTime(d: Date) {
  // ✅ SP fixo
  const p = getSPParts(d);
  return `${p.hour}:${p.minute}`;
}

function weekdayPtBR(d: Date) {
  // ✅ SP fixo
  const s = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ_SP, weekday: "long" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function saudacaoTempo(d: Date) {
  // ✅ SP fixo
  const p = getSPParts(d);
  const h = Number(p.hour);

  // Entre 04:00 e 11:59
  if (h >= 4 && h < 12) return "Bom dia";
  // Entre 12:00 e 17:59
  if (h >= 12 && h < 18) return "Boa tarde";
  // Antes das 04:00 ou depois das 18:00
  return "Boa noite";
}

/**
 * Gera uma chave de dia (YYYY-MM-DD) no fuso SP.
 */
function spDayKey(d: Date) {
  const p = getSPParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Diferença inteira de dias (a - b) baseada no "dia" de SP
 * (não UTC, não timezone do servidor).
 */
function diffDays(a: Date, b: Date) {
  const aKey = spDayKey(a);
  const bKey = spDayKey(b);

  // Converte as chaves em UTC meia-noite pra subtrair sem depender do timezone local
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

  // 1. DADOS BÁSICOS (Lógica Estrita)
  const displayName = String(row.client_name || row.name || "").trim();
  const primeiroNome = displayName.split(" ")[0] || "";

  // Prefixo/Saudação: Apenas o que está no campo. Sem fallback para nome.
  const namePrefix = String(row.name_prefix || row.saudacao || "").trim();
  const saudacao = namePrefix ? namePrefix : "";

  // 2. DATAS
  const createdAt = safeDate(row.created_at);
  const dueAt = safeDate(row.vencimento);
  const daysSinceCadastro = createdAt ? Math.max(0, diffDays(now, createdAt)) : 0;

  let diasParaVencimento = "0";
  let diasAtraso = "0";

  if (dueAt) {
    const d = diffDays(dueAt, now);
    if (d >= 0) diasParaVencimento = String(d);
    else diasAtraso = String(Math.abs(d));
  }

  const appUrl = "https://unigestor.net.br";
  const cleanPhone = normalizeToPhone(row.whatsapp_username || row.whatsapp_e164 || "");

  // ✅ link_pagamento será preenchido na hora do envio (manual/cron) via token
  const linkPagamento = "";

// 4. PREÇO / MOEDA
const priceVal = row.price_amount ? Number(row.price_amount) : 0;

// ✅ valor_fatura: SOMENTE o valor (sem moeda)
const valorFaturaStr = priceVal > 0 ? `${priceVal.toFixed(2).replace(".", ",")}` : "";

// ✅ moeda_cliente (você disse que já está funcionando no view)
const moedaCliente = String(row.price_currency || row.currency || "").trim(); // BRL/USD/EUR


  return {
    saudacao_tempo: saudacaoTempo(now),
    dias_desde_cadastro: String(daysSinceCadastro),
    dias_para_vencimento: diasParaVencimento,
    dias_atraso: diasAtraso,
    hoje_data: toBRDate(now),
    hoje_dia_semana: weekdayPtBR(now),
    hora_agora: toBRTime(now),

    saudacao: saudacao, // ✅ Corrigido: Só traz Sr./Sra. ou vazio
    primeiro_nome: primeiroNome, // ✅ Corrigido: Só o primeiro nome
    nome_completo: displayName, // ✅ Corrigido: Nome completo
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

    // 💰 Financeiro
link_pagamento: linkPagamento,
pin_cliente: cleanPhone && cleanPhone.length >= 4 ? cleanPhone.slice(-4) : "", // ✅ PIN inicial padrão

// ✅ moeda do cliente (view)
moeda_cliente: moedaCliente,

// (mantém se você ainda usa pix copia e cola automático)
pix_copia_cola: row.pix_code || "",

// ✅ PIX Manual por tipo (dinâmico via payment_gateways pix_manual)
// OBS: aqui fica vazio e a gente preenche no POST logo depois do buildTemplateVars
pix_manual_cnpj: "",
pix_manual_cpf: "",
pix_manual_email: "",
pix_manual_phone: "",

// ✅ compat legado (se algum template antigo ainda tiver {chave_pix_manual})
chave_pix_manual: "",

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

  // ✅ legado
  client_id?: string;

  // ✅ novo
  reseller_id?: string;

  // ✅ padrão (opcional)
  recipient_id?: string;
  recipient_type?: "client" | "reseller";

  // ✅ novo (opcional)
  message_template_id?: string;

  message: string;
  send_at: string; // ISO (pode vir sem TZ do front)
  whatsapp_session?: string | null;
};

async function fetchClientWhatsApp(sb: any, tenantId: string, clientId: string) {
  // ✅ SEMPRE pega da view consolidada
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
    row: data, // ✅ para variáveis
  };
}

async function fetchResellerWhatsApp(sb: any, tenantId: string, resellerId: string) {
  const tryViews = ["vw_resellers_list_active", "vw_resellers_list_archived"];
  let lastErr: any = null;

  for (const view of tryViews) {
    const { data, error } = await sb.from(view).select("*").eq("tenant_id", tenantId).eq("id", resellerId).maybeSingle();

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
        row: data, // ✅ para variáveis
      };
    }
  }

  if (lastErr) throw new Error(lastErr.message);
  throw new Error("Revenda não encontrada nas views de revenda");
}

async function fetchPixManualMap(sb: any, tenantId: string) {
  const { data, error } = await sb
    .from("payment_gateways")
    .select("priority, created_at, config")
    .eq("tenant_id", tenantId)
    .eq("type", "pix_manual")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  // pega o 1º de cada tipo (pela ordem priority/created_at)
  const out: Record<string, string> = {};

  for (const g of (data || []) as any[]) {
    const cfg = (g?.config || {}) as any;
    const tRaw = String(cfg?.pix_key_type || "").trim().toLowerCase(); // cnpj/cpf/email/phone/random
    const kRaw = String(cfg?.pix_key || "").trim();

    if (!tRaw || !kRaw) continue;

    if (!out[tRaw]) out[tRaw] = kRaw;
  }

  return out; // { cnpj: "...", cpf:"...", email:"...", phone:"...", random:"..." }
}


// =========================
// ✅ NOVO: send_at sempre normalizado para UTC
// (quando vier sem TZ, interpreta como São Paulo)
// =========================

// detecta se a string já tem timezone (Z ou ±HH:MM)
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

  // já tem TZ (ex: ...Z / ...-03:00 / ...+00:00)
  if (hasTzDesignator(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) throw new Error(`send_at inválido: ${s}`);
    return d.toISOString();
  }

  // aceita "YYYY-MM-DDTHH:mm" ou "YYYY-MM-DD HH:mm" (sem TZ)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    // fallback: tenta parse genérico
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
    console.log("[WA][scheduled] Server misconfigured", {
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

  // Pega o cabeçalho Authorization (padrão Vercel e padrão JWT)
const cronSecret = process.env.CRON_SECRET || null;

// pega só o token "puro" (independente de Bearer/bearer/espacos)
const bearer = getBearerToken(req);

const isCron = !!cronSecret && !!bearer && bearer === cronSecret;


  let authedUserId: string | null = null;

  // Se NÃO for o Cron, tenta autenticar como usuário logado (Front-end)
  if (!isCron) {
    const token = getBearerToken(req); // Sua função auxiliar
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
  // =========================
// 2) CRON: processa fila
// =========================
if (isCron) {
    // ============================================================
  // ✅ PASSO 0: ENFILEIRAR AUTOMAÇÕES
  // - Sem isso, o automático nunca cria jobs em client_message_jobs.
  // - A RPC deve criar os jobs (SCHEDULED/QUEUED) respeitando regras do banco.
  // - Soft-fail: se enfileirar falhar, ainda processamos jobs existentes.
  // ============================================================
  try {
    // roda no "dia SP" para alinhar com suas regras (sem depender do timezone do server)
    const p = getSPParts(new Date());
    const fireDate = `${p.year}-${p.month}-${p.day}`; // YYYY-MM-DD (SP)

    // ✅ BUSCA TODOS OS TENANTS QUE TÊM AUTOMAÇÕES ATIVAS
const { data: tenants, error: tenantsErr } = await sb
  .from("billing_automations")
  .select("tenant_id")
  .eq("is_active", true)
  .eq("is_automatic", true)
  .eq("execution_status", "RUNNING");


    if (tenantsErr) {
      console.log("[BILLING][get_tenants] erro:", tenantsErr.message);
    }

    // Remove duplicatas (um tenant pode ter várias automações)
    const uniqueTenants = [...new Set((tenants || []).map(t => t.tenant_id))];

    console.log("[BILLING][enqueue] processando", uniqueTenants.length, "tenants no dia", fireDate);

    // ✅ PROCESSA CADA TENANT
    let totalJobsCreated = 0;
    for (const tenantId of uniqueTenants) {
      const { data: enqData, error: enqErr } = await sb.rpc("billing_enqueue_scheduled", {
        p_tenant_id: tenantId,
        p_fire_date: fireDate,
      });

      const jobsCreated = enqData ?? 0;
      totalJobsCreated += jobsCreated;

      console.log("[BILLING][enqueue_scheduled]", {
        tenantId,
        fireDate,
        ok: !enqErr,
        enqErr: enqErr?.message ?? null,
        jobsCreated,
      });
    }

    console.log("[BILLING][enqueue] ✅ CONCLUÍDO:", totalJobsCreated, "jobs criados no total");
  } catch (e: any) {
    console.log("[BILLING][enqueue_scheduled] exception", e?.message ?? e);
  }

  // ✅ SELF-HEALING: revive jobs travados em SENDING (crash/restart)
  await sb
    .from("client_message_jobs")
    .update({ status: "QUEUED", error_message: null })
    .eq("status", "SENDING")
    .lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()); // 5 min

  // ✅ busca jobs prontos para enviar
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
    billing_automations (
      delay_min,
      is_active,
      is_automatic,
      execution_status,
      schedule_time
    )
  `)
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

  // Se a regra estiver desativada → cancela SEMPRE
  if (!aIsActive) {
    await sb
      .from("client_message_jobs")
      .update({ status: "CANCELLED", error_message: "Automação desativada (is_active=false)" })
      .eq("id", job.id);
    continue;
  }

  // Se for automático e não estiver RUNNING → cancela
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
      const wa =
        recipientType === "reseller"
          ? await fetchResellerWhatsApp(sb, job.tenant_id, recipientId)
          : await fetchClientWhatsApp(sb, job.tenant_id, recipientId);

      // ✅ validações
      if (!wa.phone) {
        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: `${recipientType === "reseller" ? "Revenda" : "Cliente"} sem whatsapp_username`,
          })
          .eq("id", job.id);
        continue;
      }

      if (!wa.whatsapp_opt_in) {
        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não opt-in`,
          })
          .eq("id", job.id);
        continue;
      }

      if (wa.dont_message_until) {
        const until = new Date(wa.dont_message_until);

        if (isNaN(until.getTime())) {
          await sb
            .from("client_message_jobs")
            .update({
              status: "FAILED",
              error_message: `${recipientType === "reseller" ? "Revenda" : "Cliente"} em pausa (data inválida): ${String(
                wa.dont_message_until
              )}`,
            })
            .eq("id", job.id);
          continue;
        }

        if (until > new Date()) {
          const formattedSP = new Intl.DateTimeFormat("pt-BR", {
            timeZone: TZ_SP,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(until);

          await sb
            .from("client_message_jobs")
            .update({
              status: "FAILED",
              error_message: `${recipientType === "reseller" ? "Revenda" : "Cliente"} em pausa até ${formattedSP}`,
            })
            .eq("id", job.id);
          continue;
        }
      }

      const sessionUserId = String(job.created_by || "system");
      const sessionKey = makeSessionKey(job.tenant_id, sessionUserId);

console.log("[WA][cron_send]", {
  jobId_suffix: String(job.id || "").slice(-6),
  tenantId: job.tenant_id,
  recipientType,
  recipientId_suffix: recipientId ? String(recipientId).slice(-6) : null,
  to_suffix: wa.phone ? String(wa.phone).slice(-4) : null,
  createdBy_prefix: job.created_by ? String(job.created_by).slice(0, 8) : null,
});


      // ✅ tags
const vars = buildTemplateVars({
  recipientType,
  recipientRow: (wa as any).row,
});

// ✅ garante que as chaves existam mesmo se o buildTemplateVars ainda não tiver elas
(vars as any).pix_manual_cnpj = (vars as any).pix_manual_cnpj ?? "";
(vars as any).pix_manual_cpf = (vars as any).pix_manual_cpf ?? "";
(vars as any).pix_manual_email = (vars as any).pix_manual_email ?? "";
(vars as any).pix_manual_phone = (vars as any).pix_manual_phone ?? "";

// ✅ PIX Manual por tipo (dinâmico via payment_gateways pix_manual)
try {
  const tid = String(job.tenant_id || "").trim();
  const pix = await fetchPixManualMap(sb, tid);

  (vars as any).pix_manual_cnpj = pix.cnpj || "";
  (vars as any).pix_manual_cpf = pix.cpf || "";
  (vars as any).pix_manual_email = pix.email || "";
  (vars as any).pix_manual_phone = pix.phone || "";

  // ✅ compat (se existir template antigo usando {chave_pix_manual})
  (vars as any).chave_pix_manual =
    pix.cnpj || pix.cpf || pix.email || pix.phone || pix.random || "";
} catch (e: any) {
  console.log("[WA][pix_manual][cron] falhou", e?.message ?? e);
}

// ✅ token v2 (sem auth.uid, valida por created_by)
try {
  const whatsappUsernameRaw = String((wa as any).row?.whatsapp_username ?? "").trim();
  const whatsappUsername = normalizeToPhone(whatsappUsernameRaw);

  if (whatsappUsername) {
    const expiresAt = new Date(Date.now() + 43200 * 60 * 1000).toISOString(); // 30 dias
    const createdBy = String((job as any).created_by || "").trim();

    const { data: tokData, error: tokErr } = await sb.rpc("portal_admin_create_token_for_whatsapp_v2", {
      p_tenant_id: String(job.tenant_id),
      p_whatsapp_username: whatsappUsername,
      p_created_by: createdBy,
      p_label: "Cobranca automatica",
      p_expires_at: expiresAt,
    });

    if (tokErr) throw new Error(tokErr.message);

    const rowTok = Array.isArray(tokData) ? tokData[0] : null;
    const portalToken = rowTok?.token ? String(rowTok.token) : "";

    console.log("[PORTAL][cron_token:v2]", {
      jobId_suffix: String(job.id || "").slice(-6),
      tenantId: job.tenant_id,
      createdBy_prefix: createdBy ? String(createdBy).slice(0, 8) : null,
      phone_suffix: whatsappUsername ? String(whatsappUsername).slice(-4) : null,
      ok: true,
      hasToken: !!portalToken,
      token_suffix: portalToken ? portalToken.slice(-6) : null,
    });

    if (portalToken) {
      const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "https://unigestor.net.br")
        .trim()
        .replace(/\/+$/, "");

      vars.link_pagamento = `${appUrl}?#t=${encodeURIComponent(portalToken)}`;
    } else {
      console.log("[PORTAL][token:v2] retorno sem token");
    }
  } else {
    console.log("[PORTAL][cron_token:v2] whatsapp_username vazio no destino");
  }
} catch (e: any) {
  console.log("[PORTAL][cron_token:v2] falhou", e?.message ?? e);
}

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
        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: raw.slice(0, 500),
          })
          .eq("id", job.id);
        continue;
      }

      await sb
        .from("client_message_jobs")
        .update({
          status: "SENT",
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", job.id);

      // ✅ billing_logs (mantido como você já tinha)
      if ((job as any).automation_id) {
        const cName = String((wa as any).row?.display_name || (wa as any).row?.client_name || "Cliente").trim();

        const logRes = await sb.from("billing_logs").insert({
          tenant_id: job.tenant_id,
          automation_id: (job as any).automation_id,
          client_id: job.client_id || null,
          client_name: cName,
          client_whatsapp: wa.phone,
          status: "SENT",
          sent_at: new Date().toISOString(),
        });

        if (logRes.error) console.error("Erro ao salvar Log:", logRes.error);
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

  // ✅ pode vir sem TZ do front
  const sendAtRaw = String((body as any).send_at || "").trim();

  const rawClientId = String((body as any).client_id || "").trim();
  const rawResellerId = String((body as any).reseller_id || "").trim();
  const rawRecipientId = String((body as any).recipient_id || "").trim();
  const rawRecipientType = String((body as any).recipient_type || "").trim();

  let recipientType: "client" | "reseller" | null = null;
  let recipientId = "";

  // prioridade: recipient_id+type > reseller_id > client_id
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
    return NextResponse.json(
      { error: "tenant_id, message, send_at e (client_id OU reseller_id OU recipient_id+recipient_type) são obrigatórios" },
      { status: 400 }
    );
  }

  // ✅ NORMALIZA send_at para UTC (interpretando SP quando vier sem TZ)
  let sendAtUtc: string;
  try {
    sendAtUtc = normalizeSendAtToUtcISOString(sendAtRaw);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "send_at inválido" }, { status: 400 });
  }

  // ✅ validações iguais ao dispatch (mantidas)
  const wa =
    recipientType === "reseller" ? await fetchResellerWhatsApp(sb, tenantId, recipientId) : await fetchClientWhatsApp(sb, tenantId, recipientId);

  if (!wa.phone) {
    return NextResponse.json({ error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} sem whatsapp_username` }, { status: 400 });
  }

  if (!wa.whatsapp_opt_in) {
    return NextResponse.json({ error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não permite receber mensagens` }, { status: 400 });
  }

  if (wa.dont_message_until) {
    const until = new Date(wa.dont_message_until);

    if (isNaN(until.getTime())) {
      return NextResponse.json(
        { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não quer receber mensagens (data inválida): ${wa.dont_message_until}` },
        { status: 409 }
      );
    }

    if (until > new Date()) {
      const formatted = new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ_SP,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(until);

      return NextResponse.json({ error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não quer receber mensagens até: ${formatted}` }, { status: 409 });
    }
  }

  // ✅ grava no job com a coluna correta
  const insertPayload: any = {
    tenant_id: tenantId,
    message,
    send_at: sendAtUtc, // ✅ grava UTC no banco
    status: "SCHEDULED",
    whatsapp_session: (body as any).whatsapp_session ?? "default",
    created_by: authedUserId,
  };

  // ✅ opcional: se o front enviar, o job fica linkado ao template
const mtid = String((body as any).message_template_id || "").trim();
if (mtid) insertPayload.message_template_id = mtid;

  if (recipientType === "reseller") insertPayload.reseller_id = recipientId;
  else insertPayload.client_id = recipientId;

  const { error: insErr } = await sb.from("client_message_jobs").insert(insertPayload);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, send_at: sendAtUtc });
}

// ============================================================================
// ✅ ADICIONADO: O Vercel Cron SEMPRE faz requisições GET.
// Redirecionamos o GET para a sua função POST, onde a segurança já está pronta.
// ============================================================================
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET || null;
  const bearer = getBearerToken(req);
  const isCron = !!cronSecret && !!bearer && bearer === cronSecret;

  if (!isCron) {
    return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
  }

  return POST(req);
}

