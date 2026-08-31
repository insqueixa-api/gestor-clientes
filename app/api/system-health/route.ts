// app/api/system-health/route.ts
// ✅ 31/08/2026 — leitura pura do cache (system_health_checks), zero
// chamada externa. Quem atualiza os dados é sempre o pg_cron de 5min ou o
// botão "Sincronizar agora" (que chama /api/cron/system-health-check
// direto) — essa rota aqui só existe pra ser barata de abrir várias vezes
// ao dia sem gerar tráfego externo nenhum.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const GROUP_LABELS: Record<string, string> = {
  infra: "Infraestrutura (VMs + Proxy)",
  whatsapp: "WhatsApp",
  externos: "Serviços externos",
};
const GROUP_ORDER = ["whatsapp", "infra", "externos"];

export async function GET(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const [healthRes, configRes] = await Promise.all([
    sb.from("system_health_checks").select("check_key, label, group_key, status, detail, checked_at"),
    sb.from("system_config").select("config_value").eq("config_key", "proxy_expires_at").maybeSingle<{ config_value: string | null }>(),
  ]);
  const { data, error } = healthRes;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const proxyExpiresAt = configRes.data?.config_value || null;

  const groups = GROUP_ORDER.map((key) => {
    const items = (data || [])
      .filter((r) => r.group_key === key)
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    const status = items.some((i) => i.status === "fail")
      ? "fail"
      : items.some((i) => i.status === "warn")
        ? "warn"
        : items.length > 0
          ? "ok"
          : "empty";
    return { key, label: GROUP_LABELS[key] || key, items, status };
  }).filter((g) => g.items.length > 0);

  const lastCheckedAt = (data || []).reduce<string | null>((max, r) => {
    if (!r.checked_at) return max;
    return !max || r.checked_at > max ? r.checked_at : max;
  }, null);

  return NextResponse.json({ groups, lastCheckedAt, proxyExpiresAt });
}
