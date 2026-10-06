"use client";
// app/admin/revendedor/[id]/painel_stats.tsx
// ✅ 06/10/2026: resumo do painel da revenda (NaTV) — mesmo visual do resumo
// do card de Servidor (app/admin/gerenciador/servidor/page.tsx).
// Layout pedido pelo Márcio (2ª versão, 06/10/2026):
//   - coluna esquerda da página: o resumo INTEIRO do painel (clientes,
//     vencimentos, saldo, status, usuário, atualização + Sync), no lugar do
//     antigo "Resumo da conta";
//   - dentro do card do servidor: o "Resumo da conta" (Desde / Servidores /
//     Total investido).
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

/** Dentro do card do servidor: o "Resumo da conta" (antes na coluna esquerda). */
export function ResumoContaNoCard({
  since,
  serversCount,
  totalInvested,
  valuesHidden,
}: {
  since: string;
  serversCount: number;
  totalInvested: string;
  valuesHidden: boolean;
}) {
  return (
    <div className="w-full mt-4 pt-4 border-t border-border space-y-2 text-sm">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-1">Resumo da conta</div>
      <div className="flex justify-between items-center pb-2 border-b border-border">
        <span className="text-muted-foreground font-medium">Desde</span>
        <span className="font-medium text-foreground/90">{since}</span>
      </div>
      <div className="flex justify-between items-center pb-2 border-b border-border">
        <span className="text-muted-foreground font-medium">Servidores</span>
        <span className="font-medium text-foreground">{serversCount}</span>
      </div>
      <div className="flex justify-between items-center pt-1">
        <span className="text-muted-foreground font-medium text-[11px] uppercase tracking-tight">Total investido</span>
        <span className={`font-medium text-base text-emerald-500 transition-all duration-300 ${valuesHidden ? "blur-sm select-none" : ""}`}>
          {totalInvested}
        </span>
      </div>
    </div>
  );
}

/** Coluna esquerda da página: resumo inteiro do painel + Sync. */
export function PainelContaCard({
  state,
  onSync,
  serverName,
  username,
}: {
  state: PanelState;
  onSync: () => void;
  serverName: string;
  username: string | null;
}) {
  const [showSoon, setShowSoon] = useState(false);
  const { stats } = state;
  const soon = stats?.expiring_2d || [];
  const v = (n: number | undefined) => (stats ? n ?? 0 : "—");

  return (
    <div className="bg-card border-y sm:border border-border sm:rounded-xl p-4 shadow-sm transition-colors">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
          Painel · {serverName}
        </h3>
        <button
          type="button"
          onClick={onSync}
          disabled={state.syncing}
          title="Sincronizar com o painel"
          className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-500 hover:bg-sky-500/20 transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${state.syncing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="space-y-2.5">
        <Row
          icon={<Users className="w-4 h-4 text-sky-400" />}
          label="Total de clientes"
          value={<span className="text-foreground/90">{v(stats?.total)}</span>}
          tone="text-foreground/90"
        />
        <Row icon={<CheckCircle2 className="w-4 h-4" />} label="Clientes ativos" value={v(stats?.active)} tone="text-emerald-500" />
        <Row icon={<XCircle className="w-4 h-4" />} label="Clientes expirados" value={v(stats?.expired)} tone="text-rose-500" />
        {stats && stats.blocked > 0 && (
          <Row icon={<Ban className="w-4 h-4" />} label="Bloqueados" value={stats.blocked} tone="text-muted-foreground" />
        )}
        <Row
          icon={<Clock className="w-4 h-4" />}
          label="Vencem em 2 dias"
          value={v(soon.length)}
          tone="text-amber-500"
          onClick={soon.length > 0 ? () => setShowSoon((s) => !s) : undefined}
        />
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

        <div className="border-t border-border my-1" />

        <div className="flex justify-between items-center text-xs">
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <CreditCard className="w-4 h-4 text-sky-400" /> Saldo atual
          </span>
          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-medium">
            {stats ? stats.credits : "—"}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-emerald-500" /> Conta no painel
          </span>
          <span className={stats?.account_status === "bloqueada" ? "text-rose-500 font-medium" : "text-foreground/90"}>
            {stats ? (stats.account_status === "bloqueada" ? "Bloqueada" : "Ativa") : "—"}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <User className="w-4 h-4 text-violet-500" /> Usuário
          </span>
          <span className="text-foreground/90">{username || "—"}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <RefreshCw className="w-4 h-4 text-muted-foreground" /> Atualizado
          </span>
          <span className="text-foreground/90">{fmtSyncedAt(state.syncedAt)}</span>
        </div>
      </div>

      {!stats && <div className="mt-3 text-xs text-muted-foreground italic">Clique em sincronizar para puxar os dados do painel.</div>}
      {state.msg && <div className="mt-2 text-[11px] text-amber-500">{state.msg}</div>}
    </div>
  );
}
