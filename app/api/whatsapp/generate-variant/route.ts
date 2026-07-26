// app/api/whatsapp/generate-variant/route.ts
// Gera uma variação de texto pra uma mensagem de template, usando o Gemini
// já integrado no projeto (lib/whatsapp/gemini-client.ts) — pedido do
// Márcio (26/07/2026): escrever a mensagem principal do jeito dele e deixar
// a IA sugerir reescritas parecidas (mesmo contexto/intenção, texto livre),
// mantendo as variáveis {tag} usadas. Faz parte da mesma frente de variação
// de mensagens da campanha de cobrança (ver
// docs/sql/message_template_variants.sql) — aqui só GERA o texto, quem
// salva como variante é o front (message_template_variants), igual ao botão
// "+ Adicionar variação" manual.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callGemini } from "@/lib/whatsapp/gemini-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function extractVariables(text: string): Set<string> {
  const matches = text.match(/\{[a-zA-Z0-9_]+\}/g) || [];
  return new Set(matches);
}

function cleanGeneratedText(raw: string): string {
  let t = String(raw || "").trim();
  // remove blocos de código markdown, se o Gemini insistir em envolver
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  // remove aspas envolvendo a mensagem inteira
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

async function requestVariant(apiKey: string, original: string, variables: string[], attempt: number): Promise<string> {
  const varsList = variables.length
    ? variables.map((v) => `- ${v}`).join("\n")
    : "(nenhuma)";

  const reinforcement =
    attempt > 1
      ? "\n\nATENÇÃO: na tentativa anterior você não manteve todas as variáveis pedidas. Confira com cuidado antes de responder — cada uma das variáveis listadas precisa aparecer EXATAMENTE escrita como está (com as chaves { }), sem alterar nenhum caractere."
      : "";

  const prompt = `Você é um redator de mensagens de WhatsApp para uma empresa de assinatura de IPTV. Reescreva a mensagem abaixo criando uma VARIAÇÃO com texto diferente, mas mantendo o mesmo contexto, intenção e tom (cordial, direto, em português do Brasil, como uma mensagem real de WhatsApp — não formal demais).

Pode mudar completamente a estrutura das frases, a ordem das informações, os emojis e a saudação — só não pode mudar o SENTIDO da mensagem.

REGRAS OBRIGATÓRIAS sobre variáveis (placeholders no formato {nome_da_variavel}):
${varsList}
- Cada variável listada acima precisa aparecer no texto final, escrita exatamente como está (com as chaves).
- Não invente nenhuma variável nova que não esteja na lista acima.
- Não explique nada, não use markdown, não coloque aspas — responda APENAS com o texto final da mensagem, pronto pra ser usado.

Mensagem original:
"""
${original}
"""${reinforcement}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    // ⚠️ gemini-flash-latest hoje é um modelo "thinking" que consome ~700-1000
    // tokens de raciocínio interno ANTES de escrever a resposta, e esse
    // raciocínio conta dentro do mesmo maxOutputTokens — com um budget baixo
    // (ex: 500) o finishReason vem MAX_TOKENS e o texto sai vazio/cortado.
    // thinkingConfig.thinkingBudget=0 dá 400 (não suportado nesse modelo),
    // por isso o ajuste é só um teto folgado.
    generationConfig: { temperature: 0.95, maxOutputTokens: 2048 },
  };

  const result = await callGemini(apiKey, payload, 30_000);
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return cleanGeneratedText(rawText);
}

export async function POST(req: Request) {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!supabaseUrl || !serviceKey || !geminiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: authData, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !authData?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const authedUserId = authData.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String(body?.tenant_id || "").trim();
  const content = String(body?.content || "").trim();
  if (!tenantId || !content) {
    return NextResponse.json({ error: "tenant_id e content são obrigatórios" }, { status: 400 });
  }

  const { data: mem, error: memErr } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", authedUserId)
    .maybeSingle();
  if (memErr || !mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const requiredVars = [...extractVariables(content)];

  try {
    let generated = "";
    let ok = false;

    for (let attempt = 1; attempt <= 2; attempt++) {
      generated = await requestVariant(geminiKey, content, requiredVars, attempt);
      const gotVars = extractVariables(generated);
      ok = requiredVars.every((v) => gotVars.has(v));
      if (ok && generated) break;
    }

    if (!ok || !generated) {
      return NextResponse.json(
        { error: "A IA não conseguiu manter todas as variáveis da mensagem original. Tente de novo." },
        { status: 422 },
      );
    }

    return NextResponse.json({ ok: true, content: generated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao gerar variação." }, { status: 500 });
  }
}
