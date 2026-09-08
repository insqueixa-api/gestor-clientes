// app/api/admin/gerenciaapp/renovar/route.ts
//
// Botão "Renovar" do card GerenciaApp — pedido do Márcio (08/09/2026):
// mesmo espírito do "Nova Recarga" da Appativa (paga de verdade no site
// deles primeiro, confirma aqui depois), mas em vez de lançar uma despesa
// avulsa, dá baixa na PRÓXIMA parcela pendente da recorrência mensal que já
// existe em fin_transacoes ("Renovação GerenciaApp") — a recorrência
// continua existindo intacta, só essa parcela vira PAGO. Depois relê a
// validade real do painel (expire_account) pra refletir no card.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { fetchGerenciaAppAccountStatus } from "@/lib/integrations/gerenciaapp-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DESCRICAO = "Renovação GerenciaApp";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id: tenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const dataPagamento = String(body?.data_pagamento || "").trim(); // "YYYY-MM-DD", opcional

  const { data: integ, error: integErr } = await supabase
    .from("app_integrations")
    .select("id, api_url, login_email, login_password")
    .eq("tenant_id", tenantId)
    .eq("app_name", "GERENCIAAPP")
    .maybeSingle();

  if (integErr || !integ?.api_url || !integ?.login_email || !integ?.login_password) {
    return NextResponse.json({ ok: false, error: "Integração GerenciaApp não configurada." }, { status: 400 });
  }

  const { data: parcela, error: parcelaErr } = await supabase
    .from("fin_transacoes")
    .select("id, valor, data_vencimento")
    .eq("tenant_id", tenantId)
    .eq("descricao", DESCRICAO)
    .eq("status", "PENDENTE")
    .order("data_vencimento", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (parcelaErr) return NextResponse.json({ ok: false, error: parcelaErr.message }, { status: 500 });
  if (!parcela) {
    return NextResponse.json(
      { ok: false, error: `Nenhuma parcela pendente de "${DESCRICAO}" encontrada no Financeiro Pessoal.` },
      { status: 404 },
    );
  }

  const dataPagamentoIso = dataPagamento
    ? new Date(`${dataPagamento}T12:00:00`).toISOString()
    : new Date().toISOString();

  const { error: baixaErr } = await supabase
    .from("fin_transacoes")
    .update({ status: "PAGO", data_pagamento: dataPagamentoIso })
    .eq("id", parcela.id);
  if (baixaErr) return NextResponse.json({ ok: false, error: baixaErr.message }, { status: 500 });

  try {
    // ✅ 08/09/2026, achado do Márcio: resolve_notification é SECURITY
    // DEFINER e checa auth.uid() internamente — funciona chamada pelo
    // navegador (sessão real do usuário), mas essa rota usa o client de
    // service_role (sem JWT de usuário), então auth.uid() vem null e a
    // função sempre falhava com NOT_AUTHORIZED (engolido pelo catch,
    // silenciosamente). Aqui já estamos com acesso total via service_role
    // e o tenantId já foi validado por requireAdminTenant — update direto,
    // sem passar pela função pensada pro client autenticado do navegador.
    await supabase
      .from("notifications")
      .update({ resolved_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("type", "fin_vencido")
      .eq("source_id", parcela.id)
      .is("resolved_at", null);
  } catch {
    // best-effort
  }

  try {
    const status = await fetchGerenciaAppAccountStatus(
      String(integ.api_url).replace(/\/$/, ""),
      integ.login_email,
      integ.login_password,
    );
    await supabase
      .from("app_integrations")
      .update({
        extra_config: { expire_account: status.expire_account, last_sync_at: new Date().toISOString() },
      })
      .eq("id", integ.id);

    return NextResponse.json({
      ok: true,
      expire_account: status.expire_account,
      valor: parcela.valor,
      parcela_vencimento: parcela.data_vencimento,
    });
  } catch (e: any) {
    // ✅ A baixa no financeiro já foi feita (é o mais importante e
    // irreversível de forma automática) — se só a leitura da validade
    // falhar, avisa mas não desfaz o pagamento já confirmado.
    return NextResponse.json(
      {
        ok: false,
        partial: true,
        error:
          "Pagamento confirmado no Financeiro Pessoal, mas não consegui ler a validade nova no painel: " +
          (e?.message || ""),
      },
      { status: 502 },
    );
  }
}
