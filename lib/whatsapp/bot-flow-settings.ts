// lib/whatsapp/bot-flow-settings.ts
// ─────────────────────────────────────────────────────────────────────────────
// Mensagens e ligações reutilizáveis do fluxo de atendimento (estilo n8n).
// Tudo editável pelo front; o runtime só executa. Fallbacks = comportamento
// histórico do bot, pra não quebrar se a tabela ainda não existir / estiver vazia.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BOT_GAVE_UP_MSG,
  HUMAN_REQUESTED_MSG,
  PORTAL_HANDOFF_MSG,
} from "@/lib/whatsapp/bot-menu";
import { BOT_NO_COUPON_MESSAGE } from "@/lib/client-portal/coupons";

export type FlowSettings = {
  greeting_message: string;
  success_message: string;
  escalate_message: string;
  human_requested_message: string;
  /** Resposta quando o cliente vem transferido do Portal do Cliente (botão de suporte do Bloco 3). Use {primeiro_nome}. */
  portal_handoff_message: string;
  /** 1ª resposta inválida em menu (use {menu} onde quiser reexibir as opções). */
  invalid_retry_message_1: string;
  /** 2ª resposta inválida no menu raiz / reforço. */
  invalid_retry_message_2: string;
  /** Intro padrão ao reexibir submenu (antes das opções). */
  menu_invalid_intro_1: string;
  menu_invalid_intro_2: string;
  /** Abertura usada só quando {cupom_frase} realmente achou um cupom pro cliente. Use {primeiro_nome}. */
  coupon_found_intro: string;
  /** Resposta de {cupom_frase} quando o cliente não é elegível a nenhum cupom. */
  coupon_not_found_message: string;
};

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  greeting_message: "Olá! 😊 Sou o assistente do Márcio. Me diga, como posso te ajudar?",
  success_message: "Que bom! Fico feliz que resolveu 😊",
  escalate_message: BOT_GAVE_UP_MSG,
  human_requested_message: HUMAN_REQUESTED_MSG,
  portal_handoff_message: PORTAL_HANDOFF_MSG,
  invalid_retry_message_1: "Não entendi — pode escolher uma das opções abaixo, por favor? 😊",
  invalid_retry_message_2: "Sem pressa! 😊 Escolha uma das opções digitando o número correspondente:",
  menu_invalid_intro_1: "Não entendi — pode escolher uma das opções abaixo, por favor? 😊",
  menu_invalid_intro_2: "Ainda não consegui identificar a opção. Digite só o número (1 a 8), por favor:",
  coupon_found_intro: "Boa notícia, {primeiro_nome}! 🎉 Encontrei um cupom disponível pra você:",
  coupon_not_found_message: BOT_NO_COUPON_MESSAGE,
};

function pickStr(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return t.length ? t : fallback;
}

export function mergeFlowSettings(row: Record<string, any> | null | undefined): FlowSettings {
  const d = DEFAULT_FLOW_SETTINGS;
  if (!row) return { ...d };
  return {
    greeting_message: pickStr(row.greeting_message, d.greeting_message),
    success_message: pickStr(row.success_message, d.success_message),
    escalate_message: pickStr(row.escalate_message, d.escalate_message),
    human_requested_message: pickStr(row.human_requested_message, d.human_requested_message),
    portal_handoff_message: pickStr(row.portal_handoff_message, d.portal_handoff_message),
    invalid_retry_message_1: pickStr(row.invalid_retry_message_1, d.invalid_retry_message_1),
    invalid_retry_message_2: pickStr(row.invalid_retry_message_2, d.invalid_retry_message_2),
    menu_invalid_intro_1: pickStr(row.menu_invalid_intro_1, d.menu_invalid_intro_1),
    menu_invalid_intro_2: pickStr(row.menu_invalid_intro_2, d.menu_invalid_intro_2),
    coupon_found_intro: pickStr(row.coupon_found_intro, d.coupon_found_intro),
    coupon_not_found_message: pickStr(row.coupon_not_found_message, d.coupon_not_found_message),
  };
}

/** Carrega settings do tenant. Se a tabela não existir ou falhar, usa defaults. */
export async function getFlowSettings(sb: any, tenantId: string): Promise<FlowSettings> {
  try {
    const { data, error } = await sb
      .from("bot_flow_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return { ...DEFAULT_FLOW_SETTINGS };
    return mergeFlowSettings(data);
  } catch {
    return { ...DEFAULT_FLOW_SETTINGS };
  }
}

export type FlowSettingsUpdate = Partial<FlowSettings>;

export async function upsertFlowSettings(
  sb: any,
  tenantId: string,
  patch: FlowSettingsUpdate
): Promise<{ ok: true; settings: FlowSettings } | { ok: false; error: string }> {
  const allowed: (keyof FlowSettings)[] = [
    "greeting_message",
    "success_message",
    "escalate_message",
    "human_requested_message",
    "portal_handoff_message",
    "invalid_retry_message_1",
    "invalid_retry_message_2",
    "menu_invalid_intro_1",
    "menu_invalid_intro_2",
    "coupon_found_intro",
    "coupon_not_found_message",
  ];
  const clean: Record<string, string> = {};
  for (const k of allowed) {
    if (patch[k] !== undefined && patch[k] !== null) {
      clean[k] = String(patch[k]);
    }
  }

  const { data: existing } = await sb
    .from("bot_flow_settings")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await sb
      .from("bot_flow_settings")
      .update({ ...clean, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, settings: mergeFlowSettings(data) };
  }

  const { data, error } = await sb
    .from("bot_flow_settings")
    .insert({ tenant_id: tenantId, ...clean })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, settings: mergeFlowSettings(data) };
}

// ── Alvos de ligação (saídas de um nó) ───────────────────────────────────────
// Valores especiais (não são UUID):
//   __success__   → mensagem de sucesso global
//   __escalate__  → mensagem de escalonamento + pausa bot
//   __end__       → encerra sem mensagem extra
//   __default__ / null / "" → comportamento legado do nó

export type FlowTargetKind = "success" | "escalate" | "end" | "node" | "default";

export type FlowTarget =
  | { kind: "success" }
  | { kind: "escalate" }
  | { kind: "end" }
  | { kind: "default" }
  | { kind: "node"; nodeId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFlowTarget(raw: string | null | undefined): FlowTarget {
  if (raw == null) return { kind: "default" };
  const t = String(raw).trim();
  if (!t || t === "__default__") return { kind: "default" };
  if (t === "__success__") return { kind: "success" };
  if (t === "__escalate__") return { kind: "escalate" };
  if (t === "__end__") return { kind: "end" };
  if (UUID_RE.test(t)) return { kind: "node", nodeId: t };
  return { kind: "default" };
}

export function serializeFlowTarget(t: FlowTarget): string | null {
  if (t.kind === "default") return null;
  if (t.kind === "success") return "__success__";
  if (t.kind === "escalate") return "__escalate__";
  if (t.kind === "end") return "__end__";
  return t.nodeId;
}

/** True se o nó deve perguntar "resolveu 1/2" após os passos. */
export function nodeAsksResolution(node: {
  closing_message?: string | null;
  on_resolved_target?: string | null;
  on_not_resolved_target?: string | null;
  ask_resolution?: boolean | null;
}): boolean {
  if (node.ask_resolution === true) return true;
  if (node.ask_resolution === false) return false;
  return !!(
    (node.closing_message && node.closing_message.trim()) ||
    (node.on_resolved_target && node.on_resolved_target.trim()) ||
    (node.on_not_resolved_target && node.on_not_resolved_target.trim())
  );
}

/** Limite de saltos em cadeia (redirect A→B→C…) para evitar loop. */
export const MAX_REDIRECT_DEPTH = 6;

export function isRedirectState(state: string): { nodeId: string } | null {
  const m = /^__redirect_node__:([0-9a-f-]{36})$/i.exec(state);
  return m ? { nodeId: m[1] } : null;
}

export function makeRedirectState(nodeId: string): string {
  return `__redirect_node__:${nodeId}`;
}
