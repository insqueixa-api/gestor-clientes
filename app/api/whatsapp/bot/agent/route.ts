// app/api/whatsapp/bot/agent/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { generatePortalLink } from "@/lib/whatsapp/template-vars";
// 🟢 Importando a Fonte Única de Verdade (Regras e Ferramentas unificadas)
import { BOT_TOOL_DECLARATIONS, buildBotSystemPrompt } from "@/lib/whatsapp/bot-prompt";

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
  const timeout = setTimeout(() => controller.abort(), 30_000);
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

  const { tenant_id, session_key, phone, remoteJid, text, media_base64, media_type, mime_type } = body;

  // Ignora imediatamente qualquer mensagem vinda de grupos (@g.us)
  const jidToCheck = remoteJid || phone || "";
  if (jidToCheck.includes("@g.us")) {
    safeLog(`[BOT][agent] Mensagem de grupo ignorada: ${jidToCheck}`);
    return NextResponse.json({ ok: true, action: "ignored_group" });
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
      server_username,
      vencimento, screens, plan_label, plan_table_id,
      price_amount, price_currency, technology,
      server_id, is_trial, is_archived,
      servers (name)
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
    return {
      ...raw,
      display_name: isSec ? (raw.secondary_display_name || raw.display_name || "Cliente") : (raw.display_name || "Cliente"),
      server_name: (raw.servers as any)?.name || "Servidor",
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
      return NextResponse.json({ ok: true, action: "auto_confirmed" });
    }

    // Caso B: No fluxo do portal, aguardando confirmação manual sua
    if (recentPayment?.fulfillment_status === "manual_pending") {
      const msg =
        `Oi ${firstName}! Recebi seu comprovante. ✅\n\nSua renovação está em análise e será concluída em breve. Qualquer dúvida é só chamar!`;
      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "manual_pending" });
    }

    // Caso C: Sem registro no portal — pagou fora do sistema
    // Gemini analisa a imagem pra extrair os dados do comprovante
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
              text: `Analise esta imagem/documento. É um comprovante de pagamento financeiro (transferência PIX, TED, DOC, recibo bancário ou similar)?\n\nSe SIM, extraia os dados visíveis e responda SOMENTE com este JSON:\n{"is_receipt":true,"pix_key":"chave pix de destino se visível ou null","value":"valor em reais como string ou null","datetime":"data e hora como string ou null","confirmation_code":"código de confirmação/autenticação ou null"}\n\nSe NÃO for comprovante de pagamento, responda SOMENTE:\n{"is_receipt":false}\n\nResponda APENAS o JSON, sem markdown, sem explicação.`,
            },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 256 },
      };

      let parsed: any = null;
      try {
        const analysisResult = await callGemini(geminiKey, analysisPayload);
        const rawText = analysisResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      } catch (e: any) {
        safeLog("[BOT][agent] Erro ao analisar imagem:", e?.message);
        return NextResponse.json({ ok: true, action: "silence" });
      }

      if (!parsed?.is_receipt) {
        return NextResponse.json({ ok: true, action: "silence" });
      }

      const detalhes = [
        parsed.pix_key ? `🔑 Chave PIX: ${parsed.pix_key}` : null,
        parsed.value ? `💰 Valor: ${parsed.value}` : null,
        parsed.datetime ? `📅 Data/hora: ${parsed.datetime}` : null,
        parsed.confirmation_code ? `🔢 Código: ${parsed.confirmation_code}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const portalLink = await toolGerarLinkPortal(sb, tenant_id, clientMatches[0], clients[0].is_secondary);

      const msg = [
        `Oi ${firstName}! Recebi seu comprovante. 📄`,
        "",
        detalhes || "Dados do comprovante identificados.",
        "",
        "Já notifiquei o suporte para concluir sua renovação. Em breve tudo estará ok! ⏳",
        "",
        `💡 *Dica:* Na próxima vez, você pode renovar pelo portal — é automático, sem precisar enviar comprovante!`,
        portalLink ? `👉 ${portalLink}` : "",
      ]
        .filter((l) => l !== undefined)
        .join("\n")
        .trim();

      await sendWAMessage(session_key, phone, msg);
      return NextResponse.json({ ok: true, action: "receipt_manual" });
    }

    return NextResponse.json({ ok: true, action: "silence" });
  }

  // ── 3. Mensagem de texto — agente Gemini com ferramentas ─────────────────

  if (!text?.trim()) {
    return NextResponse.json({ ok: true, action: "silence" });
  }

  // Carrega templates como base de conhecimento do agente
  const { data: templateRows } = await sb
    .from("message_templates")
    .select("name, category, content")
    .eq("tenant_id", tenant_id)
    .order("category");

  const templatesText = (templateRows || [])
    .map((t: any) => `### [${t.category}] ${t.name}\n${t.content}`)
    .join("\n\n---\n\n");

  // 🟢 Chamando a função de prompt unificada
  const systemPrompt = buildBotSystemPrompt(clients, templatesText); 

  // Conversa inicial
  const conversation: any[] = [
    { role: "user", parts: [{ text: text.trim() }] },
  ];

  const geminiPayload: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: [{ functionDeclarations: BOT_TOOL_DECLARATIONS }], // 🟢 Ferramentas unificadas
    contents: conversation,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
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

  if (!finalResponse) {
    safeLog("[BOT][agent] Agente não retornou resposta após 5 iterações");
    return NextResponse.json({ ok: true, action: "no_response" });
  }

  await sendWAMessage(session_key, phone, finalResponse);
  return NextResponse.json({ ok: true, action: "responded" });
}