// app/api/admin/condominio/revisar-texto/route.ts
// Revisão de texto por IA pras Ações do módulo Condomínio — mesmo padrão de
// app/api/whatsapp/generate-variant/route.ts (requireAdminTenant + callGemini
// já existentes no projeto), só trocando o prompt pelo do protótipo local
// (Vidamerica/lib/gemini.ts), com o nome do condomínio dinâmico em vez de
// fixo "Vidamérica".
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { callGemini } from "@/lib/whatsapp/gemini-client";
import { isRichHtml, sanitizeRichHtml } from "@/lib/rich-text/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanGeneratedText(raw: string): string {
  let t = String(raw || "").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export async function POST(req: Request) {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  // ✅ 08/10/2026: chave principal vem do painel (Parceiros → Gemini, lib/ai/gemini-config.ts);
  // a env var é só reserva — sem trava aqui, callGemini avisa se não houver chave nenhuma.

  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { tenant_id: authTenantId } = auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String(body?.tenant_id || "").trim();
  const titulo = String(body?.titulo || "item do informativo").trim();
  const texto = String(body?.texto || "").trim();
  const nomeCondominio = String(body?.nomeCondominio || "o condomínio").trim();

  if (!tenantId || !texto) {
    return NextResponse.json({ error: "tenant_id e texto são obrigatórios" }, { status: 400 });
  }
  if (tenantId !== authTenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ✅ 30/09/2026: texto do editor novo vem em HTML (negrito, listas…) —
  // a IA revisa só as palavras e MANTÉM as tags; a saída passa pelo
  // sanitizador. Texto antigo (puro) segue o prompt de sempre.
  const rico = isRichHtml(texto);
  const regraFormato = rico
    ? "O texto está em HTML simples (tags <p>, <strong>, <em>, <u>, <s>, <ul>, <ol>, <li>, <blockquote>, <a>, <br>). Revise apenas as palavras: mantenha exatamente as mesmas tags em volta dos mesmos trechos, a mesma estrutura de parágrafos e listas, e os mesmos links. Não acrescente tags novas nem markdown. Devolva apenas o HTML revisado, sem aspas, sem ``` e sem comentários."
    : "Não use markdown, listas com marcadores ou títulos. Devolva apenas o texto revisado corrido, sem aspas e sem comentários.";

  const prompt = `Você é o revisor de texto do informativo semanal/mensal de um condomínio residencial, o ${nomeCondominio}.

Revise o texto abaixo, referente ao item "${titulo}", deixando a redação mais clara, natural e bem escrita em português do Brasil, no mesmo tom institucional e cordial usado em comunicados de condomínio. Mantenha o mesmo sentido e as mesmas informações do original. Não invente fatos, números, valores ou prazos que não estejam no texto original. ${regraFormato}

Texto original:
"""
${texto}
"""`;

  try {
    const result = await callGemini(
      geminiKey,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      },
      30_000,
    );
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const limpo = cleanGeneratedText(rawText);
    const sugestao = rico ? sanitizeRichHtml(limpo) : limpo;
    if (!sugestao) {
      return NextResponse.json({ error: "A IA não retornou um texto válido. Tente de novo." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, sugestao });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao revisar com o Gemini." }, { status: 500 });
  }
}
