// app/api/finance/sync-iptv-despesa/route.ts
//
// Chamada automaticamente ao final de toda recarga de servidor
// (recarga_servidor.tsx), achado 26/08/2026 — antes a despesa de recarga só
// era recalculada quando alguém abria a tela Financeiro Pessoal, deixando a
// Evolução Consolidada e a lista de lançamentos desatualizadas até a
// próxima visita. Também chamada pela própria tela Financeiro Pessoal pro
// mês que está aberto (body { ano_mes: "YYYY-MM" }; sem body = mês atual).
// Ver lib/finance/sync-iptv-lancamentos.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { syncIptvRecargaServidores } from "@/lib/finance/sync-iptv-lancamentos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id } = auth;

  const body = await req.json().catch(() => ({}));
  // Mês atual em horário de Brasília (a Vercel roda em UTC — às 21h do
  // último dia já seria "mês que vem").
  const mesAtualSP = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  })
    .format(new Date())
    .slice(0, 7);
  const pedido = String(body?.ano_mes || "");
  const anoMes = /^\d{4}-\d{2}$/.test(pedido) ? pedido : mesAtualSP;
  const [y, m] = anoMes.split("-").map(Number);
  const dateObj = new Date(y, m - 1, 15, 12);

  const result = await syncIptvRecargaServidores(supabase, tenant_id, dateObj);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
