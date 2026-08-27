// app/api/admin/apps/appativa/activate/route.ts
//
// "Ativar via Appativa" — botão manual na tela do cliente pra disparar a
// mesma ativação que o Portal já faz automaticamente ao pagar (achado
// 26/08/2026, pedido do Márcio: "ali eu também deveria chamar essa
// integração pra confirmar essa ativação dos aplicativos"). Mesmo espírito
// do "Marcar pago" do GPC Roku (app/api/admin/apps/gpc-roku/mark-paid), mas
// pra qualquer app mapeado na Appativa (apps.appativa_app_id) — não só um
// app específico.
//
// ⚠️ Sem client_portal_payments aqui — a confirmação roda em segundo plano
// (ver lib/apps/appativa-client-activation.ts) e persiste direto em
// client_apps.field_values.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { loadClientApp } from "@/lib/apps/orchestration";
import { extractFieldByType } from "@/lib/apps/panel";
import { triggerAppativaActivationForClient } from "@/lib/apps/appativa-client-activation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

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
  if (!row.appativaAppId) {
    return NextResponse.json({ ok: false, error: "Esse aplicativo não está mapeado na Appativa." }, { status: 400 });
  }

  const macApp = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  if (!macApp) {
    return NextResponse.json({ ok: false, error: "Preencha o Device ID (MAC) antes de ativar." }, { status: 400 });
  }
  const keyApp = extractFieldByType(row.fieldsConfig, row.field_values, "device_key");

  const result = await triggerAppativaActivationForClient(supabase, {
    tenantId,
    clientAppId: row.id,
    appativaAppId: row.appativaAppId,
    macApp,
    keyApp,
    fieldsConfig: row.fieldsConfig,
    fieldValues: row.field_values,
  });

  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    message: "Ativação solicitada! Confirmando automaticamente nos próximos ~1 min — atualize a página daqui a pouco pra ver o vencimento novo.",
  });
}
