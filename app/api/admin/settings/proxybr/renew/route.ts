// app/api/admin/settings/proxybr/renew/route.ts
// ✅ 11/09/2026 — movida de app/api/system-health/proxy-renew (painel
// "Sistema" removido). Chama a API real da ProxyBR (POST /orders/:uuid/
// renew, ver lib/proxybr.ts) — DEBITA do saldo da conta ProxyBR de verdade,
// por isso fica atrás de confirmação no front (useConfirm) antes de chamar
// essa rota.
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { getActiveProxyOrder, renewProxyOrder } from "@/lib/proxybr";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const apiToken = String(process.env.PROXYBR_API_TOKEN || "").trim();
  if (!apiToken) {
    return NextResponse.json({ error: "PROXYBR_API_TOKEN não configurado" }, { status: 500 });
  }

  try {
    const { order } = await getActiveProxyOrder(apiToken);
    if (!order) {
      return NextResponse.json({ error: "Nenhum pedido ativo encontrado na conta ProxyBR" }, { status: 404 });
    }
    const result = await renewProxyOrder(apiToken, order.uuid);
    return NextResponse.json({ ok: true, order: result?.data || result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao renovar" }, { status: 502 });
  }
}
