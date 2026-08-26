// app/api/admin/apps/gpc-roku/mark-paid/route.ts
//
// "Marcar como pago (10 anos)" — botão manual na tela do cliente pra quando
// alguém paga o GPC Roku por fora do Portal (achado 26/08/2026, pedido do
// Márcio — ver docs/sql/gpc_roku_activations.sql). Mesmo núcleo
// (renewGpcRokuTenYears, lib/apps/gpc-roku-registry.ts) usado quando o
// cliente paga pelo Portal (lib/client-portal/fulfillment.ts) — só que aqui
// não existe pagamento nenhum pra marcar como concluído, é 100% manual.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant, getBearerToken } from "@/lib/api/auth";
import { loadClientApp } from "@/lib/apps/orchestration";
import { extractFieldByType } from "@/lib/apps/panel";
import { renewGpcRokuTenYears } from "@/lib/apps/gpc-roku-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  if (row.appName !== "GPC Roku") {
    return NextResponse.json({ ok: false, error: "Essa ação só está disponível pro GPC Roku." }, { status: 400 });
  }

  const macValue = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  if (!macValue) {
    return NextResponse.json({ ok: false, error: "Preencha o Device ID (MAC) antes de marcar como pago." }, { status: 400 });
  }

  // ✅ "Quem fez" — mesmo token já validado por requireAdminTenant, só busca
  // o e-mail pra gravar no registro (auth.getUser não é exposto por lá).
  const token = getBearerToken(req);
  const { data: authUser } = token ? await supabase.auth.getUser(token) : { data: null as any };
  const activatedBy = authUser?.user?.email || undefined;

  const result = await renewGpcRokuTenYears(supabase, {
    tenantId,
    clientId: row.client_id,
    clientAppId: row.id,
    macValue,
    fieldsConfig: row.fieldsConfig,
    fieldValues: row.field_values,
    activatedBy,
  });

  // ⚠️ Narrowing via `"error" in result`, de propósito — com `strict: false`
  // neste projeto, o TS não estreita bem uniões discriminadas por negação
  // de boolean (mesmo padrão documentado em lib/client-portal/fulfillment.ts).
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, expireDate: result.expireDate });
}
