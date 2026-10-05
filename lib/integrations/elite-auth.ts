// lib/integrations/elite-auth.ts
// Quem está chamando as rotas do Elite: chamada interna (fulfillment do
// portal, tenant vem no body) ou admin logado (tenant SEMPRE do
// tenant_members — nunca confia no tenant_id do body vindo do navegador).
import { isInternalRequest } from "@/lib/internal-auth";
import { adminSupabase } from "@/lib/api/auth";

export async function resolveEliteCaller(
  req: Request,
  body: any,
): Promise<{ tenantId: string; internal: boolean } | null> {
  const integrationId = String(body?.integration_id ?? "").trim();

  if (isInternalRequest(req)) {
    let tenantId = String(body?.tenant_id ?? "").trim() || null;
    if (!tenantId && integrationId) {
      const { data } = await adminSupabase()
        .from("server_integrations")
        .select("tenant_id")
        .eq("id", integrationId)
        .maybeSingle();
      tenantId = data?.tenant_id ?? null;
    }
    return tenantId ? { tenantId, internal: true } : null;
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabaseAuth = await createClient();
  const { data: auth, error: authErr } = await supabaseAuth.auth.getUser();
  if (authErr || !auth?.user?.id) return null;
  const { data: tm } = await supabaseAuth
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .single();
  return tm?.tenant_id ? { tenantId: tm.tenant_id, internal: false } : null;
}
