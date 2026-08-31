"use client";
// app/admin/cron-status/page.tsx
// ✅ 31/08/2026, pedido do Márcio depois do incidente da ProxyBR: virou o
// painel "Sistema" — reflete TUDO que é externo/infraestrutura, não só os
// cron jobs. 3 seções novas no topo (WhatsApp, Infraestrutura, Serviços
// externos) vêm de app/api/system-health/route.ts, que só LÊ o cache
// (system_health_checks) — nenhuma chamada externa acontece só por abrir
// essa página, não importa quantas vezes por dia. Quem atualiza o cache é
// um pg_cron a cada 5min (docs/sql/system_health_checks.sql); o botão
// "Sincronizar agora" força uma rodada nova na hora, sob demanda.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw, CheckCircle2, XCircle, AlertTriangle, Clock3, ChevronDown, ChevronRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";

type JobRow = {
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
  neverRanYet: boolean;
};

type GroupRow = {
  key: string;
  label: string;
  jobs: JobRow[];
  status: "ok" | "failed" | "pending";
};

type HealthItem = {
  check_key: string;
  label: string;
  group_key: string;
  status: "ok" | "warn" | "fail";
  detail: string | null;
  checked_at: string;
};

type HealthGroup = {
  key: string;
  label: string;
  items: HealthItem[];
  status: "ok" | "warn" | "fail" | "empty";
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Nunca";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function GroupBadge({ status }: { status: GroupRow["status"] }) {
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-500">
        <XCircle className="w-3.5 h-3.5" /> Precisa de atenção
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-500">
        <Clock3 className="w-3.5 h-3.5" /> Aguardando 1ª execução
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500">
      <CheckCircle2 className="w-3.5 h-3.5" /> Tudo OK
    </span>
  );
}

function HealthGroupBadge({ status }: { status: HealthGroup["status"] }) {
  if (status === "fail") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-500">
        <XCircle className="w-3.5 h-3.5" /> Falha
      </span>
    );
  }
  if (status === "warn") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-500">
        <AlertTriangle className="w-3.5 h-3.5" /> Atenção
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500">
      <CheckCircle2 className="w-3.5 h-3.5" /> Tudo OK
    </span>
  );
}

function HealthItemBadge({ status }: { status: HealthItem["status"] }) {
  if (status === "fail") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-500">
        <XCircle className="w-3.5 h-3.5" /> Falha
      </span>
    );
  }
  if (status === "warn") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-500">
        <AlertTriangle className="w-3.5 h-3.5" /> Atenção
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500">
      <CheckCircle2 className="w-3.5 h-3.5" /> OK
    </span>
  );
}

export default function CronStatusPage() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [healthGroups, setHealthGroups] = useState<HealthGroup[]>([]);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [renewingProxy, setRenewingProxy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirm();
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");

      const [resCron, resHealth] = await Promise.all([
        fetch("/api/cron/status", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/system-health", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const jsonCron = await resCron.json().catch(() => ({}));
      const jsonHealth = await resHealth.json().catch(() => ({}));
      if (!resCron.ok) throw new Error(jsonCron?.error || "Falha ao carregar status dos crons.");
      if (!resHealth.ok) throw new Error(jsonHealth?.error || "Falha ao carregar status do sistema.");

      const gs: GroupRow[] = jsonCron.groups || [];
      setGroups(gs);
      setHealthGroups(jsonHealth.groups || []);
      setHealthCheckedAt(jsonHealth.lastCheckedAt || null);
      // ✅ Abre automaticamente só os grupos com problema — o resto fica
      // fechado, pra não repetir a mesma parede de texto de antes.
      setExpanded(new Set(gs.filter((g) => g.status !== "ok").map((g) => g.key)));
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

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");

      const res = await fetch("/api/cron/system-health-check", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao sincronizar.");
      await load();
    } catch (e: any) {
      setError(e.message || "Erro desconhecido");
    } finally {
      setSyncing(false);
    }
  }, [load]);

  // ✅ Renovação de verdade via API da ProxyBR — DEBITA do saldo da conta
  // deles, por isso pede confirmação antes.
  const renewProxy = useCallback(async () => {
    const ok = await confirm({
      title: "Renovar o proxy dedicado agora?",
      subtitle: "Isso debita do saldo da conta na ProxyBR (custo do plano atual) e estende a validade — use só se realmente precisar renovar antes do vencimento normal.",
      tone: "amber",
      confirmText: "Renovar",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    setRenewingProxy(true);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");

      const res = await fetch("/api/system-health/proxy-renew", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao renovar.");
      await sync();
    } catch (e: any) {
      setError(e.message || "Erro desconhecido");
    } finally {
      setRenewingProxy(false);
    }
  }, [confirm, sync]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6 pb-10 px-3 sm:px-0 md:px-4">
      <div className="flex items-center justify-between gap-2 flex-wrap pt-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-foreground">Sistema</h1>
          <p className="text-xs text-muted-foreground mt-1">
            WhatsApp, VMs, proxy, serviços externos e tudo que roda de madrugada — tudo num lugar só.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sync}
            disabled={syncing || loading}
            className="h-9 px-3 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500 text-xs font-medium hover:bg-sky-500/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Sincronizar agora
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="h-9 px-3 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Atualizar
          </button>
        </div>
      </div>

      {lastFetch && (
        <p className="text-[10px] text-muted-foreground -mt-4">
          Tela atualizada {lastFetch.toLocaleTimeString("pt-BR")}
          {healthCheckedAt && ` · última checagem do sistema: ${fmtDateTime(healthCheckedAt)}`}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-500 text-sm p-3">{error}</div>
      )}

      {loading && healthGroups.length === 0 && groups.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground animate-pulse">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {healthGroups.map((g) => {
            const isOpen = expanded.has(`health_${g.key}`);
            return (
              <div key={`health_${g.key}`} className="rounded-2xl border border-border bg-card/95 shadow-sm overflow-hidden">
                <button
                  onClick={() => toggle(`health_${g.key}`)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-foreground">{g.label}</span>
                    <span className="text-[11px] text-muted-foreground">({g.items.length})</span>
                  </div>
                  <HealthGroupBadge status={g.status} />
                </button>

                {isOpen && (
                  <div className="border-t border-border divide-y divide-border">
                    {g.items.map((item) => (
                      <div key={item.check_key} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{item.label}</p>
                          {item.detail && (
                            <p className="text-[11px] text-muted-foreground truncate" title={item.detail}>
                              {item.detail}
                            </p>
                          )}
                          {item.check_key === "proxy" && (
                            <button
                              type="button"
                              onClick={renewProxy}
                              disabled={renewingProxy}
                              className="text-[11px] text-sky-500 hover:text-sky-400 font-medium mt-0.5 disabled:opacity-50"
                            >
                              {renewingProxy ? "Renovando..." : "🔄 Renovar agora (debita saldo ProxyBR)"}
                            </button>
                          )}
                        </div>
                        <HealthItemBadge status={item.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {healthGroups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nenhuma checagem de sistema ainda — clique em "Sincronizar agora".
            </div>
          )}

          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <div key={g.key} className="rounded-2xl border border-border bg-card/95 shadow-sm overflow-hidden">
                <button
                  onClick={() => toggle(g.key)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-foreground">{g.label}</span>
                    <span className="text-[11px] text-muted-foreground">({g.jobs.length})</span>
                  </div>
                  <GroupBadge status={g.status} />
                </button>

                {isOpen && (
                  <div className="border-t border-border overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase">
                        <tr>
                          <th className="p-3">Job</th>
                          <th className="p-3">Agenda</th>
                          <th className="p-3">Ativo</th>
                          <th className="p-3">Última execução OK</th>
                          <th className="p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {g.jobs.map((j) => (
                          <tr key={j.key} className={`hover:bg-muted/30 align-top ${!j.active ? "opacity-50" : ""}`}>
                            <td className="p-3 font-medium text-foreground">
                              {j.label}
                              {j.isHttpTrigger && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-sky-500/10 text-sky-500 uppercase">
                                  HTTP
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{j.scheduleLabel}</td>
                            <td className="p-3">
                              {j.active ? (
                                <span className="text-emerald-500 text-xs font-medium">Sim</span>
                              ) : (
                                <span className="text-muted-foreground text-xs font-medium">Não</span>
                              )}
                            </td>
                            <td className="p-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(j.lastOkAt)}</td>
                            <td className="p-3">
                              {!j.active ? (
                                <span className="text-muted-foreground text-xs">Desativado</span>
                              ) : j.neverRanYet ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-500">
                                  <Clock3 className="w-3.5 h-3.5" /> Ainda não rodou
                                </span>
                              ) : j.isStale ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-500">
                                  <XCircle className="w-3.5 h-3.5" /> Falhou
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
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
