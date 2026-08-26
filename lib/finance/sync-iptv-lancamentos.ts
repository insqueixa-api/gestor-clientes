// lib/finance/sync-iptv-lancamentos.ts
//
// Sincroniza os 2 lançamentos automáticos de IPTV em fin_transacoes
// ("IPTV - Recarga de Servidores" e "IPTV - Rendimentos") — achado
// 26/08/2026, pedido do Márcio: antes só eram recalculados quando alguém
// abria a tela Financeiro Pessoal (sincronizarRendimentos em
// app/admin/settings/financeiro_pessoal/page.tsx), o que deixava a
// Evolução Consolidada e a lista de lançamentos desatualizadas até a
// próxima visita àquela tela — errado, porque isso é automático e deveria
// rodar a cada transação (recarga de servidor, recarga de revenda,
// renovação de cliente).
//
// Fontes usadas aqui (todas tabelas normais, legíveis com a service_role,
// sem depender de sessão de usuário real):
// - server_credit_purchases → "IPTV - Recarga de Servidores" (despesa)
// - client_renewals + server_credit_sales → "IPTV - Rendimentos" (receita)
//
// A view vw_dashboard_finance_cards (fonte original desses números no
// client-side) resolve o tenant_id via auth.uid() internamente — por isso
// não dava pra chamar ela direto de um webhook/RPC sem sessão. Replicado
// aqui a partir das MESMAS tabelas brutas que a view usa (confirmado lendo
// a definição real da view via `pg_get_viewdef`, 26/08/2026), só que
// filtrando por tenantId recebido como parâmetro em vez de auth.uid().

function monthBounds(dateObj: Date) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth();
  const ultimoDia = new Date(y, m + 1, 0).getDate();
  const dataVenc = `${y}-${String(m + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  const mesStart = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return {
    dataVenc,
    mesStart,
    mesStartStr: `${mesStart}T00:00:00.000Z`,
    mesEndStr: `${y}-${String(m + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}T23:59:59.999Z`,
    dataPagamentoMes: new Date(`${dataVenc}T12:00:00`).toISOString(),
  };
}

async function resolveIptvContext(supabaseAdmin: any, tenantId: string) {
  const [{ data: cat }, { data: contas }] = await Promise.all([
    supabaseAdmin
      .from("fin_categorias")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("nome", "%iptv%")
      .maybeSingle(),
    supabaseAdmin
      .from("fin_contas_bancarias")
      .select("id, nome")
      .eq("tenant_id", tenantId),
  ]);

  const contaMpPj = (contas || []).find((c: any) => {
    const n = String(c?.nome || "").toLowerCase();
    return n.includes("mercado pago") && n.includes("pj");
  })?.id;

  return { catId: cat?.id as string | undefined, contaMpPj };
}

// ✅ Upsert único (existe -> atualiza + remove duplicatas; some se valor
// virar 0; cria se não existir) — mesmo comportamento de upsertDinamico em
// financeiro_pessoal/page.tsx, só que reaproveitado pelos 2 lançamentos.
async function upsertIptvLancamento(
  supabaseAdmin: any,
  tenantId: string,
  params: {
    descricao: string;
    tipo: "RECEITA" | "DESPESA";
    valor: number;
    catId: string;
    contaMpPj: string | undefined;
    dataVenc: string;
    mesStart: string;
    dataPagamentoMes: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { descricao, tipo, valor, catId, contaMpPj, dataVenc, mesStart, dataPagamentoMes } = params;

  const { data: existentes, error: errSel } = await supabaseAdmin
    .from("fin_transacoes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("descricao", descricao)
    .gte("data_vencimento", mesStart)
    .lte("data_vencimento", dataVenc);
  if (errSel) return { ok: false, error: errSel.message };

  if (valor <= 0) {
    if (existentes && existentes.length > 0) {
      const { error: errDel } = await supabaseAdmin
        .from("fin_transacoes")
        .delete()
        .in("id", existentes.map((e: any) => e.id));
      if (errDel) return { ok: false, error: errDel.message };
    }
    return { ok: true };
  }

  if (existentes && existentes.length > 0) {
    const { error: errUpd } = await supabaseAdmin
      .from("fin_transacoes")
      .update({
        valor,
        data_vencimento: dataVenc,
        status: "PAGO",
        data_pagamento: dataPagamentoMes,
        conta_id: contaMpPj ?? null,
      })
      .eq("id", existentes[0].id);
    if (errUpd) return { ok: false, error: errUpd.message };

    if (existentes.length > 1) {
      const { error: errDelDup } = await supabaseAdmin
        .from("fin_transacoes")
        .delete()
        .in("id", existentes.slice(1).map((e: any) => e.id));
      if (errDelDup) return { ok: false, error: errDelDup.message };
    }
  } else {
    const { error: errIns } = await supabaseAdmin.from("fin_transacoes").insert({
      tenant_id: tenantId,
      tipo,
      descricao,
      valor,
      data_vencimento: dataVenc,
      status: "PAGO",
      data_pagamento: dataPagamentoMes,
      conta_id: contaMpPj ?? null,
      categoria_id: catId,
      is_recorrente: true,
      frequencia: "MENSAL",
      observacoes: "Sincronização Automática",
    });
    if (errIns) return { ok: false, error: errIns.message };
  }

  return { ok: true };
}

// ✅ Despesa — server_credit_purchases é tabela normal (sem RLS/auth.uid()
// amarrado), chamável de qualquer contexto server-side.
export async function syncIptvRecargaServidores(
  supabaseAdmin: any,
  tenantId: string,
  dateObj: Date = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { dataVenc, mesStart, mesStartStr, mesEndStr, dataPagamentoMes } = monthBounds(dateObj);
    const [{ catId, contaMpPj }, { data: purchases }] = await Promise.all([
      resolveIptvContext(supabaseAdmin, tenantId),
      supabaseAdmin
        .from("server_credit_purchases")
        .select("total_amount_brl")
        .eq("tenant_id", tenantId)
        .gte("created_at", mesStartStr)
        .lte("created_at", mesEndStr),
    ]);

    if (!catId) return { ok: false, error: 'Categoria "IPTV" não encontrada.' };

    const valor = (purchases || []).reduce(
      (acc: number, row: any) => acc + Number(row.total_amount_brl || 0),
      0,
    );

    return upsertIptvLancamento(supabaseAdmin, tenantId, {
      descricao: "IPTV - Recarga de Servidores",
      tipo: "DESPESA",
      valor,
      catId,
      contaMpPj,
      dataVenc,
      mesStart,
      dataPagamentoMes,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao sincronizar." };
  }
}

// ✅ Receita — client_renewals + server_credit_sales são as mesmas 2
// tabelas brutas que vw_dashboard_finance_cards usa (renewals_amount_daily
// / sales_daily), só que filtradas por tenantId direto em vez de resolver
// via auth.uid(). Nenhuma conversão de câmbio necessária aqui — ambas as
// tabelas já guardam o valor em BRL.
export async function syncIptvRendimentos(
  supabaseAdmin: any,
  tenantId: string,
  dateObj: Date = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { dataVenc, mesStart, mesStartStr, mesEndStr, dataPagamentoMes } = monthBounds(dateObj);
    const [{ catId, contaMpPj }, { data: renewals }, { data: sales }] = await Promise.all([
      resolveIptvContext(supabaseAdmin, tenantId),
      supabaseAdmin
        .from("client_renewals")
        .select("total_amount")
        .eq("tenant_id", tenantId)
        .gte("created_at", mesStartStr)
        .lte("created_at", mesEndStr),
      supabaseAdmin
        .from("server_credit_sales")
        .select("total_amount_brl")
        .eq("tenant_id", tenantId)
        .gte("created_at", mesStartStr)
        .lte("created_at", mesEndStr),
    ]);

    if (!catId) return { ok: false, error: 'Categoria "IPTV" não encontrada.' };

    const valor =
      (renewals || []).reduce((acc: number, r: any) => acc + Number(r.total_amount || 0), 0) +
      (sales || []).reduce((acc: number, s: any) => acc + Number(s.total_amount_brl || 0), 0);

    return upsertIptvLancamento(supabaseAdmin, tenantId, {
      descricao: "IPTV - Rendimentos",
      tipo: "RECEITA",
      valor,
      catId,
      contaMpPj,
      dataVenc,
      mesStart,
      dataPagamentoMes,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao sincronizar." };
  }
}
