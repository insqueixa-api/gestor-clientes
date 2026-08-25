// app/api/client-portal/apps/retry-activation/route.ts
//
// Botão "Tentar novamente" (achado 25/08/2026) — quando a ativação
// automática via Appativa falha (ex: MAC errado, webhook confirmou erro em
// client_portal_payments.fulfillment_error), o cliente já corrige o campo
// pelo fluxo existente (POST /api/client-portal/apps/update-fields) e essa
// rota reenvia a ativação com o dado atualizado (POST /api/
// reenviar-ativacao da Appativa). A confirmação de verdade continua vindo
// pelo webhook (app/api/webhooks/appativa/route.ts), igual ao fluxo normal
// — aqui só reenfileira e limpa o erro anterior.
import { NextRequest, NextResponse } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { extractFieldByType } from "@/lib/apps/panel";
import { reenviarAtivacao, solicitarAtivacao, getAppativaApiKey, syncAppativaCredits } from "@/lib/integrations/appativa";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  const supabaseAdmin = makeSupabaseAdmin();
  if (!supabaseAdmin) return jsonError("Erro interno", 500);

  const body = await req.json().catch(() => ({} as any));
  const session_token = normalizeStr(body?.session_token);
  const client_id = normalizeStr(body?.client_id);
  const client_app_id = normalizeStr(body?.client_app_id);

  const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
  if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
  if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

  // ✅ Pega o pagamento de app_renewal mais recente pra este app, ainda
  // pendente e com erro registrado (webhook de falha, ou tentativa que
  // nunca chegou a solicitar por falta de MAC).
  const { data: payment } = await supabaseAdmin
    .from("client_portal_payments")
    .select("id, appativa_historico_id, fulfillment_error")
    .eq("tenant_id", ctx.tenant_id)
    .eq("client_id", client_id)
    .eq("client_app_id", client_app_id)
    .eq("payment_type", "app_renewal")
    .eq("status", "approved")
    .eq("fulfillment_status", "manual_pending")
    .not("fulfillment_error", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!payment) {
    return jsonError("Nenhuma ativação pendente com erro encontrada para este aplicativo.", 404);
  }

  const { data: appRow } = await supabaseAdmin
    .from("client_apps")
    .select("field_values, apps(appativa_app_id, fields_config)")
    .eq("id", client_app_id)
    .eq("client_id", client_id)
    .maybeSingle();

  if (!appRow) return jsonError("Aplicativo não encontrado", 404);

  const appMeta = Array.isArray(appRow.apps) ? appRow.apps[0] : appRow.apps;
  const appativaAppId = appMeta?.appativa_app_id ? String(appMeta.appativa_app_id) : "";
  if (!appativaAppId) {
    return jsonError("Este aplicativo não está vinculado à Appativa.", 400);
  }

  const fieldsConfig = Array.isArray(appMeta?.fields_config) ? appMeta.fields_config : [];
  const values = appRow.field_values || {};
  const macApp = extractFieldByType(fieldsConfig, values, "mac");
  const keyApp = extractFieldByType(fieldsConfig, values, "device_key");

  if (!macApp) {
    return jsonError("Preencha o Device ID (MAC) antes de tentar novamente.", 400);
  }

  const apiKey = await getAppativaApiKey(supabaseAdmin, ctx.tenant_id);
  if (!apiKey) return jsonError("Erro interno", 500);

  // ✅ Se por algum motivo nunca chegou a existir um historico_id (ex:
  // primeira tentativa falhou por falta de MAC, nunca chamou
  // solicitar-ativacao), reenviar-ativacao não serve — usa
  // solicitar-ativacao do zero. Senão, reenvia o existente com os dados
  // atuais.
  const result = payment.appativa_historico_id
    ? await reenviarAtivacao(apiKey, {
        historicoId: payment.appativa_historico_id,
        appativaAppId,
        macApp,
        keyApp: keyApp || undefined,
        obs: "Reenvio solicitado pelo cliente via portal (correção de dados)",
      })
    : await solicitarAtivacao(apiKey, { appativaAppId, macApp, keyApp: keyApp || undefined });

  // ⚠️ Narrowing via `"data" in result` — ver comentário em markAppRenewalPaid
  // (lib/client-portal/fulfillment.ts) sobre o bug de strict:false deste projeto.
  if (!("data" in result)) {
    return jsonError(`Falha ao reenviar a ativação: ${result.error}`, 502);
  }

  const newHistoricoId =
    "historico_id" in result.data ? result.data.historico_id : (result.data as any).id;

  const { error: updErr } = await supabaseAdmin
    .from("client_portal_payments")
    .update({ appativa_historico_id: newHistoricoId, fulfillment_error: null })
    .eq("id", payment.id)
    .eq("tenant_id", ctx.tenant_id);

  if (updErr) return jsonError("Erro interno", 500);

  // ✅ Reenvio pode gerar ajuste de crédito na hora (ver ReenviarAtivacaoResult
  // em lib/integrations/appativa.ts) — sincroniza o saldo mostrado na aba
  // Parceiros, mesmo achado de markAppRenewalPaid (26/08/2026). Fail-soft.
  try {
    await syncAppativaCredits(supabaseAdmin, ctx.tenant_id);
  } catch {
    // não bloqueia a resposta por falha no sync de créditos
  }

  return NextResponse.json(
    { ok: true, message: "Reenviado — aguardando confirmação da Appativa." },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
