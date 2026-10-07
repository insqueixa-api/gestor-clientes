// lib/reseller-portal/app-orders.ts
// ✅ 07/10/2026 — Portal da Revenda, etapa 2: a revenda paga por PIX a
// ativação de licença de app (AtivaApp / DupleCast). Pedidos em
// reseller_app_orders (docs/sql/reseller_app_orders.sql).
//   1. createAppOrder        → valor SEMPRE do sistema (apps.license_price);
//                              reconfere a disponibilidade NO SERVIDOR antes de
//                              cobrar (mesma janela do portal do cliente)
//   2. confirmPaidAndFulfillApp → webhook (MP/FastDePix) OU acompanhamento da
//                              tela: reconsulta o gateway, confere o VALOR pago
//   3. fulfillAppOrder       → trava atômica pending→processing (1 ativação por
//                              pedido). DupleCast: 1 código (fallback AtivaApp
//                              só se o 1º falhar NA HORA — nunca os dois, mesma
//                              regra do cliente). AtivaApp: fila → confirma pelo
//                              webhook dela ou pelo acompanhamento
//   4. resolveResellerAppativa → status final da AtivaApp (vencimento ≥ 300 dias
//                              à frente, mesma checagem do cliente)
// Ao concluir: vencimento salvo no app do cliente da revenda (se veio do card),
// receita em "IPTV - Rendimentos", WhatsApp pra revenda, sino só em erro.
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { notify } from "@/lib/notifications/notify";
import { syncIptvRendimentos } from "@/lib/finance/sync-iptv-lancamentos";
import { extractFieldByType } from "@/lib/apps/panel";
import {
  appativaIdentifierLabel,
  consultarAtivacao,
  extractAppativaCreds,
  getAppativaApiKey,
  solicitarAtivacao,
  syncAppativaCredits,
} from "@/lib/integrations/appativa";
import { renewDuplecastWithCode } from "@/lib/apps/duplecast-renewal";
import {
  activationAvailableFrom,
  canCheckByDevice,
  checkResellerApp,
  isActivatableApp,
  readFieldValues,
  resellerLicensePrice,
} from "@/lib/reseller-portal/apps";
import { appOrigin, cancelPix, checkPix, createPix, reopenPix, usablePixGateways } from "@/lib/reseller-portal/pix";

const APP_COLS = "id, name, cost_type, license_price, is_active, is_hidden, integration_type, appativa_app_id, renewal_source, fields_config";
const APPATIVA_OK = new Set(["ativado", "aprovado"]);
const APPATIVA_FAIL = new Set(["incorreto", "reprovado"]);
const MIN_DAYS_FORWARD = 300; // vencimento novo de verdade (anual), nunca o antigo
const OPEN_PAID = ["pending", "processing", "activating", "unknown"];

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const dateBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
function log(event: string, meta: Record<string, unknown>) {
  console.error(`[reseller_app_order:${event}]`, { kind: "reseller_portal_event", ...meta });
}
function isoDate(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "").trim());
  if (m) return m[1];
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? "").trim());
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}
/** Identificador do aparelho (MAC / e-mail) normalizado — chave da trava de duplicidade. */
function deviceKeyOf(fieldsConfig: any[], values: Record<string, string>) {
  const { macApp } = extractAppativaCreds(fieldsConfig, values);
  const raw = macApp || extractFieldByType(fieldsConfig, values, "mac");
  return String(raw || "").trim().toUpperCase().replace(/[^0-9A-Z@._]/g, "");
}
const isDuplecast = (app: any) => String(app?.name || "").trim() === "DupleCast";

export type AppOrderPix = {
  order_id: string;
  gateway_type: string;
  gateway_name: string;
  has_alternate_gateway: boolean;
  amount: number;
  app_name: string;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  expires_at: string;
};

// ---------------------------------------------------------------------------
// 1) CRIAR
// ---------------------------------------------------------------------------
export async function createAppOrder(
  admin: SupabaseClient,
  p: { tenantId: string; resellerId: string; appId: string; fieldValues?: unknown; rowId?: string; excludeGatewayType?: string },
): Promise<{ ok: true; pix: AppOrderPix } | { ok: false; status: number; error: string }> {
  const { data: app } = await admin.from("apps").select(APP_COLS).eq("id", p.appId).eq("tenant_id", p.tenantId).maybeSingle();
  if (!app || !isActivatableApp(app)) return { ok: false, status: 400, error: "Esse aplicativo não tem ativação pelo portal." };
  const fieldsConfig = Array.isArray((app as any).fields_config) ? (app as any).fields_config : [];

  // veio do card de um cliente → usa os dados SALVOS do app dele (nunca os do navegador)
  let values: Record<string, string>;
  let rowId: string | null = null;
  let endClientUsername: string | null = null;
  if (p.rowId) {
    const { data: row } = await admin
      .from("reseller_client_apps")
      .select("id, app_id, field_values, reseller_end_clients(username)")
      .eq("id", p.rowId)
      .eq("tenant_id", p.tenantId)
      .eq("reseller_id", p.resellerId)
      .maybeSingle();
    if (!row || (row as any).app_id !== (app as any).id) return { ok: false, status: 404, error: "Aplicativo não encontrado." };
    const fv = readFieldValues(app, (row as any).field_values);
    if ("error" in fv) return { ok: false, status: 400, error: `${fv.error} (toque em Editar no card do cliente).` };
    values = fv.values;
    rowId = (row as any).id;
    endClientUsername = (row as any).reseller_end_clients?.username || null;
  } else {
    const fv = readFieldValues(app, p.fieldValues);
    if ("error" in fv) return { ok: false, status: 400, error: fv.error };
    values = fv.values;
  }
  const deviceKey = deviceKeyOf(fieldsConfig, values);
  if (!deviceKey) return { ok: false, status: 400, error: `Preencha o ${appativaIdentifierLabel(fieldsConfig)}.` };

  // ✅ disponibilidade reconferida AQUI (nunca confia no "disponível" da tela)
  let prevExpire: string | null = null;
  if (canCheckByDevice(app)) {
    const chk = await checkResellerApp(admin, {
      app: { id: (app as any).id, name: (app as any).name, integration_type: (app as any).integration_type, fields_config: fieldsConfig },
      fieldValues: values,
      m3uUrl: "",
      serverName: "",
      serverId: null,
    });
    if (!chk.ok) return { ok: false, status: 400, error: `Não foi possível verificar o aparelho: ${chk.error}` };
    prevExpire = isoDate(chk.expireDate);
    const from = activationAvailableFrom(app, prevExpire);
    if (from === "9999-12-31") return { ok: false, status: 409, error: "Esse aparelho já tem licença vitalícia — não precisa ativar." };
    if (from) return { ok: false, status: 409, error: `A licença desse aparelho vence em ${dateBR(prevExpire)}. A ativação libera a partir de ${dateBR(from)}.` };
  }

  const amount = resellerLicensePrice(app);
  if (!amount) return { ok: false, status: 400, error: "Esse aplicativo está sem preço de licença." };

  // pagamento já feito pra esse aparelho e ainda ativando → não deixa pagar por cima
  const { data: paidOpen } = await admin
    .from("reseller_app_orders")
    .select("id")
    .eq("tenant_id", p.tenantId)
    .eq("app_id", (app as any).id)
    .eq("device_key", deviceKey)
    .eq("status", "approved")
    .in("fulfillment_status", OPEN_PAID)
    .limit(1)
    .maybeSingle();
  if (paidOpen) return { ok: false, status: 409, error: "Já existe um pagamento desse aparelho sendo ativado. Aguarde a confirmação." };

  const usable = await usablePixGateways(admin, p.tenantId);
  if (!usable.length) return { ok: false, status: 503, error: "Pagamento indisponível no momento — fale com o suporte." };
  const gateway = p.excludeGatewayType ? usable.find((g: any) => g.type !== p.excludeGatewayType) : usable[0];
  if (!gateway) return { ok: false, status: 503, error: "Não há outra forma de pagamento disponível." };

  // PIX ainda válido do MESMO aparelho no MESMO gateway → reaproveita; o resto é cancelado
  const { data: pending } = await admin
    .from("reseller_app_orders")
    .select("*")
    .eq("tenant_id", p.tenantId)
    .eq("reseller_id", p.resellerId)
    .eq("app_id", (app as any).id)
    .eq("device_key", deviceKey)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const old of pending || []) {
    const same = Math.abs(Number(old.amount_brl) - amount) < 0.01 && old.gateway_type === gateway.type;
    const alive = old.expires_at && new Date(old.expires_at).getTime() > Date.now() + 60 * 1000;
    if (same && alive && old.gateway_payment_id) {
      const re = await reopenPix(gateway, old.gateway_type, old.gateway_payment_id, old.expires_at);
      if (re) {
        return {
          ok: true,
          pix: {
            order_id: old.id,
            gateway_type: old.gateway_type,
            gateway_name: gateway.name,
            has_alternate_gateway: usable.length > 1,
            amount,
            app_name: (app as any).name,
            pix_qr_code: re.pix_qr_code,
            pix_qr_code_base64: re.pix_qr_code_base64,
            expires_at: re.expires_at,
          },
        };
      }
    }
    if (old.gateway_payment_id) await cancelPix(admin, p.tenantId, old.gateway_type, old.gateway_payment_id);
    await admin.from("reseller_app_orders").update({ status: "cancelled" }).eq("id", old.id).eq("status", "pending");
  }

  const { data: reseller } = await admin.from("resellers").select("display_name").eq("id", p.resellerId).maybeSingle();
  const resellerName = String(reseller?.display_name || "Revenda");
  const orderId = randomUUID();
  const description = `Ativação ${(app as any).name} — ${resellerName}`;
  const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
  const pix = await createPix(gateway, {
    externalRef: orderId,
    amount,
    description,
    idempotencyKey: `resapp-${p.resellerId}-${(app as any).id}-${deviceKey}-${amount.toFixed(2)}-${bucket10m}`,
    payerName: resellerName,
    payerEmail: `revenda-${p.resellerId.slice(0, 8)}@unigestor.net.br`,
    metadata: { payment_type: "reseller_app_activation", tenant_id: p.tenantId, reseller_id: p.resellerId, app_id: (app as any).id },
  });
  if (!pix) {
    log("pix_create_failed", { gateway: gateway.type });
    return { ok: false, status: 502, error: "Falha ao gerar o PIX. Tente de novo." };
  }

  const { error: insErr } = await admin.from("reseller_app_orders").insert({
    id: orderId,
    tenant_id: p.tenantId,
    reseller_id: p.resellerId,
    app_id: (app as any).id,
    app_name: (app as any).name,
    reseller_client_app_id: rowId,
    end_client_username: endClientUsername,
    field_values: values,
    device_key: deviceKey,
    prev_expire_date: prevExpire,
    amount_brl: amount,
    gateway_id: gateway.id,
    gateway_type: gateway.type,
    gateway_payment_id: pix.gateway_payment_id,
    status: "pending",
    expires_at: pix.expires_at,
  });
  if (insErr) {
    log("insert_failed", { message: insErr.message });
    await cancelPix(admin, p.tenantId, gateway.type, pix.gateway_payment_id);
    return { ok: false, status: 500, error: "Erro interno." };
  }

  return {
    ok: true,
    pix: {
      order_id: orderId,
      gateway_type: gateway.type,
      gateway_name: gateway.name,
      has_alternate_gateway: usable.length > 1,
      amount,
      app_name: (app as any).name,
      pix_qr_code: pix.pix_qr_code,
      pix_qr_code_base64: pix.pix_qr_code_base64,
      expires_at: pix.expires_at,
    },
  };
}

// ---------------------------------------------------------------------------
// 2) CONFIRMAR PAGAMENTO (webhook ou acompanhamento)
// ---------------------------------------------------------------------------
async function notifyAdmin(order: any, title: string, message: string) {
  try {
    await notify({ tenantId: order.tenant_id, type: "fulfillment_error", title, message, link: `/admin/revendedor/${order.reseller_id}`, sourceId: order.id });
  } catch {}
}

/**
 * Reconsulta o gateway; se pago no valor certo, marca aprovado e dispara a
 * ativação em segundo plano (after) — a resposta não espera o DupleCast (~90s).
 * Idempotente: webhook + acompanhamento juntos só ativam 1 vez.
 */
export async function confirmPaidAndFulfillApp(admin: SupabaseClient, orderId: string): Promise<void> {
  const { data: order } = await admin.from("reseller_app_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || !order.gateway_payment_id) return;

  if (order.status === "pending") {
    const chk = await checkPix(admin, order.tenant_id, order.gateway_type, order.gateway_payment_id);
    if (!chk || chk.state === "pending") return;
    if (chk.state === "dead") {
      await admin.from("reseller_app_orders").update({ status: chk.status }).eq("id", order.id).eq("status", "pending");
      return;
    }
    // ✅ confere o VALOR pago (nunca ativa por um PIX de valor menor)
    if (!(chk.paidAmount >= Number(order.amount_brl) - 0.01)) {
      await admin
        .from("reseller_app_orders")
        .update({
          status: "approved",
          paid_at: new Date().toISOString(),
          fulfillment_status: "error",
          fulfillment_error: `Valor pago (${brl(chk.paidAmount)}) diferente do pedido (${brl(Number(order.amount_brl))}) — ativação NÃO feita.`,
        })
        .eq("id", order.id)
        .eq("status", "pending");
      await notifyAdmin(order, "Ativação de app com valor divergente", `${order.app_name}: pago com valor diferente do pedido. Confira antes de ativar.`);
      return;
    }
    const { error } = await admin
      .from("reseller_app_orders")
      .update({ status: "approved", paid_at: new Date().toISOString(), fulfillment_status: "pending" })
      .eq("id", order.id)
      .eq("status", "pending");
    if (error) {
      // índice "1 pago em aberto por aparelho": outro pedido pago do mesmo aparelho ainda ativando
      await admin
        .from("reseller_app_orders")
        .update({
          status: "approved",
          paid_at: new Date().toISOString(),
          fulfillment_status: "error",
          fulfillment_error: "Pago, mas já havia outra ativação desse aparelho em andamento — conferir (possível pagamento em dobro).",
        })
        .eq("id", order.id)
        .eq("status", "pending");
      await notifyAdmin(order, "Ativação paga em dobro?", `${order.app_name}: pagamento de um aparelho que já estava sendo ativado. Confira.`);
      return;
    }
  }

  const { data: fresh } = await admin.from("reseller_app_orders").select("status, fulfillment_status, provider").eq("id", orderId).maybeSingle();
  if (fresh?.status === "approved" && fresh.fulfillment_status === "pending") {
    after(() => fulfillAppOrder(admin, orderId));
  } else if (fresh?.fulfillment_status === "activating" && fresh.provider === "appativa") {
    await resolveResellerAppativa(admin, orderId);
  }
}

// ---------------------------------------------------------------------------
// 3) ATIVAR (trava atômica: só 1 execução por pedido)
// ---------------------------------------------------------------------------
export async function fulfillAppOrder(admin: SupabaseClient, orderId: string): Promise<void> {
  const { data: claimed } = await admin
    .from("reseller_app_orders")
    .update({ fulfillment_status: "processing" })
    .eq("id", orderId)
    .eq("status", "approved")
    .eq("fulfillment_status", "pending")
    .select("*")
    .maybeSingle();
  if (!claimed) return;
  const order = claimed;
  const finish = (fields: Record<string, unknown>) => admin.from("reseller_app_orders").update(fields).eq("id", order.id);

  try {
    const { data: app } = await admin.from("apps").select(APP_COLS).eq("id", order.app_id).maybeSingle();
    const fieldsConfig = Array.isArray((app as any)?.fields_config) ? (app as any).fields_config : [];
    const values = (order.field_values || {}) as Record<string, string>;
    const appativaAppId = (app as any)?.appativa_app_id ? String((app as any).appativa_app_id) : "";
    const duple = isDuplecast(app);

    async function tryAppativa(): Promise<{ ok: true } | { ok: false; error: string }> {
      if (!appativaAppId) return { ok: false, error: "AtivaApp não mapeada nesse app." };
      const { macApp, keyApp } = extractAppativaCreds(fieldsConfig, values);
      if (!macApp) return { ok: false, error: `${appativaIdentifierLabel(fieldsConfig)} não informado.` };
      const apiKey = await getAppativaApiKey(admin, order.tenant_id);
      if (!apiKey) return { ok: false, error: "Parceiro AtivaApp sem chave configurada." };
      const r = await solicitarAtivacao(apiKey, { appativaAppId, macApp, keyApp: keyApp || undefined });
      if (!("data" in r)) return { ok: false, error: r.error };
      await finish({ provider: "appativa", appativa_historico_id: String(r.data.id), fulfillment_status: "activating", fulfillment_error: null });
      // mesma checagem automática do cliente: 5 em 5s por ~1 min (além do
      // webhook da AtivaApp e do acompanhamento da tela) — não depende de a
      // revenda ficar com a tela aberta
      after(async () => {
        await syncAppativaCredits(admin, order.tenant_id).catch(() => null);
        for (let i = 0; i < 12; i++) {
          await new Promise((res) => setTimeout(res, 5000));
          const out = await resolveResellerAppativa(admin, order.id).catch(() => "pending" as const);
          if (out !== "pending") break;
        }
      });
      return { ok: true };
    }

    async function tryDuplecast(): Promise<{ ok: true } | { ok: false; error: string }> {
      const mac = extractFieldByType(fieldsConfig, values, "mac");
      const key = extractFieldByType(fieldsConfig, values, "device_key");
      if (!mac || !key) return { ok: false, error: "MAC e Device Key são obrigatórios no DupleCast." };
      await finish({ provider: "duplecast", fulfillment_status: "activating" });
      const r = await renewDuplecastWithCode(admin, {
        tenantId: order.tenant_id,
        clientAppId: "00000000-0000-0000-0000-000000000000", // não é client_apps (sem campo de data → não grava lá)
        macValue: mac,
        deviceKey: key,
        fieldsConfig: [],
        fieldValues: {},
      });
      if ("error" in r) return { ok: false, error: r.error };
      await completeOrder(admin, order.id, isoDate(r.expireDate), { duplecast_code: r.code });
      return { ok: true };
    }

    // DupleCast: parceiro padrão é o próprio DupleCast, AtivaApp só se escolhido
    // em apps.renewal_source; o 2º só roda se o 1º falhar NA HORA (nunca os dois)
    const appativaFirst = !duple || (app as any)?.renewal_source === "appativa";
    const first = appativaFirst ? await tryAppativa() : await tryDuplecast();
    if (!("error" in first)) return;
    const firstErr = first.error;
    const canFallback = duple && (appativaFirst ? true : !!appativaAppId);
    if (canFallback) {
      const second = appativaFirst ? await tryDuplecast() : await tryAppativa();
      if (!("error" in second)) return;
      const msg = `${appativaFirst ? "AtivaApp" : "DupleCast"}: ${firstErr} · ${appativaFirst ? "DupleCast" : "AtivaApp"}: ${second.error}`;
      await finish({ fulfillment_status: "error", fulfillment_error: `${msg} — ativar manualmente.` });
      await notifyAdmin(order, "Ativação de app paga falhou", `${order.app_name} (revenda): ${msg}. Ative manualmente.`);
      return;
    }
    await finish({ fulfillment_status: "error", fulfillment_error: `${firstErr} — ativar manualmente.` });
    await notifyAdmin(order, "Ativação de app paga falhou", `${order.app_name} (revenda): ${firstErr}. Ative manualmente.`);
  } catch (e: any) {
    // caiu no meio: NÃO volta pra 'pending' (poderia ativar 2x) — fica pra conferência
    await finish({ fulfillment_status: "unknown", fulfillment_error: `Erro inesperado na ativação: ${e?.message || "erro"} — conferir no parceiro.` });
    await notifyAdmin(order, "Ativação de app paga: erro", `${order.app_name} (revenda): erro inesperado. Confira no parceiro.`);
  }
}

// ---------------------------------------------------------------------------
// 4) AtivaApp: status final (webhook dela / acompanhamento da tela)
// ---------------------------------------------------------------------------
export async function resolveResellerAppativa(admin: SupabaseClient, orderId: string): Promise<"done" | "pending" | "error" | "skipped"> {
  const { data: order } = await admin.from("reseller_app_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order?.appativa_historico_id || order.provider !== "appativa") return "skipped";
  if (order.fulfillment_status === "done") return "done";
  if (order.fulfillment_status !== "activating") return "skipped";
  const apiKey = await getAppativaApiKey(admin, order.tenant_id);
  if (!apiKey) return "skipped";
  const r = await consultarAtivacao(apiKey, order.appativa_historico_id);
  if (!("data" in r)) return "pending";
  const st = String(r.data.status_transacao || "").trim().toLowerCase();
  if (APPATIVA_OK.has(st) || APPATIVA_FAIL.has(st)) await syncAppativaCredits(admin, order.tenant_id).catch(() => null);
  if (APPATIVA_FAIL.has(st)) {
    const { data: app } = await admin.from("apps").select("fields_config").eq("id", order.app_id).maybeSingle();
    const label = appativaIdentifierLabel(Array.isArray(app?.fields_config) ? app!.fields_config : []);
    const { data: upd } = await admin
      .from("reseller_app_orders")
      .update({ fulfillment_status: "error", fulfillment_error: `AtivaApp recusou a ativação ("${r.data.status_transacao}"). Confira o ${label}.` })
      .eq("id", order.id)
      .eq("fulfillment_status", "activating")
      .select("id")
      .maybeSingle();
    if (upd) await notifyAdmin(order, "AtivaApp recusou ativação paga", `${order.app_name} (revenda): status "${r.data.status_transacao}". Confira o ${label}.`);
    return "error";
  }
  if (!APPATIVA_OK.has(st)) return "pending";
  const date = isoDate((r.data as any).data_expiracao_at || (r.data as any).data_expiracao);
  const daysForward = date ? (new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86400000 : -1;
  if (!date || daysForward < MIN_DAYS_FORWARD) return "pending"; // AtivaApp ainda propagando o vencimento novo
  await completeOrder(admin, order.id, date, {});
  return "done";
}

/** Conclui (1 vez só): vencimento no app do cliente da revenda, receita, WhatsApp. */
async function completeOrder(admin: SupabaseClient, orderId: string, newExpire: string | null, extra: Record<string, unknown>) {
  const { data: order } = await admin
    .from("reseller_app_orders")
    .update({ fulfillment_status: "done", fulfilled_at: new Date().toISOString(), new_expire_date: newExpire, fulfillment_error: null, ...extra })
    .eq("id", orderId)
    .in("fulfillment_status", ["processing", "activating"])
    .select("*")
    .maybeSingle();
  if (!order) return; // já concluído por outro caminho
  log("done", { order: String(order.id).slice(0, 8), app: order.app_name });
  if (order.reseller_client_app_id && newExpire) {
    await admin.from("reseller_client_apps").update({ expire_date: newExpire }).eq("id", order.reseller_client_app_id);
  }
  try {
    await syncIptvRendimentos(admin, order.tenant_id);
  } catch {}
  await sendActivationWhatsApp(admin, order);
}

/** Comprovante pro WhatsApp da revenda. Template "Ativação Revenda" se existir; senão texto padrão. */
async function sendActivationWhatsApp(admin: SupabaseClient, order: any) {
  const mark = (st: "sent" | "error" | "na") => admin.from("reseller_app_orders").update({ whatsapp_status: st }).eq("id", order.id);
  try {
    const secret = String(process.env.INTERNAL_API_SECRET || "").trim();
    if (!secret) return void (await mark("error"));
    const { data: tpl } = await admin
      .from("message_templates")
      .select("content")
      .eq("tenant_id", order.tenant_id)
      .ilike("name", "%ativa%revenda%")
      .limit(1)
      .maybeSingle();
    const vencimento = order.new_expire_date ? dateBR(order.new_expire_date) : "confirmado no aparelho";
    const cliente = order.end_client_username || "";
    const base =
      tpl?.content ||
      `✅ *Ativação confirmada!*\n\n📱 Aplicativo: *{app_nome}*${cliente ? "\n👤 Cliente: *{cliente}*" : ""}\n📅 Novo vencimento: *{app_vencimento}*\n\nObrigado!`;
    const message = base.replaceAll("{app_nome}", order.app_name).replaceAll("{app_vencimento}", vencimento).replaceAll("{cliente}", cliente);
    const res = await fetch(`${appOrigin()}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ tenant_id: order.tenant_id, reseller_id: order.reseller_id, message, whatsapp_session: "default" }),
      signal: AbortSignal.timeout(20000),
    });
    await mark(res.ok ? "sent" : "error");
  } catch (e: any) {
    log("whatsapp_failed", { message: e?.message });
    await mark("error").then(() => null, () => null);
  }
}

// ---------------------------------------------------------------------------
// 5) WEBHOOKS
// ---------------------------------------------------------------------------
/** MP / FastDePix: pagamento que não é de cliente nem de crédito. Assinatura conferida com o segredo do gateway do tenant. */
export async function handleResellerAppOrderWebhook(
  admin: SupabaseClient,
  params: { gatewayFamily: "mercadopago" | "fastdepix"; gatewayPaymentId: string; verify: (secret: string) => boolean },
  gatewayConfigFor: (tenantId: string, type: string) => Promise<Record<string, any>>,
): Promise<"not_found" | "bad_signature" | "ok"> {
  let q = admin.from("reseller_app_orders").select("id, tenant_id, gateway_type").eq("gateway_payment_id", params.gatewayPaymentId);
  q = params.gatewayFamily === "mercadopago" ? q.eq("gateway_type", "mercadopago") : q.in("gateway_type", ["fastpay", "fastflow"]);
  const { data: order } = await q.maybeSingle();
  if (!order) return "not_found";
  const cfg = await gatewayConfigFor(order.tenant_id, order.gateway_type);
  const secret = String(cfg.webhook_secret || "").trim();
  if (!secret || !params.verify(secret)) {
    console.error("[reseller_app_order_webhook_sig_failed]", { kind: "suspicious_access", gateway: order.gateway_type });
    return "bad_signature";
  }
  await confirmPaidAndFulfillApp(admin, order.id);
  return "ok";
}

/** Webhook da AtivaApp: id_cobranca que não é de cliente pode ser de revenda. */
export async function handleResellerAppativaWebhook(admin: SupabaseClient, historicoId: string): Promise<boolean> {
  const { data: order } = await admin.from("reseller_app_orders").select("id").eq("appativa_historico_id", historicoId).maybeSingle();
  if (!order) return false;
  await resolveResellerAppativa(admin, order.id);
  return true;
}
