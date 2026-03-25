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

// VERSÃO DEBUG — remover depois
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const payment_type = String(body?.payment_type || "renewal");

    const { data: member } = await supabase
      .from("tenant_members")
      .select("tenant_id, tenants(whatsapp_sessions)")
      .eq("user_id", user.id)
      .maybeSingle();

    const myTenantId = String(member?.tenant_id || "");

    const { data: network } = await supabase
      .from("saas_network")
      .select("parent_tenant_id")
      .eq("child_tenant_id", myTenantId)
      .maybeSingle();

    const parentTenantId = String(network?.parent_tenant_id || "");

    // ✅ Lê do FILHO (minha correção)
    const { data: myTenantRow } = await supabase
      .from("tenants")
      .select("saas_plan_table_id, credits_plan_table_id, name")
      .eq("id", myTenantId)
      .single();

    // ✅ Também lê do PAI para comparar
    const { data: parentTenantRow } = await supabase
      .from("tenants")
      .select("saas_plan_table_id, credits_plan_table_id, name")
      .eq("id", parentTenantId)
      .single();

    const planTableId = payment_type === "renewal"
      ? String(myTenantRow?.saas_plan_table_id || "")
      : String(myTenantRow?.credits_plan_table_id || "");

    // RETORNA DEBUG COMPLETO
    return NextResponse.json({
      ok: false,
      _debug: {
        user_id: user.id,
        my_tenant_id: myTenantId,
        my_tenant_name: myTenantRow?.name,
        my_saas_plan_table_id: myTenantRow?.saas_plan_table_id,
        my_credits_plan_table_id: myTenantRow?.credits_plan_table_id,
        parent_tenant_id: parentTenantId,
        parent_name: parentTenantRow?.name,
        parent_saas_plan_table_id: parentTenantRow?.saas_plan_table_id,
        parent_credits_plan_table_id: parentTenantRow?.credits_plan_table_id,
        payment_type,
        resolved_plan_table_id: planTableId,
      },
      error: "DEBUG MODE — veja _debug"
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}