// lib/alerts/app-activation-alert.ts
//
// Cria o sino "Ativação de aplicativo" (client_alerts kind=app_activation),
// opcionalmente com um cupom pessoal do app — o desconto já entra no valor
// do sino e o uso do cupom é registrado na quitação (settle_client_alert ou
// pagamento no portal). Fonte única: sino (ClientAlertBell) e a pergunta
// depois de ativar/renovar app pelo admin (AppTrustPrompt).
// docs/alertas-confianca/PLANO.md
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatDateBR } from "@/lib/date-br";

export type AppCouponInput = {
  code: string;
  type: "percent" | "fixed";
  value: number;
};

export function appActivationMessage(appName: string, dateISO: string) {
  if (!appName) return "";
  const datePart = dateISO ? formatDateBR(dateISO, "") : "";
  return datePart ? `Ativação de aplicativo: "${appName}" - dia ${datePart}` : `Ativação de aplicativo: "${appName}"`;
}

export function randomCouponCode(appName: string) {
  const base = appName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6) || "APP";
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function couponDiscount(amount: number, coupon: AppCouponInput | null) {
  if (!coupon || !(coupon.value > 0)) return 0;
  const d = coupon.type === "percent" ? (amount * coupon.value) / 100 : coupon.value;
  return Number(Math.min(amount, d).toFixed(2));
}

export async function createAppActivationAlert(params: {
  tenantId: string;
  clientId: string;
  clientName: string;
  clientAppId: string;
  appName: string;
  amount: number;
  currency: string;
  activationDate: string;
  message?: string;
  coupon?: AppCouponInput | null;
  /** "Já recebi" (baixa na hora) — o Log mostra "Ativação de aplicativo", não "em confiança" */
  receivedNow?: boolean;
}): Promise<{ ok: true; alertId: string } | { ok: false; error: string }> {
  const { tenantId, clientId, clientAppId, appName, amount, currency } = params;
  if (!(amount > 0)) return { ok: false, error: "Informe um valor maior que zero." };

  let couponId: string | null = null;
  // nome do app guardado no sino: o "Salvar" do cadastro recria os
  // client_apps e o vínculo (client_app_id) pode se perder
  let meta: Record<string, unknown> = { app_name: appName, ...(params.receivedNow ? { received_now: true } : {}) };
  let finalAmount = amount;
  const coupon = params.coupon || null;
  if (coupon) {
    const code = coupon.code.trim().toUpperCase();
    if (!code || !(coupon.value > 0) || (coupon.type === "percent" && coupon.value > 100)) {
      return { ok: false, error: "Confira o código e o valor do desconto." };
    }
    const discount = couponDiscount(amount, coupon);
    const { data, error } = await supabaseBrowser
      .from("coupons")
      .insert({
        tenant_id: tenantId,
        code,
        description: `${appName || "Aplicativo"} — ${params.clientName}`,
        discount_type: coupon.type,
        discount_value: coupon.value,
        currency: coupon.type === "fixed" ? currency : null,
        is_active: true,
        client_id: clientId,
        target_client_app_ids: [clientAppId],
        max_total_redemptions: 1,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message || "Não deu pra criar o cupom (código já usado?)." };
    couponId = data.id;
    finalAmount = Number((amount - discount).toFixed(2));
    meta = { ...meta, full_amount: amount, discount_amount: discount, coupon_code: code };
  }

  const { data: alert, error: alertErr } = await supabaseBrowser
    .from("client_alerts")
    .insert({
      tenant_id: tenantId,
      client_id: clientId,
      status: "OPEN",
      kind: "app_activation",
      client_app_id: clientAppId,
      amount: finalAmount,
      currency,
      activation_date: params.activationDate || null,
      message: params.message?.trim() || appActivationMessage(appName, params.activationDate),
      coupon_id: couponId,
      meta,
    })
    .select("id")
    .single();
  if (alertErr || !alert) {
    // cupom sem sino não serve pra nada — desfaz
    if (couponId) await supabaseBrowser.from("coupons").delete().eq("id", couponId);
    return { ok: false, error: alertErr?.message || "Não deu pra criar o sino." };
  }
  return { ok: true, alertId: alert.id };
}
