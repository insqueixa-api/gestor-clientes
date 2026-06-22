// app/api/whatsapp/bot/chat-admin/route.ts
// Rota exclusiva do painel admin para testar e ensinar o bot.
// NÃO envia mensagens pro WhatsApp real — só retorna a resposta do agente.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePortalLink } from "@/lib/whatsapp/template-vars";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.log(...args);
}

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function toBRDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function diffDaysFromNow(iso: string): number {
  const sp = (d: Date) =>
    new Date(d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
  return Math.floor(
    (sp(new Date(iso)).getTime() - sp(new Date()).getTime()) / 86_400_000
  );
}

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

// ── Tools (mesmas do agent, sem envio WA) ────────────────────────────────────

async function toolGerarLinkPortal(sb: any, tenantId: string, client: any): Promise<string> {
  const phone = client.whatsapp_username;
  if (!phone) return "(link não disponível — cliente sem WhatsApp)";
  return generatePortalLink(sb, {
    tenantId,
    contact: { number: phone, username: phone, is_secondary: false },
    createdBy: null,
    label: "Teste admin bot",
    expiresAt: null,
    onLog: safeLog,
  });
}

async function toolConsultarPrecos(sb: any, tenantId: string, client: any): Promise<any> {
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
      .eq("currency", client.price_currency || "BRL").eq("is_active", true).maybeSingle();
    if (def) planTableId = def.id;
  }
  if (!planTableId) return { error: "Tabela de preços não encontrada" };

  const { data: items } = await sb
    .from("plan_table_items")
    .select("period, plan_table_item_prices(screens_count, price_amount)")
    .eq("plan_table_id", planTableId);

  const screens = Number(client.screens || 1);
  const precoAtual = (items || [])
    .map((item: any) => {
      let valor = 0;
      if (client.price_amount > 0 && PERIOD_LABELS[item.period] === client.plan_label) {
        valor = client.price_amount;
      } else {
        const exact = item.plan_table_item_prices?.find((p: any) => p.screens_count === screens);
        if (exact) valor = exact.price_amount;
      }
      return { periodo: PERIOD_LABELS[item.period] || item.period, valor };
    })
    .filter((p: any) => p.valor > 0)
    .sort((a: any, b: any) => ORDER.indexOf(a.period) - ORDER.indexOf(b.period));

  return { moeda: client.price_currency || "BRL", telas: screens, precos: precoAtual };
}

async function toolVerificarCloudflare(): Promise<any> {
  try {
    const res = await fetch("https://www.cloudflarestatus.com/api/v2/status.json", {
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json();
    return { operacional: data?.status?.indicator === "none", descricao: data?.status?.description || "" };
  } catch {
    return { operacional: true, descricao: "Não foi possível verificar" };
  }
}

async function toolRecomendarApplicativo(sb: any, tenantId: string, serverId: string | null): Promise<any> {
  const { data: apps } = await sb
    .from("apps").select("name, cost_type, partner_server_id, license_price, license_period")
    .eq("tenant_id", tenantId).eq("is_hidden", false);

  if (!apps) return {};
  return {
    parceiros: (apps as any[]).filter(a => a.cost_type === "partnership" && a.partner_server_id === serverId).map(a => a.name),
    gratis: (apps as any[]).filter(a => a.cost_type === "free" && !a.partner_server_id).map(a => a.name),
    pagos: (apps as any[]).filter(a => a.cost_type === "paid" && !a.partner_server_id).map(a => ({
      nome: a.name,
      valor: a.license_price ? `R$ ${Number(a.license_price).toFixed(2).replace(".", ",")}` : null,
      periodo: a.license_period === "annual" ? "anuidade" : a.license_period === "lifetime" ? "vitalício" : null,
    })),
  };
}

const TOOL_DECLARATIONS = [
  {
    name: "gerar_link_portal",
    description: "Gera o link do portal de renovação para o cliente pagar online.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "consultar_precos",
    description: "Consulta a tabela de preços real do cliente por período e telas.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "verificar_cloudflare",
    description: "Verifica instabilidade global na Cloudflare. Usar SOMENTE quando app não abre.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "recomendar_aplicativo",
    description: "Recomenda aplicativos por servidor do cliente.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
];

function buildSystemPrompt(client: any, templatesText: string, isTest: boolean): string {
  const diasVenc = client.vencimento ? diffDaysFromNow(client.vencimento) : null;
  const vencStatus = diasVenc === null ? "não informado"
    : diasVenc < 0 ? `⚠️ VENCIDO há ${Math.abs(diasVenc)} dia(s)`
    : diasVenc === 0 ? "⚠️ VENCE HOJE"
    : `✅ ${toBRDate(client.vencimento)} (em ${diasVenc} dia(s))`;

  return `Você é o assistente de atendimento da UniGestor, um serviço de IPTV.${isTest ? "\n\n⚠️ MODO DE TESTE: Esta é uma simulação do painel admin. Responda normalmente como faria com um cliente real." : ""}

## CLIENTE SIMULADO
- Nome: ${client.display_name || "Cliente Teste"}
- Servidor: ${client.server_name || "Servidor"}
- Plano: ${client.plan_label || "Mensal"} / ${client.screens || 1} tela(s)
- Vencimento: ${vencStatus}
- Moeda: ${client.price_currency || "BRL"}

## REGRAS ABSOLUTAS
1. NUNCA invente valores, datas ou dados financeiros — use as ferramentas.
2. Vencimento vencido? Explique e ofereça o link de renovação.
3. verificar_cloudflare SOMENTE quando "app não abre".
4. Preços e apps sempre via ferramenta, nunca da memória.

## DIAGNÓSTICO (ordem obrigatória)
1. Vencido? → link para renovar.
2. Canal trava → internet do cliente → resetar modem.
3. App não abre → verificar_cloudflare → orientar conforme resultado.
4. App abre mas canal falha → verificar com suporte.

## SOBRE TELAS
1 tela = múltiplas TVs em uso intercalado. Simultâneo = precisa de mais telas.

## BASE DE CONHECIMENTO
${templatesText || "(nenhum template ativo)"}

## TOM
Informal, conciso, como WhatsApp real. Máx 4-5 linhas por resposta. Emojis com moderação.`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY não configurada" }, { status: 500 });

  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  // Auth — usuário logado normal
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !authData?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Tenant
  const { data: member } = await sb
    .from("tenant_members").select("tenant_id")
    .eq("user_id", authData.user.id).limit(1).maybeSingle();
  if (!member?.tenant_id) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 403 });
  const tenantId = member.tenant_id;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const { message, client_id, conversation_history } = body;
  if (!message?.trim()) return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });

  // Carrega cliente (se informado) ou usa um placeholder
  let client: any = {
    id: null, display_name: "Cliente Teste", server_name: "Servidor",
    plan_label: "Mensal", screens: 1, vencimento: null,
    price_currency: "BRL", price_amount: 0, plan_table_id: null,
    server_id: null, whatsapp_username: null,
  };

  if (client_id) {
    const { data: clientData } = await sb
      .from("clients")
      .select(`id, display_name, whatsapp_username, vencimento, screens, plan_label,
               plan_table_id, price_amount, price_currency, server_id, servers(name)`)
      .eq("id", client_id).eq("tenant_id", tenantId).single();
    if (clientData) {
      client = { ...clientData, server_name: (clientData.servers as any)?.name || "Servidor" };
    }
  }

  // Templates como base de conhecimento
  const { data: templateRows } = await sb
    .from("message_templates").select("name, category, content")
    .eq("tenant_id", tenantId).eq("is_active", true).order("category");

  const templatesText = (templateRows || [])
    .map((t: any) => `### [${t.category}] ${t.name}\n${t.content}`)
    .join("\n\n---\n\n");

  const systemPrompt = buildSystemPrompt(client, templatesText, true);

  // Monta conversa com histórico (multi-turn)
  const history = Array.isArray(conversation_history) ? conversation_history : [];
  const contents = [
    ...history,
    { role: "user", parts: [{ text: message.trim() }] },
  ];

  const geminiPayload: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] }, // 🟢 Corrigido para CamelCase
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],   // 🟢 Corrigido para CamelCase
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  };

  // Loop de tool calling
  let finalResponse = "";
  const newContents = [...contents];

  try { // 🟢 Adicionada a blindagem contra erros da API do Gemini
    for (let i = 0; i < 5; i++) {
      const result = await callGemini(geminiKey, { ...geminiPayload, contents: newContents });
      const parts = result?.candidates?.[0]?.content?.parts || [];
      const toolCalls = parts.filter((p: any) => p.functionCall);
      const textPart = parts.find((p: any) => typeof p.text === "string" && p.text.trim());

      if (textPart && !toolCalls.length) {
        finalResponse = textPart.text.trim();
        newContents.push({ role: "model", parts: [{ text: finalResponse }] });
        break;
      }
      if (!toolCalls.length) break;

      newContents.push({ role: "model", parts });
      const toolResults: any[] = [];

      for (const part of toolCalls) {
        const fn = part.functionCall;
        let toolResult: any;
        try {
          switch (fn.name) {
            case "gerar_link_portal":
              toolResult = { link: await toolGerarLinkPortal(sb, tenantId, client) };
              break;
            case "consultar_precos":
              toolResult = await toolConsultarPrecos(sb, tenantId, client);
              break;
            case "verificar_cloudflare":
              toolResult = await toolVerificarCloudflare();
              break;
            case "recomendar_aplicativo":
              toolResult = await toolRecomendarApplicativo(sb, tenantId, client.server_id || null);
              break;
            default:
              toolResult = { error: "Ferramenta desconhecida" };
          }
        } catch (e: any) {
          toolResult = { error: e?.message };
        }
        toolResults.push({ functionResponse: { name: fn.name, response: toolResult } });
      }
      newContents.push({ role: "user", parts: toolResults });
    }
  } catch (e: any) {
    safeLog("[BOT][chat-admin] Falha ao comunicar com Google Gemini:", e?.message);
    return NextResponse.json({ error: `Erro na comunicação com a IA: ${e?.message}` }, { status: 502 });
  }

  if (!finalResponse) return NextResponse.json({ error: "Agente não retornou resposta" }, { status: 500 });

  return NextResponse.json({
    ok: true,
    response: finalResponse,
    // Devolve o histórico atualizado pro front manter o multi-turn
    updated_history: newContents,
  });
}
