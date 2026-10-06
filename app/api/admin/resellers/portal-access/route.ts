// app/api/admin/resellers/portal-access/route.ts
// ✅ 06/10/2026: menu "Portal" da página da revenda (mesma ideia do menu do
// cliente em app/api/admin/clients/portal-access):
//   info    → tem link ativo? está desvinculada?
//   open    → abre o Portal da Revenda já logado (sessão direta, sem link)
//   link    → link mágico atual (cria se não houver) pra copiar/enviar
//   rotate  → troca o link: desativa o atual, derruba sessões, gera outro
//   unlink  → desvincula: link desativado + sessões derrubadas; mensagens
//             com {link_pagamento} vêm sem link até vincular de novo
//   relink  → vincula de novo (gera link novo no próximo uso)
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import {
  getOrCreateResellerPortalToken,
  resellerPortalUrl,
  revokeResellerPortalAccess,
  startResellerSessionAsAdmin,
} from "@/lib/reseller-portal/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: sb, tenant_id: tenantId, user_id } = auth;

  const body = await req.json().catch(() => ({}) as any);
  const resellerId = String(body?.reseller_id || "").trim();
  const action = String(body?.action || "").trim();
  if (!resellerId) return NextResponse.json({ ok: false, error: "reseller_id ausente" }, { status: 400 });

  const { data: reseller } = await sb
    .from("resellers")
    .select("id, is_archived, portal_disabled_at")
    .eq("id", resellerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!reseller) return NextResponse.json({ ok: false, error: "Revenda não encontrada" }, { status: 404 });

  if (action === "info") {
    const { data: tok } = await sb
      .from("reseller_portal_tokens")
      .select("created_at, last_used_at")
      .eq("reseller_id", resellerId)
      .eq("is_active", true)
      .maybeSingle();
    return NextResponse.json({
      ok: true,
      unlinked: !!reseller.portal_disabled_at,
      archived: !!reseller.is_archived,
      has_link: !!tok,
      link_last_used_at: tok?.last_used_at || null,
    });
  }

  if (action === "open") {
    const sess = await startResellerSessionAsAdmin(sb, tenantId, resellerId);
    if (!sess) return NextResponse.json({ ok: false, error: "Falha ao abrir o Portal da Revenda" }, { status: 500 });
    return NextResponse.json({ ok: true, session_token: sess.session_token });
  }

  if (action === "link" || action === "rotate") {
    if (reseller.is_archived) return NextResponse.json({ ok: false, error: "Revenda arquivada não tem acesso ao portal." }, { status: 400 });
    if (reseller.portal_disabled_at) return NextResponse.json({ ok: false, error: "Revenda desvinculada do portal — vincule de novo antes." }, { status: 400 });
    if (action === "rotate") await revokeResellerPortalAccess(sb, tenantId, resellerId);
    const token = await getOrCreateResellerPortalToken(sb, {
      tenantId,
      resellerId,
      createdBy: user_id,
      label: action === "rotate" ? "Trocado no admin" : "Copiado no admin",
    });
    if (!token) return NextResponse.json({ ok: false, error: "Falha ao gerar o link" }, { status: 500 });
    return NextResponse.json({ ok: true, url: resellerPortalUrl(token), rotated: action === "rotate" });
  }

  if (action === "unlink" || action === "relink") {
    if (action === "unlink") await revokeResellerPortalAccess(sb, tenantId, resellerId);
    await sb
      .from("resellers")
      .update({ portal_disabled_at: action === "unlink" ? new Date().toISOString() : null })
      .eq("id", resellerId)
      .eq("tenant_id", tenantId);
    return NextResponse.json({ ok: true, unlinked: action === "unlink" });
  }

  return NextResponse.json({ ok: false, error: "action inválida" }, { status: 400 });
}
