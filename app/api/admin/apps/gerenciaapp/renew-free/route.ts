// app/api/admin/apps/gerenciaapp/renew-free/route.ts
//
// "Renovar Gratuitamente" — equivalente admin do botão que já existe no
// Portal (app/api/client-portal/apps/renew-gerenciaapp/route.ts) pra
// família GerenciaApp GRÁTIS (IBO Revenda, Zone X, VU Revenda, Facilita,
// Uni Revenda, GPC Android/LG/Pro). Pedido do Márcio, 01/09/2026: "tenho
// clientes com IBO Revenda vencendo, é grátis, quero um botão aqui igual
// o Marcar Pago do GPC Roku, mas sem cobrar nada — só estende 1 ano".
// Mesmo núcleo (ação "renew" sem expire_date explícito, +1 ano a partir
// do vencimento atual/hoje) usado pelo Portal — aqui só troca a validação
// de sessão do cliente por admin autenticado.
//
// ⚠️ GPC Roku é da MESMA família GerenciaApp mas é PAGO (cost_type=
// "paid") — usa "Marcar pago" (10 anos, gpc-roku-registry.ts), NUNCA
// esta rota. Guard explícito abaixo, mesma defesa em profundidade que a
// rota do Portal já tem.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { loadClientApp } from "@/lib/apps/orchestration";
import { getIntegrationHandler } from "@/lib/integrations";
import { extractFieldByType, findFieldByType, internalAppUrl, logAppActivity } from "@/lib/apps/panel";

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

  const handler = row.integrationType ? getIntegrationHandler(row.integrationType) : null;
  if (!handler || (handler as any).actionPrefix !== "GERENCIAAPP") {
    return NextResponse.json(
      { ok: false, error: "Essa renovação gratuita só está disponível pra família GerenciaApp." },
      { status: 400 },
    );
  }
  // ✅ Defesa em profundidade — o GPC Roku é GERENCIAAPP mas é PAGO.
  if (row.costType === "paid") {
    return NextResponse.json(
      { ok: false, error: "Esse aplicativo é pago — use o botão \"Marcar pago\" (ou o pagamento normal)." },
      { status: 400 },
    );
  }

  const macValue = extractFieldByType(row.fieldsConfig, row.field_values, "mac");
  if (!macValue) {
    return NextResponse.json({ ok: false, error: "Preencha o Device ID (MAC) antes de renovar." }, { status: 400 });
  }

  const { data: integ } = await supabase
    .from("app_integrations")
    .select("api_url")
    .eq("app_name", row.integrationType)
    .maybeSingle();

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "");
  let apiJson: any;
  try {
    const apiRes = await fetch(internalAppUrl((handler as any).apiEndpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ action: "renew", base_url: integ?.api_url || "", macValue }),
    });
    apiJson = await apiRes.json().catch(() => ({} as any));
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao conectar com o parceiro." }, { status: 502 });
  }

  if (!apiJson?.ok) {
    await logAppActivity(supabase, {
      tenantId,
      clientId: row.client_id,
      clientAppId,
      appName: row.appName,
      event: "configure_failed",
      detail: { error: apiJson?.error || "Falha ao renovar no painel do parceiro.", renew: true, source: "admin" },
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: apiJson?.error || "Houve uma falha ao renovar a licença." },
      { status: 502 },
    );
  }

  const expireDate = apiJson.expireDate || null;
  const dateField = findFieldByType(row.fieldsConfig, "date");
  if (expireDate && dateField) {
    const fieldKey = String(dateField.id || dateField.label);
    await supabase
      .from("client_apps")
      .update({ field_values: { ...row.field_values, [fieldKey]: expireDate } })
      .eq("id", clientAppId);
  }

  await logAppActivity(supabase, {
    tenantId,
    clientId: row.client_id,
    clientAppId,
    appName: row.appName,
    event: "configured",
    detail: { expireDate, renew: true, source: "admin" },
  }).catch(() => {});

  return NextResponse.json({ ok: true, expireDate, message: apiJson.message || "Licença renovada com sucesso." });
}
