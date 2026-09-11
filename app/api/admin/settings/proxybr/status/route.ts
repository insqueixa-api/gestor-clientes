// app/api/admin/settings/proxybr/status/route.ts
// ✅ 11/09/2026 — card "ProxyBR" na aba Parceiros (API de Integrações).
// Antes vivia no painel "Sistema" (removido a pedido do Márcio); só a
// validade/saldo/renovação do proxy dedicado sobreviveram, migradas pra cá
// por serem a única checagem que ele realmente usava — ver lib/proxybr.ts
// pro cliente da API real da ProxyBR.
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { getActiveProxyOrder } from "@/lib/proxybr";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const apiToken = String(process.env.PROXYBR_API_TOKEN || "").trim();
  if (!apiToken) {
    return NextResponse.json({ error: "PROXYBR_API_TOKEN não configurado" }, { status: 500 });
  }

  try {
    const { order, balance } = await getActiveProxyOrder(apiToken);
    return NextResponse.json({ ok: true, order, balance });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao consultar a ProxyBR" }, { status: 502 });
  }
}
