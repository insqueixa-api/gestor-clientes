// lib/apps/auto-renewal.ts
// ✅ 07/10/2026: "renovação automática" de licença (ícone ⚡ no seletor de
// apps) — o pagamento já sai renovando sozinho, sem o Márcio fazer nada:
//   - AtivaApp (apps.appativa_app_id);
//   - DupleCast (código da conta de revenda);
//   - família GerenciaApp (renovação no painel deles).
// O resto (pago, sem nenhum dos três) é renovação MANUAL: o pagamento cai como
// pendência no admin e o Márcio renova por fora.
// Configuração automática da lista é outra coisa (has_integration → ⚙️).
export function hasAutoRenewal(app: {
  appativa_app_id?: string | null;
  name?: string | null;
  integration_type?: string | null;
}): boolean {
  if (app.appativa_app_id) return true;
  if (String(app.name || "").trim().toLowerCase() === "duplecast") return true;
  return String(app.integration_type || "").trim().toUpperCase() === "GERENCIAAPP";
}
