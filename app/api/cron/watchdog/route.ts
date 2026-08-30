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
import { createClient } from "@supabase/supabase-js";
import {
  computeStaleJobs,
  fireDailySummaryAlert,
  getSummaryAlertActive,
  resolveDailySummaryAlert,
  setSummaryAlertActive,
} from "@/lib/cron-health";
import { notify, resolveNotification } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

// ✅ 30/08/2026, achado do Márcio: o vigia só alertava no Sentry (externo) —
// nada aparecia no sino do painel. Sentry continua (ele lê e-mail/Sentry),
// mas agora também vira notificação de verdade, igual automacao_falha e
// whatsapp_desconectado — sourceId fixo (1 notificação, atualiza em vez de
// duplicar) e resolve sozinha quando o vigia acha tudo saudável de novo.
const CRON_ALERT_SOURCE_ID = "cron_watchdog_daily";

async function getTenantId(): Promise<string | null> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from("tenants").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  if (!isCronRequest(req, "EPG_SYNC_CRON_SECRET")) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const staleJobs = await computeStaleJobs();
  const wasActive = await getSummaryAlertActive();
  const tenantId = await getTenantId();

  if (staleJobs.length > 0) {
    fireDailySummaryAlert(staleJobs);
    await setSummaryAlertActive(true);
    if (tenantId) {
      await notify({
        tenantId,
        type: "cron_falha",
        title: `⏰ ${staleJobs.length} cron(s) sem sucesso recente`,
        message: `${staleJobs.join(", ")} — veja o histórico de crons pra detalhar.`,
        link: "/admin/cron-status",
        sourceId: CRON_ALERT_SOURCE_ID,
      });
    }
  } else if (wasActive) {
    await resolveDailySummaryAlert();
    await setSummaryAlertActive(false);
    if (tenantId) {
      await resolveNotification(tenantId, "cron_falha", CRON_ALERT_SOURCE_ID);
    }
  }

  return NextResponse.json({ ok: true, staleJobs });
}
