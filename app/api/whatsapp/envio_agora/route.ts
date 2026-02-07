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
  // Ex: "sexta-feira"
  const s = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(d);
  // "Sexta-feira" (primeira maiúscula)
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function saudacaoTempo(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function diffDays(a: Date, b: Date) {
  // diferença inteira de dias (a - b)
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
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : full; // desconhecida: mantém
  });
}

function buildTemplateVars(params: { recipientType: "client" | "reseller"; recipientRow: any }) {
  const now = new Date();

  const row = params.recipientRow || {};

  // nomes possíveis (cliente e revenda podem variar)
  const displayName =
    String(row.display_name ?? row.name ?? row.full_name ?? row.nome ?? "").trim();

  const namePrefix =
    String(row.name_prefix ?? row.saudacao ?? "").trim(); // se existir no seu schema

  // datas possíveis
  const createdAt = safeDate(row.created_at ?? row.createdAt);
  const dueAt = safeDate(row.vencimento ?? row.due_at ?? row.due_date ?? row.expire_at ?? row.expires_at);

  const daysSinceCadastro =
    createdAt ? Math.max(0, diffDays(now, createdAt)) : "";

  let diasParaVencimento = "";
  let diasAtraso = "";

  if (dueAt) {
    const d = diffDays(dueAt, now); // vencimento - agora
    if (d >= 0) {
      diasParaVencimento = String(d);
      diasAtraso = "0";
    } else {
      diasParaVencimento = "0";
      diasAtraso = String(Math.abs(d));
    }
  }

  // saudacao (do print você quer algo tipo "Sr., Sra.")
  const saudacao =
    namePrefix ||
    (displayName ? displayName : "");

  return {
    // ✅ Automação inteligente & prazos
    hora_agora: toBRTime(now),
    hoje_data: toBRDate(now),
    hoje_dia_semana: weekdayPtBR(now),
    saudacao_tempo: saudacaoTempo(now),

    dias_desde_cadastro: daysSinceCadastro === "" ? "" : String(daysSinceCadastro),
    dias_para_vencimento: diasParaVencimento,
    dias_atraso: diasAtraso,

    // ✅ Dados do cliente (você pode expandir depois)
    saudacao: saudacao,

    // extras úteis (se quiser usar)
    nome: displayName,
    tipo_destino: params.recipientType, // "client" | "reseller"
  };
}


function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

type SendNowBody = {
  tenant_id: string;

  // ✅ compat legado (cliente)
  client_id?: string;

  // ✅ novo (revenda)
  reseller_id?: string;

  // ✅ opcional (futuro/padrão)
  recipient_id?: string;
  recipient_type?: "client" | "reseller";

  message: string;
  whatsapp_session?: string | null; // mantido
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

  const phone = normalizeToPhone((data as any).whatsapp_username);

  return {
    phone,
    whatsapp_opt_in: (data as any).whatsapp_opt_in === true,
    dont_message_until: ((data as any).dont_message_until as string | null) ?? null,
    row: data, // ✅ para variáveis
  };
}


async function fetchResellerWhatsApp(sb: any, tenantId: string, resellerId: string) {
  const tryViews = ["vw_resellers_list_active", "vw_resellers_list_archived"];
  let lastErr: any = null;

  for (const view of tryViews) {
    const { data, error } = await sb
      .from(view)
      .select("*") // ✅ precisa da linha pra tags (wa.row)
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
  // 1) Autorização: USER
  // =========================
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authedUserId = data.user.id;

  // =========================
  // 2) Body
  // =========================
  let body: SendNowBody;
  try {
    body = (await req.json()) as SendNowBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String((body as any).tenant_id || "").trim();
const message = String((body as any).message || "").trim();

// ✅ aceita 3 formatos:
// 1) legado: client_id
// 2) novo: reseller_id
// 3) padrão: recipient_id + recipient_type
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

if (!tenantId || !message || !recipientType || !recipientId) {
  return NextResponse.json(
    { error: "tenant_id, message e (client_id OU reseller_id OU recipient_id+recipient_type) são obrigatórios" },
    { status: 400 }
  );
}

// ✅ pega SEMPRE do destino certo
const wa =
  recipientType === "reseller"
    ? await fetchResellerWhatsApp(sb, tenantId, recipientId)
    : await fetchClientWhatsApp(sb, tenantId, recipientId);


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

    // Se a data for inválida, bloqueia mesmo assim (melhor do que deixar passar lixo)
    if (isNaN(until.getTime())) {
      return NextResponse.json(
        { error: `Cliente não quer receber mensagens (data inválida): ${wa.dont_message_until}` },
        { status: 409 }
      );
    }

    // Só bloqueia se a pausa estiver no FUTURO
    if (until > new Date()) {
      const formatted = until.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      return NextResponse.json(
        { error: `Cliente não quer receber mensagens até: ${formatted}` },
        { status: 409 }
      );
    }
  }

  // ✅ sessionKey é do usuário logado (não influencia destino)
  const sessionKey = makeSessionKey(tenantId, authedUserId);

  // ✅ LOG (ajuste sugerido)
console.log("[WA][send_now]", {
  tenantId,
  recipientType,
  recipientId,
  to: wa.phone,
  authedUserId,
});


// ✅ monta variáveis e renderiza o texto
const vars = buildTemplateVars({
  recipientType,        // "client" | "reseller"
  recipientRow: wa.row, // linha completa que buscamos na view
});

const renderedMessage = renderTemplate(message, vars);

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
    return NextResponse.json({ error: raw || "Falha ao enviar" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, to: wa.phone, recipient_type: recipientType, recipient_id: recipientId });

}
