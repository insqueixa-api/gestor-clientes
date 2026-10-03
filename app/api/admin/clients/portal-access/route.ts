// app/api/admin/clients/portal-access/route.ts
//
// Menu "Portal" da página do cliente (02/10/2026, pedido do Márcio):
//   info     → contatos do cliente (titular/secundário), se está
//              desvinculado e se a mesma pessoa tem OUTRA conta ativa
//              (usado pra sugerir desvincular ao arquivar)
//   rotate   → troca o link mágico de UM contato (titular ou secundário):
//              desativa o token atual, derruba sessões abertas e gera um
//              novo. O link é da PESSOA, então vale pra todas as contas
//              daquele WhatsApp (portal_rotate_token).
//   unlink   → "Desvinculado": conta some do portal (deep_archived_at).
//              Só conta arquivada. Histórico/cupons/WhatsApp intactos.
//   relink   → volta a aparecer no portal (continua arquivada).
// Estados: Ativo / Arquivado (aparecem no portal) / Desvinculado (não).
// SQL: docs/sql/portal_trocar_link_e_desvincular.sql
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const norm = (v: unknown) => String(v ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

type Contact = { key: "primary" | "secondary"; label: string; whatsapp: string; phone: string | null };

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId, user_id } = auth;

  const body = await req.json().catch(() => ({}) as any);
  const clientId = String(body?.client_id || "").trim();
  const action = String(body?.action || "").trim();
  if (!clientId) return NextResponse.json({ ok: false, error: "client_id ausente" }, { status: 400 });

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, display_name, server_username, is_archived, is_trial, deep_archived_at, whatsapp_username, phone_e164, secondary_display_name, secondary_whatsapp_username, secondary_phone_e164",
    )
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!client) return NextResponse.json({ ok: false, error: "Cliente não encontrado" }, { status: 404 });

  const contacts: Contact[] = [];
  if (client.whatsapp_username) {
    contacts.push({
      key: "primary",
      label: client.display_name || "Titular",
      whatsapp: client.whatsapp_username,
      phone: client.phone_e164 || null,
    });
  }
  if (client.secondary_whatsapp_username) {
    contacts.push({
      key: "secondary",
      label: client.secondary_display_name || "Secundário",
      whatsapp: client.secondary_whatsapp_username,
      phone: client.secondary_phone_e164 || null,
    });
  }

  const logEvent = async (event_type: string, message: string, meta: Record<string, unknown> = {}) => {
    await supabase
      .from("client_events")
      .insert({ tenant_id: tenantId, client_id: clientId, event_type, message, meta: { ...meta, by: user_id } });
  };

  if (action === "info") {
    // Outras contas da mesma pessoa que o portal ainda mostra (ativas)
    const others: { id: string; label: string }[] = [];
    for (const c of contacts) {
      const { data: ids } = await supabase.rpc("portal_client_ids_for_identity", {
        p_tenant_id: tenantId,
        p_whatsapp_username: c.whatsapp,
        p_phone_anchor: c.phone ? norm(c.phone) || null : null,
      });
      const otherIds = ((ids as { id: string }[] | null) || []).map((r) => r.id).filter((id) => id !== clientId);
      if (!otherIds.length) continue;
      const { data: rows } = await supabase
        .from("clients")
        .select("id, display_name, server_username, is_archived")
        .eq("tenant_id", tenantId)
        .in("id", otherIds)
        .eq("is_archived", false);
      for (const r of rows || []) {
        if (!others.some((o) => o.id === r.id)) others.push({ id: r.id, label: r.server_username || r.display_name || "Conta" });
      }
    }
    return NextResponse.json({
      ok: true,
      contacts: contacts.map(({ key, label, whatsapp }) => ({ key, label, whatsapp })),
      is_archived: !!client.is_archived,
      unlinked: !!client.deep_archived_at,
      other_active_accounts: others,
    });
  }

  if (action === "rotate") {
    const contact = contacts.find((c) => c.key === (body?.contact === "secondary" ? "secondary" : "primary"));
    if (!contact) return NextResponse.json({ ok: false, error: "Esse contato não tem WhatsApp cadastrado." }, { status: 400 });

    const { data: rot, error: rotErr } = await supabase.rpc("portal_rotate_token", {
      p_tenant_id: tenantId,
      p_whatsapp: contact.whatsapp,
      p_phone_anchor: contact.phone,
    });
    if (rotErr) return NextResponse.json({ ok: false, error: "Falha ao desativar o link antigo." }, { status: 500 });
    const stats = Array.isArray(rot) ? rot[0] : rot;

    const { data: tokData, error: tokErr } = await supabase.rpc("portal_admin_create_token_for_whatsapp_v2", {
      p_tenant_id: tenantId,
      p_whatsapp_username: contact.whatsapp,
      p_created_by: user_id,
      p_label: "admin_rotate",
      p_expires_at: null,
    });
    const tokRow = Array.isArray(tokData) ? tokData[0] : null;
    if (tokErr || !tokRow?.token) {
      return NextResponse.json({ ok: false, error: "Link antigo desativado, mas falhou ao gerar o novo — tente de novo." }, { status: 500 });
    }
    const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://unigestor.net.br").replace(/\/+$/, "");
    const link = `${appUrl}/#t=${encodeURIComponent(String(tokRow.token))}`;

    await logEvent("portal_link_rotated", `Link mágico trocado (${contact.key === "primary" ? "titular" : "secundário"})`, {
      contato: contact.key,
      tokens_desativados: stats?.tokens_desativados ?? null,
      sessoes_encerradas: stats?.sessoes_encerradas ?? null,
    });
    return NextResponse.json({
      ok: true,
      link,
      contact: contact.key,
      sessions_closed: Number(stats?.sessoes_encerradas || 0),
    });
  }

  if (action === "unlink" || action === "relink") {
    if (action === "unlink" && !client.is_archived) {
      return NextResponse.json({ ok: false, error: "Arquive o cliente antes de desvincular do portal." }, { status: 400 });
    }
    const { error } = await supabase
      .from("clients")
      .update({ deep_archived_at: action === "unlink" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", clientId)
      .eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ ok: false, error: "Falha ao salvar." }, { status: 500 });
    await logEvent(
      action === "unlink" ? "portal_unlinked" : "portal_relinked",
      action === "unlink" ? "Desvinculado do portal" : "Vinculado de novo ao portal",
    );
    return NextResponse.json({ ok: true, unlinked: action === "unlink" });
  }

  return NextResponse.json({ ok: false, error: "action inválida" }, { status: 400 });
}
