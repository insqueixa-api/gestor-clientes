// app/api/admin/apps/retry-appativa-activation/route.ts
//
// Botão "Reenviar via Appativa" no modal "Concluir renovação" da Auditoria
// (achado 25/08/2026, pedido do Márcio: quando a ativação automática falha
// — ex: MAC errado — o admin quer poder reenviar direto dali em vez de
// depender do cliente corrigir pelo portal, já que a confirmação é
// assíncrona de qualquer jeito). Mesma lógica de app/api/client-portal/
// apps/retry-activation/route.ts, só que autenticado como admin
// (requireAdminTenant) em vez de sessão de portal do cliente.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { reenviarAtivacao, solicitarAtivacao, getAppativaApiKey, syncAppativaCredits, extractAppativaCreds, appativaIdentifierLabel } from "@/lib/integrations/appativa";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: supabaseAdmin, tenant_id: authTenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const tenantId = String(body?.tenant_id || "").trim();
  const paymentId = String(body?.payment_id || "").trim();

  if (!tenantId || !paymentId) {
    return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400 });
  }
  if (tenantId !== authTenantId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { data: payment } = await supabaseAdmin
    .from("client_portal_payments")
    .select("id, client_id, client_app_id, app_name_snapshot, appativa_historico_id, fulfillment_status, payment_type")
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) return NextResponse.json({ ok: false, error: "Pagamento não encontrado" }, { status: 404 });
  if (payment.payment_type !== "app_renewal") {
    return NextResponse.json({ ok: false, error: "Este pagamento não é uma renovação de aplicativo." }, { status: 400 });
  }
  if (payment.fulfillment_status === "manual_done") {
    return NextResponse.json({ ok: false, error: "Esta renovação já foi concluída." }, { status: 400 });
  }

  // ✅ 17/09/2026, achado do Márcio: client_app_id pode estar null no
  // pagamento (ex: app foi removido/reconfigurado depois do pagamento,
  // ganhando uma linha nova em client_apps) — mesmo "salva-vidas" já usado
  // em components/apps/AppRequestModal.tsx (handleConcluirAcao): busca de
  // novo pelo nome salvo no pagamento (app_name_snapshot) em vez de travar
  // com um erro genérico. Sem isso, um reenvio de correção (o cliente já
  // pagou, só os dados foram digitados errado) ficava impossível de
  // completar por aqui.
  let effectiveClientAppId = payment.client_app_id as string | null;
  if (!effectiveClientAppId) {
    if (!payment.app_name_snapshot) {
      return NextResponse.json(
        { ok: false, error: "Esse pagamento não tem mais um aplicativo vinculado (foi removido/reconfigurado) e não há nome salvo pra buscar de novo. Abra o cliente e confira manualmente." },
        { status: 400 },
      );
    }
    const { data: matches } = await supabaseAdmin
      .from("client_apps")
      .select("id, apps!inner(name)")
      .eq("tenant_id", tenantId)
      .eq("client_id", payment.client_id)
      .eq("apps.name", payment.app_name_snapshot);
    if (!matches || matches.length !== 1) {
      return NextResponse.json(
        {
          ok: false,
          error:
            !matches || matches.length === 0
              ? `"${payment.app_name_snapshot}" não está mais na conta desse cliente (foi excluído). Abra o cliente pra conferir o que aconteceu.`
              : `Encontrei mais de um "${payment.app_name_snapshot}" nesse cliente — abra o cliente e reenvie direto pelo card do aplicativo certo.`,
        },
        { status: 400 },
      );
    }
    effectiveClientAppId = matches[0].id;
  }

  const { data: appRow } = await supabaseAdmin
    .from("client_apps")
    .select("field_values, apps(appativa_app_id, fields_config)")
    .eq("id", effectiveClientAppId)
    .eq("client_id", payment.client_id)
    .maybeSingle();

  if (!appRow) return NextResponse.json({ ok: false, error: "Aplicativo não encontrado" }, { status: 404 });

  const appMeta = Array.isArray(appRow.apps) ? appRow.apps[0] : appRow.apps;
  const appativaAppId = appMeta?.appativa_app_id ? String(appMeta.appativa_app_id) : "";
  if (!appativaAppId) {
    return NextResponse.json({ ok: false, error: "Este aplicativo não está vinculado à Appativa." }, { status: 400 });
  }

  const fieldsConfig = Array.isArray(appMeta?.fields_config) ? appMeta.fields_config : [];
  const values = appRow.field_values || {};
  const { macApp, keyApp } = extractAppativaCreds(fieldsConfig, values);

  if (!macApp) {
    return NextResponse.json({ ok: false, error: `Preencha o ${appativaIdentifierLabel(fieldsConfig)} antes de reenviar.` }, { status: 400 });
  }

  const apiKey = await getAppativaApiKey(supabaseAdmin, tenantId);
  if (!apiKey) return NextResponse.json({ ok: false, error: "Chave da Appativa não cadastrada." }, { status: 500 });

  const result = payment.appativa_historico_id
    ? await reenviarAtivacao(apiKey, {
        historicoId: payment.appativa_historico_id,
        appativaAppId,
        macApp,
        keyApp: keyApp || undefined,
        obs: "Reenvio solicitado pelo admin via Auditoria (correção de dados)",
      })
    : await solicitarAtivacao(apiKey, { appativaAppId, macApp, keyApp: keyApp || undefined });

  // ⚠️ Narrowing via `"data" in result` — mesmo bug de strict:false já
  // documentado (couponRejectReason, markAppRenewalPaid, webhook, e a rota
  // gêmea client-portal/apps/retry-activation).
  if (!("data" in result)) {
    return NextResponse.json({ ok: false, error: `Falha ao reenviar a ativação: ${result.error}` }, { status: 502 });
  }

  const newHistoricoId =
    "historico_id" in result.data ? result.data.historico_id : (result.data as any).id;

  const { error: updErr } = await supabaseAdmin
    .from("client_portal_payments")
    .update({ appativa_historico_id: newHistoricoId, fulfillment_error: null })
    .eq("id", payment.id)
    .eq("tenant_id", tenantId);

  if (updErr) return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });

  // ✅ Reenvio pode gerar ajuste de crédito na hora (ver ReenviarAtivacaoResult
  // em lib/integrations/appativa.ts) — sincroniza o saldo mostrado na aba
  // Parceiros, mesmo achado de markAppRenewalPaid (26/08/2026). Fail-soft.
  try {
    await syncAppativaCredits(supabaseAdmin, tenantId);
  } catch {
    // não bloqueia a resposta por falha no sync de créditos
  }

  return NextResponse.json({ ok: true, message: "Reenviado — aguardando confirmação da Appativa." });
}
