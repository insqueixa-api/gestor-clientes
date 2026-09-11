// app/api/admin/settings/proxybr/connection-string/route.ts
// ✅ 11/09/2026, pedido do Márcio: string de conexão do proxy residencial
// (host:porta:usuário:senha, o que a própria ProxyBR mostra no painel deles)
// editável direto no card — GET lê o valor salvo, PUT salva e propaga pros
// 2 lugares que realmente usam isso: a Vercel (lido ao vivo via
// lib/integrations/gerenciaapp-proxy.ts, sem precisar de redeploy) e a VM
// do WhatsApp (via chamada pro novo POST /system/set-proxy do
// whatsapp-service, que reinicia sozinha pra aplicar).
import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";
import { parseProxyBrRaw, PROXYBR_CONFIG_KEY } from "@/lib/integrations/gerenciaapp-proxy";

export const dynamic = "force-dynamic";

function adminSb() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const { data } = await adminSb()
    .from("system_config")
    .select("config_value, updated_at")
    .eq("config_key", PROXYBR_CONFIG_KEY)
    .maybeSingle<{ config_value: string | null; updated_at: string | null }>();

  return NextResponse.json({ ok: true, raw: data?.config_value || "", updated_at: data?.updated_at || null });
}

export async function PUT(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const body = await req.json().catch(() => ({} as any));
  const raw = String(body?.raw || "").trim();

  const parsed = parseProxyBrRaw(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: "Formato inválido — esperado host:porta:usuario:senha (ex: proxy22-br-hz.ipbr.pro:10001:usuario:senha)." },
      { status: 400 },
    );
  }

  const { error: dbErr } = await adminSb()
    .from("system_config")
    .upsert({ config_key: PROXYBR_CONFIG_KEY, config_value: raw, updated_at: new Date().toISOString() }, { onConflict: "config_key" });
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // ✅ Propaga pra VM — best-effort: a gravação em system_config (lado
  // Vercel) já é o mais importante e já aconteceu acima; se a VM estiver
  // fora do ar ou a chamada falhar, avisa mas não desfaz o que já foi salvo.
  let vmUpdated = false;
  let vmError: string | null = null;
  const waBase = String(process.env.UNIGESTOR_WA_BASE_URL || "").trim();
  const waToken = String(process.env.UNIGESTOR_WA_TOKEN || "").trim();
  if (waBase && waToken) {
    try {
      const vmRes = await fetch(`${waBase}/system/set-proxy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl: `http://${parsed.user}:${parsed.pass}@${parsed.host}:${parsed.port}` }),
        signal: AbortSignal.timeout(15_000),
      });
      const vmJson = await vmRes.json().catch(() => ({}));
      if (vmRes.ok && vmJson?.ok) vmUpdated = true;
      else vmError = vmJson?.error || `HTTP ${vmRes.status}`;
    } catch (e: any) {
      vmError = e?.message || "Falha ao chamar a VM";
    }
  } else {
    vmError = "UNIGESTOR_WA_BASE_URL/UNIGESTOR_WA_TOKEN não configurados";
  }

  return NextResponse.json({ ok: true, vmUpdated, vmError });
}
