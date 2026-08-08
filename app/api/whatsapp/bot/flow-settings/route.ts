// app/api/whatsapp/bot/flow-settings/route.ts
// GET  → mensagens globais do fluxo (saudação, sucesso, escala, retry)
// POST → salva (upsert por tenant)

import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import {
  DEFAULT_FLOW_SETTINGS,
  getFlowSettings,
  upsertFlowSettings,
  type FlowSettings,
} from "@/lib/whatsapp/bot-flow-settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: sb, tenant_id: tenantId } = auth;

  const settings = await getFlowSettings(sb, tenantId);
  return NextResponse.json({
    ok: true,
    settings,
    defaults: DEFAULT_FLOW_SETTINGS,
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: sb, tenant_id: tenantId } = auth;

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
    "coupon_found_intro",
    "coupon_not_found_message",
    "payment_auto_confirmed_message",
    "payment_manual_pending_message",
    "payment_fulfillment_error_message",
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
