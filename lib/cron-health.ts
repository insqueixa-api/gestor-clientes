// lib/cron-health.ts
// ✅ 28/08/2026: rede de segurança pra detectar cron travado/morto em
// silêncio (mesma classe do incidente do sync-jogos 26/08 — função morta
// pelo Vercel sem gerar exceção nenhuma) em jobs que NÃO têm mais cota de
// Sentry Cron Monitor sobrando (plano grátis só libera 1 — ver
// docs/sql/cron_health_watchdog.sql pro desenho completo).
//
// Cada rota chama reportCronHealth() no fim do próprio try/catch — grava um
// heartbeat em cron_health e, SE já houver um alerta-resumo aberto, checa
// na hora se essa era a última pendência (todos os outros já saudáveis) —
// se sim, resolve o issue do Sentry ali mesmo, sem esperar o próximo
// check do vigia. Detecção de "ficou velho demais" continua batch, 1x por
// dia (app/api/cron/watchdog/route.ts) — pedido do Márcio, 28/08/2026: como
// todos os crons rodam de madrugada, não faz sentido ficar checando o dia
// inteiro. Resolução, porém, é sempre instantânea quando o job volta a
// rodar OK (cron de novo ou rerun manual), porque "o sino não pode ficar
// travado" foi pedido explícito.
import { createClient as createAdmin } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";

const SENTRY_ORG = "unigestor";
const SENTRY_PROJECT = "javascript-nextjs";

// Linha sentinela em cron_health (mesma tabela dos heartbeats) só pra
// guardar se o alerta-resumo do dia está aberto ou não — não é um job de
// verdade, é o "estado do vigia".
const SUMMARY_SENTINEL = "__watchdog_summary__";

// ✅ Client próprio (service_role), não reaproveita o de cada rota — várias
// rotas de cron (ex: catalogo/limpar) só têm o client de sessão
// (lib/supabase/server.ts), que não tem sessão nenhuma quando chamado pelo
// pg_cron/VM (sem cookie), e cron_health tem RLS sem policy — só
// service_role escreve. Um client dedicado aqui evita ficar refém do que
// cada rota já tinha à mão.
const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type JobConfig = { name: string; kind: "sql" | "http"; maxAgeHours: number };

// job_name aqui = jobname exato em cron.job pros "sql", e o mesmo valor
// passado em reportCronHealth() pelas rotas pros "http". Fonte única —
// tanto o vigia (watchdog) quanto o resolve instantâneo (reportCronHealth)
// usam esta mesma lista, pra nunca ficarem em desacordo sobre o que "está
// tudo bem" significa.
//
// sync-jogos fica de fora de propósito: já tem Sentry Cron Monitor de
// verdade (ativo, ocupando a única vaga grátis) — incluir aqui duplicaria
// o alerta.
export const JOBS: JobConfig[] = [
  // HTTP — rota Next.js faz o trabalho, pg_cron (ou a VM Hetzner) só dispara
  { name: "sync-claro", kind: "http", maxAgeHours: 30 },
  { name: "sync-catalog-elite", kind: "http", maxAgeHours: 30 },
  { name: "sync-catalog-natv", kind: "http", maxAgeHours: 30 },
  { name: "sync-catalog-fast", kind: "http", maxAgeHours: 30 }, // dispara via crontab da VM Hetzner, não pg_cron
  { name: "sync-tmdb", kind: "http", maxAgeHours: 30 },
  { name: "catalogo-limpar", kind: "http", maxAgeHours: 30 },
  { name: "condominio-pdf-purge", kind: "http", maxAgeHours: 30 },
  { name: "fx-sync", kind: "http", maxAgeHours: 30 },
  { name: "fin-snapshot-previsao", kind: "http", maxAgeHours: 24 * 35 }, // mensal

  // SQL puro — roda dentro do próprio pg_cron, sem rota
  { name: "auto_archive_expired_clients_daily", kind: "sql", maxAgeHours: 30 },
  { name: "auto_purge_expired_clients_daily", kind: "sql", maxAgeHours: 30 },
  { name: "cancel_expired_portal_payments", kind: "sql", maxAgeHours: 30 },
  { name: "checar-sugestoes-adicionadas", kind: "sql", maxAgeHours: 30 },
  { name: "check-overdue-transactions", kind: "sql", maxAgeHours: 30 },
  { name: "cleanup-old-notifications", kind: "sql", maxAgeHours: 30 },
  { name: "force_eternal_tokens_daily", kind: "sql", maxAgeHours: 30 },
  { name: "limpeza_diaria_tokens_portal", kind: "sql", maxAgeHours: 30 },
  { name: "cleanup_old_message_jobs_daily", kind: "sql", maxAgeHours: 30 },
  // ✅ 29/08/2026: substituem o cron-job.org externo (ver docs/sql/billing_native_cron_migration.sql).
  { name: "billing_enqueue_daily", kind: "sql", maxAgeHours: 30 },
  { name: "billing_dispatch_check", kind: "sql", maxAgeHours: 30 },
  { name: "vacuum_catalog_episodes_weekly", kind: "sql", maxAgeHours: 24 * 8.5 },
  { name: "vacuum_catalog_master_weekly", kind: "sql", maxAgeHours: 24 * 8.5 },
  { name: "vacuum_catalog_availability_weekly", kind: "sql", maxAgeHours: 24 * 8.5 },
];

export async function getLastOk(job: JobConfig): Promise<string | null> {
  if (job.kind === "sql") {
    const { data, error } = await supabaseAdmin.rpc("get_cron_last_success", { p_jobname: job.name });
    if (error) {
      console.error(`[cron-health] erro no RPC get_cron_last_success(${job.name}):`, error.message);
      return null;
    }
    return (data as string | null) ?? null;
  }

  const { data } = await supabaseAdmin
    .from("cron_health")
    .select("last_ok_at")
    .eq("job_name", job.name)
    .maybeSingle<{ last_ok_at: string | null }>();
  return data?.last_ok_at ?? null;
}

// Recalcula do zero quais jobs estão velhos demais agora — usado tanto pelo
// vigia diário quanto pelo resolve instantâneo em reportCronHealth().
export async function computeStaleJobs(): Promise<string[]> {
  const staleJobs: string[] = [];
  for (const job of JOBS) {
    const lastOkAt = await getLastOk(job);
    const staleMs = job.maxAgeHours * 60 * 60 * 1000;
    const isStale = !lastOkAt || Date.now() - new Date(lastOkAt).getTime() > staleMs;
    if (isStale) staleJobs.push(job.name);
  }
  return staleJobs;
}

export async function reportCronHealth(
  jobName: string,
  status: "ok" | "error",
  errorMessage?: string
): Promise<void> {
  try {
    if (status === "ok") {
      await supabaseAdmin.from("cron_health").upsert(
        {
          job_name: jobName,
          last_ok_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_name" }
      );

      // Se já tem um alerta-resumo aberto, checa na hora se essa era a
      // última pendência — não espera o próximo tick do vigia (1x/dia) pra
      // fechar o sino quando o Márcio reroda manualmente.
      if (await getSummaryAlertActive()) {
        const stillStale = await computeStaleJobs();
        if (stillStale.length === 0) {
          await resolveDailySummaryAlert();
          await setSummaryAlertActive(false);
        }
      }
    } else {
      await supabaseAdmin.from("cron_health").upsert(
        {
          job_name: jobName,
          last_error: (errorMessage ?? "erro desconhecido").slice(0, 500),
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_name" }
      );
    }
  } catch (e) {
    // Nunca deixa o reporte de saúde derrubar o job de verdade.
    console.error(`[cron-health] falha ao reportar ${jobName}:`, e);
  }
}

export async function getSummaryAlertActive(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("cron_health")
    .select("alert_active")
    .eq("job_name", SUMMARY_SENTINEL)
    .maybeSingle<{ alert_active: boolean }>();
  return !!data?.alert_active;
}

export async function setSummaryAlertActive(active: boolean): Promise<void> {
  await supabaseAdmin.from("cron_health").upsert(
    { job_name: SUMMARY_SENTINEL, alert_active: active, updated_at: new Date().toISOString() },
    { onConflict: "job_name" }
  );
}

// Dispara 1 issue no Sentry listando TODOS os jobs velhos demais do dia —
// fingerprint fixo (não muda com a lista), então dias seguidos de falha
// viram eventos novos no MESMO issue, não issues separados.
export function fireDailySummaryAlert(staleJobs: string[]): void {
  Sentry.captureMessage(
    `${staleJobs.length} cron(s) sem sucesso recente: ${staleJobs.join(", ")}`,
    {
      level: "error",
      fingerprint: ["cron-watchdog", "daily-summary"],
      tags: { kind: "cron_watchdog" },
      extra: { staleJobs },
    }
  );
}

// Resolve o issue-resumo via API do Sentry — chamado tanto pelo vigia
// (quando a lista de jobs velhos volta a ficar vazia no check diário)
// quanto por reportCronHealth (resolve instantâneo no rerun manual).
// Best-effort: se o SENTRY_AUTH_TOKEN não estiver configurado na Vercel
// (produção), só loga e segue — o alerta fica visível mas não fecha
// sozinho (dá pra resolver na mão direto no Sentry enquanto isso).
export async function resolveDailySummaryAlert(): Promise<void> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    console.warn(`[cron-health] SENTRY_AUTH_TOKEN ausente — não dá pra resolver o alerta-resumo`);
    return;
  }
  try {
    const query = encodeURIComponent("is:unresolved kind:cron_watchdog");
    const res = await fetch(
      `https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?project=${SENTRY_PROJECT}&query=${query}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const issues = await res.json().catch(() => []);
    if (!Array.isArray(issues) || issues.length === 0) return;

    await Promise.all(
      issues.map((issue: { id: string }) =>
        fetch(`https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/${issue.id}/`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "resolved" }),
        })
      )
    );
  } catch (e) {
    console.error(`[cron-health] falha ao resolver o alerta-resumo:`, e);
  }
}
