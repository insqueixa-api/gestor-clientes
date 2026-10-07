// lib/integrations/natv-transfer.ts
// ✅ 06/10/2026: núcleo do ENVIO de crédito pra revenda no NaTV, extraído de
// app/api/integrations/natv/transfer-credits (sem mudar comportamento) pra
// ser usado também pela compra de créditos do Portal da Revenda (depois do
// PIX pago — lib/reseller-portal/credit-orders.ts).
//
// A API do NaTV não tem idempotência nem estorno — um envio em dobro não tem
// volta. Defesas, em ordem:
//   1. trava no banco (reseller_credit_transfers): id = transferId (o mesmo id
//      nunca envia 2x) + no máximo 1 envio 'pending'/'unknown' por
//      revenda↔servidor;
//   2. conferência ANTES: sub-revenda direta e ativa, mínimo do NaTV, saldo;
//   3. UMA chamada de envio, nunca repetida automaticamente;
//   4. conferência DEPOIS pelo saldo; sem resposta clara e sem saldo que
//      feche → 'unknown' (trava novas recargas até alguém conferir).
// Quem chama decide o que fazer com o resultado (registrar a venda etc.).
import type { SupabaseClient } from "@supabase/supabase-js";
import { natvFindSubreseller, natvMinTransfer, natvMyCredits, natvTransferCredits } from "@/lib/integrations/natv-credits";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(event: string, meta: Record<string, unknown>) {
  console.error(`[natv_transfer:${event}]`, { kind: "integration_event", provider: "natv", ...meta });
}

export type NatvTransferParams = {
  transferId: string;
  tenantId: string;
  resellerServerId: string;
  serverId: string;
  integrationId: string;
  token: string;
  recipient: string;
  amount: number;
  salePayload: Record<string, unknown>;
  createdBy: string | null;
};

export type NatvTransferOutcome =
  | { kind: "done"; transfer: any; note: string | null }
  | { kind: "unknown"; transfer: any; note: string | null }
  | { kind: "failed"; transfer: any; message: string }
  | { kind: "repeated"; transfer: any } // mesmo transferId já existia — nada foi chamado
  | { kind: "open_conflict"; open: any } // outro envio pendente/sem confirmação pra essa revenda
  | { kind: "lock_error" };

export async function executeNatvCreditTransfer(admin: SupabaseClient, p: NatvTransferParams): Promise<NatvTransferOutcome> {
  // mesmo transferId já processado → nunca chama de novo
  const { data: existing } = await admin.from("reseller_credit_transfers").select("*").eq("id", p.transferId).maybeSingle();
  if (existing) return { kind: "repeated", transfer: existing };

  // 1) TRAVA
  const { data: lock, error: lockErr } = await admin
    .from("reseller_credit_transfers")
    .insert({
      id: p.transferId,
      tenant_id: p.tenantId,
      reseller_server_id: p.resellerServerId,
      server_id: p.serverId,
      server_integration_id: p.integrationId,
      provider: "NATV",
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
  const fail = async (msg: string, extra: Record<string, unknown> = {}): Promise<NatvTransferOutcome> => {
    const t = await patch({ status: "failed", error: msg, ...extra });
    log("failed", { transfer_id: p.transferId, msg });
    return { kind: "failed", transfer: t, message: msg };
  };

  // 2) CONFERÊNCIA ANTES (qualquer erro aqui = nada foi enviado)
  let sub;
  let callerBefore: number;
  try {
    sub = await natvFindSubreseller(p.token, p.recipient);
    if (!sub) return await fail(`"${p.recipient}" não aparece como sub-revenda direta da sua conta no NaTV.`);
    if (sub.status !== 1) return await fail(`A revenda "${p.recipient}" está bloqueada no NaTV.`);
    const min = natvMinTransfer(sub.credits);
    if (p.amount < min) return await fail(`O NaTV exige no mínimo ${min} créditos pra essa revenda.`);
    callerBefore = await natvMyCredits(p.token);
    if (callerBefore < p.amount) return await fail(`Seu saldo no NaTV (${callerBefore}) não cobre ${p.amount} créditos.`);
  } catch (e: any) {
    return await fail(`Não consegui conferir o NaTV antes do envio: ${e?.message || "erro"}. Nada foi enviado.`);
  }
  await patch({ recipient_credits_before: sub.credits, caller_credits_before: callerBefore });

  // 3) ENVIO — uma chamada só
  const result = await natvTransferCredits(p.token, p.recipient, p.amount);
  log("api_result", { transfer_id: p.transferId, kind: result.kind, status: result.status });

  if (result.kind === "rejected") {
    return await fail(result.message, { api_status: result.status, api_response: result.body });
  }

  // 4) CONFERÊNCIA DEPOIS
  await sleep(1500);
  let subAfter: number | null = null;
  let callerAfter: number | null = null;
  try {
    const s2 = await natvFindSubreseller(p.token, p.recipient);
    subAfter = s2 ? s2.credits : null;
  } catch {}
  try {
    callerAfter = await natvMyCredits(p.token);
  } catch {}

  const recipientGot = subAfter !== null && subAfter >= sub.credits + p.amount;
  const callerPaid = callerAfter !== null && callerBefore - callerAfter >= p.amount;

  let finalStatus: "done" | "unknown";
  let note: string | null = null;
  if (result.kind === "ok") {
    finalStatus = "done";
    const respRecipient = Number(result.body?.recipient_credits);
    if (!recipientGot && !(Number.isFinite(respRecipient) && respRecipient >= sub.credits + p.amount)) {
      note = `NaTV confirmou o envio, mas o saldo da revenda conferido depois foi ${subAfter ?? "?"} (antes ${sub.credits}).`;
    }
  } else {
    // sem resposta clara: só o saldo decide; na dúvida, trava pra conferência manual
    finalStatus = recipientGot || callerPaid ? "done" : "unknown";
    note =
      finalStatus === "done"
        ? `${result.message} Confirmado pelo saldo depois do envio.`
        : `${result.message} O saldo não confirmou o envio — confira no painel do NaTV antes de qualquer nova recarga.`;
  }

  const callerFinal =
    result.kind === "ok" && Number.isFinite(Number(result.body?.caller_credits)) ? Number(result.body.caller_credits) : callerAfter;
  const t = await patch({
    status: finalStatus,
    api_status: result.status,
    api_response: result.body,
    recipient_credits_after: subAfter ?? (Number.isFinite(Number(result.body?.recipient_credits)) ? Number(result.body.recipient_credits) : null),
    caller_credits_after: callerFinal,
    error: note,
  });

  // seu saldo no card do servidor já atualizado
  if (callerFinal !== null && Number.isFinite(callerFinal)) {
    await admin
      .from("server_integrations")
      .update({ credits_last_known: callerFinal, credits_last_sync_at: new Date().toISOString() })
      .eq("id", p.integrationId);
  }

  if (finalStatus === "unknown") {
    log("unknown", { transfer_id: p.transferId });
    return { kind: "unknown", transfer: t, note };
  }
  return { kind: "done", transfer: t, note };
}
