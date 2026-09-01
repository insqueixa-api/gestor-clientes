// app/api/cron/whatsapp-status-check/route.ts
// ✅ 01/09/2026 — substitui o antigo pg_cron de 5min que rodava o painel
// Sistema inteiro (achado: ~288 invocações/dia à toa, o Márcio só queria
// aquele check sob demanda — ver docs/sql/billing_dispatch_smart_check.sql).
// Esta rota é minúscula (só WhatsApp) e só é chamada pelo próprio
// billing_dispatch_check() direto do Postgres via pg_net, e só quando: (a)
// existe job de cobrança pronto pra disparar E (b) o cache de 10min de
// alguma sessão necessária já venceu. Nunca roda "no vazio".
import crypto from "crypto";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getWAContextOrCron, proxyVM } from "@/lib/whatsapp/wa-context";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Mesmo mecanismo de app/api/whatsapp/* (x-cron-secret + CRON_CONTROL_SECRET).
function isSystemCronRequest(req: Request): boolean {
  const secret = process.env.CRON_CONTROL_SECRET || "";
  const header = req.headers.get("x-cron-secret") || "";
  if (!secret || !header || header.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret));
}

// ✅ 428/408 no log do WhatsApp reconectam sozinhos na maioria das vezes —
// só "connected" ou "connecting" contam como saudável (mesmo critério do
// painel Sistema).
async function checkSession(req: Request, session: 1 | 2) {
  const label = session === 1 ? "WhatsApp — Principal" : "WhatsApp — Secundário";
  const statusSeVaziou = session === 1 ? "fail" : "warn";

  const ctx = await getWAContextOrCron(req, session);
  if (!ctx) {
    return { check_key: `whatsapp_${session}`, label, group_key: "whatsapp", status: statusSeVaziou, detail: "Configuração ausente (env vars)" };
  }

  try {
    const result = await proxyVM(ctx, "/status", { method: "GET" });
    const status = result.json?.status as string | undefined;
    const saudavel = status === "connected" || status === "connecting";
    return {
      check_key: `whatsapp_${session}`,
      label,
      group_key: "whatsapp",
      status: saudavel ? "ok" : statusSeVaziou,
      detail: saudavel ? (status === "connecting" ? "Reconectando…" : "") : "Desconectado — precisa escanear QR Code",
    };
  } catch (e: any) {
    return { check_key: `whatsapp_${session}`, label, group_key: "whatsapp", status: statusSeVaziou, detail: e?.message?.slice(0, 200) || "Falha ao consultar a VM" };
  }
}

export async function POST(req: Request) {
  if (!isSystemCronRequest(req)) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requested: number[] = Array.isArray(body?.sessions) && body.sessions.length ? body.sessions : [1, 2];
  const wanted = requested.filter((s) => s === 1 || s === 2) as (1 | 2)[];

  const results = await Promise.all(wanted.map((s) => checkSession(req, s)));

  const rows = results.map((r) => ({ ...r, detail: r.detail.slice(0, 300), checked_at: new Date().toISOString() }));
  const { error } = await supabaseAdmin.from("system_health_checks").upsert(rows, { onConflict: "check_key" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, checked: rows.length });
}
