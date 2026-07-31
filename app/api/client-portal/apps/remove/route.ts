// app/api/client-portal/apps/remove/route.ts
// "Excluir Aplicativo" do Bloco 3 — caminhos possíveis (pedido do Marcio,
// 25/07/2026, revisado 26/07/2026):
//   - App com integração automática (has_integration/handler.useApi): tenta
//     apagar do painel do parceiro e, se der certo, apaga a linha
//     client_apps na sequência — tudo automático.
//   - App sem integração MAS ainda ativo no catálogo (útil só como
//     registro/lembrete): não tem como desconfigurar sozinho, então cria um
//     PEDIDO DE REMOÇÃO em client_app_requests (action='removal') +
//     notifica o admin. A linha client_apps só é apagada de verdade quando
//     o admin "Conclui" o pedido na Auditoria (aba Aplicativos) — até lá o
//     app continua aparecendo pro cliente, marcado como "exclusão
//     solicitada". O admin (app/api/admin/apps/remove) nunca cai nesse
//     ramo — ele é quem resolveria o pedido, então sempre apaga direto.
//   - App DESCONTINUADO (apps.is_active=false, ex: DuplexPlay): sempre apaga
//     na hora, mesmo sem integração — esperar o admin "concluir" um pedido
//     não faz sentido nenhum quando não existe mais painel de parceiro vivo
//     pra desconfigurar.
//
// A parte "desconfigura no painel do parceiro" mora em
// lib/apps/orchestration.ts (removeClientAppFromPartner) — mesma função
// usada por app/api/admin/apps/remove/route.ts. A política de pedido
// pendente/notificação abaixo é exclusiva do portal.
import { NextRequest, NextResponse, after } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { logAppActivity } from "@/lib/apps/panel";
import { loadClientApp, removeClientAppFromPartner } from "@/lib/apps/orchestration";
import { notify, formatClientLabel } from "@/lib/notifications/notify";

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
  let tenantId = "";
  let client_id = "";
  let client_app_id = "";
  let appName = "Aplicativo";
  let supabaseAdmin: ReturnType<typeof makeSupabaseAdmin> = null;

  try {
    supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    client_id = normalizeStr(body?.client_id);
    client_app_id = normalizeStr(body?.client_app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    tenantId = ctx.tenant_id;
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const row = await loadClientApp(supabaseAdmin, { clientAppId: client_app_id, tenantId, clientId: client_id });
    if (!row) return jsonError("Aplicativo não encontrado", 404);
    appName = row.appName;

    const partnerResult = await removeClientAppFromPartner(supabaseAdmin, row);

    // ✅ Sem integração de verdade, ainda ativo no catálogo E pago — vira
    // pedido pro admin, não apaga nada agora. Idempotente: se já existe
    // pedido pendente pra esse app, só confirma (não duplica notificação).
    // Comparação explícita (=== false) — ver nota em .../configure/route.ts.
    // Parceria/gratuito sem integração (pedido do Márcio, 31/07/2026): não
    // existe painel de parceiro nenhum pro admin desconfigurar (o cliente
    // configura tudo sozinho no app dele) — então não faz sentido virar
    // pendência; cai direto no delete abaixo, igual app descontinuado.
    if (partnerResult.attempted === false && row.isActive && row.costType === "paid") {
      const { data: existing } = await supabaseAdmin
        .from("client_app_requests")
        .select("id")
        .eq("client_app_id", client_app_id)
        .eq("action", "removal")
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ ok: true, data: { pending_admin: true, already_requested: true } }, { status: 200, headers: NO_STORE_HEADERS });
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("client_app_requests")
        .insert({
          tenant_id: tenantId,
          client_id,
          client_app_id,
          app_name: appName,
          fields_snapshot: row.field_values,
          action: "removal",
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr || !inserted) return jsonError("Erro interno", 500);

      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("display_name, server_username, servers(name)")
        .eq("id", client_id)
        .maybeSingle();

      await notify({
        tenantId,
        type: "app_removal_pending",
        title: "🗑️ Exclusão de app solicitada",
        message: `${formatClientLabel(client?.display_name, client?.server_username, (client?.servers as any)?.name)} pediu pra remover "${appName}" do portal.`,
        link: "/admin/auditoria?view=aplicativos",
        sourceId: inserted.id,
      });

      return NextResponse.json({ ok: true, data: { pending_admin: false, already_requested: false } }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // ✅ Remove localmente de qualquer jeito — mesmo comportamento do admin
    // (o botão "REMOVER" nunca depende do painel do parceiro pra tirar o
    // app da conta do cliente). App descontinuado sem integração (ex:
    // DuplexPlay) cai direto aqui também.
    const { error: delErr } = await supabaseAdmin.from("client_apps").delete().eq("id", client_app_id);
    if (delErr) return jsonError("Erro interno", 500);

    after(() =>
      logAppActivity(supabaseAdmin, {
        tenantId,
        clientId: client_id,
        clientAppId: null,
        appName,
        event: partnerResult.attempted === false || partnerResult.ok === true ? "removed" : "removed_partner_failed",
        detail: partnerResult.attempted === false || partnerResult.ok === true ? null : { error: partnerResult.error },
      }),
    );

    return NextResponse.json({ ok: true, data: { pending_admin: false } }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (e: any) {
    if (tenantId && client_app_id) {
      try {
        await logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "removed_partner_failed",
          detail: { error: e?.message || "Erro interno inesperado.", unexpected: true },
        });
      } catch {
        // não deixa o log derrubar a resposta de erro
      }
    }
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
