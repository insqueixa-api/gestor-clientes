// app/api/cron/appativa-payment-watchdog/route.ts
//
// ✅ 11/09/2026, pedido do Márcio (projeto de tirar o Fluid Compute — rotas
// de pagamento precisam caber em 60s no total). A checagem síncrona de
// confirmação da Appativa dentro de `after()` (em lib/client-portal/
// fulfillment.ts) foi encurtada pra ~35s (era ~75s) pra caber no orçamento —
// mas medição real (11/09/2026) mostrou que NENHUMA das confirmações reais
// já vistas caiu dentro de qualquer janela razoável dentro de uma única
// invocação (uma levou 124s, outra ~93min). Este vigia é quem cobre o resto.
//
// Rodando de 1 em 1 minuto (pg_cron), mas SÓ consulta o próprio banco
// primeiro — se não achar nenhuma pendência, sai sem nunca bater na API da
// Appativa. Como o volume real é ínfimo (só 3-4 ativações Appativa em toda a
// história da conta até aqui), na prática isso roda "vazio" quase sempre —
// pedido explícito do Márcio: "não quero que ele fique martelando a
// Appativa, só checar pendência".
//
// Janela de 3h (generosa, cobre com folga o pior caso já medido, ~93min) —
// depois disso, fica pro botão manual "Ver status" (Auditoria) resolver,
// igual já era antes desse vigia existir.
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isCronRequest } from "@/lib/internal-auth";
import { resolveAppativaAppRenewal, prodLog } from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";
// ✅ 12/09/2026: 60s → 120s, Fluid Compute mantido de vez — sem mais teto de
// 60s do Hobby. Na prática quase sempre roda "vazio" (sai antes de bater na
// Appativa), então isso é só folga extra pro lote de até 20 pendências.
export const maxDuration = 120;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function handle(req: Request) {
  if (!isCronRequest(req, "APPATIVA_WATCHDOG_CRON_SECRET")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 1) só consulta o próprio banco — barato, nunca bate na API da Appativa
  // se não achar nada.
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: pending, error } = await supabaseAdmin
    .from("client_portal_payments")
    .select("id, tenant_id")
    .eq("fulfillment_status", "manual_pending")
    .not("appativa_historico_id", "is", null)
    .gte("created_at", threeHoursAgo)
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!pending?.length) {
    return Response.json({ ok: true, pendentes: 0 });
  }

  // 2) achou pendência de verdade — aí sim reconsulta cada uma.
  let resolved = 0;
  for (const row of pending) {
    try {
      const result = await resolveAppativaAppRenewal(supabaseAdmin, row.tenant_id, row.id);
      if (result.outcome === "done") resolved++;
    } catch (e: any) {
      prodLog("appativa_watchdog.check_failed", { paymentId: row.id, message: e?.message });
    }
  }

  return Response.json({ ok: true, pendentes: pending.length, resolvidos: resolved });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
