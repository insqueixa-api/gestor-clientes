// app/api/integrations/natv/transfer-credits/route.ts
// ✅ 06/10/2026: "Recarga rápida" da revenda envia o crédito de verdade no
// NaTV (antes só registrava a venda e o Márcio enviava na mão no painel).
//
// A API do NaTV não tem idempotência nem estorno — um envio em dobro não tem
// volta. Defesas, em ordem:
//   1. trava no banco (reseller_credit_transfers): o id vem do modal (gerado 1x
//      quando abre) → clique duplo/reenvio cai no mesmo registro; e no máximo
//      1 transferência 'pending'/'unknown' por revenda↔servidor;
//   2. conferência ANTES: a revenda é sub-revenda direta, quantidade ≥ mínimo
//      do NaTV, seu saldo cobre o envio;
//   3. UMA chamada de envio, nunca repetida automaticamente;
//   4. conferência DEPOIS: saldo da revenda (e o seu) — sem resposta clara do
//      NaTV, o saldo decide; se nem o saldo fecha, fica 'unknown' e trava novas
//      recargas até o Márcio dizer "chegou"/"não chegou" (action: resolve).
// A venda (server_credit_sales + Financeiro) só é registrada com o crédito
// confirmado.
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient as createSupabaseServer } from "@/lib/supabase/server";
import {
  natvFindSubreseller,
  natvMinTransfer,
  natvMyCredits,
  natvTransferCredits,
} from "@/lib/integrations/natv-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCIES = ["BRL", "USD", "EUR"];
// pending mais velho que isso = a função caiu no meio → tratado como 'unknown'
const STALE_PENDING_MS = 2 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

function log(event: string, meta: Record<string, unknown>) {
  console.error(`[natv_transfer:${event}]`, { kind: "integration_event", provider: "natv", ...meta });
}

type SalePayload = {
  unit_price: number;
  currency: string;
  total_brl: number;
  notes: string;
};

function publicTransfer(t: any) {
  if (!t) return null;
  return {
    id: t.id,
    status: t.status,
    amount: t.amount,
    recipient_username: t.recipient_username,
    recipient_credits_before: t.recipient_credits_before,
    recipient_credits_after: t.recipient_credits_after,
    caller_credits_after: t.caller_credits_after,
    error: t.error,
    sale_id: t.sale_id,
    created_at: t.created_at,
  };
}

// Mesmo transfer_id chegou de novo (clique duplo, rede): devolve o estado
// atual sem chamar o NaTV. 'pending'/'unknown' voltam como "sem confirmação"
// pra tela NUNCA tratar como falha e liberar outra tentativa.
function repeatedResponse(t: any) {
  if (t.status === "done") return NextResponse.json({ ok: true, repeated: true, transfer: publicTransfer(t) });
  if (t.status === "failed") {
    return NextResponse.json({ ok: false, repeated: true, error: t.error || "Envio recusado.", transfer: publicTransfer(t) }, { status: 400 });
  }
  return NextResponse.json(
    {
      ok: false,
      repeated: true,
      unknown: true,
      error:
        t.status === "pending"
          ? "Esse envio ainda está em andamento — aguarde e confira antes de tentar de novo."
          : t.error || "Envio sem confirmação — confira no painel do NaTV.",
      transfer: publicTransfer(t),
    },
    { status: 202 },
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUser = await createSupabaseServer();
    const { data: auth, error: authErr } = await supabaseUser.auth.getUser();
    const userId = auth?.user?.id;
    if (authErr || !userId) return jsonError(401, "Unauthorized");

    const admin = createSupabaseAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action || "transfer");
    const resellerServerId = String(body?.reseller_server_id || "").trim();
    const transferId = String(body?.transfer_id || "").trim();

    // ---------- carrega vínculo + checa que o usuário é da conta ----------
    async function loadLink(rsId: string) {
      if (!UUID_RE.test(rsId)) return null;
      const { data: rs } = await admin
        .from("reseller_servers")
        .select("id, tenant_id, server_id, server_username")
        .eq("id", rsId)
        .maybeSingle();
      if (!rs) return null;
      const { data: member } = await admin
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", rs.tenant_id)
        .eq("user_id", userId)
        .maybeSingle();
      return member ? rs : null;
    }

    async function registerSale(t: any) {
      const p = (t.sale_payload || {}) as SalePayload;
      const { data, error } = await supabaseUser.rpc("sell_credits_to_reseller_without_balance", {
        p_tenant_id: t.tenant_id,
        p_server_id: t.server_id,
        p_reseller_server_id: t.reseller_server_id,
        p_credits_sold: t.amount,
        p_unit_price: p.unit_price,
        p_sale_currency: p.currency,
        p_total_amount_brl: p.total_brl,
        p_notes: p.notes,
      } as any);
      if (error) return { saleId: null as string | null, error: error.message };
      const saleId = Array.isArray(data) && data[0]?.sale_id ? String(data[0].sale_id) : null;
      await admin.from("reseller_credit_transfers").update({ sale_id: saleId, updated_at: new Date().toISOString() }).eq("id", t.id);
      return { saleId, error: null as string | null };
    }

    async function syncCallerCredits(integrationId: string, credits: number | null) {
      if (credits === null || !Number.isFinite(credits)) return;
      await admin
        .from("server_integrations")
        .update({ credits_last_known: credits, credits_last_sync_at: new Date().toISOString() })
        .eq("id", integrationId);
    }

    // ======================= open: transferência sem confirmação =======================
    if (action === "open") {
      const rs = await loadLink(resellerServerId);
      if (!rs) return jsonError(404, "Vínculo não encontrado.");
      const { data: open } = await admin
        .from("reseller_credit_transfers")
        .select("*")
        .eq("reseller_server_id", rs.id)
        .in("status", ["pending", "unknown"])
        .maybeSingle();
      const isOpen =
        open && (open.status === "unknown" || Date.now() - new Date(open.created_at).getTime() > STALE_PENDING_MS);
      return NextResponse.json({ ok: true, open: isOpen ? publicTransfer(open) : null, in_progress: open && !isOpen });
    }

    // ======================= resolve: Márcio confere no painel =======================
    if (action === "resolve") {
      const outcome = String(body?.outcome || "");
      if (!UUID_RE.test(transferId) || !["arrived", "not_arrived"].includes(outcome)) {
        return jsonError(400, "Parâmetros inválidos.");
      }
      const { data: t } = await admin.from("reseller_credit_transfers").select("*").eq("id", transferId).maybeSingle();
      if (!t || !(await loadLink(t.reseller_server_id))) return jsonError(404, "Transferência não encontrada.");
      const stale = t.status === "pending" && Date.now() - new Date(t.created_at).getTime() > STALE_PENDING_MS;
      if (t.status !== "unknown" && !stale) return jsonError(409, "Essa transferência não está aguardando conferência.");

      const now = new Date().toISOString();
      // update condicional no status: 2 cliques simultâneos não registram a venda 2x
      const { data: upd } = await admin
        .from("reseller_credit_transfers")
        .update({
          status: outcome === "arrived" ? "done" : "failed",
          error: outcome === "arrived" ? t.error : `${t.error ? t.error + " · " : ""}Márcio conferiu: não chegou.`,
          resolved_by: userId,
          resolved_at: now,
          updated_at: now,
        })
        .eq("id", t.id)
        .eq("status", t.status)
        .select("*")
        .maybeSingle();
      if (!upd) return jsonError(409, "Essa transferência já foi resolvida.");
      log("resolved", { transfer_id: t.id, outcome });

      if (outcome === "arrived") {
        const sale = await registerSale(upd);
        return NextResponse.json({
          ok: true,
          transfer: publicTransfer({ ...upd, sale_id: sale.saleId }),
          sale_registered: !!sale.saleId,
          sale_error: sale.error,
        });
      }
      return NextResponse.json({ ok: true, transfer: publicTransfer(upd) });
    }

    // ======================= transfer =======================
    if (action !== "transfer") return jsonError(400, "action inválida.");

    const amount = Number(body?.amount);
    const sale: SalePayload = {
      unit_price: Number(body?.unit_price),
      currency: String(body?.currency || "BRL").toUpperCase(),
      total_brl: Number(body?.total_brl),
      notes: String(body?.notes || "").slice(0, 2000),
    };
    if (!UUID_RE.test(transferId)) return jsonError(400, "transfer_id inválido.");
    if (!Number.isInteger(amount) || amount <= 0) return jsonError(400, "Quantidade de créditos inválida.");
    if (!(sale.unit_price > 0) || !(sale.total_brl > 0) || !CURRENCIES.includes(sale.currency)) {
      return jsonError(400, "Preço/total inválido.");
    }

    const rs = await loadLink(resellerServerId);
    if (!rs) return jsonError(404, "Vínculo revenda↔servidor não encontrado.");
    const recipient = String(rs.server_username || "").trim();
    if (!recipient) return jsonError(400, "A revenda não tem usuário do painel cadastrado nesse servidor.");

    // mesmo transfer_id já processado → devolve o resultado, nunca chama de novo
    const { data: existing } = await admin.from("reseller_credit_transfers").select("*").eq("id", transferId).maybeSingle();
    if (existing) return repeatedResponse(existing);

    const { data: server } = await admin
      .from("servers")
      .select("panel_integration")
      .eq("id", rs.server_id)
      .eq("tenant_id", rs.tenant_id)
      .maybeSingle();
    if (!server?.panel_integration) return jsonError(400, "Servidor sem integração.");
    const { data: integ } = await admin
      .from("server_integrations")
      .select("id, provider, api_token, is_active")
      .eq("id", server.panel_integration)
      .eq("tenant_id", rs.tenant_id)
      .maybeSingle();
    if (!integ || String(integ.provider).toUpperCase() !== "NATV") return jsonError(400, "Integração do servidor não é NaTV.");
    if (integ.is_active === false) return jsonError(400, "Integração NaTV está desativada.");
    const token = String(integ.api_token || "").trim();
    if (!token) return jsonError(400, "Chave da API do NaTV não cadastrada.");

    // 1) TRAVA
    const { data: lock, error: lockErr } = await admin
      .from("reseller_credit_transfers")
      .insert({
        id: transferId,
        tenant_id: rs.tenant_id,
        reseller_server_id: rs.id,
        server_id: rs.server_id,
        server_integration_id: integ.id,
        provider: "NATV",
        recipient_username: recipient,
        amount,
        status: "pending",
        sale_payload: sale,
        created_by: userId,
      })
      .select("*")
      .single();
    if (lockErr || !lock) {
      if ((lockErr as any)?.code === "23505") {
        const { data: again } = await admin.from("reseller_credit_transfers").select("*").eq("id", transferId).maybeSingle();
        if (again) return repeatedResponse(again);
        const { data: open } = await admin
          .from("reseller_credit_transfers")
          .select("*")
          .eq("reseller_server_id", rs.id)
          .in("status", ["pending", "unknown"])
          .maybeSingle();
        return jsonError(409, "Já existe um envio de crédito pra essa revenda aguardando confirmação. Resolva ele antes de enviar outro.", {
          open: publicTransfer(open),
        });
      }
      return jsonError(500, "Falha ao registrar a trava do envio.");
    }

    const patch = async (p: Record<string, unknown>) => {
      const { data } = await admin
        .from("reseller_credit_transfers")
        .update({ ...p, updated_at: new Date().toISOString() })
        .eq("id", transferId)
        .select("*")
        .single();
      return data;
    };
    const fail = async (msg: string, extra: Record<string, unknown> = {}) => {
      const t = await patch({ status: "failed", error: msg, ...extra });
      log("failed", { transfer_id: transferId, msg });
      return jsonError(400, msg, { transfer: publicTransfer(t) });
    };

    // 2) CONFERÊNCIA ANTES (qualquer erro aqui = nada foi enviado)
    let sub;
    let callerBefore: number;
    try {
      sub = await natvFindSubreseller(token, recipient);
      if (!sub) return await fail(`"${recipient}" não aparece como sub-revenda direta da sua conta no NaTV.`);
      if (sub.status !== 1) return await fail(`A revenda "${recipient}" está bloqueada no NaTV.`);
      const min = natvMinTransfer(sub.credits);
      if (amount < min) return await fail(`O NaTV exige no mínimo ${min} créditos pra essa revenda.`);
      callerBefore = await natvMyCredits(token);
      if (callerBefore < amount) return await fail(`Seu saldo no NaTV (${callerBefore}) não cobre ${amount} créditos.`);
    } catch (e: any) {
      return await fail(`Não consegui conferir o NaTV antes do envio: ${e?.message || "erro"}. Nada foi enviado.`);
    }
    await patch({ recipient_credits_before: sub.credits, caller_credits_before: callerBefore });

    // 3) ENVIO — uma chamada só
    const result = await natvTransferCredits(token, recipient, amount);
    log("api_result", { transfer_id: transferId, kind: result.kind, status: result.status });

    if (result.kind === "rejected") {
      return await fail(result.message, { api_status: result.status, api_response: result.body });
    }

    // 4) CONFERÊNCIA DEPOIS
    await sleep(1500);
    let subAfter: number | null = null;
    let callerAfter: number | null = null;
    try {
      const s2 = await natvFindSubreseller(token, recipient);
      subAfter = s2 ? s2.credits : null;
    } catch {}
    try {
      callerAfter = await natvMyCredits(token);
    } catch {}

    const recipientGot = subAfter !== null && subAfter >= sub.credits + amount;
    const callerPaid = callerAfter !== null && callerBefore - callerAfter >= amount;

    let finalStatus: "done" | "unknown";
    let note: string | null = null;
    if (result.kind === "ok") {
      finalStatus = "done";
      const respRecipient = Number(result.body?.recipient_credits);
      if (!recipientGot && !(Number.isFinite(respRecipient) && respRecipient >= sub.credits + amount)) {
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
    await syncCallerCredits(integ.id, callerFinal);

    if (finalStatus === "unknown") {
      log("unknown", { transfer_id: transferId });
      return NextResponse.json(
        { ok: false, unknown: true, error: note, transfer: publicTransfer(t) },
        { status: 202 },
      );
    }

    // 5) crédito confirmado → registra a venda (Financeiro etc.)
    const saleRes = await registerSale(t);
    return NextResponse.json({
      ok: true,
      transfer: publicTransfer({ ...t, sale_id: saleRes.saleId }),
      sale_registered: !!saleRes.saleId,
      sale_error: saleRes.error,
    });
  } catch (e: any) {
    console.error("[integration_error:natv:transfer-credits]", { message: e?.message, kind: "integration_error", provider: "natv" });
    return jsonError(500, "Erro interno no envio de créditos.");
  }
}
