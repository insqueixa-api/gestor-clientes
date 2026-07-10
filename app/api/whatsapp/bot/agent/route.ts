// app/api/whatsapp/bot/agent/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { generatePortalLink } from "@/lib/whatsapp/template-vars";
// 🟢 Importando a Fonte Única de Verdade (Regras e Ferramentas unificadas)
import { BOT_TOOL_DECLARATIONS, buildBotSystemPrompt, toBRDateTime } from "@/lib/whatsapp/bot-prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: máx 60s (agente pode demorar com tool calls)

// ── Helpers internos ──────────────────────────────────────────────────────────

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.log(...args);
}

function isInternalAuth(req: Request): boolean {
  const secret = String(process.env.UNIGESTOR_BOT_INTERNAL_SECRET || "").trim();
  const provided = String(req.headers.get("x-internal-secret") || "").trim();
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Gemini API ────────────────────────────────────────────────────────────────

// Usa a tag -latest para garantir que a API v1beta encontre o modelo
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini(apiKey: string, payload: any): Promise<any> {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

// ── Envio de resposta via WA service ─────────────────────────────────────────

async function sendWAMessage(sessionKey: string, phone: string, message: string) {
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (!baseUrl || !waToken) {
    safeLog("[BOT][agent] WA env vars ausentes");
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${baseUrl}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${waToken}`,
        "x-session-key": sessionKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, message }),
      signal: controller.signal,
    });
    if (!res.ok) {
      safeLog("[BOT][agent] Erro ao enviar WA:", res.status, await res.text().catch(() => ""));
    }
  } catch (e: any) {
    safeLog("[BOT][agent] Timeout/erro ao enviar WA:", e?.message);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Implementações das ferramentas (Lógica de Negócio do Backend) ─────────────

async function toolGerarLinkPortal(
  sb: any,
  tenantId: string,
  rawClient: any,
  isSecondary: boolean
): Promise<string> {
  const phone = isSecondary
    ? rawClient.secondary_whatsapp_username
    : rawClient.whatsapp_username;
  if (!phone) return "";
  return generatePortalLink(sb, {
    tenantId,
    contact: { number: phone, username: phone, is_secondary: isSecondary },
    createdBy: null,
    label: "Bot de atendimento",
    expiresAt: null,
    onLog: safeLog,
  });
}

async function toolConsultarPrecos(
  sb: any,
  tenantId: string,
  client: any
): Promise<any> {
  const PERIOD_LABELS: Record<string, string> = {
    MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral",
    SEMIANNUAL: "Semestral", ANNUAL: "Anual",
  };
  const ORDER = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];

  // Resolve plan_table_id
  let planTableId = client.plan_table_id;
  if (!planTableId) {
    const { data: def } = await sb
      .from("plan_tables")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_system_default", true)
      .eq("currency", client.price_currency || "BRL")
      .eq("is_active", true)
      .maybeSingle();
    if (def) planTableId = def.id;
  }
  if (!planTableId) return { error: "Tabela de preços não encontrada" };

  // Verifica se é Elite (sem ANNUAL)
  let isElite = false;
  if (client.server_id) {
    const { data: srv } = await sb
      .from("servers").select("panel_integration").eq("id", client.server_id).single();
    if (srv?.panel_integration) {
      const { data: integ } = await sb
        .from("server_integrations").select("provider").eq("id", srv.panel_integration).single();
      if (integ?.provider?.toUpperCase() === "ELITE") isElite = true;
    }
  }

  const { data: items } = await sb
    .from("plan_table_items")
    .select("period, plan_table_item_prices(screens_count, price_amount)")
    .eq("plan_table_id", planTableId);

  const screens = Number(client.screens || 1);

  // Preços da configuração atual
  const precoAtual = (items || [])
    .filter((item: any) => !isElite || item.period !== "ANNUAL")
    .map((item: any) => {
      // Override: aplica só quando é o mesmo período E mesmas telas do plano atual
      let valor = 0;
      if (
        client.price_amount > 0 &&
        PERIOD_LABELS[item.period] === client.plan_label
      ) {
        valor = client.price_amount;
      } else {
        const exact = item.plan_table_item_prices?.find(
          (p: any) => p.screens_count === screens
        );
        if (exact) valor = exact.price_amount;
      }
      return { periodo: PERIOD_LABELS[item.period] || item.period, valor };
    })
    .filter((p: any) => p.valor > 0)
    .sort((a: any, b: any) => ORDER.indexOf(a.period) - ORDER.indexOf(b.period));

  // Preços com +1 tela — SEMPRE da tabela, nunca override (é hipotético)
  const precoTelasExtra = (items || [])
    .filter((item: any) => !isElite || item.period !== "ANNUAL")
    .map((item: any) => {
      const extra = item.plan_table_item_prices?.find(
        (p: any) => p.screens_count === screens + 1
      );
      return {
        periodo: PERIOD_LABELS[item.period] || item.period,
        valor: extra?.price_amount || 0,
        telas: screens + 1,
      };
    })
    .filter((p: any) => p.valor > 0)
    .sort((a: any, b: any) => ORDER.indexOf(a.period) - ORDER.indexOf(b.period));

  return {
    moeda: client.price_currency || "BRL",
    telas_atuais: screens,
    precos_configuracao_atual: precoAtual,
    precos_com_tela_extra: precoTelasExtra,
    observacao: "precos_com_tela_extra são hipotéticos — não aplica override do cliente",
  };
}

async function toolVerificarCloudflare(): Promise<any> {
  try {
    const res = await fetch("https://www.cloudflarestatus.com/api/v2/status.json", {
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json();
    return {
      operacional: data?.status?.indicator === "none",
      indicator: data?.status?.indicator || "unknown",
      descricao: data?.status?.description || "",
    };
  } catch {
    // Se não conseguiu checar, assume operacional (não alarmar o cliente à toa)
    return { operacional: true, indicator: "unknown", descricao: "Não foi possível verificar" };
  }
}

async function toolRecomendarApplicativo(
  sb: any,
  tenantId: string,
  serverId: string | null
): Promise<any> {
  const { data: apps } = await sb
    .from("apps")
    .select("name, cost_type, partner_server_id, license_price, license_period")
    .eq("tenant_id", tenantId)
    .eq("is_hidden", false);

  if (!apps) return { apps_parceiros: [], apps_gratis: [], apps_pagos: [] };

  const parceiros = (apps as any[])
    .filter((a) => a.cost_type === "partnership" && a.partner_server_id === serverId)
    .map((a) => ({ nome: a.name }));

  const gratis = (apps as any[])
    .filter((a) => a.cost_type === "free" && !a.partner_server_id)
    .map((a) => ({ nome: a.name }));

  const pagos = (apps as any[])
    .filter((a) => a.cost_type === "paid" && !a.partner_server_id)
    .map((a) => ({
      nome: a.name,
      valor: a.license_price
        ? `R$ ${Number(a.license_price).toFixed(2).replace(".", ",")}`
        : null,
      periodo: a.license_period === "annual"
        ? "anuidade"
        : a.license_period === "lifetime"
        ? "vitalício"
        : null,
    }));

  return { apps_parceiros_do_servidor: parceiros, apps_universais_gratis: gratis, apps_universais_pagos: pagos };
}

// ── RAG: Gerar embedding e buscar conhecimento relevante ─────────────────────

async function generateEmbedding(apiKey: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding?.values ?? null;
  } catch {
    return null;
  }
}



async function searchBotKnowledge(
  sb: any,
  tenantId: string,
  embedding: number[],
  limit = 5
): Promise<string> {
  try {
    const { data, error } = await sb.rpc("search_bot_knowledge", {
      p_tenant_id: tenantId,
      p_embedding: `[${embedding.join(",")}]`,
      p_limit: limit,
      p_threshold: 0.5,
    });

    if (error || !data?.length) return "(nenhum conhecimento relevante encontrado)";

    return data
      .map((row: any) => `### [${row.category}] ${row.title}\n${row.content}`)
      .join("\n\n---\n\n");
  } catch {
    return "(erro ao buscar base de conhecimento)";
  }
}

// ── Item 5: classificação de mensagens automáticas recentes ──────────────────
// O bot "lê o sistema" antes de decidir: descobre se o cliente está
// respondendo a algo que VOCÊ (ou o sistema) já mandou, e reage de forma
// determinística — sem depender do Gemini interpretar o contexto sozinho.

type RecentJobKind =
  | "payment_confirmation"
  | "vencimento"
  | "pos_venda_satisfacao"
  | "pos_venda_fidelidade"
  | "pos_venda_generico"
  | "none";

function classifyRecentJob(job: any, templateInfo: { name?: string; category?: string } | null): RecentJobKind {
  if (!job) return "none";

  const templateName = String(templateInfo?.name || "");
  const automationType = job.billing_automations?.type || null;
  const automationName = String(job.billing_automations?.name || "");

  // Disparado por evento (pagamento confirmado), sem automation_id
  if (!job.automation_id && templateName === "Pagamento Realizado") {
    return "payment_confirmation";
  }
  if (automationType === "Vencimento") {
    return "vencimento";
  }
  if (automationType === "Pós-Venda") {
    if (/pesquisa de satisfa/i.test(automationName)) return "pos_venda_satisfacao";
    if (/fidelidade/i.test(automationName)) return "pos_venda_fidelidade";
    return "pos_venda_generico";
  }
  return "none";
}

// Verifica se o texto é composto SOMENTE por saudações/agradecimentos
// conhecidos — qualquer conteúdo fora dessa lista faz cair no fluxo normal
// (Gemini), pra nunca engolir uma pergunta real disfarçada de cordialidade.
const GRATITUDE_PHRASES = [
  "bom dia", "boa tarde", "boa noite", "oi", "olá", "ola",
  "obrigada", "obrigado", "obrigada pela paciência", "obrigado pela paciência",
  "obrigada por tudo", "obrigado por tudo", "muito obrigada", "muito obrigado",
  "valeu", "vlw", "tudo certo", "tudo ótimo", "tudo otimo", "perfeito",
  "ótimo", "otimo", "obrigada viu", "obrigado viu",
];

function isGratitudeOrGreetingOnly(text: string): boolean {
  let remaining = text
    .toLowerCase()
    .replace(/[!.,😊🙏❤️😄👍✅🎉]/g, "")
    .trim();

  for (const phrase of [...GRATITUDE_PHRASES].sort((a, b) => b.length - a.length)) {
    remaining = remaining.split(phrase).join(" ");
  }
  remaining = remaining.replace(/\s+/g, " ").trim();
  return remaining.length === 0 && text.trim().length > 0;
}

const POSTPONEMENT_INTENT =
  /\b(vou pagar|pago (amanh[ãa]|hoje|depois|mais tarde|essa semana)|j[áa] vou (pagar|renovar)|assim que (puder|poss[íi]vel)|quando (chegar|puder)|semana que vem)\b/i;

const PROBLEM_KEYWORDS =
  /\b(travando|travou|ruim|p[ée]ssimo|n[ãa]o (funciona|gostei|est[áa] bom)|problema|reclama|demora|lento|sem sinal|n[ãa]o consigo)\b/i;

// ── Item 7: arquitetura de menu (Fase B) ──────────────────────────────────

type MenuContext = "tecnico" | "pagamento" | "instalacao" | null;

// Detecção determinística por palavra-chave — barata e previsível, sem
// depender do Gemini pra decidir o roteamento inicial.
function detectMenuContext(text: string): MenuContext {
  const t = text.toLowerCase();

  if (/\b(travando|travou|trava|congela|buffer|tela preta|sem sinal|não abre|nao abre|não funciona|nao funciona|erro|não conecta|nao conecta|canal)\b/i.test(t)) {
    return "tecnico";
  }
  if (/\b(pagar|pagamento|renovar|renova[çc][ãa]o|pix|vencimento|venceu|cobran[çc]a|boleto|cancelar|plano)\b/i.test(t)) {
    return "pagamento";
  }
  if (/\b(instalar|instala[çc][ãa]o|tv nova|configurar|app|aplicativo|celular|tablet|computador|nova tv)\b/i.test(t)) {
    return "instalacao";
  }
  return null;
}

const MAIN_MENU_TEXT =
  "Me conta o que você precisa:\n" +
  "1️⃣ Problema técnico\n" +
  "2️⃣ Renovação / pagamento\n" +
  "3️⃣ Nova instalação\n" +
  "4️⃣ Dúvidas gerais\n" +
  "5️⃣ Falar com o Márcio";

const TECNICO_SUBMENU_TEXT =
  "Entendido! Me conta mais:\n" +
  "1️⃣ Canal travando / buffering\n" +
  "2️⃣ Aplicativo não abre\n" +
  "3️⃣ Tela preta com som\n" +
  "4️⃣ Sem sinal / vencimento\n" +
  "5️⃣ Descrever o problema";

const PAGAMENTO_SUBMENU_TEXT =
  "Entendido! Me conta mais:\n" +
  "1️⃣ Já paguei, aguardando confirmação\n" +
  "2️⃣ Quero renovar agora\n" +
  "3️⃣ Dúvida sobre valores / trocar plano\n" +
  "4️⃣ Cancelar\n" +
  "5️⃣ Outro assunto sobre pagamento";

const INSTALACAO_SUBMENU_TEXT =
  "Entendido! Me conta mais:\n" +
  "1️⃣ TV nova\n" +
  "2️⃣ Celular / tablet\n" +
  "3️⃣ Computador\n" +
  "4️⃣ Já tenho o app, preciso reconfigurar\n" +
  "5️⃣ Outro assunto sobre instalação";

function submenuTextFor(context: MenuContext): string {
  if (context === "tecnico") return TECNICO_SUBMENU_TEXT;
  if (context === "pagamento") return PAGAMENTO_SUBMENU_TEXT;
  if (context === "instalacao") return INSTALACAO_SUBMENU_TEXT;
  return MAIN_MENU_TEXT;
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!isInternalAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    safeLog("[BOT][agent] GEMINI_API_KEY não configurada");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

const { tenant_id, session_key, phone, remoteJid, text, media_base64, media_type, mime_type, awaiting_payment_type, bot_state } = body;

  // Ignora imediatamente qualquer mensagem vinda de grupos (@g.us)
  const jidToCheck = remoteJid || phone || "";
  if (jidToCheck.includes("@g.us")) {
    safeLog(`[BOT][agent] Mensagem de grupo ignorada: ${jidToCheck}`);
        return NextResponse.json({ ok: true, action: "ignored_group", mark_read: true });

  }

  if (!tenant_id || !session_key || !phone) {
    return NextResponse.json({ error: "Parâmetros obrigatórios ausentes" }, { status: 400 });
  }

  // ── 1. Identificar cliente ────────────────────────────────────────────────

  const { data: clientMatches, error: clientErr } = await sb
  .from("clients")
  .select(`
    id, display_name, secondary_display_name,
    whatsapp_username, secondary_whatsapp_username,
    server_username, server_password,
    vencimento, screens, plan_label, plan_table_id,
    price_amount, price_currency, technology,
    server_id, is_trial, is_archived,
    servers (name, dns, is_offline, offline_since, offline_reason)
  `)
  .eq("tenant_id", tenant_id)
  .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

if (clientErr || !clientMatches?.length) {
    safeLog("[BOT][agent] Número não identificado como cliente:", phone);
    return NextResponse.json({ ok: true, action: "silence" });
  }

  // ── Mapeia TODAS as contas encontradas ──
  const clients = clientMatches.map((raw) => {
  const isSec = raw.secondary_whatsapp_username === phone;
  const dnsArray: string[] = (raw.servers as any)?.dns || [];
  const srv = raw.servers as any;
  return {
    ...raw,
    display_name: isSec ? (raw.secondary_display_name || raw.display_name || "Cliente") : (raw.display_name || "Cliente"),
    server_name: srv?.name || "Servidor",
    server_dns: dnsArray,
    server_is_offline: srv?.is_offline ?? false,
    server_offline_since: srv?.offline_since ?? null,
    server_offline_reason: srv?.offline_reason ?? null,
    is_secondary: isSec,
  };
});

const firstName = clients[0].display_name.split(" ")[0];

  // ── 2. Mídia — lógica determinística (sem IA pra decidir o status) ────────

if (media_base64 && media_type) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    const { data: recentPayments } = await sb
      .from("client_portal_payments")
      .select("id, fulfillment_status, whatsapp_status")
      .eq("tenant_id", tenant_id)
      .in("client_id", clients.map((c: any) => c.id))
      .gte("created_at", sixHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1);

    const recentPayment = recentPayments?.[0];

    // Caso A: Renovado via portal — confirmação automática já aconteceu
    if (recentPayment?.whatsapp_status === "sent") {
      const msg =
        `Oi ${firstName}! 😊 Recebi seu comprovante, mas sua renovação já foi processada automaticamente pelo portal — tudo certo com seu acesso!\n\nPara os próximos pagamentos pelo portal, não precisa enviar comprovante. Tudo acontece de forma automática. ✅`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "auto_confirmed", mark_read: true, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    // Caso B: No fluxo do portal, aguardando confirmação manual sua
    if (recentPayment?.fulfillment_status === "manual_pending") {
      const msg =
        `Oi ${firstName}! Recebi seu comprovante. ✅\n\nSua renovação está em análise e será concluída em breve. Qualquer dúvida é só chamar!`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "manual_pending", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    // Caso C: Sem registro no portal — pergunta Portal ou PIX antes de decidir
    // (Item 6). A extração detalhada do comprovante (chave PIX, valor, etc.)
    // foi removida daqui — quando o Márcio conferir a conversa manualmente
    // (mark_read: false na resposta "PIX"), ele já vê a imagem/PDF original
    // direto no WhatsApp, sem precisar do texto extraído pelo Gemini.
    if (!recentPayment) {
      let analysisPayload: any = {
        contents: [{
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mime_type || (media_type === "image" ? "image/jpeg" : "application/pdf"),
                data: media_base64,
              },
            },
            {
              text: `Analise esta imagem/documento. É um comprovante de pagamento financeiro (transferência PIX, TED, DOC, recibo bancário ou similar)?\n\nResponda SOMENTE com este JSON:\n{"is_receipt":true}\nou\n{"is_receipt":false}\n\nResponda APENAS o JSON, sem markdown, sem explicação.`,
            },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 64 },
      };

      let parsed: any = null;
      try {
        const analysisResult = await callGemini(geminiKey, analysisPayload);
        const rawText = analysisResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      } catch (e: any) {
        safeLog("[BOT][agent] Erro ao analisar imagem:", e?.message);
        return NextResponse.json({ ok: true, action: "silence", mark_read: true });
      }

      if (!parsed?.is_receipt) {
        return NextResponse.json({ ok: true, action: "silence", mark_read: true });
      }

      const msg = `Vi que você informou que está pago! Só confirma uma coisa: foi feito direto pelo portal ou via PIX/transferência manual?`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({
        ok: true,
        action: "awaiting_payment_type",
        mark_read: true, // ainda é só uma pergunta do bot — não precisa da sua atenção agora
        bot_response: msg,
        display_name: clients[0]?.display_name || null,
        server_name: clients[0]?.server_name || null,
      });
    }

    return NextResponse.json({ ok: true, action: "silence" });
  }

// ── 3. Mensagem de texto — agente Gemini com ferramentas ─────────────────

  if (!text?.trim()) {
    return NextResponse.json({ ok: true, action: "silence" });
  }

// ✅ Item 7 (Fase B): roteamento por estado de menu.
  // Prioridade alta — roda antes do Item 5/6, pois define o "modo" da
  // conversa. Escalonamento (Item 1) continua tendo prioridade máxima,
  // pois é checado mais abaixo e intercepta qualquer estado.
  const trimmedForMenu = text.trim();
  const numericChoice = /^[1-5]$/.test(trimmedForMenu) ? Number(trimmedForMenu) : null;

  if (!bot_state || bot_state === "aguardando_resposta" || bot_state === "aguardando_resposta_2") {
    const detected = detectMenuContext(trimmedForMenu);

    if (detected) {
      const msg = submenuTextFor(detected);
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: `menu_${detected}`, mark_read: true, bot_response: msg, next_state: detected, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    // Se já estava no menu principal (aguardando_resposta) e o cliente
    // escolheu um número válido do menu principal
    if (bot_state === "aguardando_resposta" && numericChoice) {
      if (numericChoice === 5) {
        const msg = "Aguarde que o Márcio já vai te atender! 🙏";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "escalated_menu", escalate: true, mark_read: false, bot_response: msg, next_state: "__clear__", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      const mapped: MenuContext = numericChoice === 1 ? "tecnico" : numericChoice === 2 ? "pagamento" : numericChoice === 3 ? "instalacao" : null;
      if (mapped) {
        const msg = submenuTextFor(mapped);
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: `menu_${mapped}`, mark_read: true, bot_response: msg, next_state: mapped, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      // Opção 4 (Dúvidas gerais) → Gemini livre
      return NextResponse.json({ ok: true, action: "menu_geral", mark_read: true, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      // (cai propositalmente sem sendWAMessage aqui — a resposta real vem do
      // fluxo Gemini mais abaixo nesta mesma request, na Fase C isso será
      // reorganizado; por ora deixa como TODO da Fase C)
    }

    // 1ª vez que vemos esse contato (bot_state null) → sem contexto
    // detectado → apresenta + menu, 2 mensagens separadas
    if (!bot_state) {
      const msg1 = "Oi! Sou o assistente do Márcio 🤖";
      await sendWAMessage(session_key, phone, msg1);
      await sendWAMessage(session_key, phone, MAIN_MENU_TEXT);
      return NextResponse.json({ ok: true, action: "menu_intro", mark_read: true, bot_response: `${msg1}\n\n${MAIN_MENU_TEXT}`, next_state: "aguardando_resposta", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    // 2ª tentativa (aguardando_resposta_2) também falhou → escalona, calmo
    if (bot_state === "aguardando_resposta_2") {
      const msg = "Aguarde que o Márcio já vai te atender! 🙏";
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "escalated_menu", escalate: true, mark_read: false, bot_response: msg, next_state: "__clear__", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    // 1ª tentativa (aguardando_resposta) não identificou nada e não foi
    // número válido → pergunta de novo, reformulado (paciência com idosos)
    const msg = `Sem pressa! Pode me contar com suas palavras o que está precisando? Por exemplo: "meu canal travou", "quero pagar" ou "preciso instalar num aparelho novo" 😊`;
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({ ok: true, action: "menu_retry", mark_read: true, bot_response: msg, next_state: "aguardando_resposta_2", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ✅ Item 7 (Fase B, continuação): já dentro de um submenu
  if (bot_state === "tecnico" || bot_state === "pagamento" || bot_state === "instalacao") {
    // Troca de contexto a qualquer momento — regra que você definiu: "a
    // qualquer momento pode mudar o contexto, tipo novo problema"
    const newContext = detectMenuContext(trimmedForMenu);
    if (newContext && newContext !== bot_state) {
      const msg = submenuTextFor(newContext);
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: `menu_switch_${newContext}`, mark_read: true, bot_response: msg, next_state: newContext, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    if (bot_state === "tecnico" && numericChoice) {
      if (numericChoice === 1) {
        const msg = "Segue um passo a passo que costuma resolver a maioria dos problemas:\n1. Desligue o modem da tomada e aguarde 5 minutos\n2. Desligue também a TV da tomada\n3. Após 5 minutos, ligue só o modem e aguarde a internet estabilizar\n4. Só então ligue a TV na tomada\n5. Ligue a TV pelo controle mas não abra o app ainda\n6. Aguarde 1 minuto\n7. Agora abra o app e teste\nSe continuar, me avisa que passo o próximo procedimento.";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "tecnico_reset", mark_read: true, bot_response: msg, next_state: "tecnico", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 2) {
        const cf = await toolVerificarCloudflare();
        const msg = cf.operacional
          ? "Verifiquei aqui e não identificamos instabilidade externa no momento. Vamos tentar: desligue o modem da tomada por 5 minutos e reabra o aplicativo. Se persistir, me avisa!"
          : "Identificamos que a instabilidade vem de um serviço externo chamado Cloudflare, que faz a ponte entre você e nosso servidor. O time deles já está atuando para corrigir. A normalização deve ocorrer em breve. Obrigado pela paciência! 💙";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "tecnico_cloudflare", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 3) {
        const msg = "Isso geralmente é um conflito no reprodutor de vídeo do aplicativo. Vá nas configurações do app (Settings), procure 'Media Player' ou 'Player de Vídeo' e altere de Hardware (HW) para Software (SW) — ou vice-versa. Reinicie o app e teste! 📺";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "tecnico_tela_preta", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 4) {
        const c = clients[0];
        const vencido = c?.vencimento ? new Date(c.vencimento).getTime() < Date.now() : false;
        let msg: string;
        if (vencido) {
          const portalLink = await toolGerarLinkPortal(sb, tenant_id, clientMatches[0], c.is_secondary);
          msg = `Vi aqui que seu acesso está vencido — por isso o sinal parou. 😊\n\nPara renovar:\n👉 ${portalLink}\nSenha: últimos 4 dígitos do seu WhatsApp`;
        } else {
          msg = "Seu acesso está em dia! Vamos tentar o reset padrão: desligue o modem da tomada por 5 minutos, depois a TV, e teste de novo. Se persistir, me avisa!";
        }
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "tecnico_vencimento", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      // numericChoice === 5 (descrever problema) cai pro Gemini, mais abaixo
    }

    if (bot_state === "pagamento" && numericChoice) {
      if (numericChoice === 1) {
        const msg = "Pode me mandar o comprovante por aqui, ou me contar quando fez o pagamento, que eu já verifico! 📄";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "pagamento_aguardando_comprovante", mark_read: true, bot_response: msg, next_state: "pagamento", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 2) {
        const portalLink = await toolGerarLinkPortal(sb, tenant_id, clientMatches[0], clients[0].is_secondary);
        const msg = `Claro! 😊 Acesse o portal para concluir a renovação:\n👉 ${portalLink}\nSenha: últimos 4 dígitos do seu WhatsApp`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "pagamento_renovar", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 3) {
        const precos = await toolConsultarPrecos(sb, tenant_id, clients[0]);
        const linhas = (precos.precos_configuracao_atual || []).map((p: any) => `- ${p.periodo}: ${precos.moeda} ${Number(p.valor).toFixed(2)}`);
        const msg = linhas.length ? `Segue a tabela de valores da sua conta:\n${linhas.join("\n")}` : "Não encontrei a tabela de preços da sua conta agora — vou encaminhar pro Márcio verificar. 🙏";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "pagamento_precos", mark_read: !linhas.length ? false : true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 4) {
        const msg = "Seu sinal fica ativo até a data de vencimento, sem fidelidade nem multa. Se decidir cancelar, é só não renovar — nenhuma ação extra é necessária. Se mudar de ideia, estarei por aqui! 😊";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "pagamento_cancelar", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      // numericChoice === 5 cai pro Gemini, mais abaixo
    }

    if (bot_state === "instalacao" && numericChoice) {
      if (numericChoice === 1) {
        const msg = "Legal! 📺 Me diz a marca da sua TV (Samsung, LG, TCL, Philips, Android TV...) que já te indico o aplicativo certo!";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "instalacao_tv_nova", mark_read: true, bot_response: msg, next_state: "instalacao", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 2) {
        const msg = "Show! 📱 É iPhone/iPad ou Android?";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "instalacao_mobile", mark_read: true, bot_response: msg, next_state: "instalacao", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 3) {
        const msg = "Para computador (Windows ou Mac), use o Web Player:\n👉 https://gpcpro.com.br/\nCódigo: 1366067\nUsuário e senha são os mesmos do seu servidor.";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "instalacao_computador", mark_read: true, bot_response: msg, next_state: "geral", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      if (numericChoice === 4) {
        const msg = "Sem problema! Me conta qual aplicativo você já usa que eu te ajudo a reconfigurar.";
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "instalacao_reconfigurar", mark_read: true, bot_response: msg, next_state: "instalacao", display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
      // numericChoice === 5 cai pro Gemini, mais abaixo
    }

    // Texto livre dentro do submenu (ou opção 5) — por ora usa o Gemini
    // completo mais abaixo (Fase C ainda não implementada: prompt filtrado
    // por categoria). Não retorna aqui de propósito — deixa cair no fluxo.
  }

  // ✅ Item 6: resposta à pergunta "Portal ou PIX?" — tem prioridade sobre
  // qualquer outro filtro, pois é a continuação direta de uma pergunta que
  // o próprio bot fez na mensagem anterior.
  if (awaiting_payment_type === true) {
    const trimmed = text.trim();
    const mentionsPix = /\b(pix|transfer[eê]ncia|manual|ted|doc|dep[oó]sito)\b/i.test(trimmed);
    const mentionsPortal = /\b(portal|link|site)\b/i.test(trimmed);

    if (mentionsPix && !mentionsPortal) {
      const msg1 = `Entendido! O Márcio vai cuidar da sua renovação assim que possível 😊`;
      await sendWAMessage(session_key, phone, msg1);
      const msg2 = `Já fica a dica: se renovar direto pelo portal usando o link que te mandei, o processo é automático — você nem precisa enviar comprovante nem esperar a confirmação manual. #FicaADica`;
      await sendWAMessage(session_key, phone, msg2);
      return NextResponse.json({
        ok: true,
        action: "payment_pix_confirmed",
        mark_read: false, // precisa da sua conferência manual do comprovante
        bot_response: `${msg1}\n\n${msg2}`,
        display_name: clients[0]?.display_name || null,
        server_name: clients[0]?.server_name || null,
      });
    }

    if (mentionsPortal && !mentionsPix) {
      // Rechecagem — o webhook do portal pode ter chegado com atraso
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recheck } = await sb
        .from("client_portal_payments")
        .select("id, fulfillment_status, whatsapp_status")
        .eq("tenant_id", tenant_id)
        .in("client_id", clients.map((c: any) => c.id))
        .gte("created_at", sixHoursAgo)
        .order("created_at", { ascending: false })
        .limit(1);

      const found = recheck?.[0];
      if (found?.whatsapp_status === "sent") {
        const msg = `Ah, encontrei aqui! 😊 Sua renovação pelo portal já foi processada automaticamente — tudo certo com seu acesso!`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "payment_portal_confirmed", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }

      const msg = `Hmm, ainda não encontrei o registro por aqui — deixa comigo, já vou verificar direto com o Márcio pra confirmar. 🙏`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "payment_portal_not_found", mark_read: false, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
    }

    // Resposta ambígua — pergunta de novo, uma única vez (o TTL de 15min
    // no lado da VM evita loop infinito se o cliente nunca responder claro)
    const msg = `Desculpa, não entendi — foi pelo portal (aquele link que te mandei) ou via PIX/transferência manual?`;
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({ ok: true, action: "awaiting_payment_type", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
  }

  // ✅ Item 5: verifica se o cliente está respondendo a uma mensagem
  // automática recente (últimas 24h) antes de qualquer outro filtro.
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentJob } = await sb
      .from("client_message_jobs")
      .select(`
        sent_at,
        automation_id,
        message_template_id,
        billing_automations ( name, type )
      `)
      .eq("tenant_id", tenant_id)
      .in("client_id", clients.map((c: any) => c.id))
      .eq("status", "SENT")
      .gte("sent_at", twentyFourHoursAgo)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // A FK fk_jobs_message_template já existe no banco (criada como proteção
    // de integridade de dados), mas o select aninhado combinando as duas
    // relações no mesmo objeto gerou erro de build — mantendo a busca manual
    // e explícita aqui, que é a versão comprovadamente estável.
    let templateInfo: { name?: string; category?: string } | null = null;
    if (recentJob?.message_template_id) {
      const { data: tpl } = await sb
        .from("message_templates")
        .select("name, category")
        .eq("id", recentJob.message_template_id)
        .maybeSingle();
      templateInfo = tpl || null;
    }

    const jobKind = classifyRecentJob(recentJob, templateInfo);
    safeLog("[BOT][agent] Item5 — job recente classificado como:", jobKind);

    if (jobKind !== "none") {
      const trimmed = text.trim();

      // Confirmação de pagamento + só agradeceu/confirmou
if (jobKind === "payment_confirmation" && isGratitudeOrGreetingOnly(trimmed)) {
        const msg = `Que bom, ${firstName}! 😊 Fico feliz que deu tudo certo com sua renovação. Qualquer coisa é só chamar!`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "payment_ack", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }

      // Lembrete de vencimento + cliente disse que vai pagar depois
if (jobKind === "vencimento" && POSTPONEMENT_INTENT.test(trimmed)) {
        const msg = `Sem pressa! Pode ficar tranquilo — quando for renovar, é só acessar o portal que está tudo pronto. Se precisar de ajuda, é só chamar! 😊`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "vencimento_ack", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }

      // Pesquisa de satisfação + resposta positiva (sem sinal de reclamação
      // e sem ser um feedback longo — nuance fica pro Gemini avaliar)
      if (
        jobKind === "pos_venda_satisfacao" &&
        !PROBLEM_KEYWORDS.test(trimmed) &&
        trimmed.length < 300
      ) {
        const msg = `Muito obrigado pelo retorno, ${firstName}! 🙏 Fico feliz que esteja gostando. Qualquer coisa, é só chamar!`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "satisfaction_ack", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }

      // Fidelidade e pós-venda genérico: mesmo tratamento — agradece e encerra
      if (
        (jobKind === "pos_venda_fidelidade" || jobKind === "pos_venda_generico") &&
        isGratitudeOrGreetingOnly(trimmed)
      ) {
        const msg = `Que bom, ${firstName}! 😊 Fico feliz em saber. Qualquer coisa, é só chamar!`;
        await sendWAMessage(session_key, phone, msg);
        return NextResponse.json({ ok: true, action: "pos_venda_ack", mark_read: true, bot_response: msg, display_name: clients[0]?.display_name || null, server_name: clients[0]?.server_name || null });
      }
    }
  } catch (e: any) {
    safeLog("[BOT][agent] Erro ao ler contexto do sistema (item 5):", e?.message);
    // Falha aqui nunca deve travar o atendimento normal.
  }

  // Filtro determinístico: confirmações simples nunca chegam ao agente
  const confirmacaoSimples = /^(ok|okay|oks|👍|👌|✅|😊|🙏|blz|beleza|certo|entendi|entendido|perfeito|tá|ta|tá bom|ta bom|tudo bem|obrigad[oa]|vlw|valeu|até|ótimo|otimo|show|legal|massa|👏|🤝|😀|😄|🙂)$/i;
  if (confirmacaoSimples.test(text.trim())) {
    safeLog("[BOT][agent] Confirmação simples ignorada:", text.trim());
    return NextResponse.json({ ok: true, action: "silence_confirmation", mark_read: true });
  }

  
  // ✅ Escalonamento determinístico — NUNCA depende do Gemini decidir sozinho.
  // Bug real (caso Sandra, 26/06): o modelo às vezes ignorava a regra de
  // transferência escrita no prompt e continuava respondendo como se nada
  // tivesse acontecido. Isso aqui intercepta ANTES de qualquer chamada à IA.
  const escalationTrigger =
    /^(pessoal|márcio|marcio|humano|0)$/i.test(text.trim()) ||
    /\b(falar com (o )?márcio|falar com (uma )?pessoa|atendente humano|quero (um )?humano|preciso de (uma )?pessoa)\b/i.test(text.trim());

  if (escalationTrigger) {
    safeLog("[BOT][agent] Escalonamento explícito detectado:", text.trim());
    const msg = `Sem problema! Vou deixar sua conversa marcada aqui e o Márcio te retorna assim que possível. 🙏`;
    await sendWAMessage(session_key, phone, msg);
    return NextResponse.json({
      ok: true,
      action: "escalated",
      escalate: true, // sinaliza para a VM pausar o bot para este contato
      display_name: clients[0]?.display_name || null,
      server_name: clients[0]?.server_name || null,
    });
  }

  // Ignora links puros sem contexto (YouTube, Spotify, TikTok etc.)
  const isLinkOnly = /^https?:\/\/\S+$/.test(text.trim());
  if (isLinkOnly) {
    safeLog("[BOT][agent] Link puro ignorado:", text.trim().slice(0, 80));
    return NextResponse.json({ ok: true, action: "silence", mark_read: true });
  }

  // ── RAG: busca conhecimento relevante para esta mensagem ─────────────────
  let templatesText = "(nenhum conhecimento relevante encontrado)";
  try {
    const embedding = await generateEmbedding(geminiKey, text.trim());
    if (embedding) {
      // Mensagens simples não precisam de RAG completo
const isSimpleQuery = /^(ol[aá]|oi|bom dia|boa tarde|boa noite|quando vence|meu vencimento|renovar|pagar|quanto custa)$/i.test(text.trim());
templatesText = await searchBotKnowledge(sb, tenant_id, embedding, isSimpleQuery ? 2 : 5);
      safeLog("[BOT][agent] RAG: conhecimento buscado com sucesso");
    } else {
      safeLog("[BOT][agent] RAG: falha ao gerar embedding — usando fallback vazio");
    }
  } catch (e: any) {
    safeLog("[BOT][agent] RAG: erro inesperado —", e?.message);
  }

  // ── Histórico recente: últimos jobs enviados + últimos pagamentos ─────────
const [{ data: recentJobs }, { data: recentPayments }] = await Promise.all([
  sb
    .from("client_message_jobs")
    .select("sent_at, message_template_id, status")
    .eq("tenant_id", tenant_id)
    .in("client_id", clients.map((c: any) => c.id))
    .eq("status", "SENT")
    .order("sent_at", { ascending: false })
    .limit(3),
  sb
    .from("client_portal_payments")
    .select("created_at, status, fulfillment_status, whatsapp_status, new_vencimento, price_amount, price_currency, period")
    .eq("tenant_id", tenant_id)
    .in("client_id", clients.map((c: any) => c.id))
    .order("created_at", { ascending: false })
    .limit(3),
]);

const historicoRecente = [
  "### Últimos envios automáticos:",
  ...(recentJobs && recentJobs.length > 0
    ? recentJobs.map((j: any) =>
        `- ${j.message_template_id ? "Lembrete automático" : "Mensagem manual"} enviado em ${toBRDateTime(j.sent_at)}`
      )
    : ["- Nenhum envio recente encontrado"]),
  "",
  "### Últimos pagamentos no portal:",
  ...(recentPayments && recentPayments.length > 0
    ? recentPayments.map((p: any) =>
        `- ${toBRDateTime(p.created_at)} | ${p.price_currency} ${Number(p.price_amount).toFixed(2)} | status=${p.status} | fulfillment=${p.fulfillment_status} | whatsapp=${p.whatsapp_status ?? "n/a"}${p.new_vencimento ? ` | novo_vencimento=${toBRDateTime(p.new_vencimento)}` : ""}`
      )
    : ["- Nenhum pagamento recente encontrado"]),
].join("\n");

const agoraSP = new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

const promptBase = buildBotSystemPrompt(clients, templatesText, {
  historicoRecente,
  agoraSP,
});

// Adiciona a regra de ouro para blindar o bot contra as "legendas órfãs"
const systemPrompt = promptBase + "\n\nREGRA DE MÍDIA: Se o cliente mencionar que enviou foto, comprovante ou imagem mas você não recebeu o conteúdo visual, responda: 'Recebi sua mensagem! Para comprovantes de pagamento, você pode renovar direto pelo portal que é automático — ou se preferir, o Márcio vai conferir assim que possível. 😊' Nunca peça para reenviar a imagem.";

  // Histórico vem do sessionManager (em memória, sem banco)
  const history = Array.isArray(body.conversation_history) ? body.conversation_history : [];
  
  // Monta conversa: histórico anterior + mensagem atual
  const conversation: any[] = [
    ...history,
    { role: "user", parts: [{ text: text.trim() }] },
  ];

  const geminiPayload: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: [{ functionDeclarations: BOT_TOOL_DECLARATIONS }], // 🟢 Ferramentas unificadas
    contents: conversation,
generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  // Loop de tool calling — máx 5 iterações pra evitar loop infinito
  let finalResponse = "";

  try {
    for (let i = 0; i < 5; i++) {
      safeLog(`[BOT][agent] Gemini iteração ${i + 1}`);

      const result = await callGemini(geminiKey, geminiPayload);
      const parts = result?.candidates?.[0]?.content?.parts || [];

      const toolCalls = parts.filter((p: any) => p.functionCall);
      const textPart = parts.find((p: any) => typeof p.text === "string" && p.text.trim());

      // Modelo deu resposta de texto sem tool calls → fim do loop
      if (textPart && !toolCalls.length) {
        finalResponse = textPart.text.trim();
        break;
      }

      // Sem tool calls e sem texto → algo errado, sai
      if (!toolCalls.length) {
        safeLog("[BOT][agent] Gemini não retornou texto nem tool calls");
        break;
      }

      // Adiciona resposta do modelo à conversa antes de executar ferramentas
      geminiPayload.contents.push({ role: "model", parts });

      // Executa cada ferramenta solicitada
      const toolResults: any[] = [];
      for (const part of toolCalls) {
        const fn = part.functionCall;
        let toolResult: any;

        try {
          switch (fn.name) {
            case "gerar_link_portal": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              // IMPORTANTE: Mantém a distinção de rawClient para gerarLinkPortal como estava antes
              const selectedRaw = clientMatches[idx] || clientMatches[0];
              const selectedClient = clients[idx] || clients[0];
              toolResult = {
                link: await toolGerarLinkPortal(sb, tenant_id, selectedRaw, selectedClient.is_secondary),
              };
              break;
            }

            case "consultar_precos": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              const selectedClient = clients[idx] || clients[0];
              toolResult = await toolConsultarPrecos(sb, tenant_id, selectedClient);
              break;
            }

            case "verificar_cloudflare":
              toolResult = await toolVerificarCloudflare();
              break;

            case "recomendar_aplicativo": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              const selectedClient = clients[idx] || clients[0];
              toolResult = await toolRecomendarApplicativo(sb, tenant_id, selectedClient.server_id || null);
              break;
            }

            default:
              toolResult = { error: `Ferramenta desconhecida: ${fn.name}` };
          }
        } catch (e: any) {
          safeLog(`[BOT][agent] Erro na ferramenta ${fn.name}:`, e?.message);
          toolResult = { error: e?.message || "Erro ao executar ferramenta" };
        }

        safeLog(`[BOT][agent] Tool ${fn.name}:`, JSON.stringify(toolResult).slice(0, 200));

        toolResults.push({
          functionResponse: {
            name: fn.name,
            response: toolResult,
          },
        });
      }

      // Adiciona resultados das ferramentas à conversa
      geminiPayload.contents.push({ role: "user", parts: toolResults });
    }
  } catch (e: any) {
    safeLog("[BOT][agent] Falha ao comunicar com Google Gemini:", e?.message);
    return NextResponse.json({ ok: false, error: e?.message }, { status: 502 });
  }

if (!finalResponse?.trim()) {
    safeLog("[BOT][agent] Agente não retornou resposta após 5 iterações");
    return NextResponse.json({ ok: true, action: "no_response" });
  }

  // Nunca envia texto técnico ou de controle como resposta real
  const blockedResponses = ["do_not_respond", "silence", "no_response", "ignored"];
  if (blockedResponses.some(b => finalResponse.trim().toLowerCase() === b)) {
    safeLog("[BOT][agent] Resposta bloqueada (controle interno):", finalResponse.trim());
    return NextResponse.json({ ok: true, action: "silence" });
  }

  // Bloqueia raciocínio interno vazando como resposta
  const isInternalThinking = (
    finalResponse.includes("Portanto, devo ignorar") ||
    finalResponse.includes("devo ignorar esta mensagem") ||
    finalResponse.includes("não devo responder nada") ||
    finalResponse.includes("* Portanto, devo") ||
    finalResponse.includes("Analisando a mensagem, devo") ||
    finalResponse.includes("Com base nas regras, devo") ||
    /^\*[\s\S]*\*$/.test(finalResponse.trim())
  );
  if (isInternalThinking) {
    safeLog("[BOT][agent] Raciocínio interno bloqueado:", finalResponse.slice(0, 100));
    return NextResponse.json({ ok: true, action: "silence" });
  }

await sendWAMessage(session_key, phone, finalResponse);
return NextResponse.json({
    ok: true,
    action: "responded",
    bot_response: finalResponse,
    next_state: "geral", // ✅ Item 7 — depois de conversar livre, não repete o menu
    display_name: clients[0]?.display_name || null,
    server_name: clients[0]?.server_name || null,
    server_username: clients[0]?.server_username || null,
  });
}