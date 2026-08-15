// app/api/admin/portal-preview/route.ts
//
// Abre o Portal do Cliente já logado, direto do botão "Portal" em
// /admin/cliente/[id] (pedido do Márcio, 15/08/2026) — pra testar qualquer
// conta sem precisar receber o link mágico por WhatsApp. Reaproveita as
// mesmas duas RPCs do fluxo real (magic link → login): gera um token
// (portal_admin_create_token_for_whatsapp_v2, mesma usada em
// lib/whatsapp/template-vars.ts) e já resolve ele numa sessão
// (portal_start_session, mesma usada em app/api/client-portal/login) — sem
// passar pelo Turnstile, que só existe pra barrar bot no login público, não
// faz sentido numa chamada autenticada como admin. Sem log de auditoria
// (decisão explícita do Márcio).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.res.status === 403 ? "Forbidden" : "Unauthorized" }, { status: auth.res.status });
  }
  const { supabase: supabaseAdmin, tenant_id: tenantId, user_id } = auth;

  const body = await req.json().catch(() => ({} as any));
  const clientId = String(body?.client_id || "").trim();
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "client_id ausente" }, { status: 400 });
  }

  try {
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, whatsapp_username")
      .eq("id", clientId)
      .eq("tenant_id", tenantId)
      .single();

    if (clientErr || !client) {
      return NextResponse.json({ ok: false, error: "Cliente não encontrado" }, { status: 404 });
    }
    if (!client.whatsapp_username) {
      return NextResponse.json({ ok: false, error: "Cliente sem WhatsApp cadastrado — Portal exige uma identidade" }, { status: 400 });
    }

    const { data: tokData, error: tokErr } = await supabaseAdmin.rpc(
      "portal_admin_create_token_for_whatsapp_v2",
      {
        p_tenant_id: tenantId,
        p_whatsapp_username: client.whatsapp_username,
        p_created_by: user_id,
        p_label: "admin_preview",
        p_expires_at: null,
      }
    );
    if (tokErr) {
      return NextResponse.json({ ok: false, error: "Falha ao gerar token do Portal" }, { status: 500 });
    }
    const tokRow = Array.isArray(tokData) ? tokData[0] : null;
    const portalToken = tokRow?.token ? String(tokRow.token) : "";
    if (!portalToken) {
      return NextResponse.json({ ok: false, error: "Token do Portal vazio" }, { status: 500 });
    }

    const { data: sessData, error: sessErr } = await supabaseAdmin.rpc("portal_start_session", {
      p_token: portalToken,
    });
    if (sessErr) {
      return NextResponse.json({ ok: false, error: "Falha ao iniciar sessão do Portal" }, { status: 500 });
    }
    const sessRow = Array.isArray(sessData) ? sessData[0] : null;
    if (!sessRow?.session_token) {
      return NextResponse.json({ ok: false, error: "Sessão do Portal vazia" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, session_token: sessRow.session_token });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Erro interno" }, { status: 500 });
  }
}
