// lib/apps/renewal-window.ts
// ✅ 12/10/2026, pedido do Márcio: quantos dias antes do vencimento a
// renovação da licença libera. Regra única pro portal do cliente, página
// Aplicativo ID e Portal da Revenda.
//   • Appativa renova primeiro → 7 dias (regra deles)
//   • resto (DupleCast direto, GerenciaApp, GPC Roku…) → 30 dias
// DupleCast com código da Appativa só renova primeiro pela Appativa quando
// apps.renewal_source = "appativa" (padrão é o próprio DupleCast — mesma
// escolha de lib/client-portal/fulfillment.ts e lib/reseller-portal/app-orders.ts).
// Antes bastava ter appativa_app_id pra cair em 7 dias, até no DupleCast
// que renova direto.

type AppLike = {
  appativa_app_id?: string | null;
  integration_type?: string | null;
  renewal_source?: string | null;
};

export function renewsFirstViaAppativa(app: AppLike | null | undefined): boolean {
  if (!app?.appativa_app_id) return false;
  const isDuplecast = String(app.integration_type || "").toUpperCase() === "DUPLECAST";
  return isDuplecast ? app.renewal_source === "appativa" : true;
}

export function renewalWindowDays(app: AppLike | null | undefined): number {
  return renewsFirstViaAppativa(app) ? 7 : 30;
}
