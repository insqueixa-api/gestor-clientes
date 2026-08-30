// app/api/cron/status/route.ts
// ✅ 30/08/2026: rota pro botão "Histórico de Crons" do sino — dá pro
// Márcio conferir de manhã se tudo que roda de madrugada disparou certo,
// sem precisar entrar no Supabase. Duas fontes, cada uma com seu limite:
//
// 1) pg_cron (cron.job/cron.job_run_details) — mostra TODOS os jobs
//    agendados, ativos/inativos, com o status do próprio pg_cron. Pra jobs
//    que só disparam um net.http_post (is_http_trigger=true), esse status
//    reflete só "o disparo foi enfileirado", NÃO o resultado real da rota —
//    é o mesmo gotcha já documentado em lib/cron-health.ts.
// 2) cron_health (mesma tabela/lista que o vigia diário usa,
//    lib/cron-health.ts::JOBS) — é o sinal de verdade pros jobs que fazem
//    trabalho de app (rota HTTP), porque cada rota reporta o próprio
//    sucesso/erro ali, não só "o pg_cron chamou".
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";
import { JOBS, getLastOk } from "@/lib/cron-health";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdminTenant(req);
  if (!auth.ok) return auth.res;

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const [pgcronRes, healthRes] = await Promise.all([
    sb.rpc("admin_list_pgcron_status"),
    sb.from("cron_health").select("job_name, last_ok_at, last_error, last_error_at"),
  ]);

  if (pgcronRes.error) {
    return NextResponse.json({ error: pgcronRes.error.message }, { status: 500 });
  }

  const healthMap = new Map((healthRes.data || []).map((h) => [h.job_name, h]));

  const appJobs = await Promise.all(
    JOBS.map(async (job) => {
      const lastOkAt = await getLastOk(job);
      const staleMs = job.maxAgeHours * 60 * 60 * 1000;
      const isStale = !lastOkAt || Date.now() - new Date(lastOkAt).getTime() > staleMs;
      const h = healthMap.get(job.name);
      return {
        name: job.name,
        kind: job.kind,
        maxAgeHours: job.maxAgeHours,
        lastOkAt,
        lastError: h?.last_error ?? null,
        lastErrorAt: h?.last_error_at ?? null,
        isStale,
      };
    }),
  );

  return NextResponse.json({
    pgcron: pgcronRes.data || [],
    appJobs,
  });
}
