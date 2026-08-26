// lib/finance/sync-iptv-despesa.ts
//
// Sincroniza "IPTV - Recarga de Servidores" em fin_transacoes (achado
// 26/08/2026, pedido do Márcio): antes esse lançamento só era recalculado
// quando alguém abria a tela Financeiro Pessoal (sincronizarRendimentos em
// app/admin/settings/financeiro_pessoal/page.tsx) — errado, porque o
// gráfico "Evolução Consolidada" e a lista de lançamentos leem direto de
// fin_transacoes, então ficavam com o valor desatualizado até a próxima
// visita àquela tela. Extraído pra rodar automaticamente toda vez que uma
// recarga de servidor é salva (recarga_servidor.tsx, via
// app/api/finance/sync-iptv-despesa/route.ts).
//
// ⚠️ Só cobre o lado DESPESA (server_credit_purchases é uma tabela normal,
// legível com a service_role). O lado RECEITA ("IPTV - Rendimentos") NÃO
// foi migrado pra cá: a fonte dele (vw_dashboard_finance_cards) depende de
// auth.uid() internamente e não devolve nada pra um cliente sem sessão de
// usuário real — confirmado ao vivo (query direta com tenant_id explícito
// via service_role voltou vazia). Continua só no sync client-side de
// financeiro_pessoal/page.tsx por enquanto, até decidir como replicar essa
// fonte pro lado servidor.

export async function syncIptvRecargaServidores(
  supabaseAdmin: any,
  tenantId: string,
  dateObj: Date = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  try {
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth();
    const ultimoDia = new Date(y, m + 1, 0).getDate();

    const dataVenc = `${y}-${String(m + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
    const mesStart = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const mesStartStr = `${mesStart}T00:00:00.000Z`;
    const mesEndStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}T23:59:59.999Z`;

    const [{ data: cat }, { data: contas }, { data: purchases }] = await Promise.all([
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
      supabaseAdmin
        .from("server_credit_purchases")
        .select("total_amount_brl")
        .eq("tenant_id", tenantId)
        .gte("created_at", mesStartStr)
        .lte("created_at", mesEndStr),
    ]);

    if (!cat?.id) return { ok: false, error: 'Categoria "IPTV" não encontrada.' };

    const contaMpPj = (contas || []).find((c: any) => {
      const n = String(c?.nome || "").toLowerCase();
      return n.includes("mercado pago") && n.includes("pj");
    })?.id;

    const valorDespesas = (purchases || []).reduce(
      (acc: number, row: any) => acc + Number(row.total_amount_brl || 0),
      0,
    );

    const dataPagamentoMes = new Date(`${dataVenc}T12:00:00`).toISOString();

    const { data: existentes, error: errSel } = await supabaseAdmin
      .from("fin_transacoes")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("descricao", "IPTV - Recarga de Servidores")
      .gte("data_vencimento", mesStart)
      .lte("data_vencimento", dataVenc);
    if (errSel) return { ok: false, error: errSel.message };

    if (valorDespesas <= 0) {
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
          valor: valorDespesas,
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
        tipo: "DESPESA",
        descricao: "IPTV - Recarga de Servidores",
        valor: valorDespesas,
        data_vencimento: dataVenc,
        status: "PAGO",
        data_pagamento: dataPagamentoMes,
        conta_id: contaMpPj ?? null,
        categoria_id: cat.id,
        is_recorrente: true,
        frequencia: "MENSAL",
        observacoes: "Sincronização Automática",
      });
      if (errIns) return { ok: false, error: errIns.message };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha ao sincronizar." };
  }
}
