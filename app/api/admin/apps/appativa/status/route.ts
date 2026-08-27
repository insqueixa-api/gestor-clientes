// app/api/admin/apps/appativa/status/route.ts
//
// "Ver status" — consulta na hora o resultado de uma ativação Appativa
// disparada manualmente pelo admin (achado 27/08/2026, pedido do Márcio:
// "deixa um ver status no admin, no caso quando tem a ativação em
// andamento"). Reaproveita o historicoId salvo em client_apps.field_values.
// _appativa_pending_id por triggerAppativaActivationForClient — sem
// nenhuma tabela nova, sem nenhum log automático (mesmo espírito do resto
// do fluxo manual da Appativa, sem client_portal_payments envolvido).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { loadClientApp } from "@/lib/apps/orchestration";
import { findFieldByType } from "@/lib/apps/panel";
import { getAppativaApiKey } from "@/lib/integrations/appativa";
import { checkAppativaHistoricoOnce } from "@/lib/apps/appativa-client-activation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const clientAppId = String(body?.client_app_id || "").trim();
  if (!clientAppId) {
    return NextResponse.json({ ok: false, error: "client_app_id é obrigatório" }, { status: 400 });
  }

  const row = await loadClientApp(supabase, { clientAppId, tenantId });
  if (!row) return NextResponse.json({ ok: false, error: "Aplicativo não encontrado" }, { status: 404 });

  const historicoId = row.field_values?.["_appativa_pending_id"];
  if (!historicoId) {
    return NextResponse.json({ ok: true, pending: false });
  }

  const apiKey = await getAppativaApiKey(supabase, tenantId);
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Parceiro Appativa sem chave configurada (Configurações → Parceiros)." }, { status: 400 });
  }

  const check = await checkAppativaHistoricoOnce(apiKey, historicoId);

  if (check.outcome === "pending") {
    return NextResponse.json({ ok: true, pending: true });
  }

  const { _appativa_pending_id, ...restFieldValues } = row.field_values || {};

  if (check.outcome === "done") {
    const dateField = findFieldByType(row.fieldsConfig, "date");
    const updated = dateField
      ? { ...restFieldValues, [String(dateField.id || dateField.label)]: check.expireDate }
      : restFieldValues;
    await supabase.from("client_apps").update({ field_values: updated }).eq("id", clientAppId);
    return NextResponse.json({ ok: true, pending: false, expireDate: check.expireDate });
  }

  // outcome === "error"
  await supabase.from("client_apps").update({ field_values: restFieldValues }).eq("id", clientAppId);
  return NextResponse.json({ ok: true, pending: false, error: check.error });
}
