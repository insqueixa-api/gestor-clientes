// app/api/whatsapp/bot/chat-admin/route.ts
// Simulador do painel — usa o mesmo motor de árvore de agent/route.ts
// (lib/whatsapp/bot-engine.ts), só que nunca manda WhatsApp de verdade:
// as mensagens ficam empilhadas em `sentMessages` e voltam no JSON.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveClientProvider, getNodeById, type ServerProvider } from "@/lib/whatsapp/bot-menu";
import { getFlowSettings } from "@/lib/whatsapp/bot-flow-settings";
import { runBotEngine } from "@/lib/whatsapp/bot-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function makeSupabaseAdmin() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ✅ Traduz o next_state técnico (ex: "menunode:6d0aea8b-...") pra algo que
// você reconhece na hora (o nome do nó), em vez do UUID cru — só pra
// exibição no rodapé de debug do simulador, o valor técnico continua
// indo normalmente em next_state pro front controlar o fluxo.
async function resolveStateLabel(sb: any, nextState: string | undefined | null): Promise<string | null> {
  if (!nextState || nextState === "__clear__") return null;
  if (nextState === "geral") return "Conversa livre";
  if (nextState === "geral_retry") return "Conversa livre (2ª tentativa)";
  if (nextState === "aguardando_resposta") return "Aguardando 1ª resposta do menu";
  if (nextState === "aguardando_resposta_2") return "Aguardando resposta (última tentativa)";
  const confirmSwitchM = /^confirm_switch:([a-f0-9-]+):([a-f0-9-]+)$/.exec(nextState);
  if (confirmSwitchM) {
    const [, targetId, originId] = confirmSwitchM;
    const target = await getNodeById(sb, targetId);
    const origin = await getNodeById(sb, originId);
    return `Confirmando troca para: ${target?.label || "nó removido"} (estava em: ${origin?.label || "nó removido"})`;
  }
  const m = /^(menunode_retry|menunode|conta|awaiting_resolution_retry|awaiting_resolution):([a-f0-9-]+)$/.exec(nextState);
  if (m) {
    const node = await getNodeById(sb, m[2]);
    const label = node?.label || "nó removido";
    const prefix =
      m[1] === "menunode" ? "Dentro de"
      : m[1] === "menunode_retry" ? "Dentro de (2ª tentativa)"
      : m[1] === "conta" ? "Perguntando qual conta em"
      : m[1] === "awaiting_resolution_retry" ? "Aguardando se resolveu (após objeção) em"
      : "Aguardando se resolveu em";
    return `${prefix}: ${label}`;
  }
  return nextState;
}

export async function POST(req: Request) {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const sb = makeSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: authData } = await sb.auth.getUser(token);
  if (!authData?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: member } = await sb.from("tenant_members").select("tenant_id").eq("user_id", authData.user.id).limit(1).maybeSingle();
  if (!member?.tenant_id) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 403 });
  const tenantId = member.tenant_id;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const { message, bot_state } = body;
  // ✅ Sanitiza pra só dígitos antes de usar no filtro .or() do Supabase —
  // mesmo formato que o telefone real já chega pronto do sessionManager.js
  // no fluxo de produção. Sem isso, vírgula/parênteses no campo phone
  // podiam distorcer a sintaxe do filtro.
  const phone = String(body.phone || "").replace(/\D/g, "") || null;
  if (!message?.trim()) return NextResponse.json({ error: "message é obrigatório" }, { status: 400 });
  const trimmed = message.trim();

  // ── Clientes (multi-conta) ────────────────────────────────────────────────
  let clients: any[] = [];
  let clientMatchesRaw: any[] = [];
  if (phone) {
    const { data: clientMatches } = await sb
      .from("clients")
      .select(`id, display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username, server_username, server_password, vencimento, screens, plan_label, plan_table_id, price_amount, price_currency, technology, server_id, servers (name, dns, is_offline, offline_reason)`)
      .eq("tenant_id", tenantId)
      .or(`whatsapp_username.eq.${phone},secondary_whatsapp_username.eq.${phone}`);

    if (clientMatches?.length) {
      clientMatchesRaw = clientMatches;
      clients = clientMatches.map((raw) => {
        const isSec = raw.secondary_whatsapp_username === phone;
        const srv = raw.servers as any;
        return {
          ...raw,
          display_name: isSec ? (raw.secondary_display_name || raw.display_name || "Cliente") : (raw.display_name || "Cliente"),
          server_name: srv?.name || "Servidor",
          server_dns: srv?.dns || [],
          server_is_offline: srv?.is_offline ?? false,
          server_offline_reason: srv?.offline_reason ?? null,
          is_secondary: isSec,
        };
      });
    }
  }
  if (!clients.length) {
    clients = [{ id: null, display_name: "Cliente Teste", server_name: "Servidor Teste", plan_label: "Mensal", screens: 1, vencimento: null, price_currency: "BRL", price_amount: 0, plan_table_id: null, server_id: null, whatsapp_username: null, server_is_offline: false, server_offline_reason: null }];
    clientMatchesRaw = [clients[0]];
  }

  const flow = await getFlowSettings(sb, tenantId);

  // ✅ Provider do servidor do cliente — usado pra filtrar conteúdo restrito
  // a um servidor específico (nós e steps).
  const clientProvider: ServerProvider | null = await resolveClientProvider(sb, clients[0]?.server_id || null);

  const sentMessages: string[] = [];
  function send(text: string) {
    if (text?.trim()) sentMessages.push(text);
  }

  const result = await runBotEngine({
    sb,
    tenantId,
    geminiKey,
    flow,
    clients,
    clientMatchesRaw,
    clientProvider,
    trimmed,
    botState: bot_state,
    send,
    logPrefix: "[BOT][chat-admin]",
  });

  return NextResponse.json({
    ok: true,
    response: sentMessages.join("\n\n"),
    action: result.action,
    escalate: result.escalate ?? false,
    mark_read: result.markRead,
    next_state: result.nextState,
    next_state_label: await resolveStateLabel(sb, result.nextState),
    transfer_reason: result.transferReason ?? null,
  });
}
