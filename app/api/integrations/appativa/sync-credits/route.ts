// app/api/integrations/appativa/sync-credits/route.ts
//
// Sincroniza o saldo de créditos da Appativa (GET /api/creditos-disponiveis)
// e grava em api_integrations.credits_available — mesmo padrão de
// servers.credits_available, mas pra parceiros de API. Disparado pelo botão
// "Sincronizar" na aba Parceiros, e também automaticamente (via
// syncAppativaCredits, lib/integrations/appativa.ts) depois de toda
// solicitação/reenvio de ativação real — extraído pra lá em 26/08/2026.
//
// A chave de API é SEMPRE lida daqui do banco (nunca de env var) — pode
// rotacionar a qualquer momento do lado do parceiro (ver
// docs/sql/api_integrations_partners.sql).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { syncAppativaCredits } from "@/lib/integrations/appativa";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { tenant_id } = auth;

  const body = await req.json().catch(() => ({} as any));
  const integration_id = String(body?.integration_id || "").trim();
  if (!integration_id) {
    return NextResponse.json({ ok: false, error: "integration_id é obrigatório" }, { status: 400 });
  }

  const result = await syncAppativaCredits(auth.supabase, tenant_id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, credits_available: result.credits });
}
