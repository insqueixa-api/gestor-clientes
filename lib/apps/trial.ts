// lib/apps/trial.ts
// ✅ 12/10/2026, pedido do Márcio: o DupleCast dá 15 dias de avaliação e
// depois expira sozinho — mas o parceiro não informa quando começou. A 1ª
// verificação que vê "trial" grava field_values._trial_since (dia em SP) e a
// partir dela contamos os 15 dias (só internamente) e, passado o prazo, o app
// aparece como Expirado (renovação liberada) mesmo antes de alguém checar
// de novo. Só DupleCast tem prazo conhecido; os outros seguem só "avaliação".

export const TRIAL_DAYS_BY_INTEGRATION: Record<string, number> = { DUPLECAST: 15 };

export function todaySP(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** dias restantes da avaliação (no dia da 1ª checagem = 15; chegou a 0 = expirou, como o Márcio pediu: "no 15º dia muda pra expirado"); null = sem prazo conhecido */
export function trialDaysLeft(
  fieldValues: Record<string, any> | null | undefined,
  integrationType: string | null | undefined,
): number | null {
  const v = fieldValues || {};
  if (v._trial_hint !== "1") return null;
  const total = TRIAL_DAYS_BY_INTEGRATION[String(integrationType || "").toUpperCase()];
  const since = String(v._trial_since || "").slice(0, 10);
  if (!total || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return null;
  const used = Math.round((Date.parse(`${todaySP()}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000);
  return total - used;
}

/** avaliação já passou do prazo → tratar como expirado */
export function trialOver(fieldValues: Record<string, any> | null | undefined, integrationType: string | null | undefined): boolean {
  const left = trialDaysLeft(fieldValues, integrationType);
  return left != null && left <= 0;
}

// ✅ 12/10/2026 (mesmo dia), pedido do Márcio: NÃO mostrar "faltam X dias" —
// a contagem começa na 1ª checagem, não na instalação real (o cliente pode
// ter instalado dias antes), então o número poderia estar errado. Mostra só
// "Modo de avaliação"; a contagem fica interna, pra virar Expirado depois dos
// 15 dias (como começa na 1ª checagem, nunca expira ANTES do real).
export function trialLabel(daysLeft: number | null): string {
  if (daysLeft != null && daysLeft <= 0) return "Expirado";
  return "Modo de avaliação";
}
