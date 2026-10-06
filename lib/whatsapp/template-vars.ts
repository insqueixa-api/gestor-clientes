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

// ✅ Tenta cada candidato NA ORDEM, normalizando um de cada vez, e só passa
// pro próximo se o atual não virar telefone válido — não escolher o primeiro
// valor truthy e SÓ DEPOIS normalizar. Achado em 12/08/2026: com
// `normalizeToPhone(a || b || c)`, um `whatsapp_username` que seja um
// username de verdade (WhatsApp está migrando pra permitir isso, ex:
// "insqueixa") é truthy e "vence" o `||` antes de qualquer normalização —
// vira string vazia depois de normalizado e NUNCA cai pro telefone real em
// `whatsapp_e164`/`phone_e164`, mesmo ele existindo. Com essa função, o
// campo de identidade pode ser um handle (usado só para exibição/variável de
// template) que o envio de verdade continua achando o telefone real.
function firstNormalizedPhone(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const phone = normalizeToPhone(candidate);
    if (phone) return phone;
  }
  return "";
}

// ✅ Sanitiza um valor pra usar como parte local de um e-mail sintético
// (ex: `${sanitizeEmailLocalPart(client.whatsapp_username)}@unigestor.net.br`,
// usado como comprador no Mercado Pago quando o cliente não tem e-mail
// cadastrado). Antes interpolava `whatsapp_username` direto — com um
// telefone (só dígitos) nunca dava problema, mas um username de verdade
// pode conter caracteres fora do alfabeto local-part de e-mail (ex: um "@"
// colado por engano), gerando um endereço com dois arrobas e syntax
// inválida pro gateway. Mantém só letras/dígitos/ponto/hífen/underscore
// (subconjunto seguro de RFC 5322), com fallback pra "cliente" se sobrar
// vazio.
export function sanitizeEmailLocalPart(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "");
  return cleaned || "cliente";
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

    // 📱 Aplicativo (renovação) — preenchido depois pela rota, quando o
    // caller (renovação de app) manda app_nome/app_vencimento no body
    // (achado 26/08/2026). Vazio por padrão pra nunca vazar {app_nome}
    // literal num template usado fora desse contexto.
    app_nome: "",
    app_vencimento: "",

    // 💰 Financeiro
    link_pagamento: "", // preenchido depois via generatePortalLink (precisa do contato específico)
    cupom_frase: "", // preenchido depois via getCouponPhraseForClient (precisa de query assíncrona)
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

  const phones: { number: string; username: string; is_secondary: boolean }[] = [];

  const phoneMain = firstNormalizedPhone(rowData.whatsapp_username, rowData.whatsapp_e164, rowData.phone_e164);
  if (phoneMain) {
    phones.push({
      number: phoneMain,
      username: String(rowData.whatsapp_username || phoneMain).trim(),
      is_secondary: false,
    });
  }

  const phoneSec = firstNormalizedPhone(rowData.secondary_whatsapp_username, rowData.secondary_phone_e164);
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
      // ✅ Mesmo fallback de fetchClientWhatsApp (linha ~289): sem isso, uma
      // revenda com telefone certo cadastrado mas sem o campo
      // whatsapp_username confirmado no formulário (ex: operador não clicou
      // no ✓), ou com um username de verdade em vez de telefone, ficava sem
      // nenhum destino de envio, mesmo com o telefone salvo corretamente em
      // whatsapp_e164/phone_e164.
      const phone = firstNormalizedPhone(
        (data as any).whatsapp_username,
        (data as any).whatsapp_e164,
        (data as any).phone_e164,
      );

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

    app_nome: "",
    app_vencimento: "",

    link_pagamento: "",
    cupom_frase: "", // cupons são um recurso do portal do cliente — revenda nunca preenche isso
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

// Mantém a checagem de servidor Elite (exclui o período Anual da tabela).
// Movida de lib/whatsapp/bot-engine.ts (removido junto com o bot de
// atendimento) — usada pela tag {tabela_precos} em envio_agora/envio_programado.
export async function toolConsultarPrecosTexto(sb: any, tenantId: string, client: any): Promise<string> {
  const PERIOD_LABELS: Record<string, string> = {
    MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral",
    SEMIANNUAL: "Semestral", ANNUAL: "Anual",
  };
  const ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

  let planTableId = client.plan_table_id;
  if (!planTableId) {
    const { data: def } = await sb
      .from("plan_tables").select("id")
      .eq("tenant_id", tenantId).eq("is_system_default", true)
      .eq("currency", client.price_currency || "BRL").eq("is_active", true)
      .maybeSingle();
    if (def) planTableId = def.id;
  }
  if (!planTableId) return "(tabela de preços não encontrada)";

  let isElite = false;
  if (client.server_id) {
    const { data: srv } = await sb.from("servers").select("panel_integration").eq("id", client.server_id).single();
    if (srv?.panel_integration) {
      const { data: integ } = await sb.from("server_integrations").select("provider").eq("id", srv.panel_integration).single();
      if (integ?.provider?.toUpperCase() === "ELITE") isElite = true;
    }
  }

  const { data: items } = await sb
    .from("plan_table_items")
    .select("period, plan_table_item_prices(screens_count, price_amount)")
    .eq("plan_table_id", planTableId);

  const screens = Number(client.screens || 1);
  const linhas = (items || [])
    .filter((item: any) => !isElite || item.period !== "ANNUAL")
    .map((item: any) => {
      let valor = 0;
      if (client.price_amount > 0 && PERIOD_LABELS[item.period] === client.plan_label) valor = client.price_amount;
      else {
        const exact = item.plan_table_item_prices?.find((p: any) => p.screens_count === screens);
        if (exact) valor = exact.price_amount;
      }
      return { periodo: PERIOD_LABELS[item.period] || item.period, valor, order: ORDER.indexOf(item.period) };
    })
    .filter((p: any) => p.valor > 0)
    .sort((a: any, b: any) => a.order - b.order)
    .map((p: any) => `- ${p.periodo}: ${client.price_currency || "BRL"} ${Number(p.valor).toFixed(2)}`);

  return linhas.length ? linhas.join("\n") : "(nenhum preço configurado)";
}

