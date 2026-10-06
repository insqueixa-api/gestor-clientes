"use client";
// app/admin/revendedor/[id]/painel_stats.tsx
// ✅ 06/10/2026: resumo do painel da revenda (NaTV) dentro do card do
// servidor vinculado — mesmo visual do resumo do card de Servidor
// (app/admin/gerenciador/servidor/page.tsx): clientes à esquerda, saldo e
// conta à direita, botão Sync (app/api/integrations/natv/reseller-stats).
import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Clock, CreditCard, RefreshCw, ShieldCheck, User, Users, XCircle } from "lucide-react";

type Stats = {
  credits: number;
  account_status: string;
  total: number;
  active: number;
  expired: number;
  blocked: number;
  expiring_2d: { username: string; expires_at: string | null }[];
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
  return j as { supported: boolean; stats: Stats | null; synced_at: string | null; note?: string };
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

export default function PainelStats({ resellerServerId, username }: { resellerServerId: string; username?: string | null }) {
  const [supported, setSupported] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSoon, setShowSoon] = useState(false);

  useEffect(() => {
    let alive = true;
    call("get", resellerServerId)
      .then((j) => {
        if (!alive) return;
        setSupported(j.supported);
        setStats(j.stats);
        setSyncedAt(j.synced_at);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [resellerServerId]);

  async function sync() {
    setSyncing(true);
    setMsg(null);
    try {
      const j = await call("sync", resellerServerId);
      setStats(j.stats);
      setSyncedAt(j.synced_at);
      if (j.note) setMsg(j.note);
    } catch (e: any) {
      setMsg(e?.message || "Falha ao sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  if (!supported) return null;

  const soon = stats?.expiring_2d || [];
  const v = (n: number | undefined) => (stats ? n ?? 0 : "—");

  return (
    <div className="w-full mt-4 pt-4 border-t border-border space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Resumo no painel</span>
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          title="Sincronizar com o painel do NaTV"
          className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-500 hover:bg-sky-500/20 transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
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

        <div className="space-y-2 pl-0 sm:pl-4 sm:border-l border-border text-xs">
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-2 text-muted-foreground">
              <CreditCard className="w-4 h-4 text-sky-400" /> Saldo atual
            </span>
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-medium">{v(stats?.credits)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="w-4 h-4 text-emerald-500" /> Conta no painel
            </span>
            <span className={stats?.account_status === "bloqueada" ? "text-rose-500 font-medium" : "text-foreground/90"}>
              {stats ? (stats.account_status === "bloqueada" ? "Bloqueada" : "Ativa") : "—"}
            </span>
          </div>
          {username && (
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-2 text-muted-foreground">
                <User className="w-4 h-4 text-violet-500" /> Usuário
              </span>
              <span className="text-foreground/90">{username}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="w-4 h-4 text-muted-foreground" /> Atualizado
            </span>
            <span className="text-foreground/90">{fmtSyncedAt(syncedAt)}</span>
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
      {msg && <div className="text-[11px] text-amber-500">{msg}</div>}
    </div>
  );
}
