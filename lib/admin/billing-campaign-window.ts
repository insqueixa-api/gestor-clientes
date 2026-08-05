export const MIN_DELAY_SECS = 2 * 60;
export const MAX_DELAY_SECS = 30 * 60;

function clampDelayRange(
  minSecs: number,
  maxSecs: number,
  floorSecs: number,
  ceilSecs: number,
  fallbackMinSecs: number,
  fallbackMaxSecs: number,
) {
  const normalizedMin = Number.isFinite(minSecs)
    ? Math.max(floorSecs, Math.floor(minSecs))
    : fallbackMinSecs;
  const normalizedMax = Number.isFinite(maxSecs)
    ? Math.max(floorSecs, Math.floor(maxSecs))
    : fallbackMaxSecs;

  if (normalizedMax < normalizedMin) {
    return { minSecs: normalizedMin, maxSecs: normalizedMin };
  }

  return {
    minSecs: Math.min(normalizedMin, ceilSecs),
    maxSecs: Math.min(normalizedMax, ceilSecs),
  };
}

export function normalizeBillingDelayWindow(minSecs: number, maxSecs: number) {
  return clampDelayRange(
    minSecs,
    maxSecs,
    MIN_DELAY_SECS,
    MAX_DELAY_SECS,
    MIN_DELAY_SECS,
    MAX_DELAY_SECS,
  );
}

// ✅ Intervalo entre o envio pro contato PRIMÁRIO e o SECUNDÁRIO do mesmo
// cliente (quando a conta tem os dois cadastrados) — pedido do Márcio,
// 05/08/2026: precisa sortear um tempo, não usar um valor fixo, "pra não
// ficar em cima". Regra pedida: 0 a 2min por padrão, editável até 10min.
export const MIN_SECONDARY_CONTACT_DELAY_SECS = 0;
export const MAX_SECONDARY_CONTACT_DELAY_SECS = 10 * 60;
export const DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS = 0;
export const DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS = 2 * 60;

export function normalizeSecondaryContactDelay(minSecs: number, maxSecs: number) {
  return clampDelayRange(
    minSecs,
    maxSecs,
    MIN_SECONDARY_CONTACT_DELAY_SECS,
    MAX_SECONDARY_CONTACT_DELAY_SECS,
    DEFAULT_SECONDARY_CONTACT_DELAY_MIN_SECS,
    DEFAULT_SECONDARY_CONTACT_DELAY_MAX_SECS,
  );
}
