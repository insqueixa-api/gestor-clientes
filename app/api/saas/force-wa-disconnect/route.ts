import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ✅ Caça o ID do dono daquela revenda
async function resolveTenantSenderUserId(sb: any, tenantId: string): Promise<string | null> {
  try {
    const { data: owner } = await sb
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .maybeSingle();
    if (owner?.user_id) return String(owner.user_id);
  } catch {}

  try {
    const { data } = await sb.from("tenant_members").select("user_id").eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(1);
    if (data && data[0]) return String(data[0].user_id);
  } catch {}
  return null;
}

export async function POST(req: Request) {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const baseUrl = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();

  if (!baseUrl || !waToken || !supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { target_tenant_id, session_number } = body;

    if (!target_tenant_id) return NextResponse.json({ error: "Faltando target_tenant_id" }, { status: 400 });

    const ownerId = await resolveTenantSenderUserId(sb, target_tenant_id);
    if (!ownerId) return NextResponse.json({ error: "Dono não encontrado" }, { status: 404 });

    // ✅ Monta a assinatura criptografada idêntica à que a VM espera
    const suffix = session_number === 2 ? ":2" : "";
    const sessionKey = crypto.createHash("sha256").update(`${target_tenant_id}:${ownerId}${suffix}`).digest("hex");

    // ✅ Manda a ordem letal para a VM matar a sessão
    const res = await fetch(`${baseUrl}/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${waToken}`,
        "x-session-key": sessionKey
      }
    });

    return NextResponse.json({ ok: true, vm_status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}