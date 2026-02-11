import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

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
  const now = new Date(); // Travado em SP
  const row = params.recipientRow || {};

  // 1. DADOS BÁSICOS (Mapeados exatamente da sua vw_clients_list_active)
  const displayName = String(row.client_name ?? row.name ?? "").trim(); // NOME EXATO DO BANCO
  const primeiroNome = displayName.split(" ")[0] || "";
  const namePrefix = String(row.name_prefix ?? row.saudacao ?? "").trim();
  const saudacao = namePrefix || (displayName ? displayName : "");

  // 2. DATAS
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

  // 3. O LINK ENCURTADO E SEGURO (Fixo no domínio de produção)
  const appUrl = "https://unigestor.net.br";
  const cleanPhone = normalizeToPhone(row.whatsapp_username || row.whatsapp_e164 || "");
  const linkPagamento = cleanPhone ? `${appUrl}/p/${cleanPhone}` : "";

  // 4. PREÇO (Mapeado exatamente de price_amount)
  const priceVal = row.price_amount ? Number(row.price_amount) : 0;
  const valorFaturaStr = priceVal > 0 ? `R$ ${priceVal.toFixed(2).replace('.', ',')}` : "";

  // 5. RETORNO DE TODAS AS VARIÁVEIS
  return {
    // 🤖 Automação & Prazos
    saudacao_tempo: saudacaoTempo(now),
    dias_desde_cadastro: String(daysSinceCadastro),
    dias_para_vencimento: diasParaVencimento,
    dias_atraso: diasAtraso,
    hoje_data: toBRDate(now),
    hoje_dia_semana: weekdayPtBR(now),
    hora_agora: toBRTime(now),

    // 👤 Dados do Cliente
    saudacao: saudacao,
    primeiro_nome: primeiroNome,
    nome_completo: displayName,
    whatsapp: row.whatsapp_username || "",
    observacoes: row.notes || "", // Mantido como fallback se um dia você adicionar notes
    data_cadastro: createdAt ? toBRDate(createdAt) : "",

    // 🖥️ Acesso e Servidor (Nomes exatos do Banco)
    usuario_app: row.username || "",
    senha_app: row.server_password || "",
    plano_nome: row.plan_name || "",
    telas_qtd: String(row.screens || ""),
    tecnologia: row.technology || "",
    servidor_nome: row.server_name || "",

    // 📅 Dados da Assinatura
    data_vencimento: dueAt ? toBRDate(dueAt) : "",
    hora_vencimento: dueAt ? toBRTime(dueAt) : "",
    dia_da_semana_venc: dueAt ? weekdayPtBR(dueAt) : "",

    // 🏢 Revenda (Mantido compatibilidade caso haja revendas depois)
    revenda_nome: row.reseller_name || "",
    revenda_site: row.reseller_panel_url || "",
    revenda_telegram: row.reseller_telegram || "",
    revenda_dns: row.reseller_dns || "",

    // 💰 Financeiro
    link_pagamento: linkPagamento, 
    pix_copia_cola: row.pix_code || "", 
    chave_pix_manual: row.pix_manual || "", 
    valor_fatura: valorFaturaStr,

    // Legado (Para não quebrar o que já existia)
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
        row: data, // ✅ para variáveis
      };
    }
  }

  if (lastErr) throw new Error(lastErr.message);
  throw new Error("Revenda não encontrada nas views de revenda");
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
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL!;
  const waToken = process.env.UNIGESTOR_WA_TOKEN!;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const sb = createClient(supabaseUrl, serviceKey);

  // =========================
  // 1) Autorização BLINDADA: CRON ou USER
  // =========================
  
  // Pega o cabeçalho Authorization (padrão Vercel e padrão JWT)
  const authHeader = req.headers.get("authorization");
  
  // Pega a senha mestra que definimos nas variáveis de ambiente
  const cronSecret = process.env.CRON_SECRET; 

  // Verifica se é o Cron da Vercel (O "Crachá" bate com a senha?)
  // A Vercel envia "Bearer SUA_SENHA", então comparamos direto
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

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
  // 2) CRON: processa fila
  // =========================
  if (isCron) {
    // ✅ SELF-HEALING: revive jobs travados em SENDING (crash/restart)
    await sb
      .from("client_message_jobs")
      .update({ status: "QUEUED", error_message: null })
      .eq("status", "SENDING")
      .lt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()); // 5 min

    const { data: jobs, error: jobsErr } = await sb
      .from("client_message_jobs")
      .select("id, tenant_id, client_id, reseller_id, whatsapp_session, message, send_at, created_by, automation_id")
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
        if (!locked) continue; // outro worker pegou antes

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
            .update({
              status: "FAILED",
              error_message: "Job sem destino (client_id/reseller_id ausente)",
            })
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

          // data inválida -> FAILED
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

          // bloqueado (futuro) -> FAILED (não fica preso em SENDING)
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
          jobId: job.id,
          tenantId: job.tenant_id,
          recipientType,
          recipientId,
          to: wa.phone,
          createdBy: job.created_by,
        });

        // ✅ renderiza tags NA HORA DO ENVIO (CRON) (agora tudo em SP)
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

// ✅ SALVA O LOG PARA A TELA DE HISTÓRICO LER
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
      } catch (e: any) {
        const errorMsg = e?.message || "Falha ao processar job";
        
        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: errorMsg,
          })
          .eq("id", job.id);

        // ✅ SALVA O ERRO NOS LOGS
        if ((job as any).automation_id) {
           await sb.from("billing_logs").insert({
               tenant_id: job.tenant_id,
               automation_id: (job as any).automation_id,
               client_name: "Falha no Envio",
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
    recipientType === "reseller"
      ? await fetchResellerWhatsApp(sb, tenantId, recipientId)
      : await fetchClientWhatsApp(sb, tenantId, recipientId);

  // ✅ validações iguais, mas com texto certo
  if (!wa.phone) {
    return NextResponse.json(
      { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} sem whatsapp_username` },
      { status: 400 }
    );
  }

  if (!wa.whatsapp_opt_in) {
    return NextResponse.json(
      { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não permite receber mensagens` },
      { status: 400 }
    );
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

      return NextResponse.json(
        { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não quer receber mensagens até: ${formatted}` },
        { status: 409 }
      );
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
  return POST(req);
}