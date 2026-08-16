// app/api/admin/apps/check-validity/route.ts
//
// "Verificar" do painel "Concluir renovação de licença" da Auditoria
// (components/apps/AppRequestModal.tsx, action="renewal") — autenticado
// como admin (Bearer = access_token da
// sessão do admin, checa tenant_members) em vez de sessão do portal. Usado
// depois de o Márcio já ter pago a licença de verdade ao desenvolvedor do
// app, por fora do sistema — só confirma o vencimento real no painel do
// parceiro, sem criar/alterar nada lá.
//
// A consulta em si (antes reimplementada aqui) agora mora em
// lib/apps/orchestration.ts (checkClientAppValidity) — a mesma função usada
// por app/api/client-portal/apps/check-validity/route.ts. Isso também
// corrige uma lacuna que só esta rota tinha: sem o fallback "parceiro não
// devolveu vencimento (ex: DUPLEXTV) → mantém o valor já salvo", que o
// portal já tinha. Auth e contrato de request/response (tenant_id +
// client_app_id no body, mesmas respostas de erro) continuam idênticos.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { loadClientApp, loadClientAppDraft, checkClientAppValidity } from "@/lib/apps/orchestration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.res.status === 403 ? "Forbidden" : "Unauthorized" }, { status: auth.res.status });
  }
  const { supabase: supabaseAdmin, tenant_id: authTenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const tenantId = String(body?.tenant_id || "").trim();
  const clientAppId = String(body?.client_app_id || "").trim();
  // ✅ Modo rascunho (só o admin usa): app ainda não salvo em client_apps —
  // o admin adiciona o app e clica "Verificar" na hora, antes de "Salvar" o
  // cliente (fluxo real). Ver loadClientAppDraft em lib/apps/orchestration.ts.
  const appId = String(body?.app_id || "").trim();
  const draftClientId = String(body?.client_id || "").trim();
  // undefined (não {}) quando ausente — senão um caller que não manda
  // field_values (ex: AppRequestModal.tsx, que nunca manda) apagaria o MAC
  // real salvo no banco na hora de montar a consulta ao parceiro.
  const fieldValues: Record<string, string> | undefined =
    body?.field_values && typeof body.field_values === "object" ? body.field_values : undefined;
  if (!tenantId || (!clientAppId && !(appId && draftClientId))) {
    return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400 });
  }

  if (tenantId !== authTenantId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const row = clientAppId
      ? await loadClientApp(supabaseAdmin, { clientAppId, tenantId, fieldValuesOverride: fieldValues })
      : await loadClientAppDraft(supabaseAdmin, { appId, clientId: draftClientId, tenantId, fieldValues: fieldValues || {} });
    if (!row) return NextResponse.json({ ok: false, error: "Aplicativo não encontrado" }, { status: 404 });

    const result = await checkClientAppValidity(supabaseAdmin, row);
    // ✅ Comparação explícita (=== false) — ver nota em .../configure/route.ts.
    if (result.ok === false) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, expireDate: result.expireDate, isTrial: result.isTrial || false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno" }, { status: 500 });
  }
}
