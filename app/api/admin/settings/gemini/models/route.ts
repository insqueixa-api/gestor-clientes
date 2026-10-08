// app/api/admin/settings/gemini/models/route.ts
// ✅ 08/10/2026 — botão "Buscar modelos": pergunta ao Google quais modelos
// a chave pode usar pra gerar texto (e ler imagem, que o captcha precisa) e
// guarda a lista pra montar os seletores de primário/secundário/... .
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { geminiAdminClient, getGeminiRuntimeConfig, clearGeminiConfigCache } from "@/lib/ai/gemini-config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  clearGeminiConfigCache();
  const cfg = await getGeminiRuntimeConfig();
  const key = cfg.paidKey || cfg.freeKey;
  if (!key) return NextResponse.json({ error: "Cadastre uma chave antes de buscar os modelos." }, { status: 400 });

  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: json?.error?.message || `Google respondeu ${res.status}` }, { status: 502 });
    }
    // Só o que gera texto; fora imagem/áudio/embedding/TTS/live (não servem
    // pra captcha nem pra texto do sistema).
    const models = (json.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m: any) => ({
        name: String(m.name || "").replace(/^models\//, ""),
        display_name: m.displayName || "",
        description: String(m.description || "").slice(0, 160),
      }))
      .filter((m: any) => /^gemini-/i.test(m.name) && !/tts|audio|image|embedding|live|native/i.test(m.name))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    const now = new Date().toISOString();
    await geminiAdminClient()
      .from("gemini_config")
      .upsert({ tenant_id: auth.tenant_id, available_models: models, models_synced_at: now, updated_at: now }, { onConflict: "tenant_id" });
    return NextResponse.json({ ok: true, models, models_synced_at: now });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao consultar o Google" }, { status: 502 });
  }
}
