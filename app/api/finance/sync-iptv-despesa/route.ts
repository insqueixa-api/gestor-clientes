// app/api/finance/sync-iptv-despesa/route.ts
//
// Chamada automaticamente ao final de toda recarga de servidor
// (recarga_servidor.tsx), achado 26/08/2026 — antes "IPTV - Recarga de
// Servidores" só era recalculado quando alguém abria a tela Financeiro
// Pessoal, deixando a Evolução Consolidada e a lista de lançamentos
// desatualizadas até a próxima visita. Ver lib/finance/sync-iptv-lancamentos.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { syncIptvRecargaServidores } from "@/lib/finance/sync-iptv-lancamentos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id } = auth;

  const result = await syncIptvRecargaServidores(supabase, tenant_id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
