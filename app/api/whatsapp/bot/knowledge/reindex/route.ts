import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
          taskType: "RETRIEVAL_DOCUMENT",
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

export async function POST(req: Request) {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();

  if (!url || !key || !geminiKey) {
    return NextResponse.json({ error: "Env vars ausentes" }, { status: 500 });
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const tenantId = body.tenant_id;
  if (!tenantId) return NextResponse.json({ error: "tenant_id obrigatório" }, { status: 400 });

  // Busca todos sem embedding
  const { data: items, error } = await sb
    .from("bot_knowledge")
    .select("id, title, content")
    .eq("tenant_id", tenantId)
    .is("embedding", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!items?.length) return NextResponse.json({ ok: true, message: "Nenhum item sem embedding", total: 0 });

  let success = 0;
  let failed = 0;

  for (const item of items) {
    const textToEmbed = `${item.title}\n\n${item.content}`;
    const embedding = await generateEmbedding(geminiKey, textToEmbed);

    if (!embedding) { failed++; continue; }

    const { error: updateErr } = await sb
      .from("bot_knowledge")
      .update({ embedding: `[${embedding.join(",")}]` })
      .eq("id", item.id)
      .eq("tenant_id", tenantId);

    if (updateErr) { failed++; } else { success++; }

    // Pausa entre chamadas para não estourar rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  return NextResponse.json({
    ok: true,
    total: items.length,
    success,
    failed,
    message: `${success} embeddings gerados, ${failed} falharam`,
  });
}