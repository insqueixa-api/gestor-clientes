// app/api/system-health/explain/route.ts
// ✅ 31/08/2026, pedido do Márcio: botão "Explique com IA" em cada item do
// painel Sistema — não é uma investigação nova, é o Gemini explicando em
// português simples o diagnóstico que a própria checagem já levantou (o
// `detail` de cada item já carrega o dado técnico real: contagem de
// falhas, mensagem de erro, validade, etc). Mesmo padrão de fallback
// grátis→paga de qualquer outra chamada Gemini do projeto (callGemini).
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { callGemini } from "@/lib/whatsapp/gemini-client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const label = String(body?.label || "").trim();
  const status = String(body?.status || "").trim();
  const detail = String(body?.detail || "").trim();
  if (!label || !status) {
    return NextResponse.json({ error: "label e status são obrigatórios" }, { status: 400 });
  }

  const prompt = `Você está explicando um item de um painel de monitoramento interno de um sistema de gestão (IPTV + condomínio) pro dono do sistema, que não é técnico mas administra tudo sozinho.

Item do painel: "${label}"
Status atual: ${status === "fail" ? "FALHA (vermelho)" : status === "warn" ? "ATENÇÃO (amarelo)" : "OK (verde)"}
Detalhe técnico registrado pela checagem automática: "${detail || "(sem detalhe adicional — está tudo normal)"}"

Responda em português do Brasil, direto e sem jargão desnecessário, em no máximo 4-5 frases curtas:
1. O que esse item verifica, em 1 frase simples.
2. O que o status/detalhe atual significa na prática (impacto real, se houver).
3. Se for FALHA ou ATENÇÃO: o que fazer a seguir, de forma concreta. Se for OK: só confirme que está tudo bem, sem inventar problema.

Não use markdown, não use títulos numerados na resposta, escreva como um parágrafo corrido ou 2 curtos.`;

  try {
    const result = await callGemini(
      geminiKey,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      },
      25_000,
    );
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "IA não retornou explicação (resposta vazia)" }, { status: 502 });
    }
    return NextResponse.json({ explanation: text });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message?.slice(0, 300) || "Falha ao consultar a IA" }, { status: 502 });
  }
}
