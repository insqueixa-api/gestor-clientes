// app/api/client-portal/apps/check-validity/route.ts
// Botão "Verificar validade" do Bloco 3 — só consulta o vencimento real no
// painel do parceiro, sem criar/alterar nada. Autenticação (session_token) e
// log de auditoria ficam aqui; a consulta em si mora em
// lib/apps/orchestration.ts (checkClientAppValidity), a mesma função que
// app/api/admin/apps/check-validity/route.ts usa.
import { NextRequest, NextResponse, after } from "next/server";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { logAppActivity } from "@/lib/apps/panel";
import { loadClientApp, checkClientAppValidity } from "@/lib/apps/orchestration";

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

    const result = await checkClientAppValidity(supabaseAdmin, row);

    // ✅ Comparação explícita (=== false) — ver nota em .../configure/route.ts.
    if (result.ok === false) {
      after(() =>
        logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "check_validity_failed",
          detail: { error: result.error },
        }),
      );
      return jsonError(result.error, 400);
    }

    after(() =>
      logAppActivity(supabaseAdmin, {
        tenantId,
        clientId: client_id,
        clientAppId: client_app_id,
        appName,
        event: "check_validity",
        // Log fica com o que o parceiro REALMENTE devolveu (pra auditoria) —
        // `expireDate` (com fallback pro banco) é só o que vai pro cliente.
        detail: result.rawExpireDate ? { expireDate: result.rawExpireDate } : null,
      }),
    );

    return NextResponse.json({ ok: true, expireDate: result.expireDate }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (e: any) {
    if (tenantId && client_app_id) {
      try {
        await logAppActivity(supabaseAdmin, {
          tenantId,
          clientId: client_id,
          clientAppId: client_app_id,
          appName,
          event: "check_validity_failed",
          detail: { error: e?.message || "Erro interno inesperado.", unexpected: true },
        });
      } catch {
        // não deixa o log derrubar a resposta de erro
      }
    }
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
