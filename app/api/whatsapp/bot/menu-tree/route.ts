// app/api/whatsapp/bot/menu-tree/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
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
      })
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, node: data });
  }

  if (action === "update_node") {
    const { id, ...fields } = body;
    delete fields.action;
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