import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Adiciona no topo junto com as outras funções
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
}

export const runtime = "nodejs";

function isInternal(req: Request) {
  const expected = String(process.env.INTERNAL_API_SECRET || "").trim();
  const received = String(req.headers.get("x-internal-secret") || "").trim();

  if (!expected || !received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

async function resolveTenantSenderUserId(sb: any, tenantId: string): Promise<string | null> {
  // 1) tenta owner (se existir coluna role)
  try {
    const { data: owner } = await sb
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .maybeSingle();

    if (owner?.user_id) return String(owner.user_id);
  } catch {
    // se não existir coluna role, cai pro fallback abaixo
  }

  // 2) fallback: primeiro membro do tenant
let first: any = null;

try {
  const { data } = await sb
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1);

  first = data;
} catch {
  const { data } = await sb
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .limit(1);

  first = data;
}

const u = Array.isArray(first) ? first[0]?.user_id : null;
return u ? String(u) : null;

}


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

async function fetchManualPaymentVars(sb: any, tenantId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {
    pix_manual_cnpj: "",
    pix_manual_cpf: "",
    pix_manual_email: "",
    pix_manual_phone: "",
    pix_manual_aleatoria: "",
    transfer_iban: "",
    transfer_swift: "",
  };

  // ✅ Busca tanto o PIX manual quanto a Transferência Internacional manual
  const { data, error } = await sb
    .from("payment_gateways")
    .select("type, priority, config, created_at")
    .eq("tenant_id", tenantId)
    .in("type", ["pix_manual", "transfer_manual"])
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  // 1) Trata os do tipo PIX
  const pixList = (data || [])
    .filter((r: any) => r.type === "pix_manual")
    .map((r: any) => ({
      pix_key_type: String(r?.config?.pix_key_type ?? "").trim().toLowerCase(),
      pix_key: String(r?.config?.pix_key ?? "").trim(),
    }));

  const pickPix = (t: string) => pixList.find((p: any) => p.pix_key_type === t && p.pix_key);

  out.pix_manual_cnpj = pickPix("cnpj")?.pix_key || "";
  out.pix_manual_cpf = pickPix("cpf")?.pix_key || "";
  out.pix_manual_email = pickPix("email")?.pix_key || "";
  out.pix_manual_phone = pickPix("phone")?.pix_key || "";
  out.pix_manual_aleatoria = pickPix("aleatoria")?.pix_key || pickPix("random")?.pix_key || "";

  // 2) Trata os do tipo Transferência Internacional
  const transferGateway = (data || []).find((r: any) => r.type === "transfer_manual");
  if (transferGateway && transferGateway.config) {
    out.transfer_iban = String(transferGateway.config.iban || "").trim();
    out.transfer_swift = String(transferGateway.config.swift_bic || "").trim();
  }

  return out;
}


function buildTemplateVars(params: { recipientType: "client" | "reseller"; recipientRow: any; isSecondary?: boolean }) {
  const now = new Date(); // Travado em SP
  const row = params.recipientRow || {};

// 1. DADOS BÁSICOS DINÂMICOS (Principal ou Secundário)
  // ✅ Adicionado fallback para 'display_name' (usado nas Revendas)
  const displayName = params.isSecondary
    ? String(row.secondary_display_name || "").trim()
    : String(row.display_name || row.client_name || row.name || "").trim();

  const primeiroNome = displayName.split(" ")[0] || "";

  const namePrefix = params.isSecondary
    ? String(row.secondary_name_prefix || "").trim()
    : String(row.name_prefix || row.saudacao || "").trim();
    
  const saudacao = namePrefix ? namePrefix : "";

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
  
  // Pega o telefone correto para o PIN inicial e link
  const rawPhone = params.isSecondary 
    ? (row.secondary_whatsapp_username || "") 
    : (row.whatsapp_username || row.whatsapp_e164 || "");
  const cleanPhone = normalizeToPhone(rawPhone);

// ✅ link_pagamento agora será /renew?t=TOKEN (gerado mais abaixo no POST)
// aqui fica apenas um placeholder seguro (evita quebrar se o token falhar)
const linkPagamento = "";


// 4. PREÇO (Mapeado exatamente de price_amount)
// ✅ agora envia só o valor (sem moeda), pois a moeda pode variar (BRL/USD/EUR)
const priceVal = row.price_amount ? Number(row.price_amount) : 0;
const valorFaturaStr = priceVal > 0 ? `${priceVal.toFixed(2).replace(".", ",")}` : "";


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
    observacoes: row.notes || "",
    data_cadastro: createdAt ? toBRDate(createdAt) : "",

    // 🖥️ Acesso e Servidor
    usuario_app: row.username || "",
    senha_app: row.server_password || "",
    plano_nome: row.plan_name || "",
    telas_qtd: String(row.screens || ""),
    tecnologia: row.technology || "",
    servidor_nome: row.servidor_nome || row.server_name || "", // ✅ ACEITA O NOME DO SERVIDOR INJETADO

    // 📅 Dados da Assinatura
    data_vencimento: dueAt ? toBRDate(dueAt) : "",
    hora_vencimento: dueAt ? toBRTime(dueAt) : "",
    dia_da_semana_venc: dueAt ? weekdayPtBR(dueAt) : "",

    // 🏢 Revenda 
    revenda_nome: row.reseller_name || row.display_name || row.name || "", // ✅ ROBUSTEZ NO NOME
    usuario_revenda: row.usuario_revenda || "", // ✅ NOVO
    revenda_site: row.reseller_panel_url || "",
    revenda_telegram: row.reseller_telegram || "",
    revenda_dns: row.reseller_dns || "",

    // 💰 Financeiro
    venda_creditos: row.venda_creditos != null ? String(row.venda_creditos) : "", // ✅ NOVO
    link_pagamento: linkPagamento,
    pin_cliente: cleanPhone && cleanPhone.length >= 4 ? cleanPhone.slice(-4) : "", 
    valor_fatura: valorFaturaStr,
    moeda_cliente: String(row.price_currency || "").trim(),
    pix_manual_cnpj: "",
    pix_manual_cpf: "",
    pix_manual_email: "",
    pix_manual_phone: "",
    pix_manual_aleatoria: "",
    transfer_iban: "",
    transfer_swift: "",

    // Legado
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
  let rowData: any = null;
  const tryViews = ["vw_clients_list_active", "vw_clients_list_archived"];

  for (const view of tryViews) {
    const { data } = await sb.from(view).select("*").eq("tenant_id", tenantId).eq("id", clientId).maybeSingle();
    if (data) {
      rowData = data;
      break;
    }
  }

  if (!rowData) throw new Error("Cliente não encontrado nas views");

  const phones = [];
  // ✅ Busca o número nas colunas alternativas (Testes rápidos salvam no e164)
  const phoneMain = normalizeToPhone(rowData.whatsapp_username || rowData.whatsapp_e164 || rowData.phone_e164);
  if (phoneMain) phones.push({ number: phoneMain, is_secondary: false });

  const phoneSec = normalizeToPhone(rowData.secondary_whatsapp_username || rowData.secondary_phone_e164);
  if (phoneSec) phones.push({ number: phoneSec, is_secondary: true });

  return {
    phones, 
    // ✅ Se for null (teste rápido), assume true para não travar o envio
    whatsapp_opt_in: rowData.whatsapp_opt_in !== false,
    dont_message_until: rowData.dont_message_until ?? null,
    row: rowData,
  };
}

async function fetchResellerWhatsApp(sb: any, tenantId: string, resellerId: string, resellerServerId?: string, creditsRecharged?: string) {
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
      
      // ✅ NOVO: Busca dados de servidor, usuário e créditos
      let serverQuery = sb.from("reseller_servers").select("server_username, last_recharge_credits, servers(name)").eq("tenant_id", tenantId).eq("reseller_id", resellerId);
      
      // Se enviou da recarga agorinha, busca exato o servidor da recarga. Se for envio avulso/manual, busca o último mexido.
      if (resellerServerId) {
          serverQuery = serverQuery.eq("id", resellerServerId);
      } else {
          serverQuery = serverQuery.order("updated_at", { ascending: false }).limit(1);
      }
      
      const { data: rsData } = await serverQuery.maybeSingle();

      if (rsData) {
        data.usuario_revenda = rsData.server_username;
        // Prioriza os créditos exatos que vieram da tela agorinha, se não tiver, pega o que ficou guardado no banco
        data.venda_creditos = creditsRecharged != null ? creditsRecharged : rsData.last_recharge_credits;
        data.servidor_nome = rsData.servers?.name;
      }

      return {
        phones: phone ? [{ number: phone, is_secondary: false }] : [],
        whatsapp_opt_in: (data as any).whatsapp_opt_in === true,
        dont_message_until: ((data as any).whatsapp_snooze_until as string | null) ?? null,
        row: data, 
      };
    }
  }

  if (lastErr) throw new Error(lastErr.message);
  throw new Error("Revenda não encontrada nas views de revenda");
}

export async function POST(req: Request) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!baseUrl || !waToken || !supabaseUrl || !serviceKey) {
    safeServerLog("[WA][send_now] Server misconfigured", {
      hasBaseUrl: !!baseUrl,
      hasWaToken: !!waToken,
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceKey: !!serviceKey,
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceKey);



// =========================
// 1) Autorização: INTERNAL ou USER
// =========================
const internal = isInternal(req);

// Se alguém mandou x-internal-secret mas está errado -> 401 direto
const hasInternalHeader = !!req.headers.get("x-internal-secret");
if (hasInternalHeader && !internal) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

let authedUserId = "";

// ✅ USER: exige Bearer
if (!internal) {
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

if (!tenantId || !message) {
  return NextResponse.json({ error: "tenant_id e message são obrigatórios" }, { status: 400 });
}

// ✅ INTERNAL: resolve um user_id real do tenant para gerar x-session-key válido
if (internal) {
  const senderUserId = await resolveTenantSenderUserId(sb, tenantId);
  authedUserId = senderUserId || "internal";
}




// =========================
// 3) Validação de membro do tenant (apenas USER)
// =========================
if (!internal) {
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



// =========================
// 4) Identificação do destino
// =========================

// ✅ aceita 3 formatos:
// 1) legado: client_id
// 2) novo: reseller_id
// 3) padrão: recipient_id + recipient_type

const rawClientId = String((body as any).client_id || "").trim();
  const rawResellerId = String((body as any).reseller_id || "").trim();
  const rawTestId = String((body as any).test_id || "").trim(); // ✅ Adicionado
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
    // ✅ Testes moram na view de clientes, então tratamos como client
    recipientType = "client";
    recipientId = rawTestId;
  }

if (!tenantId || !message || !recipientType || !recipientId) {
  return NextResponse.json(
    { error: "tenant_id, message e (client_id OU reseller_id OU recipient_id+recipient_type) são obrigatórios" },
    { status: 400 }
  );
}


  const rawResellerServerId = String((body as any).reseller_server_id || "").trim();
  const rawCredits = (body as any).credits_recharged != null ? String((body as any).credits_recharged) : undefined;

  // ✅ pega SEMPRE do destino certo (passando servidor e créditos se existirem)
  const wa =
    recipientType === "reseller"
      ? await fetchResellerWhatsApp(sb, tenantId, recipientId, rawResellerServerId, rawCredits)
      : await fetchClientWhatsApp(sb, tenantId, recipientId);

  // Validação 1: Conta sem números salvos
  if (!wa.phones || wa.phones.length === 0) {
    return NextResponse.json(
      { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} sem whatsapp_username` },
      { status: 400 }
    );
  }

  // Validação 2: Opt-in (Se for falso, BLOQUEIA TUDO para ambos, retorna 400)
  if (!wa.whatsapp_opt_in) {
    return NextResponse.json(
      { error: `${recipientType === "reseller" ? "Revenda" : "Cliente"} não permite receber mensagens` },
      { status: 400 }
    );
  }

  // Validação 3: Snooze (Se for verdadeiro, BLOQUEIA TUDO para ambos, retorna 409)
  if (wa.dont_message_until) {
    const until = new Date(wa.dont_message_until);

    if (isNaN(until.getTime())) {
      return NextResponse.json(
        { error: `Cliente não quer receber mensagens (data inválida): ${wa.dont_message_until}` },
        { status: 409 }
      );
    }

    if (until > new Date()) {
      const formatted = new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ_SP,
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(until);

      return NextResponse.json(
        { error: `Cliente não quer receber mensagens até: ${formatted}` },
        { status: 409 }
      );
    }
  }

  // ✅ NOVO: Lê a sessão requisitada do body e gera a chave correspondente
  const targetSession = String((body as any).whatsapp_session || "default");
  let sessionKey = "";
  
  if (targetSession === "session2") {
    sessionKey = crypto.createHash("sha256").update(`${tenantId}:${authedUserId}:2`).digest("hex");
  } else {
    sessionKey = makeSessionKey(tenantId, authedUserId);
  }

  safeServerLog("[WA][send_now]", {
    tenantId,
    recipientType,
    recipientId_suffix: recipientId ? recipientId.slice(-6) : null,
    authedUserId_prefix: authedUserId ? String(authedUserId).slice(0, 8) : null,
    total_contacts: wa.phones.length,
  });

  // Puxa as variáveis dos Gateways Manuais uma única vez para a conta
  let manualPaymentVars: Record<string, string> = {};
  try {
    manualPaymentVars = await fetchManualPaymentVars(sb, tenantId);
  } catch (e: any) {
    safeServerLog("[WA][send_now][manual_payments] falhou", e?.message ?? e);
  }

  const results = [];

  // ==========================================
  // LOOP DE DISPARO 
  // O cadastro passou nos bloqueios? Agora dispara para o(s) número(s) atrelado(s) a ele.
  // ==========================================
  for (const contact of wa.phones) {
    const vars = buildTemplateVars({
      recipientType,
      recipientRow: wa.row,
      isSecondary: contact.is_secondary,
    });
    Object.assign(vars, manualPaymentVars); // ✅ Injeta o PIX e o IBAN na mensagem final

    // ✅ 1. CORREÇÃO DO PIN: Tenta pegar o PIN real do banco (ignora os 4 últimos dígitos se a senha tiver sido alterada)
    try {
      const realPin = wa.row?.portal_pin; 
      if (realPin) {
        vars.pin_cliente = realPin;
      } else if (wa.row?.id) {
        // Busca de segurança direto na tabela caso a view não traga o portal_pin
        const { data: pinData } = await sb.from("clients").select("portal_pin").eq("id", wa.row.id).single();
        if (pinData?.portal_pin) {
          vars.pin_cliente = pinData.portal_pin;
        }
      }
    } catch(e) {}

    // ✅ 2. CORREÇÃO DO LINK: O "if (!internal)" foi REMOVIDO para gerar o link também nas automações/webhook!
    try {
      // Se for internal (automático), authedUserId é vazio, então mandamos explícito NULL para não dar erro de formato UUID no banco.
      const safeUserId = authedUserId ? authedUserId : null;
      const actionLabel = internal ? "Envio automático" : "Envio manual";

      const { data: tokData, error: tokErr } = await sb.rpc("portal_admin_create_token_for_whatsapp_v2", {
        p_tenant_id: tenantId,
        p_whatsapp_username: contact.number, 
        p_created_by: safeUserId, // Protegido contra string vazia
        p_label: contact.is_secondary ? `${actionLabel} Secundário` : actionLabel,
        p_expires_at: null,
      });

      if (!tokErr) {
        const rowTok = Array.isArray(tokData) ? tokData[0] : null;
        const portalToken = rowTok?.token ? String(rowTok.token) : "";
        
        safeServerLog("[PORTAL][token:v2]", { ok: true, hasToken: !!portalToken, token_suffix: portalToken ? portalToken.slice(-6) : null });

        if (portalToken) {
          const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://unigestor.net.br").replace(/\/+$/, "");
          vars.link_pagamento = `${appUrl}?#t=${encodeURIComponent(portalToken)}`;
        }
      } else {
        safeServerLog("[PORTAL][token:v2] erro rpc", tokErr.message);
      }
    } catch (e: any) {
      safeServerLog("[PORTAL][token:v2] falhou", e?.message ?? e);
    }

    const renderedMessage = renderTemplate(message, vars);

    try {
      const res = await fetch(`${baseUrl}/send`, {
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
        }),
      });

      const raw = await res.text();
      let parsed: any = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch {}

      if (!res.ok) {
        safeServerLog("[WA][vm_send] http_error", { status: res.status, to_suffix: contact.number.slice(-4) });
        results.push({ phone: contact.number, error: raw || "Falha ao enviar", status: 502 });
      } else if ((parsed && (parsed.ok === false || !!parsed.error)) || /not\s*connected|disconnected|qr|invalid|blocked|logout|session/i.test(String(raw || ""))) {
        safeServerLog("[WA][vm_send] logical_error", { to_suffix: contact.number.slice(-4) });
        results.push({ phone: contact.number, error: "Falha ao enviar (WA backend)", status: 502 });
      } else {
        safeServerLog("[WA][vm_send] ok", { to_suffix: contact.number.slice(-4), wa_id: parsed?.id ?? parsed?.messageId ?? parsed?.msg_id ?? null });
        results.push({ phone: contact.number, ok: true, status: 200 });
      }
    } catch (err: any) {
      results.push({ phone: contact.number, error: err?.message, status: 500 });
    }
  }

  // Mantendo o mesmo padrão de erro 502 global se todos os números falharam
  const allFailed = results.length > 0 && results.every(r => r.status !== 200);
  if (allFailed) {
    return NextResponse.json({ error: "Falha ao enviar" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    recipient_type: recipientType,
    recipient_id: recipientId,
    disparos: results,
  });
}