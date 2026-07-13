// app/api/whatsapp/bot/flow-settings/route.ts
// GET  → mensagens globais do fluxo (saudação, sucesso, escala, retry)
// POST → salva (upsert por tenant)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_FLOW_SETTINGS,
  getFlowSettings,
  upsertFlowSettings,
  type FlowSettings,
} from "@/lib/whatsapp/bot-flow-settings";

export const dynamic = "force-dynamic";

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
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();
  return member?.tenant_id || null;
}

export async function GET(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getFlowSettings(sb, tenantId);
  return NextResponse.json({
    ok: true,
    settings,
    defaults: DEFAULT_FLOW_SETTINGS,
  });
}

export async function POST(req: Request) {
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const tenantId = await getTenantId(sb, req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const keys: (keyof FlowSettings)[] = [
    "greeting_message",
    "success_message",
    "escalate_message",
    "human_requested_message",
    "invalid_retry_message_1",
    "invalid_retry_message_2",
    "menu_invalid_intro_1",
    "menu_invalid_intro_2",
  ];
  const patch: Partial<FlowSettings> = {};
  for (const k of keys) {
    if (body[k] !== undefined) patch[k] = String(body[k] ?? "");
  }

  const result = await upsertFlowSettings(sb, tenantId, patch);
  if (result.ok === false) {
    // Tabela ainda não criada — mensagem clara pro painel
    const err = result.error;
    const msg = err.includes("bot_flow_settings") || err.includes("schema cache")
      ? "Tabela bot_flow_settings não encontrada. Rode o SQL em docs/sql/bot_flow_graph.sql no Supabase."
      : err;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true, settings: result.settings });
}
