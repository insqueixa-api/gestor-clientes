// lib/ai/gemini-config.ts
// ✅ 08/10/2026, pedido do Márcio: chaves e ordem de modelos do Gemini vêm
// do painel (2 cards em Parceiros: "Gemini Paga" e "Gemini Gratuita"; tabela
// gemini_config, docs/sql/gemini_config.sql) — se o Google aposentar ou
// sobrecarregar um modelo, ele troca lá sem deploy. Cada chave tem a sua
// ordem de modelos. Sem linha no banco (ou campo vazio): cai nas env vars e
// na lista padrão. Só servidor (service role). Cache de 60s por instância
// pra não consultar o banco a cada captcha; salvar limpa o cache da
// instância que salvou (as outras pegam em até 60s).
import { createClient } from "@supabase/supabase-js";

// Testado em 08/10/2026 com captchas reais do IBO: os dois primeiros em
// ~1s e lendo o mesmo texto; flash-latest estava 503/travado.
export const DEFAULT_GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"];

export type GeminiRuntimeConfig = {
  paidKey: string;
  paidModels: string[];
  freeKey: string;
  freeModels: string[];
};

let cache: { at: number; value: GeminiRuntimeConfig } | null = null;
const CACHE_MS = 60_000;

export function clearGeminiConfigCache() {
  cache = null;
}

export function cleanModelList(v: unknown, fallback: string[] = DEFAULT_GEMINI_MODELS): string[] {
  const list = Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
  return list.length ? [...new Set(list)] : fallback;
}

export function geminiAdminClient() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getGeminiRuntimeConfig(): Promise<GeminiRuntimeConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  let row: any = null;
  try {
    // Sistema de um tenant só: pega a configuração salva (se houver).
    const { data } = await geminiAdminClient()
      .from("gemini_config")
      .select("paid_api_key, paid_models, free_api_key, free_models")
      .order("updated_at", { ascending: false })
      .limit(1);
    row = data?.[0] || null;
  } catch {
    // banco fora/tabela ausente → segue com env vars
  }

  const value: GeminiRuntimeConfig = {
    paidKey: String(row?.paid_api_key || "").trim() || String(process.env.GEMINI_API_KEY_PAID || "").trim(),
    paidModels: cleanModelList(row?.paid_models),
    freeKey: String(row?.free_api_key || "").trim() || String(process.env.GEMINI_API_KEY || "").trim(),
    freeModels: cleanModelList(row?.free_models),
  };
  cache = { at: Date.now(), value };
  return value;
}
