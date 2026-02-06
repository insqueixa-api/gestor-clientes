// lib/api/auth.ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
export function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401 });
}
export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}
export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

export async function requireAdminTenant(req: Request) {
  const supabase = adminSupabase();
  const token = getBearerToken(req);

  if (!token) return { ok: false as const, res: unauthorized("token bearer ausente") };

  const { data: authUser, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authUser?.user?.id) return { ok: false as const, res: unauthorized("sessão inválida") };

  const user_id = authUser.user.id;

  // 1. Tenta via Metadata
  let tenant_id = authUser.user.app_metadata?.tenant_id;
  let role = authUser.user.app_metadata?.role;

  // 2. Se não tiver, busca na tabela tenant_members
  if (!tenant_id) {
    const { data: member, error: memberErr } = await supabase
      .from("tenant_members") // <--- Tabela nova
      .select("tenant_id, role")
      .eq("user_id", user_id) // <--- Coluna nova
      .maybeSingle();

    if (memberErr || !member?.tenant_id) {
      return { ok: false as const, res: unauthorized("vínculo com tenant não encontrado") };
    }
    tenant_id = member.tenant_id;
    role = member.role; // Pega a role do banco se necessário
  }

  // Validação de Role (opcional - descomente se seu sistema exigir ADMIN)
  /*
  if (String(role || "").toUpperCase() !== "ADMIN") {
    return { ok: false as const, res: unauthorized("apenas ADMIN") };
  }
  */

  return { ok: true as const, supabase, tenant_id: String(tenant_id), user_id };
}