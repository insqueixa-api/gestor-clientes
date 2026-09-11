// app/api/finance/snapshot-previsao/route.ts
// Tira uma "fotografia" do Previsto de um mês: copia pra fin_previsao_snapshot
// a lista de fin_transacoes com vencimento naquele mês, no momento exato da
// chamada. Depois disso, o Previsto daquele mês não muda mais — qualquer
// lançamento novo que aparecer com vencimento nesse mês vira "Ajuste", não
// entra escondido no Previsto.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isCronRequest } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function currentAnoMesSP(): string {
  const now = new Date();
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const y = sp.getFullYear();
  const m = String(sp.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthRange(anoMes: string): { start: string; end: string } {
  const [y, m] = anoMes.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { start: `${anoMes}-01`, end: `${anoMes}-${String(lastDay).padStart(2, "0")}` };
}

async function snapshotTenant(tenantId: string, anoMes: string, force: boolean) {
  const { count } = await supabaseAdmin
    .from("fin_previsao_snapshot")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("ano_mes", anoMes);

  if ((count || 0) > 0 && !force) {
    return { tenant_id: tenantId, skipped: true, reason: "snapshot já existe pra esse mês" };
  }

  if ((count || 0) > 0 && force) {
    const { error: delErr } = await supabaseAdmin
      .from("fin_previsao_snapshot")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("ano_mes", anoMes);
    if (delErr) throw new Error(`Falha ao limpar snapshot anterior: ${delErr.message}`);
  }

  const { start, end } = monthRange(anoMes);

  // 1) fin_transacoes com vencimento no mês
  const { data: transacoes, error } = await supabaseAdmin
    .from("fin_transacoes")
    .select("id, tipo, valor, categoria_id, data_vencimento")
    .eq("tenant_id", tenantId)
    .gte("data_vencimento", start)
    .lte("data_vencimento", end);

  if (error) throw new Error(`Falha ao buscar transações: ${error.message}`);

  const rows = (transacoes || []).map((t) => ({
    tenant_id: tenantId,
    ano_mes: anoMes,
    transacao_id: t.id,
    client_id: null,
    origem: "fin_transacoes",
    tipo: t.tipo,
    valor: t.valor,
    categoria_id: t.categoria_id,
    data_vencimento: t.data_vencimento,
  }));

  // 2) "A receber" do IPTV: clientes ativos (não-teste, não-arquivados) com
  // vencimento no mês — mesma regra da view vw_dashboard_finance_cards
  // (to_receive_brl_estimated), só que congelada em vez de recalculada ao vivo.
  const { data: fxRow } = await supabaseAdmin
    .from("tenant_fx_rates")
    .select("usd_to_brl, eur_to_brl")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const usdToBrl = Number(fxRow?.usd_to_brl) || 5;
  const eurToBrl = Number(fxRow?.eur_to_brl) || 6;

  const { data: clientesAReceber, error: clErr } = await supabaseAdmin
    .from("clients")
    .select("id, price_amount, price_currency, vencimento")
    .eq("tenant_id", tenantId)
    .eq("is_archived", false)
    .eq("is_trial", false)
    .not("vencimento", "is", null)
    .gte("vencimento", `${start}T00:00:00`)
    .lte("vencimento", `${end}T23:59:59`);

  if (clErr) throw new Error(`Falha ao buscar clientes a receber: ${clErr.message}`);

  for (const c of clientesAReceber || []) {
    const amount = Number(c.price_amount) || 0;
    const currency = String(c.price_currency || "BRL").toUpperCase();
    const brl = currency === "USD" ? amount * usdToBrl : currency === "EUR" ? amount * eurToBrl : amount;
    rows.push({
      tenant_id: tenantId,
      ano_mes: anoMes,
      transacao_id: null,
      client_id: c.id,
      origem: "iptv_a_receber",
      tipo: "RECEITA",
      valor: brl,
      categoria_id: null,
      data_vencimento: String(c.vencimento).split("T")[0],
    });
  }

  if (rows.length === 0) {
    return { tenant_id: tenantId, skipped: false, itens: 0 };
  }

  const { error: insErr } = await supabaseAdmin.from("fin_previsao_snapshot").insert(rows);
  if (insErr) throw new Error(`Falha ao gravar snapshot: ${insErr.message}`);

  return {
    tenant_id: tenantId,
    skipped: false,
    itens: rows.length,
    fin_transacoes: transacoes?.length || 0,
    iptv_a_receber: clientesAReceber?.length || 0,
  };
}

export async function POST(req: NextRequest) {
  const isCron = isCronRequest(req, "FIN_SNAPSHOT_CRON_SECRET");

  const body = await req.json().catch(() => ({}));
  const anoMes = String(body?.ano_mes || "").trim() || currentAnoMesSP();
  const force = body?.force === true;

  if (!/^\d{4}-\d{2}$/.test(anoMes)) {
    return NextResponse.json({ ok: false, error: "ano_mes inválido (esperado YYYY-MM)" }, { status: 400 });
  }

  if (isCron) {
    const { data: tenants, error } = await supabaseAdmin.from("tenants").select("id");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const results = [];
    for (const t of tenants || []) {
      try {
        results.push(await snapshotTenant(t.id, anoMes, force));
      } catch (e: any) {
        results.push({ tenant_id: t.id, error: e.message });
      }
    }
    return NextResponse.json({ ok: true, ano_mes: anoMes, results });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  const { data: members } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id);
  const tenantIds = Array.from(new Set((members || []).map((m) => m.tenant_id)));
  if (tenantIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Usuário sem tenant" }, { status: 400 });
  }

  const results = [];
  for (const tid of tenantIds) {
    try {
      results.push(await snapshotTenant(tid, anoMes, force));
    } catch (e: any) {
      results.push({ tenant_id: tid, error: e.message });
    }
  }
  return NextResponse.json({ ok: true, ano_mes: anoMes, results });
}
