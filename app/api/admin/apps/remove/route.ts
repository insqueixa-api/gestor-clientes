// app/api/admin/apps/remove/route.ts
// "Remover" pelo admin (aba Aplicativos do modal de cliente) — mesma lógica
// de app/api/client-portal/apps/remove/route.ts pra desconfigurar no painel
// do parceiro (lib/apps/orchestration.ts), mas SEM o fluxo de "pedido de
// remoção pendente" do portal: o admin é quem resolveria esse pedido, então
// sempre apaga a linha na hora, com ou sem integração automática — mesmo
// comportamento que o admin já tem hoje em novo_cliente.tsx.
//
// Aceita `client_app_id` (app já salvo, apaga a linha de verdade) OU
// `app_id` + `client_id` + `field_values` (app ainda só existe no state do
// React, antes de "Salvar" — só tenta desconfigurar no parceiro, não há
// linha em client_apps pra apagar). Ver loadClientAppDraft em
// lib/apps/orchestration.ts.
//
// `keep_row: true` (só o botão "Remover do painel oficial" do admin usa) —
// desconfigura no parceiro mas NÃO apaga a linha client_apps: esse botão
// sempre foi "tirar do painel, continuar na lista do cliente pra
// reconfigurar depois", diferente do botão "REMOVER" do cabeçalho do card
// (tira da lista, local, só reflete no banco no próximo Salvar) e diferente
// do "Concluir & Excluir" do AppRequestModal (esse sim apaga a linha).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { logAppActivity } from "@/lib/apps/panel";
import { loadClientApp, loadClientAppDraft, removeClientAppFromPartner } from "@/lib/apps/orchestration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const clientAppId = String(body?.client_app_id || "").trim();
  const appId = String(body?.app_id || "").trim();
  const draftClientId = String(body?.client_id || "").trim();
  // undefined (não {}) quando ausente — senão um caller que não manda
  // field_values (ex: AppRequestModal) apagaria o MAC real salvo no banco
  // bem na hora de montar o payload de exclusão no parceiro.
  const fieldValues: Record<string, string> | undefined =
    body?.field_values && typeof body.field_values === "object" ? body.field_values : undefined;
  const keepRow = body?.keep_row === true;

  if (!clientAppId && !(appId && draftClientId)) {
    return NextResponse.json({ ok: false, error: "client_app_id, ou app_id + client_id, é obrigatório" }, { status: 400 });
  }

  const row = clientAppId
    ? await loadClientApp(supabase, { clientAppId, tenantId, fieldValuesOverride: fieldValues })
    : await loadClientAppDraft(supabase, { appId, clientId: draftClientId, fieldValues: fieldValues || {} });
  if (!row) return NextResponse.json({ ok: false, error: "Aplicativo não encontrado" }, { status: 404 });

  const partnerResult = await removeClientAppFromPartner(supabase, row);
  const partnerSucceeded = partnerResult.attempted === false || partnerResult.ok === true;

  if (clientAppId && !keepRow) {
    const { error: delErr } = await supabase.from("client_apps").delete().eq("id", clientAppId);
    if (delErr) return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }

  await logAppActivity(supabase, {
    tenantId,
    clientId: row.client_id,
    // Com keepRow a linha continua existindo — mantém o id real no log
    // (útil pra cruzar depois). Sem keepRow ela já foi apagada, então null
    // (mesmo comportamento de antes desta flag existir).
    clientAppId: keepRow ? clientAppId || null : null,
    appName: row.appName,
    event: partnerSucceeded ? "removed" : "removed_partner_failed",
    detail: partnerSucceeded ? null : { error: partnerResult.error },
  });

  return NextResponse.json({ ok: true });
}
