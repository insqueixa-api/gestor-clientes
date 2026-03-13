import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: role } = await supabase.rpc("saas_my_role");
  if (!["superadmin", "master"].includes((role ?? "").toLowerCase()))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { tenant_id, new_email } = await req.json();
  if (!tenant_id || !new_email)
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  // Busca o user_id do tenant
  const { data: member } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenant_id)
    .single();

  if (!member?.user_id)
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });

  // Atualiza no auth.users via service_role
  const { error } = await adminSupabase.auth.admin.updateUserById(member.user_id, {
    email: new_email,
    email_confirm: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Atualiza também em profiles
  await adminSupabase.from("profiles").update({ email: new_email }).eq("id", member.user_id);

  return NextResponse.json({ ok: true });
}