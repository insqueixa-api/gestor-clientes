// app/api/admin/apps/configure/route.ts
// "Configurar/Reconfigurar" pelo admin (aba Aplicativos do modal de
// cliente) — mesma lógica de app/api/client-portal/apps/configure/route.ts
// (lib/apps/orchestration.ts), autenticado como admin via requireAdminTenant
// (Bearer = access_token da sessão do admin, resolve tenant_id via
// tenant_members) em vez de session_token do portal. Sem a trava de
// tentativas (rate-limit) do portal — o admin não tem esse limite hoje.
//
// Aceita dois formatos de corpo: `client_app_id` (app já salvo) OU
// `app_id` + `client_id` + `field_values` (app ainda só existe no state do
// React, antes de "Salvar" o cliente — fluxo real do admin: adiciona o app
// e configura na hora, só reflete em client_apps no próximo Salvar). Ver
// loadClientAppDraft em lib/apps/orchestration.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { logAppActivity } from "@/lib/apps/panel";
import { loadClientApp, loadClientAppDraft, configureClientApp } from "@/lib/apps/orchestration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const clientAppId = String(body?.client_app_id || "").trim();
  const appId = String(body?.app_id || "").trim();
  const draftClientId = String(body?.client_id || "").trim();
  // undefined (não {}) quando ausente — senão um caller que não manda
  // field_values (ex: AppRequestModal) apagaria o field_values real salvo
  // no banco em vez de simplesmente usá-lo.
  const fieldValues: Record<string, string> | undefined =
    body?.field_values && typeof body.field_values === "object" ? body.field_values : undefined;
  const m3uUrlOverride = typeof body?.m3u_url === "string" ? body.m3u_url : undefined;
  const mode = body?.mode === "secundaria" ? "secundaria" : "principal";

  const row = clientAppId
    ? await loadClientApp(supabase, { clientAppId, tenantId, fieldValuesOverride: fieldValues })
    : appId && draftClientId
      ? await loadClientAppDraft(supabase, { appId, clientId: draftClientId, tenantId, fieldValues: fieldValues || {} })
      : null;

  if (!clientAppId && !(appId && draftClientId)) {
    return NextResponse.json({ ok: false, error: "client_app_id, ou app_id + client_id, é obrigatório" }, { status: 400 });
  }
  if (!row) return NextResponse.json({ ok: false, error: "Aplicativo não encontrado" }, { status: 404 });

  const result = await configureClientApp(supabase, row, mode, m3uUrlOverride);

  // ✅ Comparação explícita (=== false), não `!result.ok` — o projeto roda
  // com strict:false no tsconfig, e sem strictNullChecks o TS não discrimina
  // a union corretamente a partir de negação de boolean.
  if (result.ok === false) {
    await logAppActivity(supabase, {
      tenantId,
      clientId: row.client_id,
      clientAppId: clientAppId || null,
      appName: row.appName,
      event: "configure_failed",
      detail: { error: result.error },
    });
    const status = result.stage === "precondition" ? result.status : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  await logAppActivity(supabase, {
    tenantId,
    clientId: row.client_id,
    clientAppId: clientAppId || null,
    appName: row.appName,
    event: "configured",
    detail: result.expireDate ? { expireDate: result.expireDate } : null,
  });

  return NextResponse.json({ ok: true, expireDate: result.expireDate, message: result.message || "Configurado com sucesso." });
}
