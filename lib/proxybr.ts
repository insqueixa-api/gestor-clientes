// lib/proxybr.ts
// ✅ 31/08/2026 — cliente da API v1 da ProxyBR (portal.proxybr.com.br),
// achada pelo Márcio (coleção Postman deles). Usada só pro painel "Sistema"
// consultar validade/saldo/auto-renovação REAIS da assinatura do proxy
// dedicado — antes disso era um campo editável manual (achado que não
// existia API de conta pública, o que era verdade só até o Márcio achar a
// coleção). Ver docs em portal.proxybr.com.br → API & Integrações.
const PROXYBR_BASE = "https://portal.proxybr.com.br/api/v1";

export type ProxyBrOrder = {
  uuid: string;
  code: string;
  status: string; // "active" | "pending_renewal" | "cancelled" | ...
  auto_renew_active: boolean;
  expires_at: string; // ISO
  starts_at: string;
  renewal_window: { is_open: boolean; starts_at: string; expires_at: string } | null;
  renewal_policy: { grace_days: number; on_expiry_action: string } | null;
  renewal_price_with_fee: number | null;
};

async function proxyBrFetch(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${PROXYBR_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.headers as Record<string, string> ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ✅ Conta tem hoje só 1 assinatura de proxy — pega a que ainda não foi
// cancelada com o vencimento mais próximo. Se um dia tiver mais de uma,
// segue funcionando (pega a mais urgente).
export async function getActiveProxyOrder(token: string): Promise<{ order: ProxyBrOrder | null; balance: number | null }> {
  const [ordersRes, balanceRes] = await Promise.all([
    proxyBrFetch("/orders?limit=10", token),
    proxyBrFetch("/balance", token).catch(() => null),
  ]);
  const orders: ProxyBrOrder[] = (ordersRes?.data || []).filter((o: ProxyBrOrder) => o.status !== "cancelled");
  orders.sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime());
  return { order: orders[0] || null, balance: balanceRes?.data?.balance ?? null };
}

export async function renewProxyOrder(token: string, orderUuid: string): Promise<any> {
  return proxyBrFetch(`/orders/${orderUuid}/renew`, token, { method: "POST" });
}
