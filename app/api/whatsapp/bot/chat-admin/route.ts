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

function toBRDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
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
      .eq("currency", client.price_currency || "BRL").maybeSingle();
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
    description: "Gera o link personalizado do portal de renovação. Use quando o cliente pedir pra pagar ou quiser renovar. IMPORTANTE: Se o cliente tiver múltiplas contas, passe o 'conta_index' correspondente.",
    parameters: { 
      type: "OBJECT", 
      properties: { 
        conta_index: { type: "INTEGER", description: "O número da conta (1, 2, etc) que o cliente escolheu. Padrão 1." } 
      }, 
      required: [] 
    },
  },
  {
    name: "consultar_precos",
    description: "Consulta a tabela de preços real do cliente. NUNCA invente preços. IMPORTANTE: Se o cliente tiver múltiplas contas, passe o 'conta_index'.",
    parameters: { 
      type: "OBJECT", 
      properties: { 
        conta_index: { type: "INTEGER", description: "O número da conta (1, 2, etc) que o cliente escolheu. Padrão 1." } 
      }, 
      required: [] 
    },
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

function buildSystemPrompt(clients: any[], templatesText: string, isTest: boolean): string {
const contasFormatadas = clients.map((c, index) => {
    const diasVenc = c.vencimento ? diffDaysFromNow(c.vencimento) : null;
    const vencDateTime = c.vencimento ? toBRDateTime(c.vencimento) : null;
    const vencStatus = diasVenc === null
      ? "não informado"
      : diasVenc < 0
      ? `⚠️ VENCIDO em ${vencDateTime} (há ${Math.abs(diasVenc)} dia(s))`
      : diasVenc === 0
      ? `⚠️ VENCE HOJE às ${vencDateTime?.split(" ")[1] || ""}`
      : `✅ ${vencDateTime} (em ${diasVenc} dia(s))`;

    return [
      `[CONTA ${index + 1}]`,
      `- Nome: ${c.display_name}`,
      `- Usuário do servidor: ${c.server_username || "(não informado)"}`,
      `- Servidor: ${c.server_name}`,
      `- Plano: ${c.plan_label} / ${c.screens} tela(s)`,
      `- Vencimento: ${vencStatus}`,
      `- Moeda: ${c.price_currency || "BRL"}`,
    ].join("\n");
  }).join("\n\n");

  return `Você é o assistente de atendimento da UniGestor, um serviço de IPTV.${isTest ? "\n\n⚠️ MODO DE TESTE: Esta é uma simulação do painel admin. Responda normalmente como faria com um cliente real." : ""}

## CONTAS IDENTIFICADAS PARA ESTE WHATSAPP (${clients.length} conta(s))
${contasFormatadas}

## REGRA PARA MÚLTIPLAS CONTAS
Se o cliente tiver MAIS DE UMA CONTA e fizer pedido genérico, NÃO adivinhe qual conta. Liste TODAS e pergunte qual ele quer.

FORMATO OBRIGATÓRIO ao listar contas (sem exceção, todas elas):
- Conta 1: Nome (usuario_servidor) — Servidor — Plano, vence DD/MM/AAAA às HH:MM
- Conta 2: Nome (usuario_servidor) — Servidor — Plano, vence DD/MM/AAAA às HH:MM
...

Exemplos:
- Conta 1: Marcio (marcio123) — NaTV — Mensal, vence 25/06/2026 às 23:59
- Conta 2: Marcio Juliana (apv71349) — FastTV — Trimestral, vence 02/08/2026 às 14:30

NUNCA omita o usuário do servidor — é a única forma de diferenciar contas do mesmo servidor.
NUNCA omita a hora do vencimento — clientes precisam saber se cai de manhã ou à meia-noite.
NUNCA interrompa a lista antes de listar todas as contas.

OBRIGATÓRIO sobre vencimentos: SEMPRE informe data E hora completas (ex: 25/06/2026 às 23:59). A hora é primordial — clientes precisam saber se o acesso vai cair de manhã ou à meia-noite.

## REGRAS ABSOLUTAS
1. NUNCA invente valores, datas ou dados financeiros — use as ferramentas.
2. Você é um assistente APENAS DE LEITURA E SUPORTE. NUNCA prometa fazer alterações no sistema, cancelar planos, cadastrar clientes ou gerar cobranças manuais. Se o cliente pedir uma ação dessas, informe que você é o assistente virtual e que ele deve aguardar o atendimento humano.
3. Vencimento vencido? Explique e ofereça o link de renovação.
4. verificar_cloudflare SOMENTE quando "app não abre".
5. Preços e apps sempre via ferramenta, nunca da memória.
6. **Apps** vêm sempre de recomendar_aplicativo. Nunca da memória.
7. Se não souber responder, diga que vai verificar com o suporte e que responde em breve.

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

  const { message, phone, conversation_history } = body; // 🟢 Agora recebe o phone
  if (!message?.trim()) return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });

  // Preparando lista de clientes (Array)
  let clients: any[] = [];
  let clientMatchesRaw: any[] = []; // Guardamos os resultados crus (raw) pra passar pras ferramentas se precisar

  if (phone) {
    const { data: clientMatches } = await sb
      .from("clients")
      .select(`
        id, display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username,
        server_username,
        vencimento, screens, plan_label, plan_table_id, price_amount, price_currency, technology,
        server_id, is_trial, is_archived, servers (name)
      `)
      .eq("tenant_id", tenantId)
      .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

    if (clientMatches && clientMatches.length > 0) {
      clientMatchesRaw = clientMatches;
      clients = clientMatches.map((raw) => {
        const isSec = raw.secondary_whatsapp_username === phone;
        return {
          ...raw,
          display_name: isSec ? (raw.secondary_display_name || raw.display_name || "Cliente") : (raw.display_name || "Cliente"),
          server_name: (raw.servers as any)?.name || "Servidor",
          is_secondary: isSec,
        };
      });
    }
  }

  // Se não achou conta (ou nem foi passado telefone), coloca o placeholder padrão na array
  if (clients.length === 0) {
    clients.push({
      id: null, display_name: "Cliente Teste Genérico", server_name: "Servidor Teste",
      plan_label: "Mensal", screens: 1, vencimento: null,
      price_currency: "BRL", price_amount: 0, plan_table_id: null,
      server_id: null, whatsapp_username: null,
    });
    clientMatchesRaw.push(clients[0]); // Evita erro se a tool for chamada
  }

  // Templates como base de conhecimento (removido is_active=true para ler tudo)
  const { data: templateRows } = await sb
    .from("message_templates").select("name, category, content")
    .eq("tenant_id", tenantId).order("category");

  const templatesText = (templateRows || [])
    .map((t: any) => `### [${t.category}] ${t.name}\n${t.content}`)
    .join("\n\n---\n\n");

  const systemPrompt = buildSystemPrompt(clients, templatesText, true); // 🟢 Passando o Array

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
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },

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
            case "gerar_link_portal": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              const selectedClient = clients[idx] || clients[0];
              toolResult = { link: await toolGerarLinkPortal(sb, tenantId, selectedClient) };
              break;
            }
            case "consultar_precos": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              const selectedClient = clients[idx] || clients[0];
              toolResult = await toolConsultarPrecos(sb, tenantId, selectedClient);
              break;
            }
            case "verificar_cloudflare":
              toolResult = await toolVerificarCloudflare();
              break;
            case "recomendar_aplicativo": {
              const idx = Math.max(0, (fn.args?.conta_index || 1) - 1);
              const selectedClient = clients[idx] || clients[0];
              toolResult = await toolRecomendarApplicativo(sb, tenantId, selectedClient.server_id || null);
              break;
            }
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
