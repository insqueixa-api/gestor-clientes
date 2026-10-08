// app/api/admin/settings/gemini/test/route.ts
// ✅ 08/10/2026 — botão "Testar" de cada card: chama cada modelo da lista
// daquele card com a chave dele (pergunta curta, sem fallback) e devolve
// status + tempo de cada um. Guarda o resultado pra aparecer no card.
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { geminiAdminClient, getGeminiRuntimeConfig, clearGeminiConfigCache } from "@/lib/ai/gemini-config";
import { testGeminiModel } from "@/lib/whatsapp/gemini-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const body = await req.json().catch(() => ({} as any));
  const which = body?.which === "free" ? "free" : "paid";

  clearGeminiConfigCache();
  const cfg = await getGeminiRuntimeConfig();
  const key = which === "paid" ? cfg.paidKey : cfg.freeKey;
  const models = which === "paid" ? cfg.paidModels : cfg.freeModels;
  if (!key) return NextResponse.json({ error: "Esse card ainda não tem chave." }, { status: 400 });

  // Em paralelo: o pior caso fica no tempo do modelo mais lento (≤15s).
  const results = await Promise.all(
    models.map(async (model) => ({ model, ...(await testGeminiModel(key, model, 15_000)) })),
  );

  const now = new Date().toISOString();
  const sb = geminiAdminClient();
  const { data: row } = await sb.from("gemini_config").select("last_test").eq("tenant_id", auth.tenant_id).maybeSingle();
  const lastTest = { ...(row?.last_test || {}), [which]: { at: now, results } };
  await sb
    .from("gemini_config")
    .upsert({ tenant_id: auth.tenant_id, last_test: lastTest, last_test_at: now, updated_at: now }, { onConflict: "tenant_id" });

  return NextResponse.json({ ok: true, which, results, at: now });
}
