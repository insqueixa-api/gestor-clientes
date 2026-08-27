// app/api/admin/apps/duplecast/activate/route.ts
//
// "Renovar via código" — botão manual na tela do cliente pra disparar a
// mesma renovação que o Portal já faz automaticamente ao pagar (achado
// 26/08/2026, pedido do Márcio — mesmo espírito do "Marcar pago" do GPC
// Roku e do "Ativar via Appativa"). Consome 1 código real da conta de
// revenda — use só quando o cliente já pagou (por fora do Portal) ou pra
// forçar uma renovação manual de verdade.
//
// Síncrono (diferente da Appativa): renewDuplecastWithCode já confirma o
// vencimento real dentro da própria chamada, sem precisar de polling em
// segundo plano.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { loadClientApp } from "@/lib/apps/orchestration";
import { extractFieldByType } from "@/lib/apps/panel";
import { renewDuplecastWithCode } from "@/lib/apps/duplecast-renewal";

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
  if (row.appName !== "DupleCast") {
    return NextResponse.json({ ok: false, error: "Essa ação só está disponível pro Duplecast." }, { status: 400 });
  }

  const macValue = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  if (!macValue) {
    return NextResponse.json({ ok: false, error: "Preencha o Device ID (MAC) antes de renovar." }, { status: 400 });
  }
  const deviceKey = extractFieldByType(row.fieldsConfig, row.field_values, "device_key");
  if (!deviceKey) {
    return NextResponse.json({ ok: false, error: "Preencha a Device Key antes de renovar." }, { status: 400 });
  }

  const result = await renewDuplecastWithCode(supabase, {
    tenantId,
    clientAppId: row.id,
    macValue,
    deviceKey,
    fieldsConfig: row.fieldsConfig,
    fieldValues: row.field_values,
  });

  // ⚠️ Narrowing via `"error" in result`, mesmo motivo documentado em
  // lib/client-portal/fulfillment.ts (strict:false não estreita bem uniões
  // discriminadas por negação de boolean).
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, expireDate: result.expireDate, code: result.code });
}
