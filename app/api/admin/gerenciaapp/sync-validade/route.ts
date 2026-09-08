// app/api/admin/gerenciaapp/sync-validade/route.ts
//
// Botão "Sincronizar validade" do card GerenciaApp (Configurações →
// Integrações → Parceiros) — loga no painel deles e lê a validade real da
// conta master (expire_account), gravando em app_integrations.extra_config
// pra exibir no card sem precisar abrir o painel deles manualmente.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { fetchGerenciaAppAccountStatus } from "@/lib/integrations/gerenciaapp-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;

  const { data: integ, error: integErr } = await supabase
    .from("app_integrations")
    .select("id, api_url, login_email, login_password")
    .eq("tenant_id", tenantId)
    .eq("app_name", "GERENCIAAPP")
    .maybeSingle();

  if (integErr || !integ?.api_url || !integ?.login_email || !integ?.login_password) {
    return NextResponse.json({ ok: false, error: "Integração GerenciaApp não configurada." }, { status: 400 });
  }

  try {
    const status = await fetchGerenciaAppAccountStatus(
      String(integ.api_url).replace(/\/$/, ""),
      integ.login_email,
      integ.login_password,
    );

    const { error: updErr } = await supabase
      .from("app_integrations")
      .update({
        extra_config: { expire_account: status.expire_account, last_sync_at: new Date().toISOString() },
      })
      .eq("id", integ.id);
    if (updErr) throw updErr;

    return NextResponse.json({ ok: true, expire_account: status.expire_account });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao sincronizar validade." }, { status: 502 });
  }
}
