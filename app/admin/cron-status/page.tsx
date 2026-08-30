"use client";
// app/admin/cron-status/page.tsx
// ✅ 30/08/2026: link "Histórico de Crons" no sino — visão de todos os
// pg_cron (ativos/inativos, com horário da última execução) + os jobs
// monitorados pelo vigia diário (lib/cron-health.ts), incluindo o
// sync-catalog-fast que dispara pela VM Hetzner, não pelo pg_cron.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PgCronRow = {
  jobname: string;
  schedule: string;
  active: boolean;
  is_http_trigger: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_success_at: string | null;
};

type AppJobRow = {
  name: string;
  kind: "sql" | "http";
  maxAgeHours: number;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  isStale: boolean;
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Nunca";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default function CronStatusPage() {
  const [loading, setLoading] = useState(true);
  const [pgcron, setPgcron] = useState<PgCronRow[]>([]);
  const [appJobs, setAppJobs] = useState<AppJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");

      const res = await fetch("/api/cron/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao carregar status dos crons.");

      setPgcron(json.pgcron || []);
      setAppJobs(json.appJobs || []);
      setLastFetch(new Date());
    } catch (e: any) {
      setError(e.message || "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6 pb-10 px-3 sm:px-0 md:px-4">
      <div className="flex items-center justify-between gap-2 flex-wrap pt-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-foreground">Histórico de Crons</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Confira se tudo que roda de madrugada (e o resto do dia) disparou certinho.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="h-9 px-3 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Atualizar
        </button>
      </div>

      {lastFetch && (
        <p className="text-[10px] text-muted-foreground -mt-4">Atualizado {lastFetch.toLocaleTimeString("pt-BR")}</p>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-500 text-sm p-3">{error}</div>
      )}

      {/* ✅ Jobs monitorados pelo vigia diário — sinal de verdade pra rotas
          HTTP (cada uma reporta o próprio resultado, não só "o pg_cron
          chamou"). Inclui o sync-catalog-fast, que dispara pela VM Hetzner. */}
      <div className="rounded-2xl border border-border bg-card/95 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Serviços monitorados (vigia diário)</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Cada linha reporta o próprio sucesso/erro — inclui o sync-catalog-fast (dispara pela VM Hetzner, não pelo pg_cron).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase">
              <tr>
                <th className="p-3">Job</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Última execução OK</th>
                <th className="p-3">Limite (horas)</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {appJobs.map((j) => (
                <tr key={j.name} className="hover:bg-muted/30 align-top">
                  <td className="p-3 font-medium text-foreground">{j.name}</td>
                  <td className="p-3 text-xs text-muted-foreground uppercase">{j.kind}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(j.lastOkAt)}</td>
                  <td className="p-3 text-muted-foreground">{j.maxAgeHours}h</td>
                  <td className="p-3">
                    {j.isStale ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-500">
                        <XCircle className="w-3.5 h-3.5" /> Velho demais
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 className="w-3.5 h-3.5" /> OK
                      </span>
                    )}
                    {j.lastError && (
                      <div className="text-[10px] text-rose-500 mt-1 max-w-xs truncate" title={j.lastError}>
                        {j.lastError} {j.lastErrorAt ? `(${fmtDateTime(j.lastErrorAt)})` : ""}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {appJobs.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Nada carregado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ✅ Todos os pg_cron (ativos e inativos) — status vem direto do
          próprio pg_cron; pra jobs que só disparam HTTP, isso confirma que o
          disparo saiu, não necessariamente que a rota terminou bem (ver
          tabela de cima pra esse sinal mais completo). */}
      <div className="rounded-2xl border border-border bg-card/95 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Todos os pg_cron (Supabase)</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            <AlertTriangle className="w-3 h-3 inline -mt-0.5 text-amber-500" /> Jobs marcados "dispara HTTP" só confirmam que o
            pg_cron chamou a rota — o resultado real está na tabela de cima.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase">
              <tr>
                <th className="p-3">Job</th>
                <th className="p-3">Agenda</th>
                <th className="p-3">Ativo</th>
                <th className="p-3">Última execução</th>
                <th className="p-3">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pgcron.map((j) => (
                <tr key={j.jobname} className={`hover:bg-muted/30 align-top ${!j.active ? "opacity-50" : ""}`}>
                  <td className="p-3 font-medium text-foreground">
                    {j.jobname}
                    {j.is_http_trigger && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-sky-500/10 text-sky-500 uppercase">
                        dispara HTTP
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{j.schedule}</td>
                  <td className="p-3">
                    {j.active ? (
                      <span className="text-emerald-500 text-xs font-medium">Ativo</span>
                    ) : (
                      <span className="text-muted-foreground text-xs font-medium">Inativo</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(j.last_run_at)}</td>
                  <td className="p-3">
                    {j.last_run_status === "succeeded" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sucesso
                      </span>
                    ) : j.last_run_status === "failed" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-500">
                        <XCircle className="w-3.5 h-3.5" /> Falhou
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">Nunca rodou</span>
                    )}
                  </td>
                </tr>
              ))}
              {pgcron.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Nada carregado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
