"use client";
// app/admin/cron-status/page.tsx
// ✅ 30/08/2026: redesenhado a pedido do Márcio — a versão anterior (2
// tabelas, 24+ linhas soltas) era ilegível. Agora agrupa por categoria
// (Catálogo/EPG, Cobrança, Manutenção, Financeiro, Sistema), cada grupo
// mostra 1 status resumido e vem colapsado — só expande quem quer ver o
// detalhe de cada job.
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw, CheckCircle2, XCircle, Clock3, ChevronDown, ChevronRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

export default function CronStatusPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

      const gs: GroupRow[] = json.groups || [];
      setGroups(gs);
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

      {loading && groups.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground animate-pulse">Carregando...</div>
      ) : (
        <div className="space-y-3">
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
