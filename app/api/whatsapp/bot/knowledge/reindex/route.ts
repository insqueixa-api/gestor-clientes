// app/api/whatsapp/bot/knowledge/reindex/route.ts
// Gera embeddings em lote para todos os itens sem embedding
// Chamar via POST com { tenant_id: "..." }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function generateEmbedding(apiKey: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[REINDEX] Gemini erro:", res.status, err.slice(0, 200));
      return null;
    }
    const data = await res.json();
    return data?.embedding?.values ?? null;
  } catch (e: any) {
    console.error("[REINDEX] generateEmbedding erro:", e?.message);
    return null;
  }
}

export async function POST(req: Request) {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();

  console.log("[REINDEX] geminiKey presente:", !!geminiKey, "length:", geminiKey.length);

  if (!url || !key) return NextResponse.json({ error: "Supabase env vars ausentes" }, { status: 500 });
  if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY ausente" }, { status: 500 });

  const sb = createClient(url, key, { auth: { persistSession: false } });

  let tenantId: string | undefined;
  try {
    const body = await req.json();
    tenantId = body.tenant_id;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!tenantId) return NextResponse.json({ error: "tenant_id obrigatório" }, { status: 400 });

  // Busca todos sem embedding
  const { data: items, error } = await sb
    .from("bot_knowledge")
    .select("id, title, content")
    .eq("tenant_id", tenantId)
    .is("embedding", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!items?.length) return NextResponse.json({ ok: true, message: "Nenhum item sem embedding", total: 0 });

  console.log("[REINDEX] Itens sem embedding:", items.length);

  const results: { id: string; title: string; ok: boolean; error?: string }[] = [];

  for (const item of items) {
    const textToEmbed = `${item.title}\n\n${item.content}`;
    const embedding = await generateEmbedding(geminiKey, textToEmbed);

    if (!embedding) {
      console.error("[REINDEX] Falha embedding para:", item.title);
      results.push({ id: item.id, title: item.title, ok: false, error: "embedding falhou" });
      continue;
    }

    const { error: updateErr } = await sb
      .from("bot_knowledge")
      .update({ embedding: `[${embedding.join(",")}]` })
      .eq("id", item.id)
      .eq("tenant_id", tenantId);

    if (updateErr) {
      console.error("[REINDEX] Update falhou para:", item.title, updateErr.message);
      results.push({ id: item.id, title: item.title, ok: false, error: updateErr.message });
    } else {
      console.log("[REINDEX] ✅", item.title);
      results.push({ id: item.id, title: item.title, ok: true });
    }

    // Pausa entre chamadas para não estourar rate limit do Google
    await new Promise(r => setTimeout(r, 400));
  }

  const success = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  return NextResponse.json({
    ok: true,
    total: items.length,
    success,
    failed,
    results,
    message: `${success} embeddings gerados, ${failed} falharam`,
  });
}