// app/api/whatsapp/bot/menu-tree/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateDocumentEmbedding } from "@/lib/whatsapp/gemini-client";

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Embedding de intenção do nó (rótulo + palavras-chave) ────────────────────
// Alimenta o fallback semântico (searchMenuIntentTop) usado quando o cliente
// escreve algo que não bate literalmente com nenhuma palavra-chave cadastrada.
// Falha aberta: se faltar GEMINI_API_KEY ou a chamada falhar, o nó salva
// normalmente sem embedding — a detecção por palavra-chave continua
// funcionando de qualquer forma, só o fallback semântico fica indisponível
// pra esse nó específico.
function buildIntentText(label: string, keywords: string[]): string {
  const kw = (keywords || []).filter(Boolean).join(", ");
  return kw ? `${label}. Palavras relacionadas: ${kw}` : label;
}

async function tryGenerateIntentEmbedding(label: string, keywords: string[]): Promise<number[] | null> {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey || !label?.trim()) return null;
  try {
    // ✅ Modo "documento" (RETRIEVAL_DOCUMENT) — a categoria é o conteúdo que
    // será ENCONTRADO depois. Usar o modo "consulta" aqui foi o bug que
    // fazia mensagens sem relação nenhuma (ex: "Olá, tudo bem?") passarem no
    // threshold de similaridade contra categorias como "Nova instalação".
    return await generateDocumentEmbedding(geminiKey, buildIntentText(label, keywords));
  } catch {
    return null;
  }
}

async function getTenantId(sb: any, req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: authData } = await sb.auth.getUser(token);
  if (!authData?.user?.id) return null;
  const { data: member } = await sb
    .from("tenant_members").select("tenant_id")
    .eq("user_id", authData.user.id).limit(1).maybeSingle();
  return member?.tenant_id || null;
}

// ── GET: retorna a árvore inteira (flat) + todos os passos, pro front montar ──
export async function GET(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: nodes, error: nodesErr } = await sb
    .from("bot_menu_nodes")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("parent_id", { ascending: true, nullsFirst: true })
    .order("option_number", { ascending: true });

  if (nodesErr) return NextResponse.json({ error: nodesErr.message }, { status: 500 });

  const nodeIds = (nodes || []).map((n: any) => n.id);
  const { data: steps } = nodeIds.length
    ? await sb.from("bot_menu_steps").select("*").in("node_id", nodeIds).order("step_order", { ascending: true })
    : { data: [] };

  return NextResponse.json({ ok: true, nodes: nodes || [], steps: steps || [] });
}

// ── POST: cria nó, cria/atualiza passos, ou executa uma ação (o "action" no body decide) ──
export async function POST(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === "create_node") {
    const { parent_id, slug, option_number, label, keywords, requires_account_check, special_actions } = body;
    // ✅ "0" é reservado como atalho global de "falar com humano"
    // (isEscalationTrigger, em bot-menu.ts) — uma opção de árvore com esse
    // número nunca seria alcançável por dígito.
    if (Number(option_number) === 0) {
      return NextResponse.json({ error: "O número 0 é reservado para 'falar com humano' — use 1 ou maior." }, { status: 400 });
    }
    const embedding = await tryGenerateIntentEmbedding(label, keywords || []);
    const { data, error } = await sb
      .from("bot_menu_nodes")
      .insert({
        tenant_id: tenantId,
        parent_id: parent_id || null,
        slug: slug || null,
        option_number,
        label,
        keywords: keywords || [],
        requires_account_check: !!requires_account_check,
        special_actions: special_actions || [],
        ...(embedding ? { intent_embedding: `[${embedding.join(",")}]` } : {}),
      })
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, node: data });
  }

  if (action === "update_node") {
    const { id, ...fields } = body;
    delete fields.action;
    if (fields.option_number !== undefined && Number(fields.option_number) === 0) {
      return NextResponse.json({ error: "O número 0 é reservado para 'falar com humano' — use 1 ou maior." }, { status: 400 });
    }
    // ✅ Regenera o embedding de intenção sempre que o rótulo ou as
    // palavras-chave mudam — busca os valores atuais pra completar o que
    // não veio nesse payload específico (ex: salvar só passos não deveria
    // apagar o embedding existente).
    if (fields.label !== undefined || fields.keywords !== undefined) {
      const { data: current } = await sb.from("bot_menu_nodes").select("label, keywords").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      const finalLabel = fields.label ?? current?.label ?? "";
      const finalKeywords = fields.keywords ?? current?.keywords ?? [];
      const embedding = await tryGenerateIntentEmbedding(finalLabel, finalKeywords);
      if (embedding) fields.intent_embedding = `[${embedding.join(",")}]`;
    }
    const { data, error } = await sb
      .from("bot_menu_nodes")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).eq("tenant_id", tenantId)
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, node: data });
  }

  if (action === "delete_node") {
    const { id } = body;
    const { error } = await sb.from("bot_menu_nodes").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reorder_node") {
    const { id, option_number } = body;
    if (Number(option_number) === 0) {
      return NextResponse.json({ error: "O número 0 é reservado para 'falar com humano' — use 1 ou maior." }, { status: 400 });
    }
    const { error } = await sb.from("bot_menu_nodes").update({ option_number }).eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Passos (steps) de um nó folha ──
  if (action === "set_steps") {
    const { node_id, steps } = body as { node_id: string; steps: string[] };

    // Confirma que o nó pertence ao tenant antes de mexer
    const { data: node } = await sb.from("bot_menu_nodes").select("id").eq("id", node_id).eq("tenant_id", tenantId).maybeSingle();
    if (!node) return NextResponse.json({ error: "Nó não encontrado" }, { status: 404 });

    await sb.from("bot_menu_steps").delete().eq("node_id", node_id);
    if (steps?.length) {
      const rows = steps.map((text, i) => ({ node_id, step_order: i + 1, message_text: text }));
      const { error } = await sb.from("bot_menu_steps").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação desconhecida" }, { status: 400 });
}