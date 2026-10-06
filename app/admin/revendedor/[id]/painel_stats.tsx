"use client";
// app/admin/revendedor/[id]/painel_stats.tsx
// ✅ 06/10/2026: resumo do painel da revenda (NaTV) — mesmo visual do resumo
// do card de Servidor (app/admin/gerenciador/servidor/page.tsx).
// Layout pedido pelo Márcio:
//   - dentro do card do servidor: clientes (esquerda) + "Resumo da conta"
//     (Desde / Servidores / Total investido, à direita) + botão Sync;
//   - coluna esquerda da página: a conta no painel (saldo, status, usuário,
//     última atualização), no lugar do antigo "Resumo da conta".
// O estado é um só (usePainelStats) pros dois lugares mostrarem o mesmo Sync.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, CreditCard, RefreshCw, ShieldCheck, User, Users, XCircle, Ban } from "lucide-react";

export type PanelStats = {
  credits: number;
  account_status: string;
  total: number;
  active: number;
  expired: number;
  blocked: number;
  expiring_2d: { username: string; expires_at: string | null }[];
};

export type PanelState = {
  supported: boolean;
  stats: PanelStats | null;
  syncedAt: string | null;
  syncing: boolean;
  msg: string | null;
};

function fmtPanelDate(s: string | null) {
  // "2026-10-15 18:19:18" → "15/10 18:19"
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s) : null;
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : s || "—";
}

function fmtSyncedAt(iso: string | null) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function call(action: "get" | "sync", resellerServerId: string) {
  const res = await fetch("/api/integrations/natv/reseller-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, reseller_server_id: resellerServerId }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok) throw new Error(j?.error || "Falha ao consultar o painel.");
  return j as { supported: boolean; stats: PanelStats | null; synced_at: string | null; note?: string };
}

const EMPTY: PanelState = { supported: false, stats: null, syncedAt: null, syncing: false, msg: null };

/** Estado do painel por vínculo revenda↔servidor (ids em paralelo). */
export function usePainelStats(resellerServerIds: string[]) {
  const [byId, setById] = useState<Record<string, PanelState>>({});
  const key = resellerServerIds.join(",");

  useEffect(() => {
    let alive = true;
    const ids = key ? key.split(",") : [];
    Promise.all(
      ids.map((id) =>
        call("get", id)
          .then((j) => [id, { ...EMPTY, supported: j.supported, stats: j.stats, syncedAt: j.synced_at }] as const)
          .catch(() => [id, EMPTY] as const),
      ),
    ).then((pairs) => {
      if (alive) setById(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const sync = useCallback(async (id: string) => {
    setById((p) => ({ ...p, [id]: { ...(p[id] || EMPTY), syncing: true, msg: null } }));
    try {
      const j = await call("sync", id);
      setById((p) => ({
        ...p,
        [id]: { ...(p[id] || EMPTY), supported: true, stats: j.stats, syncedAt: j.synced_at, syncing: false, msg: j.note || null },
      }));
    } catch (e: any) {
      setById((p) => ({ ...p, [id]: { ...(p[id] || EMPTY), syncing: false, msg: e?.message || "Falha ao sincronizar." } }));
    }
  }, []);

  return { byId, sync };
}

function Row({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: string;
  onClick?: () => void;
}) {
  return (
    <div className="flex justify-between items-center text-xs">
      <div className={`flex items-center gap-2.5 font-normal ${tone}`}>
        {icon}
        <span>{label}</span>
      </div>
      {onClick ? (
        <button type="button" onClick={onClick} className="font-normal text-muted-foreground hover:text-sky-500 hover:underline">
          {value}
        </button>
      ) : (
        <span className="font-normal text-muted-foreground">{value}</span>
      )}
    </div>
  );
}

/** Dentro do card do servidor: clientes + "Resumo da conta" + Sync. */
export function PainelResumoCard({
  state,
  onSync,
  since,
  serversCount,
  totalInvested,
  valuesHidden,
}: {
  state: PanelState;
  onSync: () => void;
  since: string;
  serversCount: number;
  totalInvested: string;
  valuesHidden: boolean;
}) {
  const [showSoon, setShowSoon] = useState(false);
  if (!state.supported) return null;
  const { stats } = state;
  const soon = stats?.expiring_2d || [];
  const v = (n: number | undefined) => (stats ? n ?? 0 : "—");

  return (
    <div className="w-full mt-4 pt-4 border-t border-border space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Resumo</span>
        <button
          type="button"
          onClick={onSync}
          disabled={state.syncing}
          title="Sincronizar com o painel do NaTV"
          className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-500 hover:bg-sky-500/20 transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${state.syncing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Row
            icon={<Users className="w-4 h-4 text-sky-400" />}
            label="Total de clientes"
            value={<span className="text-foreground/90">{v(stats?.total)}</span>}
            tone="text-foreground/90"
          />
          <Row icon={<CheckCircle2 className="w-4 h-4" />} label="Clientes ativos" value={v(stats?.active)} tone="text-emerald-500" />
          <Row icon={<XCircle className="w-4 h-4" />} label="Clientes expirados" value={v(stats?.expired)} tone="text-rose-500" />
          <div className="border-t border-border my-1" />
          <Row
            icon={<Clock className="w-4 h-4" />}
            label="Vencem em 2 dias"
            value={v(soon.length)}
            tone="text-amber-500"
            onClick={soon.length > 0 ? () => setShowSoon((s) => !s) : undefined}
          />
          {stats && stats.blocked > 0 && (
            <Row icon={<Ban className="w-4 h-4" />} label="Bloqueados" value={stats.blocked} tone="text-muted-foreground" />
          )}
        </div>

        {/* "Resumo da conta" (antes na coluna esquerda da página) */}
        <div className="space-y-2 pl-0 sm:pl-4 sm:border-l border-border text-xs">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Desde</span>
            <span className="text-foreground/90">{since}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Servidores</span>
            <span className="text-foreground/90">{serversCount}</span>
          </div>
          <div className="border-t border-border my-1" />
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground uppercase tracking-tight text-[11px]">Total investido</span>
            <span className={`font-medium text-sm text-emerald-500 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}>
              {totalInvested}
            </span>
          </div>
        </div>
      </div>

      {showSoon && soon.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 space-y-1">
          {soon.map((u) => (
            <div key={u.username} className="flex justify-between text-xs">
              <span className="text-foreground/90 font-medium">{u.username}</span>
              <span className="text-muted-foreground">vence {fmtPanelDate(u.expires_at)}</span>
            </div>
          ))}
        </div>
      )}

      {!stats && <div className="text-xs text-muted-foreground italic">Clique em sincronizar para puxar os dados do painel.</div>}
      {state.msg && <div className="text-[11px] text-amber-500">{state.msg}</div>}
    </div>
  );
}

/** Coluna esquerda da página: a conta da revenda no painel. */
export function PainelContaCard({
  state,
  serverName,
  username,
}: {
  state: PanelState;
  serverName: string;
  username: string | null;
}) {
  const { stats } = state;
  return (
    <div className="bg-card border-y sm:border border-border sm:rounded-xl p-4 shadow-sm transition-colors">
      <h3 className="text-[11px] font-medium text-muted-foreground uppercase mb-4 tracking-widest">
        Conta no painel · {serverName}
      </h3>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center pb-2 border-b border-border">
          <span className="flex items-center gap-2 text-muted-foreground font-medium">
            <CreditCard className="w-4 h-4 text-sky-400" /> Saldo atual
          </span>
          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-medium">
            {stats ? stats.credits : "—"}
          </span>
        </div>
        <div className="flex justify-between items-center pb-2 border-b border-border">
          <span className="flex items-center gap-2 text-muted-foreground font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-500" /> Conta no painel
          </span>
          <span className={stats?.account_status === "bloqueada" ? "text-rose-500 font-medium" : "font-medium text-foreground/90"}>
            {stats ? (stats.account_status === "bloqueada" ? "Bloqueada" : "Ativa") : "—"}
          </span>
        </div>
        <div className="flex justify-between items-center pb-2 border-b border-border">
          <span className="flex items-center gap-2 text-muted-foreground font-medium">
            <User className="w-4 h-4 text-violet-500" /> Usuário
          </span>
          <span className="font-medium text-foreground/90">{username || "—"}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-2 text-muted-foreground font-medium">
            <RefreshCw className="w-4 h-4 text-muted-foreground" /> Atualizado
          </span>
          <span className="font-medium text-foreground/90">{fmtSyncedAt(state.syncedAt)}</span>
        </div>
      </div>
    </div>
  );
}
