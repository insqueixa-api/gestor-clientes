// app/api/integrations/appativa/sync-credits/route.ts
//
// Sincroniza o saldo de créditos da Appativa (GET /api/creditos-disponiveis)
// e grava em api_integrations.credits_available — mesmo padrão de
// servers.credits_available, mas pra parceiros de API. Disparado pelo botão
// "Sincronizar" na aba Parceiros hoje; pensado pra também ser chamado
// depois de cada ativação quando essa parte for implementada (achado do
// Márcio: "assim como acontece com as renovações e o sync de saldo do
// servidor").
//
// A chave de API é SEMPRE lida daqui do banco (nunca de env var) — pode
// rotacionar a qualquer momento do lado do parceiro (ver
// docs/sql/api_integrations_partners.sql).
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { notify } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

// ✅ Limiar próprio do parceiro (diferente do <=15 usado pros servidores
// IPTV, ver lib/client-portal/fulfillment.ts) — pedido do Márcio.
// ⚠️ TEMPORÁRIO (25/08/2026): 40 só pra testar que o alerta dispara de
// verdade — valor final combinado é 5. Voltar pra 5 depois do teste.
const LOW_CREDITS_THRESHOLD = 40;

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id } = auth;

  const body = await req.json().catch(() => ({} as any));
  const integration_id = String(body?.integration_id || "").trim();
  if (!integration_id) {
    return NextResponse.json({ ok: false, error: "integration_id é obrigatório" }, { status: 400 });
  }

  const { data: integration, error: fetchErr } = await supabase
    .from("api_integrations")
    .select("id, tenant_id, provider, label, api_key")
    .eq("id", integration_id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (fetchErr || !integration) {
    return NextResponse.json({ ok: false, error: "Parceiro não encontrado" }, { status: 404 });
  }

  if (integration.provider !== "APPATIVA") {
    return NextResponse.json({ ok: false, error: "Parceiro não suporta sincronização de créditos" }, { status: 400 });
  }

  const apiKey = String(integration.api_key || "").trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Chave de API não cadastrada para este parceiro" }, { status: 400 });
  }

  let creditsData: any;
  try {
    const res = await fetch("https://api.ativeapp.com/api/creditos-disponiveis", {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    });
    creditsData = await res.json().catch(() => ({} as any));
    if (!res.ok || creditsData?.sucesso !== true) {
      return NextResponse.json(
        { ok: false, error: creditsData?.erro || creditsData?.message || "Falha ao consultar créditos" },
        { status: 502 },
      );
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Falha ao conectar com a API da Appativa" }, { status: 502 });
  }

  const credits = Number(creditsData?.creditos_disponiveis);

  const { error: updErr } = await supabase
    .from("api_integrations")
    .update({ credits_available: credits, credits_last_sync_at: new Date().toISOString() })
    .eq("id", integration.id)
    .eq("tenant_id", tenant_id);

  if (updErr) {
    return NextResponse.json({ ok: false, error: "Falha ao salvar saldo" }, { status: 500 });
  }

  if (Number.isFinite(credits) && credits < LOW_CREDITS_THRESHOLD) {
    try {
      await notify({
        tenantId: tenant_id,
        type: "saldo_baixo",
        title: "🪫 Saldo Baixo — Parceiro",
        message: `O parceiro "${integration.label}" está com apenas ${credits} crédito(s). Recarregue para evitar interrupção nas ativações.`,
        link: "/admin/settings/api-server",
        sourceId: integration.id,
      });
    } catch (e) {
      console.error("[appativa/sync-credits] falha ao notificar saldo baixo", (e as any)?.message);
    }
  }

  return NextResponse.json({ ok: true, credits_available: credits });
}
