// app/api/admin/apps/check-appativa-status/route.ts
//
// Botão "Ver status" no modal "Concluir renovação" da Auditoria — checagem
// manual sob demanda pra quando a ativação via Appativa ainda está
// pendente (achado 25/08/2026, pedido do Márcio: sem volume que justifique
// um cron recorrente — as 2 checagens automáticas de markAppRenewalPaid
// já cobrem o caso comum; esse botão cobre o resto, sem precisar o admin
// entrar manualmente no painel/app da Appativa pra conferir).
//
// Só reconsulta e conclui se for o caso — mesma lógica de
// resolveAppativaAppRenewal usada pelo webhook e pelas checagens
// automáticas, nunca duplicada.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { resolveAppativaAppRenewal } from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase: supabaseAdmin, tenant_id: authTenantId } = auth;

  const body = await req.json().catch(() => ({} as any));
  const tenantId = String(body?.tenant_id || "").trim();
  const paymentId = String(body?.payment_id || "").trim();

  if (!tenantId || !paymentId) {
    return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400 });
  }
  if (tenantId !== authTenantId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const result = await resolveAppativaAppRenewal(supabaseAdmin, tenantId, paymentId);
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
