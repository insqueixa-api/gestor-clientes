// app/api/admin/settings/proxybr/check-and-renew/route.ts
// ✅ 11/09/2026, pedido do Márcio: quando ele dá baixa na parcela
// "Renovação ProxyBR" direto pela tela do Financeiro Pessoal (sem passar
// pelo card de Parceiros/botão "Renovar"), esta rota é chamada em seguida
// (ver ModalBaixa.tsx) pra checar a validade REAL na ProxyBR e só renovar
// de verdade (debitando saldo) se ainda não tiver sido renovado — evita
// renovar em dobro se a conta já tinha auto-renovação ligada ou se ele já
// tivesse renovado manualmente no próprio painel deles antes de dar baixa
// aqui.
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { getActiveProxyOrder, renewProxyOrder } from "@/lib/proxybr";

export const dynamic = "force-dynamic";

// ✅ Mesmo patamar usado no card (ModalCatalogo... não, no card do
// ProxyBR em api-server/page.tsx) pra marcar "perto de vencer" — abaixo
// disso, considera que ainda não foi renovado de verdade.
const RENEW_THRESHOLD_DAYS = 5;

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

    const diasRestantes = Math.ceil((new Date(order.expires_at).getTime() - Date.now()) / 86_400_000);
    if (diasRestantes > RENEW_THRESHOLD_DAYS) {
      return NextResponse.json({
        ok: true,
        renewed: false,
        expires_at: order.expires_at,
        message: "Validade já estava OK — não precisou renovar de novo.",
      });
    }

    const result = await renewProxyOrder(apiToken, order.uuid);
    const newOrder = result?.data || result;
    return NextResponse.json({
      ok: true,
      renewed: true,
      expires_at: newOrder?.expires_at || null,
      message: "Ainda não estava renovado — renovação disparada agora.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao checar/renovar o proxy" }, { status: 502 });
  }
}
