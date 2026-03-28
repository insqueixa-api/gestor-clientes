import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

    const { data: { user } } = await adminSupabase.auth.getUser(token);
    if (!user) return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { child_tenant_id, saas_plan_table_id, credits_plan_table_id, auto_whatsapp_session } = body;

    if (!child_tenant_id) return NextResponse.json({ ok: false, error: "ID do filho ausente" }, { status: 400 });

    const patch: Record<string, string | null> = {
      saas_plan_table_id: saas_plan_table_id || null,
      credits_plan_table_id: credits_plan_table_id || null,
    };
    if (auto_whatsapp_session) patch.auto_whatsapp_session = auto_whatsapp_session;

    const { error } = await adminSupabase
      .from("tenants")
      .update(patch)
      .eq("id", child_tenant_id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}