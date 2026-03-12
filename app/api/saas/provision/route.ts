import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Cliente com service_role para criar auth users
const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export async function POST(req: Request) {
  const supabase = await createClient();

  // Valida sessão do chamador
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Valida que o chamador é SUPERADMIN ou MASTER via RPC
  const { data: roleData, error: roleErr } = await supabase.rpc("saas_my_role");
  if (roleErr || !["SUPERADMIN", "MASTER"].includes(roleData)) {
    return NextResponse.json({ error: "forbidden", hint: "Apenas SUPERADMIN ou MASTER podem criar tenants." }, { status: 403 });
  }

  const body = await req.json();
  const { name, email, password, role, trial_days, credits_initial } = body;

  // Validações básicas
  if (!name || !email || !password || !role) {
    return NextResponse.json({ error: "missing_fields", hint: "name, email, password e role são obrigatórios." }, { status: 400 });
  }
  if (!["MASTER", "USER"].includes(role)) {
    return NextResponse.json({ error: "invalid_role", hint: "Role deve ser MASTER ou USER." }, { status: 400 });
  }
  if (role === "MASTER" && roleData === "USER") {
    return NextResponse.json({ error: "forbidden_role" }, { status: 403 });
  }

  const slug = slugify(name);

  // 1. Cria o auth user via service_role
  const { data: newUser, error: userErr } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userErr || !newUser?.user) {
    return NextResponse.json(
      { error: "user_creation_failed", hint: userErr?.message || "Falha ao criar usuário." },
      { status: 500 }
    );
  }

  const newUserId = newUser.user.id;

  // 2. Chama RPC para criar todas as estruturas SaaS
  const { data: newTenantId, error: rpcErr } = await supabase.rpc("saas_provision_tenant_records", {
    p_user_id: newUserId,
    p_tenant_name: name,
    p_tenant_slug: slug,
    p_role: role,
    p_trial_days: trial_days ?? 7,
    p_credits_initial: credits_initial ?? 0,
  });

  if (rpcErr) {
    // Rollback: remove o auth user criado
    await adminSupabase.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { error: "provision_failed", hint: rpcErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, tenant_id: newTenantId, user_id: newUserId });
}
