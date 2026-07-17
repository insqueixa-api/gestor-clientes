//lib/whatsapp/template-vars.ts

// ============================================================
// Módulo único de variáveis de template para WhatsApp — CLIENTE
// Usado por: envio_agora, envio agendado (cron) e o bot de atendimento.
// ⚠️ Não contém nada de revenda — isso fica nas rotas que ainda precisam.
// ============================================================

const TZ_SP = "America/Sao_Paulo";

// ── Datas/hora (sempre travado em SP, independente do timezone do servidor) ──

export function getSPParts(d: Date) {
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

export function toBRDate(d: Date) {
  const p = getSPParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

export function toBRTime(d: Date) {
  const p = getSPParts(d);
  return `${p.hour}:${p.minute}`;
}

export function weekdayPtBR(d: Date) {
  const s = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ_SP, weekday: "long" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function saudacaoTempo(d: Date) {
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

/** Diferença inteira de dias (a - b), baseada no "dia" de SP, não UTC. */
export function diffDays(a: Date, b: Date) {
  const aKey = spDayKey(a);
  const bKey = spDayKey(b);
  const aUtc = new Date(`${aKey}T00:00:00.000Z`);
  const bUtc = new Date(`${bKey}T00:00:00.000Z`);
  const ms = aUtc.getTime() - bUtc.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function safeDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// ── Telefone ──

export function normalizeToPhone(usernameRaw: unknown): string {
  const s = String(usernameRaw ?? "").trim();
  return s.replace(/[^\d]/g, "");
}

// ── DNS do servidor ──
// ✅ Sorteia uma DNS entre as cadastradas no servidor, evitando a primeira
// sempre que houver alternativa — a primeira só é usada em último caso
// (quando é a única cadastrada).
export function pickRandomDns(dnsList: string[] | null | undefined): string {
  const valid = (dnsList || []).map((d) => String(d || "").trim()).filter(Boolean);
  if (!valid.length) return "";
  if (valid.length === 1) return valid[0];
  const idx = 1 + Math.floor(Math.random() * (valid.length - 1));
  return valid[idx];
}

function safeUuidOrNull(v: unknown): string | null {
  const s = String(v || "").trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  return isUuid ? s : null;
}

// ── Motor de template ({variavel} → valor) ──

export function renderTemplate(text: string, vars: Record<string, string>) {
  if (!text) return "";
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    const k = String(key || "").trim();
    if (!k) return full;
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : full; // desconhecida: mantém {literal}
  });
}

// ── Figurinha de app ({NomeDoApp+logo}) ──────────────────────────────────
// ✅ Token dedicado, separado do renderTemplate normal de propósito: o "+"
// não é aceito pela regex de variável comum (`[a-zA-Z0-9_]+`), então os dois
// mecanismos nunca colidem. Usado pra deixar o painel de variáveis 100%
// dinâmico — cada app cadastrado em `apps` vira automaticamente um token
// clicável, sem precisar mexer em código quando um app novo é cadastrado.
export function slugifyAppName(name: string): string {
  return String(name || "")
    .normalize("NFD")
    .replace(new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g"), "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

const APP_LOGO_TOKEN_RE = /\{([A-Za-z0-9_]+)\+logo\}/g;

/**
 * Encontra tokens {NomeDoApp+logo} no texto, troca cada um pelo nome real do
 * app (texto continua legível) e devolve a lista de imagens (logo + nome)
 * pra enviar em seguida, na ordem em que apareceram. Token que não bate com
 * nenhum app cadastrado (nome errado, app removido) fica como está — melhor
 * mostrar o texto cru do que quebrar a mensagem inteira.
 */
export function extractAppLogoTokens(
  text: string,
  apps: { name: string; icon_url: string | null }[]
): { cleanText: string; images: { name: string; url: string }[] } {
  const matches = [...text.matchAll(APP_LOGO_TOKEN_RE)];
  if (!matches.length) return { cleanText: text, images: [] };

  const bySlug = new Map<string, { name: string; icon_url: string }>();
  for (const a of apps) {
    if (a.icon_url) bySlug.set(slugifyAppName(a.name).toLowerCase(), { name: a.name, icon_url: a.icon_url });
  }

  const images: { name: string; url: string }[] = [];
  let cleanText = text;
  for (const m of matches) {
    const app = bySlug.get(m[1].toLowerCase());
    if (app) {
      images.push({ name: app.name, url: app.icon_url });
      cleanText = cleanText.replace(m[0], app.name);
    }
  }
  return { cleanText, images };
}

// ── Variáveis do cliente ──

export function buildClientTemplateVars(params: { clientRow: any; isSecondary?: boolean }): Record<string, string> {
  const now = new Date();
  const row = params.clientRow || {};

  let displayName = "";
  let namePrefix = "";

  if (params.isSecondary) {
    displayName = String(row.secondary_display_name || row.secondary_first_name || "").trim();
    namePrefix = String(row.secondary_name_prefix || "").trim();
  } else {
    displayName = String(row.display_name || row.client_name || row.first_name || row.name || "").trim();
    namePrefix = String(row.name_prefix || row.saudacao || "").trim();
  }

  const primeiroNome = displayName.split(" ")[0] || "";
  const saudacao = namePrefix || "";

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

  const priceVal = row.price_amount ? Number(row.price_amount) : 0;
  const valorFaturaStr = priceVal > 0 ? `${priceVal.toFixed(2).replace(".", ",")}` : "";

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
    saudacao,
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
    servidor_nome: row.servidor_nome || row.server_name || "",

// 📅 Dados da Assinatura
    data_vencimento: dueAt ? toBRDate(dueAt) : "",
    hora_vencimento: dueAt ? toBRTime(dueAt) : "",
    dia_da_semana_venc: dueAt ? weekdayPtBR(dueAt) : "",

    // 🏢 Revenda (necessário para templates do cliente que citam a revenda dele)
    revenda_nome: row.reseller_name || row.display_name || row.name || "",
    usuario_revenda: row.usuario_revenda || "",
    revenda_site: row.reseller_panel_url || "",
    revenda_telegram: row.reseller_telegram || "",
    revenda_dns: row.reseller_dns || "",
    venda_creditos: row.venda_creditos != null ? String(row.venda_creditos) : "",

    // 💰 Financeiro
    link_pagamento: "", // preenchido depois via generatePortalLink (precisa do contato específico)
    valor_fatura: valorFaturaStr,
    moeda_cliente: String(row.price_currency || row.currency || "").trim(),
    pix_copia_cola: row.pix_code || "",
    pix_manual_cnpj: "",
    pix_manual_cpf: "",
    pix_manual_email: "",
    pix_manual_phone: "",
    pix_manual_aleatoria: "",
    transfer_iban: "",
    transfer_swift: "",
    chave_pix_manual: "",

    // Legado
    nome: displayName,
    tipo_destino: "client",
  };
}

// ── Busca cliente + telefones + opt-in/snooze ──

export async function fetchClientWhatsApp(sb: any, tenantId: string, clientId: string) {
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

  // ✅ Garante o PIN real (algumas views podem não trazer portal_pin)
  if (!rowData.portal_pin) {
    try {
      const { data: pinData } = await sb.from("clients").select("portal_pin").eq("id", rowData.id).maybeSingle();
      if (pinData?.portal_pin) rowData.portal_pin = pinData.portal_pin;
    } catch {
      // sem problema — buildClientTemplateVars cai no fallback automaticamente
    }
  }

  const phones: { number: string; username: string; is_secondary: boolean }[] = [];

  const phoneMain = normalizeToPhone(rowData.whatsapp_username || rowData.whatsapp_e164 || rowData.phone_e164);
  if (phoneMain) {
    phones.push({
      number: phoneMain,
      username: String(rowData.whatsapp_username || phoneMain).trim(),
      is_secondary: false,
    });
  }

  const phoneSec = normalizeToPhone(rowData.secondary_whatsapp_username || rowData.secondary_phone_e164);
  if (phoneSec) {
    phones.push({
      number: phoneSec,
      username: String(rowData.secondary_whatsapp_username || phoneSec).trim(),
      is_secondary: true,
    });
  }

  return {
    phones,
    whatsapp_opt_in: rowData.whatsapp_opt_in !== false,
    dont_message_until: rowData.dont_message_until ?? null,
    row: rowData,
  };
}

// ── Chaves PIX / dados de transferência manual (config do tenant) ──

export async function fetchManualPaymentVars(sb: any, tenantId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {
    pix_manual_cnpj: "",
    pix_manual_cpf: "",
    pix_manual_email: "",
    pix_manual_phone: "",
    pix_manual_aleatoria: "",
    transfer_iban: "",
    transfer_swift: "",
    chave_pix_manual: "",
  };

  const { data, error } = await sb
    .from("payment_gateways")
    .select("type, priority, config, created_at")
    .eq("tenant_id", tenantId)
    .in("type", ["pix_manual", "transfer_manual"])
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

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

  // Compat legado: primeira chave PIX válida que encontrar
  out.chave_pix_manual =
    out.pix_manual_cnpj || out.pix_manual_cpf || out.pix_manual_email || out.pix_manual_phone || out.pix_manual_aleatoria || "";

  const transferGateway = (data || []).find((r: any) => r.type === "transfer_manual");
  if (transferGateway && transferGateway.config) {
    out.transfer_iban = String(transferGateway.config.iban || "").trim();
    out.transfer_swift = String(transferGateway.config.swift_bic || "").trim();
  }

  return out;
}

// ── Link de pagamento (gera token de portal + monta a URL final) ──
// 🔴 CRÍTICO: este é o link de acesso ao portal do cliente. Qualquer alteração aqui
// precisa preservar exatamente o comportamento de log e fallback do original.

export async function generatePortalLink(
  sb: any,
  params: {
    tenantId: string;
    contact: { number: string; username?: string; is_secondary?: boolean };
    createdBy?: string | null;
    label: string;
    expiresAt?: string | null; // ISO string, ou null para sem expiração
    onLog?: (...args: any[]) => void; // a rota injeta o safeServerLog dela aqui
  }
): Promise<string> {
  const log = params.onLog || (() => {});
  if (!params.contact?.number) return "";

  try {
    const { data: tokData, error: tokErr } = await sb.rpc("portal_admin_create_token_for_whatsapp_v2", {
      p_tenant_id: params.tenantId,
      p_whatsapp_username: params.contact.username || params.contact.number,
      p_created_by: safeUuidOrNull(params.createdBy),
      p_label: params.label,
      p_expires_at: params.expiresAt ?? null,
    });

    if (!tokErr) {
      const rowTok = Array.isArray(tokData) ? tokData[0] : null;
      const portalToken = rowTok?.token ? String(rowTok.token) : "";

      log("[PORTAL][token:v2]", { ok: true, hasToken: !!portalToken, token_suffix: portalToken ? portalToken.slice(-6) : null });

      if (portalToken) {
        const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://unigestor.net.br").replace(/\/+$/, "");
        return `${appUrl}/#t=${encodeURIComponent(portalToken)}`;
      }
      return "";
    } else {
      log("[PORTAL][token:v2] erro rpc", tokErr.message);
      return "";
    }
  } catch (e: any) {
    log("[PORTAL][token:v2] falhou", e?.message ?? e);
    return "";
  }
}

// ── Busca revenda + telefone + opt-in/snooze ──

export async function fetchResellerWhatsApp(
  sb: any,
  tenantId: string,
  resellerId: string,
  resellerServerId?: string,
  creditsRecharged?: string
) {
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

      let serverQuery = sb
        .from("reseller_servers")
        .select("id, server_username, last_recharge_credits, servers(name)")
        .eq("tenant_id", tenantId)
        .eq("reseller_id", resellerId);

      if (resellerServerId) {
        serverQuery = serverQuery.eq("id", resellerServerId);
      } else {
        serverQuery = serverQuery.order("created_at", { ascending: false }).limit(1);
      }

      const { data: rsData } = await serverQuery.maybeSingle();

      if (rsData) {
        data.usuario_revenda = rsData.server_username;
        data.servidor_nome = rsData.servers?.name;

        if (creditsRecharged != null) {
          data.venda_creditos = creditsRecharged;
        } else {
          const { data: lastSale } = await sb
            .from("server_credit_sales")
            .select("credits_sold")
            .eq("tenant_id", tenantId)
            .eq("reseller_server_id", rsData.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          data.venda_creditos = lastSale?.credits_sold ?? rsData.last_recharge_credits ?? "";
        }
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

// ── Variáveis da revenda ──
// Mantém EXATAMENTE o mesmo conjunto de chaves que buildClientTemplateVars,
// pra um template nunca quebrar se alguém usar a variável errada por engano.

export function buildResellerTemplateVars(params: { resellerRow: any }): Record<string, string> {
  const now = new Date();
  const row = params.resellerRow || {};

  const displayName = String(row.display_name || row.client_name || row.first_name || row.name || "").trim();
  const namePrefix = String(row.name_prefix || row.saudacao || "").trim();
  const primeiroNome = displayName.split(" ")[0] || "";

  const createdAt = safeDate(row.created_at);
  const dueAt = safeDate(row.vencimento); // revenda normalmente não tem — fica vazio
  const daysSinceCadastro = createdAt ? Math.max(0, diffDays(now, createdAt)) : 0;

  let diasParaVencimento = "0";
  let diasAtraso = "0";
  if (dueAt) {
    const d = diffDays(dueAt, now);
    if (d >= 0) diasParaVencimento = String(d);
    else diasAtraso = String(Math.abs(d));
  }

  const priceVal = row.price_amount ? Number(row.price_amount) : 0;
  const valorFaturaStr = priceVal > 0 ? `${priceVal.toFixed(2).replace(".", ",")}` : "";

  return {
    saudacao_tempo: saudacaoTempo(now),
    dias_desde_cadastro: String(daysSinceCadastro),
    dias_para_vencimento: diasParaVencimento,
    dias_atraso: diasAtraso,
    hoje_data: toBRDate(now),
    hoje_dia_semana: weekdayPtBR(now),
    hora_agora: toBRTime(now),

    saudacao: namePrefix,
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
    servidor_nome: row.servidor_nome || row.server_name || "",

    data_vencimento: dueAt ? toBRDate(dueAt) : "",
    hora_vencimento: dueAt ? toBRTime(dueAt) : "",
    dia_da_semana_venc: dueAt ? weekdayPtBR(dueAt) : "",

    // 🏢 Revenda
    revenda_nome: row.reseller_name || row.display_name || row.name || "",
    usuario_revenda: row.usuario_revenda || "",
    revenda_site: row.reseller_panel_url || "",
    revenda_telegram: row.reseller_telegram || "",
    revenda_dns: row.reseller_dns || "",
    venda_creditos: row.venda_creditos != null ? String(row.venda_creditos) : "",

    link_pagamento: "",
    valor_fatura: valorFaturaStr,
    moeda_cliente: String(row.price_currency || "").trim(),
    pix_copia_cola: row.pix_code || "",
    pix_manual_cnpj: "",
    pix_manual_cpf: "",
    pix_manual_email: "",
    pix_manual_phone: "",
    pix_manual_aleatoria: "",
    transfer_iban: "",
    transfer_swift: "",
    chave_pix_manual: "",

    nome: displayName,
    tipo_destino: "reseller",
  };
}

