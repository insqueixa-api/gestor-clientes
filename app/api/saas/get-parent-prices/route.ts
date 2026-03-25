import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache", Expires: "0" };

const PERIODS = [
  { period: "MONTHLY", days: 30, label: "Mensal" },
  { period: "BIMONTHLY", days: 60, label: "Bimestral" },
  { period: "QUARTERLY", days: 90, label: "Trimestral" },
  { period: "SEMIANNUAL", days: 180, label: "Semestral" },
  { period: "ANNUAL", days: 365, label: "Anual" },
];
const CREDIT_TIERS = ["C_10","C_20","C_30","C_50","C_100","C_150","C_200","C_300","C_400","C_500"];
const CREDIT_LABELS: Record<string, number> = {
  C_10:10,C_20:20,C_30:30,C_50:50,C_100:100,C_150:150,C_200:200,C_300:300,C_400:400,C_500:500,
};

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401, headers: NO_STORE });

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401, headers: NO_STORE });

    const body = await req.json().catch(() => ({} as any));
    const payment_type = String(body?.payment_type || "renewal");

    const { data: member } = await supabase
      .from("tenant_members")
      .select("tenant_id, tenants(whatsapp_sessions)")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member?.tenant_id) return NextResponse.json({ ok: false, error: "Tenant não encontrado" }, { status: 404, headers: NO_STORE });

    const myTenantId = String(member.tenant_id);
    const myTenant = member.tenants as any;
    const whatsappSessions = Number(myTenant?.whatsapp_sessions || 1);

    // Busca pai via saas_network
    const { data: network } = await supabase
      .from("saas_network")
      .select("parent_tenant_id")
      .eq("child_tenant_id", myTenantId)
      .maybeSingle();

    const parentTenantId = String(network?.parent_tenant_id || "");
    if (!parentTenantId) return NextResponse.json({ ok: false, error: "Sem tenant pai configurado" }, { status: 400, headers: NO_STORE });

    const { data: myTenantRow } = await supabase
  .from("tenants")
  .select("saas_plan_table_id, credits_plan_table_id")
  .eq("id", myTenantId)
  .single();

const planTableId = payment_type === "renewal"
  ? String(myTenantRow?.saas_plan_table_id || "")
  : String(myTenantRow?.credits_plan_table_id || "");

    if (!planTableId) return NextResponse.json({ ok: true, tiers: [], currency: "BRL" }, { headers: NO_STORE });

    const { data: tbl } = await supabase.from("plan_tables").select("currency").eq("id", planTableId).single();
    const currency = String(tbl?.currency || "BRL");

    const { data: items } = await supabase.from("plan_table_items")
      .select("period, credits_base, prices:plan_table_item_prices(screens_count, price_amount)")
      .eq("plan_table_id", planTableId);

    if (!items) return NextResponse.json({ ok: true, tiers: [], currency }, { headers: NO_STORE });

    let tiers: any[] = [];

    if (payment_type === "renewal") {
      tiers = PERIODS.map(p => {
        const item = (items as any[]).find(i => i.period === p.period);
        if (!item) return null;
        const priceRow = item.prices?.find((pr: any) => pr.screens_count === whatsappSessions)
          ?? item.prices?.find((pr: any) => pr.screens_count === 1);
        return { period: p.period, days: p.days, label: p.label, price: priceRow?.price_amount ?? null, credits: item.credits_base ?? 0 };
      }).filter(Boolean);
    } else {
      tiers = CREDIT_TIERS.map(tier => {
        const item = (items as any[]).find(i => i.period === tier);
        if (!item) return null;
        const priceRow = item.prices?.find((pr: any) => pr.screens_count === 1);
        return { period: tier, credits: CREDIT_LABELS[tier] ?? 0, price: priceRow?.price_amount ?? null };
      }).filter(Boolean);
    }

    return NextResponse.json({ ok: true, tiers, currency }, { headers: NO_STORE });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE });
  }
}