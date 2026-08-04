export const MIN_DELAY_SECS = 2 * 60;
export const MAX_DELAY_SECS = 30 * 60;

export function normalizeBillingDelayWindow(minSecs: number, maxSecs: number) {
  const normalizedMin = Number.isFinite(minSecs)
    ? Math.max(MIN_DELAY_SECS, Math.floor(minSecs))
    : MIN_DELAY_SECS;
  const normalizedMax = Number.isFinite(maxSecs)
    ? Math.max(MIN_DELAY_SECS, Math.floor(maxSecs))
    : MAX_DELAY_SECS;

  if (normalizedMax < normalizedMin) {
    return { minSecs: normalizedMin, maxSecs: normalizedMin };
  }

  return {
    minSecs: Math.min(normalizedMin, MAX_DELAY_SECS),
    maxSecs: Math.min(normalizedMax, MAX_DELAY_SECS),
  };
}
