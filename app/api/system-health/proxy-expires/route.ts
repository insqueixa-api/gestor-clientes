// app/api/system-health/proxy-expires/route.ts
// ✅ 31/08/2026 — atualiza a data de validade do proxy dedicado (ProxyBR)
// direto do painel "Sistema", sem precisar mexer em env var/redeploy toda
// vez que renovar. Ver app/api/cron/system-health-check/route.ts
// (getProxyExpiresAt) pra onde esse valor é lido.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const expiresAt = String(body?.expiresAt || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    return NextResponse.json({ error: "Data inválida (formato AAAA-MM-DD)" }, { status: 400 });
  }

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const sb = createClient(supabaseUrl, serviceKey);

  const { error } = await sb.from("system_config").upsert(
    { config_key: "proxy_expires_at", config_value: expiresAt, updated_at: new Date().toISOString() },
    { onConflict: "config_key" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
