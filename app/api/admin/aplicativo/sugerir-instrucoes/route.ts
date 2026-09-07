// app/api/admin/aplicativo/sugerir-instrucoes/route.ts
//
// Sugestão de "Instruções de configuração (Portal do Cliente)" ao cadastrar/
// editar um app no catálogo (pedido do Márcio, 06/09/2026) — a maioria dos
// apps com a mesma configuração (mesmos tipos de campo, mesmo cost_type)
// usa um texto muito parecido, e escrever do zero toda vez é repetitivo.
//
// Acha o app mais parecido já cadastrado (mesmo tenant, com instruções
// preenchidas) e:
//   - se for "muito parecido" (mesmo conjunto de tipos de campo + mesmo
//     cost_type, + mesmo license_period quando pago) -> reaproveita o texto
//     dele quase igual, só troca o nome do app, SEM gastar chamada de IA.
//   - se for só "parecido" (mesmo cost_type mas fields diferentes, ou fields
//     iguais mas preço/período bem diferente) -> pede pro Gemini adaptar o
//     texto-base pro contexto do app novo, preservando qualquer {variavel}
//     usada (mesmo mecanismo de app/api/whatsapp/generate-variant/route.ts).
//   - se não achar nada parecido o bastante -> devolve suggestion:null (o
//     front esconde o card).
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { callGemini } from "@/lib/whatsapp/gemini-client";
import { APP_FIELD_LABELS, AppFieldType } from "@/lib/apps/field-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CostType = "free" | "paid" | "partnership";

function extractVariables(text: string): string[] {
  const matches = text.match(/\{[a-zA-Z0-9_]+\}/g) || [];
  return [...new Set(matches)];
}

function cleanGeneratedText(raw: string): string {
  let t = String(raw || "").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("“") && t.endsWith("”"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const appName = String(body?.app_name || "").trim() || "este aplicativo";
  const excludeAppId = String(body?.exclude_app_id || "").trim() || null;
  const costType = (String(body?.cost_type || "free").trim() || "free") as CostType;
  const licensePrice = body?.license_price != null && body?.license_price !== "" ? Number(body.license_price) : null;
  const licensePeriod = String(body?.license_period || "").trim() || null;
  const fieldTypes: string[] = Array.isArray(body?.field_types) ? body.field_types.map(String) : [];

  const { data: candidates, error } = await supabase
    .from("apps")
    .select("id, name, fields_config, cost_type, license_price, license_period, portal_setup_instructions")
    .eq("tenant_id", tenantId)
    .not("portal_setup_instructions", "is", null)
    .neq("portal_setup_instructions", "");

  if (error) {
    return NextResponse.json({ ok: false, error: "Erro ao buscar apps parecidos." }, { status: 500 });
  }

  const inputFieldSet = new Set(fieldTypes);
  let best: { app: any; score: number; exact: boolean } | null = null;

  for (const app of candidates || []) {
    if (excludeAppId && app.id === excludeAppId) continue;
    const text = String(app.portal_setup_instructions || "").trim();
    if (!text) continue;

    const candFields = Array.isArray(app.fields_config) ? app.fields_config : [];
    const candFieldSet = new Set(candFields.map((f: any) => String(f?.type || "")).filter(Boolean));
    const fieldSim = jaccard(inputFieldSet, candFieldSet);
    const costMatch = app.cost_type === costType ? 1 : 0;

    let priceSim = 1;
    if (costType === "paid" && licensePrice != null && app.cost_type === "paid" && Number(app.license_price) > 0) {
      const diff = Math.abs(Number(app.license_price) - licensePrice);
      const base = Math.max(Number(app.license_price), licensePrice, 1);
      priceSim = Math.max(0, 1 - diff / base);
    }

    const score = fieldSim * 0.6 + costMatch * 0.3 + priceSim * 0.1;
    const exact =
      fieldSim === 1 &&
      costMatch === 1 &&
      (costType !== "paid" || app.license_period === licensePeriod);

    if (!best || score > best.score) {
      best = { app, score, exact };
    }
  }

  if (!best || best.score < 0.45) {
    return NextResponse.json({ ok: true, suggestion: null });
  }

  const baseText = String(best.app.portal_setup_instructions || "").trim();
  const baseName = String(best.app.name || "").trim();

  // Caminho barato: app quase idêntico -> reaproveita o texto quase igual,
  // só troca o nome do app onde aparecer, sem gastar chamada de IA.
  if (best.exact) {
    const suggestion = baseName ? baseText.split(baseName).join(appName) : baseText;
    return NextResponse.json({ ok: true, suggestion, basedOnAppName: baseName, viaAI: false });
  }

  // Caminho via IA: só parecido, não idêntico -> pede pra adaptar mantendo
  // o tom/formato e qualquer {variavel} usada no texto-base.
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const variables = extractVariables(baseText);
  const varsList = variables.length ? variables.map((v) => `- ${v}`).join("\n") : "";
  const fieldLabels =
    fieldTypes.map((t) => APP_FIELD_LABELS[t as AppFieldType] || t).join(", ") || "nenhum campo específico";
  const custoDescricao =
    costType === "free"
      ? "gratuito"
      : costType === "partnership"
        ? "parceria (custo já embutido no plano do servidor)"
        : `pago${licensePrice ? `, licença de R$${licensePrice}` : ""}${
            licensePeriod ? ` (${licensePeriod === "annual" ? "anual" : licensePeriod === "lifetime" ? "vitalícia" : licensePeriod})` : ""
          }`;

  const prompt = `Você escreve as instruções de configuração que aparecem no Portal do Cliente de um provedor de IPTV, explicando pro cliente final como configurar um aplicativo específico.

Abaixo está um texto de exemplo, já usado e aprovado, para o app "${baseName}" (${custoDescricao}):
"""
${baseText}
"""

Escreva um texto equivalente para o novo app "${appName}" (${custoDescricao}), que usa estes campos: ${fieldLabels}. Mantenha o mesmo tom, formato e nível de detalhe do exemplo — mude só o que for específico do app anterior.

REGRAS OBRIGATÓRIAS:
${
  varsList
    ? `- Estas variáveis (placeholders no formato {nome}) precisam continuar aparecendo, escritas exatamente como estão:\n${varsList}\n- Não invente nenhuma variável nova.`
    : "- Não use nenhuma variável no formato {nome} a menos que faça sentido óbvio pro contexto."
}
- Não invente preço, prazo ou informação que não esteja no contexto acima.
- Não use markdown, títulos ou aspas — responda só com o texto final, pronto pra ser usado.`;

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
    const suggestion = cleanGeneratedText(rawText);
    if (!suggestion) {
      return NextResponse.json({ ok: false, error: "A IA não retornou um texto válido. Tente de novo." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, suggestion, basedOnAppName: baseName, viaAI: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao gerar sugestão com o Gemini." }, { status: 500 });
  }
}
