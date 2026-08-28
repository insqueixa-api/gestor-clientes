// app/api/cron/watchdog/route.ts
// ✅ 28/08/2026: 1 check por dia (não a cada 30min — pedido do Márcio: todos
// os crons rodam de madrugada, não faz sentido ficar checando o dia
// inteiro), rodando alguns minutos depois do último job esperado da janela
// (fx-sync, 08:50 UTC). Junta TODOS os jobs "velhos demais" num único
// alerta do Sentry (kind:cron_watchdog/daily-summary — lib/cron-health.ts),
// em vez de 1 issue por job — o sino mostra 1 coisa só, com a lista de quem
// falhou dentro.
//
// A lista de jobs e a lógica de "o que conta como velho demais"
// (computeStaleJobs) moraram pra lib/cron-health.ts — é a MESMA usada pelo
// resolve instantâneo que reportCronHealth() dispara quando um job volta a
// rodar OK, pra nunca haver desacordo entre "o vigia diário achou X velho"
// e "o resolve instantâneo achou X saudável".
import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/internal-auth";
import {
  computeStaleJobs,
  fireDailySummaryAlert,
  getSummaryAlertActive,
  resolveDailySummaryAlert,
  setSummaryAlertActive,
} from "@/lib/cron-health";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isCronRequest(req, "EPG_SYNC_CRON_SECRET")) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const staleJobs = await computeStaleJobs();
  const wasActive = await getSummaryAlertActive();

  if (staleJobs.length > 0) {
    fireDailySummaryAlert(staleJobs);
    await setSummaryAlertActive(true);
  } else if (wasActive) {
    await resolveDailySummaryAlert();
    await setSummaryAlertActive(false);
  }

  return NextResponse.json({ ok: true, staleJobs });
}
