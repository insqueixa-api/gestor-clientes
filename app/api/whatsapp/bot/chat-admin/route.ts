// app/api/whatsapp/bot/chat-admin/route.ts
// Rota exclusiva do painel admin para testar e ensinar o bot.
// NÃO envia mensagens pro WhatsApp real — só retorna a resposta do agente.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePortalLink } from "@/lib/whatsapp/template-vars";
// 🟢 Importando as definições unificadas (A Fonte Única de Verdade)
import { BOT_TOOL_DECLARATIONS, buildBotSystemPrompt, toBRDateTime } from "@/lib/whatsapp/bot-prompt";

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

// ── As definições das ferramentas (TOOL_DECLARATIONS) e o System Prompt 
// ── foram movidos para @/lib/whatsapp/bot-prompt.ts para evitar duplicação.

// ── Handler ───────────────────────────────────────────────────────────────────

// ── RAG: Gerar embedding e buscar conhecimento relevante ─────────────────────

async function generateEmbedding(apiKey: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_QUERY",
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
  limit = 10
): Promise<string> {
  try {
    const { data, error } = await sb.rpc("search_bot_knowledge", {
      p_tenant_id: tenantId,
      p_embedding: `[${embedding.join(",")}]`,
      p_limit: limit,
      p_threshold: 0.3,
    });

    if (error || !data?.length) return "(nenhum conhecimento relevante encontrado)";

    return data
      .map((row: any) => `### [${row.category}] ${row.title}\n${row.content}`)
      .join("\n\n---\n\n");
  } catch {
    return "(erro ao buscar base de conhecimento)";
  }
}

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

  const { message, phone, conversation_history } = body; 
  if (!message?.trim()) return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });

  // Preparando lista de clientes (Array)
  let clients: any[] = [];
  let clientMatchesRaw: any[] = []; 

  if (phone) {
    const { data: clientMatches } = await sb
  .from("clients")
  .select(`
    id, display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username,
    server_username, server_password,
    vencimento, screens, plan_label, plan_table_id, price_amount, price_currency, technology,
    server_id, is_trial, is_archived, servers (name, dns, is_offline, offline_since, offline_reason)
  `)
  .eq("tenant_id", tenantId)
  .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

    if (clientMatches && clientMatches.length > 0) {
      clientMatchesRaw = clientMatches;
      clients = clientMatches.map((raw) => {
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
    clientMatchesRaw.push(clients[0]); 
  }

  // ── RAG: busca conhecimento relevante para esta mensagem ─────────────────
  let templatesText = "(nenhum conhecimento relevante encontrado)";
  try {
    const embedding = await generateEmbedding(geminiKey, message.trim());
    if (embedding) {
      const { data: ragData, error: ragErr } = await sb.rpc("search_bot_knowledge", {
        p_tenant_id: tenantId,
        p_embedding: `[${embedding.join(",")}]`,
        p_limit: 10,
        p_threshold: 0.3,
      });
      if (!ragErr && ragData?.length) {
        templatesText = ragData
          .map((row: any) => `### [${row.category}] ${row.title}\n${row.content}`)
          .join("\n\n---\n\n");
      }
    }
  } catch (e: any) {
    safeLog("[BOT][chat-admin] RAG erro:", e?.message);
  }

  const [{ data: recentJobs }, { data: recentPayments }] = await Promise.all([
  sb
    .from("client_message_jobs")
    .select("sent_at, message_template_id, status")
    .eq("tenant_id", tenantId)
    .in("client_id", clients.map((c: any) => c.id).filter(Boolean))
    .eq("status", "SENT")
    .order("sent_at", { ascending: false })
    .limit(3),
  sb
    .from("client_portal_payments")
    .select("created_at, status, fulfillment_status, whatsapp_status, new_vencimento, price_amount, price_currency, period")
    .eq("tenant_id", tenantId)
    .in("client_id", clients.map((c: any) => c.id).filter(Boolean))
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

const systemPrompt = buildBotSystemPrompt(clients, templatesText, {
  isTest: true,
  historicoRecente,
});

  // Monta conversa com histórico (multi-turn)
  const history = Array.isArray(conversation_history) ? conversation_history : [];
  const contents = [
    ...history,
    { role: "user", parts: [{ text: message.trim() }] },
  ];

  const geminiPayload: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] }, 
    tools: [{ functionDeclarations: BOT_TOOL_DECLARATIONS }], // 🟢 Usando as ferramentas unificadas
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  // Loop de tool calling
  let finalResponse = "";
  const newContents = [...contents];

  try { 
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
    updated_history: newContents,
  });
}