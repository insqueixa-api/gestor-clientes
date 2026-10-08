// app/api/admin/settings/gemini/route.ts
// ✅ 08/10/2026 — cards "Gemini Paga" / "Gemini Gratuita" em Parceiros
// (API de Integrações). GET devolve a configuração com a chave MASCARADA
// (nunca a chave inteira pro navegador); POST salva chave e ordem de
// modelos de um dos dois cards. Tabela: docs/sql/gemini_config.sql.
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { clearGeminiConfigCache, cleanModelList, DEFAULT_GEMINI_MODELS, geminiAdminClient } from "@/lib/ai/gemini-config";

export const dynamic = "force-dynamic";

function mask(key: string) {
  const k = String(key || "").trim();
  if (!k) return "";
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

export async function GET(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const { data: row } = await geminiAdminClient()
    .from("gemini_config")
    .select("*")
    .eq("tenant_id", auth.tenant_id)
    .maybeSingle();

  const envPaid = String(process.env.GEMINI_API_KEY_PAID || "").trim();
  const envFree = String(process.env.GEMINI_API_KEY || "").trim();
  const side = (dbKey: string | null | undefined, envKey: string, models: unknown) => {
    const key = String(dbKey || "").trim();
    return {
      masked_key: mask(key || envKey),
      source: key ? "painel" : envKey ? "variável de ambiente" : "nenhuma",
      models: cleanModelList(models, DEFAULT_GEMINI_MODELS),
    };
  };

  return NextResponse.json({
    ok: true,
    paid: side(row?.paid_api_key, envPaid, row?.paid_models),
    free: side(row?.free_api_key, envFree, row?.free_models),
    available_models: row?.available_models || [],
    models_synced_at: row?.models_synced_at || null,
    last_test: row?.last_test || null,
    last_test_at: row?.last_test_at || null,
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const body = await req.json().catch(() => ({} as any));
  const which = body?.which === "free" ? "free" : body?.which === "paid" ? "paid" : null;
  if (!which) return NextResponse.json({ error: "Informe qual card (paga/gratuita)." }, { status: 400 });

  const patch: Record<string, any> = { tenant_id: auth.tenant_id, updated_at: new Date().toISOString() };
  // Chave: só troca se veio uma nova (campo vazio = mantém a atual).
  const newKey = String(body?.api_key || "").trim();
  if (newKey) {
    if (!/^[A-Za-z0-9_\-]{20,200}$/.test(newKey)) {
      return NextResponse.json({ error: "Chave em formato inválido." }, { status: 400 });
    }
    patch[`${which}_api_key`] = newKey;
  }
  if (body?.clear_key === true) patch[`${which}_api_key`] = null;
  if (Array.isArray(body?.models)) {
    const models = cleanModelList(body.models, []).filter((m) => /^[a-z0-9.\-]{3,80}$/i.test(m)).slice(0, 8);
    if (!models.length) return NextResponse.json({ error: "Escolha pelo menos 1 modelo." }, { status: 400 });
    patch[`${which}_models`] = models;
  }

  const { error } = await geminiAdminClient().from("gemini_config").upsert(patch, { onConflict: "tenant_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  clearGeminiConfigCache();
  return NextResponse.json({ ok: true });
}
