import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

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

function toBRDate(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function toBRTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function weekdayPtBR(d: Date) {
  const s = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function saudacaoTempo(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function diffDays(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
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

  const displayName =
    String(row.display_name ?? row.name ?? row.full_name ?? row.nome ?? "").trim();

  const namePrefix =
    String(row.name_prefix ?? row.saudacao ?? "").trim();

  const createdAt = safeDate(row.created_at ?? row.createdAt);
  const dueAt = safeDate(row.vencimento ?? row.due_at ?? row.due_date ?? row.expire_at ?? row.expires_at);

  const daysSinceCadastro =
    createdAt ? Math.max(0, diffDays(now, createdAt)) : "";

  let diasParaVencimento = "";
  let diasAtraso = "";

  if (dueAt) {
    const d = diffDays(dueAt, now);
    if (d >= 0) {
      diasParaVencimento = String(d);
      diasAtraso = "0";
    } else {
      diasParaVencimento = "0";
      diasAtraso = String(Math.abs(d));
    }
  }

  const saudacao =
    namePrefix ||
    (displayName ? displayName : "");

  return {
    hora_agora: toBRTime(now),
    hoje_data: toBRDate(now),
    hoje_dia_semana: weekdayPtBR(now),
    saudacao_tempo: saudacaoTempo(now),

    dias_desde_cadastro: daysSinceCadastro === "" ? "" : String(daysSinceCadastro),
    dias_para_vencimento: diasParaVencimento,
    dias_atraso: diasAtraso,

    saudacao: saudacao,

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
  send_at: string; // ISO
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


export async function POST(req: Request) {
  const baseUrl = process.env.UNIGESTOR_WA_BASE_URL!;
  const waToken = process.env.UNIGESTOR_WA_TOKEN!;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const sb = createClient(supabaseUrl, serviceKey);

  // =========================
  // 1) Autorização: CRON ou USER
  // =========================
  const cronSecret = process.env.UNIGESTOR_CRON_SECRET;
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  let authedUserId: string | null = null;

  if (!isCron) {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    .select("id, tenant_id, client_id, reseller_id, whatsapp_session, message, send_at, created_by")
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

  // bloqueado (futuro) -> FAILED (não fica preso em SENDING)
  if (!isNaN(until.getTime()) && until > new Date()) {
    await sb
      .from("client_message_jobs")
      .update({
        status: "FAILED",
        error_message: `${recipientType === "reseller" ? "Revenda" : "Cliente"} em pausa até ${until.toISOString()}`,
      })
      .eq("id", job.id);
    continue;
  }

  // data inválida -> FAILED também
  if (isNaN(until.getTime())) {
    await sb
      .from("client_message_jobs")
      .update({
        status: "FAILED",
        error_message: `${recipientType === "reseller" ? "Revenda" : "Cliente"} em pausa (data inválida): ${String(wa.dont_message_until)}`,
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

// ✅ renderiza tags NA HORA DO ENVIO (CRON)
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

        processed++;
      } catch (e: any) {
        await sb
          .from("client_message_jobs")
          .update({
            status: "FAILED",
            error_message: e?.message || "Falha ao processar job",
          })
          .eq("id", job.id);
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
const sendAt = String((body as any).send_at || "").trim();

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

if (!tenantId || !message || !sendAt || !recipientType || !recipientId) {
  return NextResponse.json(
    { error: "tenant_id, message, send_at e (client_id OU reseller_id OU recipient_id+recipient_type) são obrigatórios" },
    { status: 400 }
  );
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
    const formatted = until.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

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
  send_at: sendAt,
  status: "SCHEDULED",
  whatsapp_session: (body as any).whatsapp_session ?? "default",
  created_by: authedUserId,
};

if (recipientType === "reseller") insertPayload.reseller_id = recipientId;
else insertPayload.client_id = recipientId;

const { error: insErr } = await sb.from("client_message_jobs").insert(insertPayload);
if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });


  return NextResponse.json({ ok: true });
}
