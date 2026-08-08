// app/api/admin/clients/[id]/eligible-coupons/route.ts
// Lista TODOS os cupons (pessoal + geral) que um cliente é elegível agora,
// pra exibir na página do cliente (app/admin/cliente/[id]/page.tsx). Marca
// `is_bot_pick` no cupom que o bot de atendimento realmente usaria em
// {cupom_frase} hoje (findEligibleCoupon com onlyBotVisible) — pode não ter
// nenhum, mesmo com cupons elegíveis na lista, se nenhum for bot_visible.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { listEligibleCoupons, findEligibleCoupon, formatDiscountLabel } from "@/lib/client-portal/coupons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;
  const { id: clientId } = await params;

  const r1 = await supabase.from("vw_clients_list_active").select("*").eq("tenant_id", tenantId).eq("id", clientId).maybeSingle();
  const r2 = r1.data ? null : await supabase.from("vw_clients_list_archived").select("*").eq("tenant_id", tenantId).eq("id", clientId).maybeSingle();
  const clientRow = r1.data || r2?.data || null;
  if (!clientRow) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  const [list, botPick] = await Promise.all([
    listEligibleCoupons({ supabaseAdmin: supabase, tenantId, clientRow }),
    findEligibleCoupon({ supabaseAdmin: supabase, tenantId, clientRow, onlyBotVisible: true }),
  ]);

  return NextResponse.json({
    coupons: list.map(({ coupon, kind }) => ({
      id: coupon.id,
      code: coupon.code,
      description: coupon.description,
      kind,
      discount_label: formatDiscountLabel(coupon),
      bot_visible: coupon.bot_visible,
      is_bot_pick: botPick?.id === coupon.id,
    })),
  });
}
