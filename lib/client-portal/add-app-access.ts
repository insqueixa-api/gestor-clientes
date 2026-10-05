// lib/client-portal/add-app-access.ts
// ✅ 04/10/2026, pedido do Márcio: quem vê o "Adicionar aplicativo" no portal.
//   tenants.portal_add_app_enabled = true  → todo cliente
//   false → só os WhatsApp de teste (tenants.portal_app_testers)
// Tester também não tem o limite de apps por conta (precisa testar à vontade).
// Liga/desliga na página Aplicativos do admin (chave "Portal").
import type { SupabaseClient } from "@supabase/supabase-js";

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function getPortalAddAppAccess(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  whatsappUsername: string | null | undefined,
): Promise<{ canAdd: boolean; isTester: boolean }> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("portal_add_app_enabled, portal_app_testers")
    .eq("id", tenantId)
    .maybeSingle();
  const wa = digits(whatsappUsername);
  const testers: string[] = Array.isArray(data?.portal_app_testers) ? data!.portal_app_testers : [];
  const isTester = !!wa && testers.some((t) => digits(t) === wa);
  return { canAdd: !!data?.portal_add_app_enabled || isTester, isTester };
}
