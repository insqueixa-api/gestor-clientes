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

  // Resolve nomes de servidor (target_server_ids guarda id, não nome) só pra
  // exibir a regra por extenso na página do cliente — sem isso o admin veria
  // só um UUID.
  const serverIds = Array.from(
    new Set(list.flatMap(({ coupon }) => coupon.target_server_ids || [])),
  );
  const serverNameById: Record<string, string> = {};
  if (serverIds.length) {
    const { data: servers } = await supabase.from("servers").select("id, name").in("id", serverIds);
    for (const s of servers || []) serverNameById[s.id] = s.name;
  }

  // Contagem de uso só pra cupons com limite total (pra mostrar "12/100 usados").
  const capped = list.filter(({ coupon }) => coupon.max_total_redemptions != null);
  const usageById: Record<string, number> = {};
  if (capped.length) {
    await Promise.all(
      capped.map(async ({ coupon }) => {
        const { count } = await supabase
          .from("coupon_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("coupon_id", coupon.id);
        usageById[coupon.id] = count || 0;
      }),
    );
  }

  return NextResponse.json({
    coupons: list.map(({ coupon, kind }) => ({
      id: coupon.id,
      code: coupon.code,
      description: coupon.description,
      kind,
      discount_label: formatDiscountLabel(coupon),
      bot_visible: coupon.bot_visible,
      is_bot_pick: botPick?.id === coupon.id,
      rule: kind === "personal" ? null : {
        target_status: coupon.target_status,
        target_server_names: (coupon.target_server_ids || []).map((id) => serverNameById[id] || id),
        target_plan_labels: coupon.target_plan_labels,
        target_app_names: coupon.target_app_names,
        rule_date_field: coupon.rule_date_field,
        rule_days_min: coupon.rule_days_min,
        rule_days_max: coupon.rule_days_max,
        max_total_redemptions: coupon.max_total_redemptions,
        used_count: coupon.max_total_redemptions != null ? (usageById[coupon.id] ?? 0) : null,
      },
    })),
  });
}
