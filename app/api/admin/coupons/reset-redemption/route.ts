// app/api/admin/coupons/reset-redemption/route.ts
//
// Permite o admin "resetar" o uso de um cupom GERAL por um cliente
// específico — apaga a linha de coupon_redemptions, liberando o cliente
// pra usar o mesmo cupom de novo (a regra "1 uso" é garantida pela
// constraint UNIQUE(coupon_id, client_id), então apagar a linha É a
// forma de resetar). coupon_redemptions só aceita escrita via
// service_role (RLS — ver docs/sql/coupons.sql), por isso passa por uma
// rota de API em vez de DELETE direto do browser (mesmo padrão de
// redeem-manual/route.ts).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: supabaseAdmin, tenant_id: authTenantId } = auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tenantId = String(body?.tenant_id || "").trim();
  const redemptionId = String(body?.redemption_id || "").trim();
  if (!tenantId || !redemptionId) {
    return NextResponse.json({ error: "Parâmetros incompletos" }, { status: 400 });
  }

  if (tenantId !== authTenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: delErr } = await supabaseAdmin
    .from("coupon_redemptions")
    .delete()
    .eq("id", redemptionId)
    .eq("tenant_id", tenantId);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
