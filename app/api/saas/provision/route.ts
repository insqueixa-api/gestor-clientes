import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

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

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: roleData, error: roleErr } = await supabase.rpc("saas_my_role");
  if (roleErr || !["superadmin", "master"].includes((roleData ?? "").toLowerCase())) {
    return NextResponse.json(
      { error: "forbidden", hint: "Apenas SUPERADMIN ou MASTER podem criar revendas." },
      { status: 403 }
    );
  }

  const body = await req.json();
  const {
    name,
    email,
    password,
    role,
    trial_days,
    credits_initial,
    responsible_name,
    phone_e164,
    whatsapp_username,
    notes,
    saas_plan_table_id,
    credits_plan_table_id,
  } = body;

  if (!name || !email || !password || !role) {
    return NextResponse.json(
      { error: "missing_fields", hint: "name, email, password e role são obrigatórios." },
      { status: 400 }
    );
  }
  if (!["MASTER", "USER"].includes(role)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "weak_password", hint: "Senha deve ter pelo menos 8 caracteres." },
      { status: 400 }
    );
  }

  const slug = slugify(name);

  // 1. Cria auth user
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

  // 2. Provisiona estrutura SaaS com dados de perfil
  const { data: newTenantId, error: rpcErr } = await supabase.rpc(
    "saas_provision_tenant_records",
    {
      p_user_id:           newUserId,
      p_tenant_name:       name,
      p_tenant_slug:       slug,
      p_role:              role,
      p_trial_days:        trial_days ?? 7,
      p_credits_initial:   credits_initial ?? 0,
      p_responsible_name:  responsible_name || name,
      p_email:             email,
      p_phone_e164:        phone_e164 || null,
      p_whatsapp_username: whatsapp_username || null,
      p_notes:             notes || null,
    }
  );

  if (rpcErr) {
    await adminSupabase.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { error: "provision_failed", hint: rpcErr.message },
      { status: 500 }
    );
  }

  // Salva tabelas de plano SaaS no tenant recém-criado
  if (newTenantId && (saas_plan_table_id || credits_plan_table_id)) {
    const planPatch: Record<string, string | null> = {};
    if (saas_plan_table_id) planPatch.saas_plan_table_id = saas_plan_table_id;
    if (role === "MASTER" && credits_plan_table_id) {
      planPatch.credits_plan_table_id = credits_plan_table_id;
    }
    await adminSupabase
      .from("tenants")
      .update(planPatch)
      .eq("id", newTenantId);
    // Falha silenciosa — não bloqueia a criação, pode corrigir depois no edit
  }

  return NextResponse.json({ ok: true, tenant_id: newTenantId, user_id: newUserId });
}
