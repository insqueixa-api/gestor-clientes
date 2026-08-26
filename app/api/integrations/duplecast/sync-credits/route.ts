// app/api/integrations/duplecast/sync-credits/route.ts
//
// Sincroniza os "créditos disponíveis" do parceiro Duplecast — códigos de
// ativação AINDA NÃO usados na conta de revenda (achado 26/08/2026, pedido
// do Márcio: quer migrar o Duplecast da Appativa, mais cara, pra cá).
// Chama a VM (whatsapp-service/src/duplecastClient.js), que já resolve o
// Cloudflare via FlareSolverr e loga como revenda (login_email/
// login_password salvos aqui — não mais usados pro fluxo por dispositivo,
// que hoje usa mac+device_key). Mesmo padrão de app/api/integrations/
// appativa/sync-credits/route.ts, só que a fonte é a VM, não uma API key.
//
// ⚠️ Achado 26/08/2026 (Márcio, recarga não persistia): o modal de recarga
// tentava gravar credit_unit_price direto do navegador (supabaseBrowser) —
// falhava em silêncio (sem erro visível, sem persistir). Movido pra cá,
// junto com credits_available, na MESMA chamada server-side (service role,
// sem depender de RLS via sessão do navegador) — o modal agora só manda o
// valor calculado no body.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminTenant } from "@/lib/api/auth";
import { notify, resolveNotification } from "@/lib/notifications/notify";

// ✅ Mesmo limiar do parceiro Appativa (lib/integrations/appativa.ts) —
// pedido do Márcio 26/08/2026: "habilitou o sino tbm para <5, igual o
// outro parceiro?".
const LOW_CREDITS_THRESHOLD = 5;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;
  const { supabase, tenant_id } = auth;

  const body = await req.json().catch(() => ({} as any));
  const integration_id = String(body?.integration_id || "").trim();
  if (!integration_id) {
    return NextResponse.json({ ok: false, error: "integration_id é obrigatório" }, { status: 400 });
  }
  // ✅ Valor por código dessa recarga (opcional — só vem preenchido quando
  // chamado pelo modal "Nova Recarga", ver recarga_duplecast_modal.tsx).
  const rawUnitPrice = body?.credit_unit_price;
  const creditUnitPrice =
    rawUnitPrice != null && Number.isFinite(Number(rawUnitPrice)) ? Number(rawUnitPrice) : null;

  const { data: integ, error: fetchErr } = await supabase
    .from("api_integrations")
    .select("id, label, login_email, login_password, api_url")
    .eq("id", integration_id)
    .eq("tenant_id", tenant_id)
    .eq("provider", "DUPLECAST")
    .maybeSingle();

  if (fetchErr || !integ) {
    return NextResponse.json({ ok: false, error: "Parceiro não encontrado" }, { status: 404 });
  }
  if (!integ.login_email || !integ.login_password || !integ.api_url) {
    return NextResponse.json(
      { ok: false, error: "E-mail, senha e link do painel precisam estar preenchidos nesse parceiro." },
      { status: 400 },
    );
  }

  const vmBaseUrl = process.env.UNIGESTOR_WA_BASE_URL;
  const vmToken = process.env.UNIGESTOR_WA_TOKEN;
  if (!vmBaseUrl || !vmToken) {
    return NextResponse.json({ ok: false, error: "VM não configurada" }, { status: 500 });
  }

  let vmJson: any;
  try {
    const siteRoot = new URL(integ.api_url).origin;
    const vmRes = await fetch(`${vmBaseUrl.replace(/\/$/, "")}/duplecast/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${vmToken}` },
      body: JSON.stringify({
        action: "list_codes",
        baseUrl: siteRoot,
        username: integ.login_email,
        password: integ.login_password,
      }),
      signal: AbortSignal.timeout(58000),
    });
    vmJson = await vmRes.json().catch(() => ({}));
    if (!vmRes.ok || !vmJson?.ok) {
      return NextResponse.json(
        { ok: false, error: vmJson?.error || `Falha na VM (HTTP ${vmRes.status}).` },
        { status: 502 },
      );
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Falha ao conectar com a VM." }, { status: 502 });
  }

  const credits = Number(vmJson.unused);
  if (!Number.isFinite(credits)) {
    return NextResponse.json({ ok: false, error: "A VM não devolveu um número de códigos disponíveis." }, { status: 502 });
  }

  const { error: updErr } = await supabase
    .from("api_integrations")
    .update({
      credits_available: credits,
      credits_last_sync_at: new Date().toISOString(),
      ...(creditUnitPrice != null ? { credit_unit_price: creditUnitPrice } : {}),
    })
    .eq("id", integ.id)
    .eq("tenant_id", tenant_id);

  if (updErr) {
    return NextResponse.json({ ok: false, error: "Falha ao salvar saldo" }, { status: 500 });
  }

  // ✅ Sino de saldo baixo (26/08/2026, pedido do Márcio: "habilitou tbm pro
  // Duplecast, igual o outro parceiro?") — mesmo limiar/mensagem/padrão de
  // lib/integrations/appativa.ts (syncAppativaCredits), fail-soft.
  if (credits < LOW_CREDITS_THRESHOLD) {
    try {
      await notify({
        tenantId: tenant_id,
        type: "saldo_baixo",
        title: "🪫 Saldo Baixo — Parceiro",
        message: `O parceiro "${integ.label}" está com apenas ${credits} código(s) disponível(is). Recarregue para evitar interrupção nas ativações.`,
        link: "/admin/settings/api-server",
        sourceId: integ.id,
      });
    } catch {
      // não bloqueia o sync por falha na notificação
    }
  } else {
    try {
      await resolveNotification(tenant_id, "saldo_baixo", integ.id);
    } catch {
      // não bloqueia o sync por falha ao resolver a notificação
    }
  }

  return NextResponse.json({ ok: true, credits_available: credits, all: vmJson.all, used: vmJson.used });
}
