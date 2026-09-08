// app/api/admin/payments/delete/route.ts
//
// Botão de lixeira da Auditoria — apaga um registro de client_portal_payments
// específico. Pedido do Márcio (08/09/2026): testes de pagamento (ex: PIX
// que ele mesmo gera e não paga de propósito) ficavam poluindo o log pra
// sempre, sem forma de limpar pela própria tela. Mesmo padrão de auth de
// app/api/admin/payments/retry-fulfillment (Bearer = access_token da sessão
// do admin, checa tenant_members).
//
// coupon_redemptions.payment_id e client_portal_payments.parent_payment_id
// são ON DELETE SET NULL — apagar aqui nunca derruba outra linha, só solta
// a referência.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: supabaseAdmin, tenant_id: authTenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const paymentId = String(body?.payment_id || "").trim();
  if (!paymentId) {
    return NextResponse.json({ error: "payment_id é obrigatório" }, { status: 400 });
  }

  const { data: deleted, error } = await supabaseAdmin
    .from("client_portal_payments")
    .delete()
    .eq("id", paymentId)
    .eq("tenant_id", authTenantId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
