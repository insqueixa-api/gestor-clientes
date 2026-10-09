// lib/integrations/elite-transfer.ts
// ✅ 09/10/2026: ENVIO de crédito pra revenda no Elite (API oficial,
// POST /resellers/{id}/credits/send) — mesmo papel de natv-transfer.ts, usado
// pela Recarga rápida (app/api/integrations/natv/transfer-credits, que agora
// atende os dois) e pela compra de créditos do Portal da Revenda.
//
// Diferenças do NaTV (documentação do Elite):
//   - mínimo de 20 créditos por envio novo;
//   - Idempotency-Key DE VERDADE: a chave nasce do id da transferência
//     (sempre a mesma pra esse envio) → repetir com a mesma chave só consulta
//     o comprovante, nunca envia 2x. eliteRequest já repete sozinho com a
//     mesma chave em timeout/429/503;
//   - 200 = concluído (operation_id); 202 = needs_review (aguardando
//     conferência) → fica 'unknown', igual ao NaTV sem confirmação;
//   - 4xx (permissão, saldo, regra) = recusado → nada foi enviado.
// Defesas em comum: trava no banco (reseller_credit_transfers: id único + no
// máximo 1 envio pendente/sem confirmação por revenda↔servidor) e conferência
// do saldo da revenda antes/depois.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EliteApiError, eliteList, eliteMe, eliteRequest, eliteUnwrap, type EliteIntegration } from "@/lib/integrations/elite-api";

export const ELITE_MIN_TRANSFER = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function log(event: string, meta: Record<string, unknown>) {
  console.error(`[elite_transfer:${event}]`, { kind: "integration_event", provider: "elite", ...meta });
}

export type EliteSubreseller = { id: number; username: string; credits: number | null; active: boolean };

function parseReseller(r: any): EliteSubreseller | null {
  const x = eliteUnwrap(r) || {};
  const acc = x.reseller || x.account || x;
  const id = Number(acc.id);
  if (!Number.isFinite(id)) return null;
  const rawCredits = acc.credits ?? acc.balance ?? acc.saldo ?? null;
  const credits = rawCredits === null || rawCredits === undefined ? null : Number(rawCredits);
  const st = String(acc.status ?? acc.state ?? acc.estado ?? "").toLowerCase();
  const enabled = acc.enabled ?? acc.active ?? acc.is_active;
  const active = enabled === undefined ? !/(block|bloq|disab|inativ|suspen)/.test(st) : !!enabled && enabled !== 0;
  return { id, username: String(acc.username ?? acc.login ?? ""), credits: credits !== null && Number.isFinite(credits) ? credits : null, active };
}

/** Sub-revenda DIRETA pelo login exato (GET /resellers, paginado). */
export async function eliteFindSubreseller(integ: EliteIntegration, username: string): Promise<EliteSubreseller | null> {
  const wanted = username.trim().toLowerCase();
  let after: number | string = 0;
  for (let page = 0; page < 20; page++) {
    const { data } = await eliteRequest(integ, "GET", "/resellers", { query: { limit: 100, after_id: after } });
    for (const r of eliteList(data)) {
      const p = parseReseller(r);
      if (p && p.username.trim().toLowerCase() === wanted) return p;
    }
    const next = (data as any)?.pagination?.next_after_id;
    if (next === null || next === undefined || next === "") return null;
    after = next;
  }
  return null;
}

/** Saldo/estado atual da sub-revenda (GET /resellers/{id}). */
export async function eliteSubresellerById(integ: EliteIntegration, id: number): Promise<EliteSubreseller | null> {
  const { data } = await eliteRequest(integ, "GET", `/resellers/${id}`);
  return parseReseller(data);
}

/** Chave do pedido no Elite — SEMPRE a mesma pra esta transferência. */
export function eliteTransferKey(transferId: string) {
  return `ugcred-${transferId.replace(/-/g, "")}`;
}

export type EliteTransferParams = {
  transferId: string;
  tenantId: string;
  resellerServerId: string;
  serverId: string;
  integ: EliteIntegration;
  recipient: string;
  amount: number;
  salePayload: Record<string, unknown>;
  createdBy: string | null;
};

export type EliteTransferOutcome =
  | { kind: "done"; transfer: any; note: string | null }
  | { kind: "unknown"; transfer: any; note: string | null }
  | { kind: "failed"; transfer: any; message: string }
  | { kind: "repeated"; transfer: any }
  | { kind: "open_conflict"; open: any }
  | { kind: "lock_error" };

export async function executeEliteCreditTransfer(admin: SupabaseClient, p: EliteTransferParams): Promise<EliteTransferOutcome> {
  const { data: existing } = await admin.from("reseller_credit_transfers").select("*").eq("id", p.transferId).maybeSingle();
  if (existing) return { kind: "repeated", transfer: existing };

  // 1) TRAVA (mesma tabela/regra do NaTV)
  const { data: lock, error: lockErr } = await admin
    .from("reseller_credit_transfers")
    .insert({
      id: p.transferId,
      tenant_id: p.tenantId,
      reseller_server_id: p.resellerServerId,
      server_id: p.serverId,
      server_integration_id: p.integ.id,
      provider: "ELITE",
      recipient_username: p.recipient,
      amount: p.amount,
      status: "pending",
      sale_payload: p.salePayload,
      created_by: p.createdBy,
    })
    .select("*")
    .single();
  if (lockErr || !lock) {
    if ((lockErr as any)?.code === "23505") {
      const { data: again } = await admin.from("reseller_credit_transfers").select("*").eq("id", p.transferId).maybeSingle();
      if (again) return { kind: "repeated", transfer: again };
      const { data: open } = await admin
        .from("reseller_credit_transfers")
        .select("*")
        .eq("reseller_server_id", p.resellerServerId)
        .in("status", ["pending", "unknown"])
        .maybeSingle();
      return { kind: "open_conflict", open };
    }
    return { kind: "lock_error" };
  }

  const patch = async (fields: Record<string, unknown>) => {
    const { data } = await admin
      .from("reseller_credit_transfers")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", p.transferId)
      .select("*")
      .single();
    return data;
  };
  const fail = async (msg: string, extra: Record<string, unknown> = {}): Promise<EliteTransferOutcome> => {
    const t = await patch({ status: "failed", error: msg, ...extra });
    log("failed", { transfer_id: p.transferId, msg });
    return { kind: "failed", transfer: t, message: msg };
  };

  // 2) CONFERÊNCIA ANTES (qualquer erro aqui = nada foi enviado)
  if (!Number.isInteger(p.amount) || p.amount < ELITE_MIN_TRANSFER) {
    return fail(`O Elite exige no mínimo ${ELITE_MIN_TRANSFER} créditos por envio.`);
  }
  let sub: EliteSubreseller | null;
  let callerBefore: number | null = null;
  try {
    sub = await eliteFindSubreseller(p.integ, p.recipient);
    if (!sub) return fail(`"${p.recipient}" não aparece como sub-revenda direta da sua conta no Elite.`);
    if (!sub.active) return fail(`A revenda "${p.recipient}" está bloqueada no Elite.`);
    callerBefore = (await eliteMe(p.integ)).credits;
    if (callerBefore !== null && callerBefore < p.amount) return fail(`Seu saldo no Elite (${callerBefore}) não cobre ${p.amount} créditos.`);
  } catch (e: any) {
    return fail(`Não consegui conferir o Elite antes do envio: ${e?.message || "erro"}. Nada foi enviado.`);
  }
  await patch({ recipient_credits_before: sub.credits, caller_credits_before: callerBefore });

  // 3) ENVIO — chave fixa desta transferência (repetir = consultar, nunca reenviar)
  let status = 0;
  let resp: any = null;
  let uncertain: string | null = null;
  try {
    const r = await eliteRequest(p.integ, "POST", `/resellers/${sub.id}/credits/send`, {
      body: { amount: p.amount, reason: `UniGestor · envio ${p.transferId.slice(0, 8)}` },
      idempotencyKey: eliteTransferKey(p.transferId),
    });
    status = r.status;
    resp = r.data;
  } catch (e: any) {
    // 409 pode ser "operação em andamento" → não dá pra afirmar que nada saiu
    if (e instanceof EliteApiError && e.status >= 400 && e.status < 500 && ![408, 409, 429].includes(e.status)) {
      // recusado pelo Elite (permissão, regra, saldo, conflito) — nada foi enviado
      return fail(e.message, { api_status: e.status, api_response: e.data ?? null });
    }
    uncertain = e?.message || "Sem resposta do Elite.";
    status = e instanceof EliteApiError ? e.status : 0;
    resp = e instanceof EliteApiError ? e.data ?? null : null;
  }
  log("api_result", { transfer_id: p.transferId, status });

  // 4) CONFERÊNCIA DEPOIS pelo saldo da revenda
  await sleep(1500);
  let subAfter: number | null = null;
  let callerAfter: number | null = null;
  try {
    subAfter = (await eliteSubresellerById(p.integ, sub.id))?.credits ?? null;
  } catch {}
  try {
    callerAfter = (await eliteMe(p.integ)).credits;
  } catch {}
  const recipientGot = subAfter !== null && sub.credits !== null && subAfter >= sub.credits + p.amount;

  let finalStatus: "done" | "unknown";
  let note: string | null = null;
  if (status === 200 && !uncertain) {
    finalStatus = "done";
    if (subAfter !== null && sub.credits !== null && !recipientGot) {
      note = `Elite confirmou o envio, mas o saldo da revenda conferido depois foi ${subAfter} (antes ${sub.credits}).`;
    }
  } else {
    // 202 (aguardando conferência) ou sem resposta: o saldo decide; na dúvida trava
    finalStatus = recipientGot ? "done" : "unknown";
    const why = status === 202 ? "O Elite deixou o envio aguardando conferência (202)." : uncertain || `Resposta ${status} do Elite.`;
    note =
      finalStatus === "done"
        ? `${why} Confirmado pelo saldo depois do envio.`
        : `${why} O saldo não confirmou — confira no painel do Elite (Chegou / Não chegou). Repetir este mesmo envio só consulta o comprovante, nunca reenvia.`;
  }

  const t = await patch({
    status: finalStatus,
    api_status: status || null,
    api_response: resp,
    recipient_credits_after: subAfter,
    caller_credits_after: callerAfter,
    error: note,
  });
  if (callerAfter !== null) {
    await admin
      .from("server_integrations")
      .update({ credits_last_known: callerAfter, credits_last_sync_at: new Date().toISOString() })
      .eq("id", p.integ.id);
  }
  if (finalStatus === "unknown") {
    log("unknown", { transfer_id: p.transferId });
    return { kind: "unknown", transfer: t, note };
  }
  return { kind: "done", transfer: t, note };
}

/**
 * Envio que ficou 'unknown': repete o MESMO pedido (mesma URL, corpo e chave)
 * — pela documentação do Elite isso só consulta o comprovante, nunca reenvia.
 * 200 → marca done. Qualquer outra resposta → continua 'unknown' (Chegou/Não chegou).
 */
export async function eliteRecheckTransfer(admin: SupabaseClient, transfer: any, integ: EliteIntegration): Promise<"done" | "unknown"> {
  if (transfer?.provider !== "ELITE" || transfer.status !== "unknown") return "unknown";
  try {
    const sub = await eliteFindSubreseller(integ, String(transfer.recipient_username));
    if (!sub) return "unknown";
    const r = await eliteRequest(integ, "POST", `/resellers/${sub.id}/credits/send`, {
      body: { amount: Number(transfer.amount), reason: `UniGestor · envio ${String(transfer.id).slice(0, 8)}` },
      idempotencyKey: eliteTransferKey(String(transfer.id)),
    });
    if (r.status !== 200) return "unknown";
    const { data: upd } = await admin
      .from("reseller_credit_transfers")
      .update({
        status: "done",
        api_status: 200,
        api_response: r.data,
        error: "Confirmado pelo comprovante do Elite (mesma chave do envio).",
        updated_at: new Date().toISOString(),
      })
      .eq("id", transfer.id)
      .eq("status", "unknown")
      .select("id")
      .maybeSingle();
    return upd ? "done" : "unknown";
  } catch {
    return "unknown";
  }
}
