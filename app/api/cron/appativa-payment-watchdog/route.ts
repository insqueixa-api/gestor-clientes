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
// ✅ 17/09/2026, pedido do Márcio ("não tem por que ficar martelando o tempo
// todo... podemos espaçar isso também"): o pg_cron em si passou de 1 em 1
// minuto pra 2 em 2 (mesma mudança na função Postgres
// appativa_payment_dispatch_check, que já decide ali se vale a pena nem
// invocar esta rota) — e o intervalo de checagem de CADA pendência cresce
// com a idade dela: 0-30min a cada 2min, 30-60min a cada 4min, 1-2h a cada
// 5min, 2-3h a cada 10min. Isso reduz tanto o Active CPU da Vercel quanto
// as chamadas reais na API da Appativa, sem perder confiabilidade — o caso
// comum (confirma em segundos/poucos minutos) continua rápido, só o caso
// raro/travado (ex: rejeição que precisa de correção manual) passa a ser
// checado com menos frequência.
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

// ✅ Espelha o mesmo cálculo da função Postgres appativa_payment_dispatch_check
// — "cruzou um múltiplo de N minutos desde o tick anterior" em vez de
// `idade % N` direto, pra tolerar o jitter normal do pg_cron (roda a cada
// CRON_TICK_MIN minutos, não exatamente no segundo 0).
const CRON_TICK_MIN = 2;
function isDueForCheck(createdAt: string): boolean {
  const ageMin = (Date.now() - new Date(createdAt).getTime()) / 60_000;
  const intervalMin = ageMin < 30 ? 2 : ageMin < 60 ? 4 : ageMin < 120 ? 5 : 10;
  return Math.floor(ageMin / intervalMin) > Math.floor((ageMin - CRON_TICK_MIN) / intervalMin);
}

async function handle(req: Request) {
  if (!isCronRequest(req, "APPATIVA_WATCHDOG_CRON_SECRET")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 1) só consulta o próprio banco — barato, nunca bate na API da Appativa
  // se não achar nada.
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: pending, error } = await supabaseAdmin
    .from("client_portal_payments")
    .select("id, tenant_id, created_at")
    .eq("fulfillment_status", "manual_pending")
    .not("appativa_historico_id", "is", null)
    // ✅ 17/09/2026, achado do Márcio: uma vez que a Appativa já respondeu
    // com uma rejeição de verdade (fulfillment_error preenchido por
    // resolveAppativaAppRenewal quando o status é "Incorreto"/"Reprovado"),
    // continuar consultando de 1 em 1 min é bater à toa na API deles — a
    // rejeição já é definitiva, só um reenvio manual (admin corrige o dado e
    // clica "Reenviar via Appativa") gera um historico_id novo pra valer a
    // pena checar de novo. Isso é exatamente o "não martelar a Appativa"
    // que esse vigia já promete no comentário do topo do arquivo.
    .is("fulfillment_error", null)
    .gte("created_at", threeHoursAgo)
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!pending?.length) {
    return Response.json({ ok: true, pendentes: 0 });
  }

  // 2) dentre as pendências reais, só processa quem já "venceu" o próprio
  // intervalo de checagem (isDueForCheck) — evita gastar chamada de API da
  // Appativa numa pendência que só apareceu aqui porque OUTRA pendência,
  // mais nova, obrigou este tick a de fato invocar a rota.
  const due = pending.filter((row) => isDueForCheck(row.created_at));

  let resolved = 0;
  for (const row of due) {
    try {
      const result = await resolveAppativaAppRenewal(supabaseAdmin, row.tenant_id, row.id);
      if (result.outcome === "done") resolved++;
    } catch (e: any) {
      prodLog("appativa_watchdog.check_failed", { paymentId: row.id, message: e?.message });
    }
  }

  return Response.json({ ok: true, pendentes: pending.length, checadas: due.length, resolvidos: resolved });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
