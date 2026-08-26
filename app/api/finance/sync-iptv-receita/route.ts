// app/api/finance/sync-iptv-receita/route.ts
//
// Chamada automaticamente ao final de toda recarga de revenda
// (recarga_revenda.tsx), achado 26/08/2026 — mesmo espírito de
// sync-iptv-despesa, mas pro lado RECEITA ("IPTV - Rendimentos"). O lado
// cliente (renovação de assinatura) já dispara isso direto do servidor
// (lib/client-portal/fulfillment.ts, sem precisar desta rota) — essa rota
// cobre o caminho client-side que faltava: recarga de créditos de revenda.
// Ver lib/finance/sync-iptv-lancamentos.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { syncIptvRendimentos } from "@/lib/finance/sync-iptv-lancamentos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id } = auth;

  const result = await syncIptvRendimentos(supabase, tenant_id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
