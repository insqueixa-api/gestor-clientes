// app/api/admin/settings/proxybr/renew/route.ts
// ✅ 11/09/2026 — movida de app/api/system-health/proxy-renew (painel
// "Sistema" removido). Chama a API real da ProxyBR (POST /orders/:uuid/
// renew, ver lib/proxybr.ts) — DEBITA do saldo da conta ProxyBR de verdade,
// por isso fica atrás de confirmação no front (useConfirm) antes de chamar
// essa rota.
//
// ✅ 11/09/2026 (mesmo dia), pedido do Márcio: mesmo espírito do botão
// "Renovar" do GerenciaApp (app/api/admin/gerenciaapp/renovar/route.ts) —
// depois de renovar de verdade, dá baixa na próxima parcela PENDENTE da
// recorrência "Renovação ProxyBR" no Financeiro Pessoal. Diferença: aqui a
// renovação É a ação real (debita saldo na hora), a baixa financeira é só
// contabilidade DEPOIS — se ela falhar, não desfaz a renovação (já
// aconteceu de verdade na ProxyBR).
import { NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { getActiveProxyOrder, renewProxyOrder } from "@/lib/proxybr";

export const dynamic = "force-dynamic";

const DESCRICAO = "Renovação ProxyBR";

export async function POST(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;

  const apiToken = String(process.env.PROXYBR_API_TOKEN || "").trim();
  if (!apiToken) {
    return NextResponse.json({ error: "PROXYBR_API_TOKEN não configurado" }, { status: 500 });
  }

  let newOrder: any;
  try {
    const { order } = await getActiveProxyOrder(apiToken);
    if (!order) {
      return NextResponse.json({ error: "Nenhum pedido ativo encontrado na conta ProxyBR" }, { status: 404 });
    }
    const result = await renewProxyOrder(apiToken, order.uuid);
    newOrder = result?.data || result;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falha ao renovar" }, { status: 502 });
  }

  // ✅ Renovação real já aconteceu — a partir daqui é só contabilidade
  // best-effort, nunca reporta erro 500 pro front por causa disso.
  let financeUpdated = false;
  try {
    const { data: parcela } = await supabase
      .from("fin_transacoes")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("descricao", DESCRICAO)
      .eq("status", "PENDENTE")
      .order("data_vencimento", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (parcela) {
      await supabase
        .from("fin_transacoes")
        .update({ status: "PAGO", data_pagamento: new Date().toISOString() })
        .eq("id", parcela.id);
      await supabase
        .from("notifications")
        .update({ resolved_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("type", "fin_vencido")
        .eq("source_id", parcela.id)
        .is("resolved_at", null);
      financeUpdated = true;
    }
  } catch {
    // best-effort — a renovação real já foi feita, não desfaz nada
  }

  return NextResponse.json({ ok: true, order: newOrder, financeUpdated });
}
