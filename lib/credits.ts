export type UserRole = "ADMIN" | "RESELLER";

export function isAdmin(role: UserRole) {
  return role === "ADMIN";
}

/**
 * Admin nunca consome crédito.
 * Revendedor precisa ter saldo > 0.
 */
export function canUseSystem(role: UserRole, balance: number | null | undefined) {
  if (isAdmin(role)) return true;
  return (balance ?? 0) > 0;
}

/**
 * Admin não debita.
 * Revendedor debita 1.
 */
export function shouldConsumeCredit(role: UserRole) {
  return !isAdmin(role);
}
