// app/api/fx/sync/route.ts
// Atualiza tenant_fx_rates 1x por dia — pedido do Márcio, 05/08/2026: antes
// isso rodava embutido no login (app/login/actions.ts), disparado toda vez
// que alguém logava; virou uma rota de cron dedicada, chamada 1x de
// madrugada. Nenhum outro lugar do sistema chama /api/fx diretamente — todo
// mundo (recarga, cadastro de cliente/servidor/revenda, snapshot financeiro)
// já lê a taxa congelada de tenant_fx_rates, então isso aqui é o ÚNICO ponto
// que fala com os provedores externos (Frankfurter/AwesomeAPI via /api/fx).
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isCronRequest } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchFx(
  base: "USD" | "EUR",
  to: "BRL",
  origin: string,
): Promise<{ rate: number; date: string }> {
  const url = `${origin}/api/fx?base=${encodeURIComponent(base)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX API falhou (${res.status})`);

  const json: unknown = await res.json();
  if (typeof json !== "object" || json === null) {
    throw new Error("Resposta inválida da API FX");
  }

  const obj = json as Record<string, unknown>;
  const rate = obj["rate"];
  const date = obj["date"];

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Resposta inválida da API FX (rate)");
  }

  return {
    rate,
    date: typeof date === "string" && date.length > 0 ? date : todayISO(),
  };
}

async function syncTenantFx(tenantId: string, origin: string) {
  const today = todayISO();

  // ✅ Mesma trava de idempotência de antes — se algum outro tick já
  // atualizou hoje (ou o cron rodar 2x por engano), não bate na API de novo.
  const { data: existingFx, error: fxErr } = await supabaseAdmin
    .from("tenant_fx_rates")
    .select("as_of_date")
    .eq("tenant_id", tenantId)
    .eq("as_of_date", today)
    .limit(1);

  if (fxErr) throw new Error(fxErr.message);
  if (existingFx && existingFx.length > 0) {
    return { tenant_id: tenantId, skipped: true, reason: "já tem taxa de hoje" };
  }

  const [usd, eur] = await Promise.all([
    fetchFx("USD", "BRL", origin),
    fetchFx("EUR", "BRL", origin),
  ]);

  const { error: rpcErr } = await supabaseAdmin.rpc("set_tenant_fx_rates", {
    p_tenant_id: tenantId,
    p_usd_to_brl: usd.rate,
    p_eur_to_brl: eur.rate,
    p_as_of_date: today,
    p_source: "frankfurter",
  });
  if (rpcErr) throw new Error(rpcErr.message);

  return { tenant_id: tenantId, skipped: false, usd_to_brl: usd.rate, eur_to_brl: eur.rate };
}

export async function POST(req: NextRequest) {
  if (!isCronRequest(req, "FX_SYNC_CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin =
    String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim() ||
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;

  const { data: tenants, error } = await supabaseAdmin.from("tenants").select("id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results = [];
  for (const t of tenants || []) {
    try {
      results.push(await syncTenantFx(t.id, origin));
    } catch (e: any) {
      results.push({ tenant_id: t.id, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, results });
}

// ✅ GET também aceito (mesma convenção de envio_programado/route.ts) — cron
// externo bate com o método que for mais simples de configurar.
export async function GET(req: NextRequest) {
  if (!isCronRequest(req, "FX_SYNC_CRON_SECRET")) {
    return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
  }
  return POST(req);
}
