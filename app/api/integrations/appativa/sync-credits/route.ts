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
  // ✅ Valor por crédito dessa recarga (opcional — só vem preenchido quando
  // chamado pelo modal "Nova Recarga", ver recarga_appativa_modal.tsx).
  // Achado 26/08/2026 (Márcio, recarga não persistia): o modal tentava
  // gravar isso direto do navegador (supabaseBrowser) — falhava em
  // silêncio. Gravado aqui, server-side, junto com o resto do sync.
  const rawUnitPrice = body?.credit_unit_price;
  const creditUnitPrice =
    rawUnitPrice != null && Number.isFinite(Number(rawUnitPrice)) ? Number(rawUnitPrice) : null;
  // ✅ Lembra os valores digitados pra pré-preencher a próxima "Nova Recarga"
  // (26/08/2026, pedido do Márcio — ver docs/sql/
  // api_integrations_last_recharge_meta.sql). Best-effort, à parte do
  // update crítico de credit_unit_price acima.
  const lastRechargeMeta = body?.last_recharge_meta ?? null;

  const result = await syncAppativaCredits(auth.supabase, tenant_id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  if (creditUnitPrice != null) {
    await auth.supabase
      .from("api_integrations")
      .update({ credit_unit_price: creditUnitPrice })
      .eq("id", integration_id)
      .eq("tenant_id", tenant_id);
  }

  if (lastRechargeMeta) {
    try {
      await auth.supabase
        .from("api_integrations")
        .update({ last_recharge_meta: lastRechargeMeta })
        .eq("id", integration_id)
        .eq("tenant_id", tenant_id);
    } catch {
      // best-effort — não bloqueia o sync se a coluna ainda não existir
    }
  }

  return NextResponse.json({ ok: true, credits_available: result.credits });
}
