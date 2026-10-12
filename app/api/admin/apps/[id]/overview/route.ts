// app/api/admin/apps/[id]/overview/route.ts
// ✅ 12/10/2026, pedido do Márcio — página do aplicativo
// (/admin/gerenciador/aplicativo/[id]). Junta num só lugar: cadastro e
// integração do app, quem usa (clientes, MAC, vencimento), pagamentos com
// custo e margem estimados, ativações em confiança e histórico de
// configurações. Só leitura.
//
// Custo por ativação (estimado com os preços ATUAIS dos parceiros):
//   • Appativa: créditos do app (apps.appativa_meta.valor) × valor do
//     crédito (api_integrations APPATIVA.credit_unit_price)
//   • DupleCast: 1 código (api_integrations DUPLECAST.credit_unit_price),
//     a não ser que o app renove pela Appativa (apps.renewal_source)
//   • GerenciaApp: assinatura fixa — sem custo por ativação
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";
import { buildAppOverview } from "@/lib/apps/app-overview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const sb = createClient(String(process.env.NEXT_PUBLIC_SUPABASE_URL), String(process.env.SUPABASE_SERVICE_ROLE_KEY), {
    auth: { persistSession: false },
  });
  const out = await buildAppOverview(sb, auth.tenant_id, id);
  return NextResponse.json(out.body, { status: out.status });
}
