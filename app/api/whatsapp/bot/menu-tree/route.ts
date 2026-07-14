// app/api/whatsapp/bot/menu-tree/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateDocumentEmbedding } from "@/lib/whatsapp/gemini-client";
import { normalizeAppliesToServers } from "@/lib/whatsapp/bot-menu";

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Embedding de intenção do nó (rótulo + palavras-chave) ────────────────────
// Alimenta o fallback semântico (searchMenuIntentCandidates) usado quando o cliente
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

// ✅ "0" (falar com humano) e "9" (voltar ao menu principal) são atalhos
// globais reservados em bot-menu.ts (isEscalationTrigger/isBackToMenuTrigger)
// — um nó de árvore com um desses números nunca seria alcançável por dígito.
function reservedOptionNumberError(n: unknown): string | null {
  const num = Number(n);
  if (num === 0) return "O número 0 é reservado para 'falar com humano' — use 1 ou maior.";
  if (num === 9) return "O número 9 é reservado para 'voltar ao menu principal' — escolha outro número.";
  return null;
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
    const { parent_id, slug, option_number, label, keywords, requires_account_check, special_actions, applies_to_servers } = body;
    const reservedErr = reservedOptionNumberError(option_number);
    if (reservedErr) return NextResponse.json({ error: reservedErr }, { status: 400 });
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
        // ✅ null/vazio = aplica a todos os servidores; array com valores
        // (NATV/FAST/ELITE) restringe a exibição só a esses.
        applies_to_servers: normalizeAppliesToServers(applies_to_servers),
        ...(embedding ? { intent_embedding: `[${embedding.join(",")}]` } : {}),
      })
      .select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, node: data });
  }

  if (action === "update_node") {
    const { id, ...rawFields } = body;
    delete rawFields.action;
    // Whitelist — evita o front gravar colunas inventadas / quebrar o row
    const ALLOWED = new Set([
      "label", "keywords", "option_number", "slug", "parent_id",
      "requires_account_check", "special_actions", "closing_message",
      "transfer_situation_label", "applies_to_servers", "is_active",
      "redirect_to_node_id", "on_resolved_target", "on_not_resolved_target",
      "ask_resolution", "invalid_retry_message_1", "invalid_retry_message_2",
    ]);
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawFields)) {
      if (ALLOWED.has(k)) fields[k] = v;
    }

    // parent_id pode ser null (vira categoria raiz / ligado ao Início)
    if (fields.parent_id !== undefined) {
      fields.parent_id = fields.parent_id == null || fields.parent_id === "" ? null : String(fields.parent_id);
      if (fields.parent_id === id) {
        return NextResponse.json({ error: "Um nó não pode ser pai de si mesmo." }, { status: 400 });
      }
    }

    if (fields.option_number !== undefined) {
      const reservedErr = reservedOptionNumberError(fields.option_number);
      if (reservedErr) return NextResponse.json({ error: reservedErr }, { status: 400 });
    }
    if (fields.applies_to_servers !== undefined) {
      fields.applies_to_servers = normalizeAppliesToServers(fields.applies_to_servers);
    }
    // Normaliza alvos de fluxo: string vazia → null; self-redirect proibido
    for (const key of ["redirect_to_node_id", "on_resolved_target", "on_not_resolved_target"] as const) {
      if (fields[key] !== undefined) {
        const v = fields[key] == null || fields[key] === "" || fields[key] === "__default__" ? null : String(fields[key]);
        fields[key] = v;
        if (v && v === id) {
          return NextResponse.json({ error: "Um nó não pode apontar para si mesmo." }, { status: 400 });
        }
      }
    }
    if (fields.redirect_to_node_id) {
      const { data: dest } = await sb.from("bot_menu_nodes").select("id").eq("id", fields.redirect_to_node_id).eq("tenant_id", tenantId).maybeSingle();
      if (!dest) return NextResponse.json({ error: "Nó de destino (continuar em) não encontrado." }, { status: 400 });
    }
    for (const key of ["on_resolved_target", "on_not_resolved_target"] as const) {
      const v = fields[key];
      if (!v) continue;
      if (v === "__success__" || v === "__escalate__" || v === "__end__") continue;
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(v)) {
        return NextResponse.json({ error: `Alvo inválido em ${key}.` }, { status: 400 });
      }
      const { data: dest } = await sb.from("bot_menu_nodes").select("id").eq("id", v).eq("tenant_id", tenantId).maybeSingle();
      if (!dest) return NextResponse.json({ error: `Nó de destino em ${key} não encontrado.` }, { status: 400 });
    }

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
    if (error) {
      const msg = /redirect_to_node_id|on_resolved_target|column/.test(error.message)
        ? `${error.message} — rode o SQL em docs/sql/bot_flow_graph.sql no Supabase.`
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
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
    const reservedErr = reservedOptionNumberError(option_number);
    if (reservedErr) return NextResponse.json({ error: reservedErr }, { status: 400 });
    const { error } = await sb.from("bot_menu_nodes").update({ option_number }).eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Passos (steps) de um nó folha ──
  if (action === "set_steps") {
    const { node_id, steps, variants } = body as {
      node_id: string;
      steps?: string[];
      // ✅ Variantes por servidor — quando presente, ignora `steps` (universal)
      // e grava um conjunto de mensagens por servidor. Ausente/vazio = modo
      // universal antigo, sem mudança de comportamento.
      variants?: { server: string; is_active: boolean; steps: string[] }[];
    };

    // Confirma que o nó pertence ao tenant antes de mexer
    const { data: node } = await sb.from("bot_menu_nodes").select("id").eq("id", node_id).eq("tenant_id", tenantId).maybeSingle();
    if (!node) return NextResponse.json({ error: "Nó não encontrado" }, { status: 404 });

    await sb.from("bot_menu_steps").delete().eq("node_id", node_id);

    const VALID_SERVERS = new Set(["NATV", "FAST", "ELITE"]);
    let rows: any[] = [];
    if (variants?.length) {
      for (const v of variants) {
        if (!VALID_SERVERS.has(v.server)) continue;
        (v.steps || []).forEach((text, i) => {
          rows.push({ node_id, step_order: i + 1, message_text: text, server: v.server, is_active: v.is_active !== false });
        });
      }
    } else if (steps?.length) {
      rows = steps.map((text, i) => ({ node_id, step_order: i + 1, message_text: text, server: null }));
    }

    if (rows.length) {
      const { error } = await sb.from("bot_menu_steps").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação desconhecida" }, { status: 400 });
}