// app/api/cron/status/route.ts
// ✅ 30/08/2026: rota pro botão "Crons" do sino — agrupa os ~25 jobs em 5
// categorias (achado do Márcio: lista plana de 24 linhas era ilegível),
// mesclando as 2 fontes num único status por job em vez de 2 tabelas
// redundantes:
//  - jobs "sql" (rodam função pura, sem rede): status do próprio pg_cron
//    já É o resultado real.
//  - jobs "http" (net.http_post pra uma rota Next.js): usa o cron_health
//    (lib/cron-health.ts), que é quem sabe se a ROTA terminou bem — o
//    pg_cron só confirma que o disparo saiu (mesmo gotcha de sempre).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminTenant } from "@/lib/api/auth";
import { JOBS, getLastOk } from "@/lib/cron-health";

export const dynamic = "force-dynamic";

// pg_cron.jobname -> nome usado em JOBS (lib/cron-health.ts) quando o
// mesmo job aparece nas 2 fontes — sem isso, apareceria 2x na tela.
const PGCRON_TO_APP_NAME: Record<string, string> = {
  epg_sync_daily: "sync-claro",
  sync_catalog_elite_daily: "sync-catalog-elite",
  sync_catalog_natv_daily: "sync-catalog-natv",
  sync_tmdb_daily: "sync-tmdb",
  sync_catalog_limpar_daily: "catalogo-limpar",
  condominio_pdf_purge_daily: "condominio-pdf-purge",
  fx_sync_daily: "fx-sync",
  "fin-snapshot-previsao-mensal": "fin-snapshot-previsao",
};

const GROUPS: Record<string, { label: string; order: number }> = {
  catalogo: { label: "Sincronização de Catálogo/EPG", order: 1 },
  cobranca: { label: "Cobrança (WhatsApp)", order: 2 },
  manutencao: { label: "Limpeza / Manutenção", order: 3 },
  financeiro: { label: "Financeiro", order: 4 },
  sistema: { label: "Sistema", order: 5 },
};

// Nome amigável + grupo pra CADA job (pg_cron.jobname ou nome "só app").
const JOB_META: Record<string, { label: string; group: keyof typeof GROUPS }> = {
  epg_sync_daily: { label: "EPG Claro (RJ+SP)", group: "catalogo" },
  sync_catalog_elite_daily: { label: "Catálogo Elite", group: "catalogo" },
  sync_catalog_natv_daily: { label: "Catálogo NaTV", group: "catalogo" },
  "sync-catalog-fast": { label: "Catálogo Fast (VM Hetzner)", group: "catalogo" },
  sync_tmdb_daily: { label: "Capas/sinopses (TMDB)", group: "catalogo" },
  sync_catalog_limpar_daily: { label: "Limpeza pós-sync do catálogo", group: "catalogo" },
  sync_jogos_daily: { label: "Jogos (grade esportiva)", group: "catalogo" },

  billing_enqueue_daily: { label: "Enfileirar cobranças (6h/7h/12h)", group: "cobranca" },
  billing_dispatch_check: { label: "Despachar cobranças (2 em 2min)", group: "cobranca" },
  cleanup_old_message_jobs_daily: { label: "Limpeza do histórico de envios", group: "cobranca" },

  auto_archive_expired_clients_daily: { label: "Arquivar clientes vencidos", group: "manutencao" },
  auto_purge_expired_clients_daily: { label: "Expurgar clientes arquivados", group: "manutencao" },
  cancel_expired_portal_payments: { label: "Cancelar pagamentos expirados do Portal", group: "manutencao" },
  "cleanup-old-notifications": { label: "Limpeza de notificações antigas", group: "manutencao" },
  force_eternal_tokens_daily: { label: "Renovar tokens eternos do Portal", group: "manutencao" },
  limpeza_diaria_tokens_portal: { label: "Limpeza de tokens órfãos do Portal", group: "manutencao" },
  condominio_pdf_purge_daily: { label: "Purga de PDFs antigos (Condomínio)", group: "manutencao" },
  vacuum_catalog_availability_weekly: { label: "Vacuum: catalog_availability", group: "manutencao" },
  vacuum_catalog_episodes_weekly: { label: "Vacuum: catalog_episodes", group: "manutencao" },
  vacuum_catalog_master_weekly: { label: "Vacuum: catalog_master", group: "manutencao" },

  fx_sync_daily: { label: "Cotação USD/EUR → BRL", group: "financeiro" },
  "fin-snapshot-previsao-mensal": { label: "Fotografia mensal do Previsto", group: "financeiro" },
  "check-overdue-transactions": { label: "Transações financeiras em atraso", group: "financeiro" },

  cron_watchdog_check: { label: "Vigia dos crons (este painel)", group: "sistema" },
  "checar-sugestoes-adicionadas": { label: "Notificar sugestões de catálogo adicionadas", group: "sistema" },
};

type MergedJob = {
  key: string;
  label: string;
  group: string;
  scheduleLabel: string;
  active: boolean;
  isHttpTrigger: boolean;
  lastOkAt: string | null;
  isStale: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  neverRanYet: boolean; // job novo, ainda não teve a 1ª chance de rodar
};

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
  const appJobByName = new Map(JOBS.map((j) => [j.name, j]));
  const pgcronJobNames = new Set((pgcronRes.data || []).map((r) => r.jobname));
  const merged: MergedJob[] = [];
  const consumedAppNames = new Set<string>();

  for (const row of pgcronRes.data || []) {
    const appName = PGCRON_TO_APP_NAME[row.jobname];
    const meta = JOB_META[row.jobname] || { label: row.jobname, group: "sistema" as const };

    if (appName && appJobByName.has(appName)) {
      // ✅ Job existe nas 2 fontes — usa o sinal de app (mais confiável pra
      // jobs que disparam HTTP), mas mantém agenda/ativo do pg_cron.
      const appJob = appJobByName.get(appName)!;
      const lastOkAt = await getLastOk(appJob);
      const staleMs = appJob.maxAgeHours * 60 * 60 * 1000;
      const h = healthMap.get(appName);
      consumedAppNames.add(appName);
      merged.push({
        key: row.jobname,
        label: meta.label,
        group: meta.group,
        scheduleLabel: row.schedule,
        active: row.active,
        isHttpTrigger: row.is_http_trigger,
        lastOkAt,
        isStale: !lastOkAt || Date.now() - new Date(lastOkAt).getTime() > staleMs,
        lastError: h?.last_error ?? null,
        lastErrorAt: h?.last_error_at ?? null,
        neverRanYet: !lastOkAt && !row.last_run_at,
      });
    } else {
      // ✅ Só existe no pg_cron (sql puro, ou http sem monitoramento de app
      // dedicado ex: cron_watchdog_check, sync_jogos_daily que já tem
      // Sentry Cron Monitor próprio) — usa o status do próprio pg_cron.
      merged.push({
        key: row.jobname,
        label: meta.label,
        group: meta.group,
        scheduleLabel: row.schedule,
        active: row.active,
        isHttpTrigger: row.is_http_trigger,
        lastOkAt: row.last_success_at,
        isStale: row.last_run_status === "failed",
        lastError: row.last_run_status === "failed" ? "Última execução do pg_cron falhou" : null,
        lastErrorAt: row.last_run_status === "failed" ? row.last_run_at : null,
        neverRanYet: !row.last_run_at,
      });
    }
  }

  // ✅ Jobs só de app (sem pg_cron) — ex: sync-catalog-fast, dispara pela VM
  // Hetzner via crontab, não pelo Supabase.
  for (const job of JOBS) {
    if (consumedAppNames.has(job.name)) continue;
    // ✅ Jobs "sql" têm o MESMO nome no pg_cron e em JOBS (ex:
    // auto_archive_expired_clients_daily) — já foram cobertos no loop de
    // cima (o pg_cron É o sinal real pra eles); sem esse filtro, apareciam
    // 2x na tela.
    if (pgcronJobNames.has(job.name)) continue;
    const meta = JOB_META[job.name] || { label: job.name, group: "sistema" as const };
    const lastOkAt = await getLastOk(job);
    const staleMs = job.maxAgeHours * 60 * 60 * 1000;
    const h = healthMap.get(job.name);
    merged.push({
      key: job.name,
      label: meta.label,
      group: meta.group,
      scheduleLabel: "VM Hetzner (crontab)",
      active: true,
      isHttpTrigger: true,
      lastOkAt,
      isStale: !lastOkAt || Date.now() - new Date(lastOkAt).getTime() > staleMs,
      lastError: h?.last_error ?? null,
      lastErrorAt: h?.last_error_at ?? null,
      neverRanYet: !lastOkAt,
    });
  }

  const groups = Object.entries(GROUPS)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, meta]) => {
      const jobs = merged
        .filter((j) => j.group === key)
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      const hasFailure = jobs.some((j) => j.isStale && j.active && !j.neverRanYet);
      const hasNeverRan = jobs.some((j) => j.neverRanYet && j.active);
      return {
        key,
        label: meta.label,
        jobs,
        status: hasFailure ? "failed" : hasNeverRan ? "pending" : "ok",
      };
    });

  return NextResponse.json({ groups });
}
