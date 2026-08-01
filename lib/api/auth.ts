// lib/api/auth.ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
export function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401 });
}
export function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}
export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}
export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

// Valores de role já usados no projeto ao longo do tempo (histórico
// inconsistente: 'owner', 'ADMIN', 'admin' aparecem em lugares diferentes).
// Mantemos os três aceitos aqui pra não quebrar nada existente.
export const ADMIN_ROLES = ["owner", "admin", "ADMIN"] as const;

export function isAdminRole(role: unknown): boolean {
  return typeof role === "string" && (ADMIN_ROLES as readonly string[]).includes(role);
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

  // Busca sempre na tabela tenant_members — é dali que vem o role, e o
  // metadata do usuário (app_metadata.tenant_id) nunca chegou a ser
  // preenchido em produção, então essa é a única fonte real hoje.
  const { data: member, error: memberErr } = await supabase
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", user_id)
    .maybeSingle();

  const tenant_id = authUser.user.app_metadata?.tenant_id || member?.tenant_id;

  if (memberErr || !tenant_id) {
    return { ok: false as const, res: unauthorized("vínculo com tenant não encontrado") };
  }

  if (!isAdminRole(member?.role)) {
    return { ok: false as const, res: forbidden("usuário sem permissão de admin neste tenant") };
  }

  return { ok: true as const, supabase, tenant_id: String(tenant_id), user_id, role: member!.role as string };
}