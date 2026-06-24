// app/api/whatsapp/bot/knowledge/route.ts
// CRUD da base de conhecimento RAG do bot
// GET  → lista todos os itens do tenant
// POST → cria novo item (gera embedding automaticamente)
// PUT  → edita item existente (regenera embedding)
// DELETE → remove item

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getTenantId(sb: any, authHeader: string): Promise<string | null> {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: authData } = await sb.auth.getUser(token);
  if (!authData?.user?.id) return null;
  const { data: member } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();
  return member?.tenant_id ?? null;
}

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

// ── GET — listar todos + busca por texto ──────────────────────────────────────
export async function GET(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req.headers.get("authorization") || "");
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const search = url.searchParams.get("q")?.trim() || "";
  const category = url.searchParams.get("category")?.trim() || "";

  let query = sb
    .from("bot_knowledge")
    .select("id, title, category, content, is_active, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("category", { ascending: true })
    .order("title", { ascending: true });

  if (search) {
    query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
  }
  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: data || [] });
}

// ── POST — criar novo item ────────────────────────────────────────────────────
export async function POST(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req.headers.get("authorization") || "");
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY ausente" }, { status: 500 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const { title, category, content } = body;
  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: "title e content são obrigatórios" }, { status: 400 });
  }

  // Gera embedding com título + conteúdo para melhor semântica
  const textToEmbed = `${title.trim()}\n\n${content.trim()}`;
  const embedding = await generateEmbedding(geminiKey, textToEmbed);

  const { data, error } = await sb.from("bot_knowledge").insert({
    tenant_id: tenantId,
    title: title.trim(),
    category: (category || "Geral").trim(),
    content: content.trim(),
    embedding: embedding ? `[${embedding.join(",")}]` : null,
    is_active: true,
  }).select("id, title, category, content, is_active, created_at").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    data,
    embedding_generated: !!embedding,
  });
}

// ── PUT — editar item existente ───────────────────────────────────────────────
export async function PUT(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req.headers.get("authorization") || "");
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  
  // DEBUG TEMPORÁRIO — remover após confirmar
  console.log("[KNOWLEDGE PUT] geminiKey presente:", !!geminiKey, "length:", geminiKey.length);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const { id, title, category, content, is_active } = body;
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  const updatePayload: any = {};
  if (title !== undefined) updatePayload.title = title.trim();
  if (category !== undefined) updatePayload.category = category.trim();
  if (content !== undefined) updatePayload.content = content.trim();
  if (is_active !== undefined) updatePayload.is_active = is_active;

  // Regenera embedding sempre que chamado com geminiKey disponível
  if (geminiKey) {
    // Busca valores atuais para compor o texto completo
    const { data: current } = await sb
      .from("bot_knowledge")
      .select("title, content")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    const finalTitle = updatePayload.title ?? current?.title ?? "";
    const finalContent = updatePayload.content ?? current?.content ?? "";
    const textToEmbed = `${finalTitle}\n\n${finalContent}`;
    const embedding = await generateEmbedding(geminiKey, textToEmbed);
    if (embedding) updatePayload.embedding = `[${embedding.join(",")}]`;
  }

  const { data, error } = await sb
    .from("bot_knowledge")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id, title, category, content, is_active, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data });
}

// ── DELETE — remover item ─────────────────────────────────────────────────────
export async function DELETE(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req.headers.get("authorization") || "");
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  const { error } = await sb
    .from("bot_knowledge")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
