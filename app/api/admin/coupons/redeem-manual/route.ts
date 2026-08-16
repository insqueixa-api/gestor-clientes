// app/api/admin/coupons/redeem-manual/route.ts
//
// Grava o resgate de um cupom aplicado num pagamento do Portal do Cliente
// que foi concluído MANUALMENTE pelo admin (Auditoria → RecargaCliente,
// fluxo de servidor Elite/sem integração/falha na renovação automática).
// coupon_redemptions só aceita escrita via service_role (RLS), por isso
// não dá pra gravar direto do browser como o client_alerts (que tem
// policy de UPDATE pro admin) — precisa dessa rota.
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
  const couponId = String(body?.coupon_id || "").trim();
  const clientId = String(body?.client_id || "").trim();
  const paymentId = String(body?.payment_id || "").trim() || null;
  const discountAmount = Number(body?.discount_amount || 0);
  const currency = String(body?.currency || "BRL").trim() || "BRL";

  if (!tenantId || !couponId || !clientId || !(discountAmount > 0)) {
    return NextResponse.json({ error: "Parâmetros incompletos" }, { status: 400 });
  }

  if (tenantId !== authTenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ✅ Faltava confirmar que coupon_id e client_id recebidos no body
  // realmente pertencem a este tenant — a checagem acima só validava o
  // próprio tenant_id. Como o insert usa service role (ignora RLS), sem
  // isso um admin autenticado que soubesse/adivinhasse ids de OUTRO tenant
  // conseguia gravar um resgate cruzado, e — se o cupom referenciado for
  // pessoal — desativar um cupom que não é dele.
  const [{ data: couponCheck }, { data: clientCheck }] = await Promise.all([
    supabaseAdmin.from("coupons").select("id").eq("id", couponId).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("clients").select("id").eq("id", clientId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!couponCheck || !clientCheck) {
    return NextResponse.json({ error: "Cupom ou cliente não encontrado" }, { status: 404 });
  }

  // Idempotente por payment_id — evita gravar 2x se o admin clicar
  // "Concluir" mais de uma vez pro mesmo pagamento.
  if (paymentId) {
    const { count } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("payment_id", paymentId);
    if (count) {
      return NextResponse.json({ ok: true, alreadyRedeemed: true });
    }
  }

  const { error: insErr } = await supabaseAdmin.from("coupon_redemptions").insert({
    tenant_id: tenantId,
    coupon_id: couponId,
    client_id: clientId,
    payment_id: paymentId,
    discount_amount: discountAmount,
    currency,
  });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Cupom pessoal se autodesativa ao ser usado — o admin reativa
  // manualmente na próxima indicação (mesmo padrão do fluxo automático em
  // lib/client-portal/fulfillment.ts).
  const { data: couponRow } = await supabaseAdmin
    .from("coupons")
    .select("client_id")
    .eq("id", couponId)
    .maybeSingle();
  if (couponRow?.client_id) {
    await supabaseAdmin.from("coupons").update({ is_active: false }).eq("id", couponId);
  }

  return NextResponse.json({ ok: true });
}
