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
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const { data: mem, error: memErr } = await supabaseAdmin
    .from("tenant_members")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (memErr || !mem) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
