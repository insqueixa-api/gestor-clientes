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
  // "Sexta-feira" (primeira maiúscula)
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
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : full; // desconhecida: mantém
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

// ✅ link_pagamento agora será /renew?t=TOKEN (gerado mais abaixo no POST)
// aqui fica apenas um placeholder seguro (evita quebrar se o token falhar)
const linkPagamento = "";


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
pin_cliente: cleanPhone && cleanPhone.length >= 4 ? cleanPhone.slice(-4) : "", // ✅ PIN inicial padrão
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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

  {
  const { data: mem, error: memErr } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", authedUserId)
    .maybeSingle();

  if (memErr || !mem) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

// client "do usuário" (usa o Bearer token) para RPCs que dependem de auth.uid()
const userSb = createClient(supabaseUrl, anonKey, {
  global: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});


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

  // ✅ monta variáveis e renderiza o texto (agora tudo em SP)
const vars = buildTemplateVars({
  recipientType,
  recipientRow: wa.row,
});

// ✅ Gera/reutiliza token do portal (precisa ser chamado como USER por causa do auth.uid())
try {
  // importante: muitas vezes seu "whatsapp_username" é telefone -> normalize evita mismatch no RPC
  const whatsappUsernameRaw = String((wa.row as any)?.whatsapp_username ?? "").trim();
  const whatsappUsername = normalizeToPhone(whatsappUsernameRaw); // ✅

  if (whatsappUsername) {
    const { data: tokData, error: tokErr } = await userSb.rpc("portal_admin_create_token_for_whatsapp", {
      p_tenant_id: tenantId,
      p_whatsapp_username: whatsappUsername,
      p_label: "Envio manual",
      p_expires_at: null,
    });

    console.log("[PORTAL][token]", {
      tokErr: tokErr?.message ?? null,
      tokDataType: typeof tokData,
      tokData,
      whatsappUsername,
      tenantId,
      authedUserId,
    });

    if (tokErr) {
      // agora você enxerga o erro no log
      throw new Error(tokErr.message);
    }

    let portalToken = "";

    // ✅ aceita string
    if (typeof tokData === "string") {
      portalToken = tokData;
    }
    // ✅ aceita objeto { token: "..." }
    else if (tokData && typeof tokData === "object" && !Array.isArray(tokData) && (tokData as any).token) {
      portalToken = String((tokData as any).token);
    }
    // ✅ aceita array [{ token: "..." }]
    else if (Array.isArray(tokData) && tokData[0]?.token) {
      portalToken = String(tokData[0].token);
    }

    if (portalToken) {
      vars.link_pagamento = `https://unigestor.net.br/renew?t=${encodeURIComponent(portalToken)}`;
    } else {
      console.log("[PORTAL][token] retorno sem token parseável");
    }
  } else {
    console.log("[PORTAL][token] whatsapp_username vazio no destino");
  }
} catch (e: any) {
  console.log("[PORTAL][token] falhou", e?.message ?? e);
  // mantém vars.link_pagamento vazio (mas agora você sabe o porquê no log)
}


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
