"use client";
// app/revenda/page.tsx
// ✅ 06/10/2026: Portal da Revenda (docs/revenda-portal/PLANO.md, fase 2).
// Entrada: link mágico (/#t=TOKEN → login → sessionStorage "rp_session") ou
// "Acessar o Portal" do admin (/revenda?session=...). Primeira versão: resumo
// do painel por servidor, Tabela Revenda (preço por crédito) e compras de
// crédito. Aplicativos dos clientes da revenda entram na próxima fase.
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, CreditCard, LogOut, Users, XCircle } from "lucide-react";

type Server = {
  id: string;
  name: string;
  logo_url: string | null;
  username: string | null;
  stats: {
    credits: number;
    total: number;
    active: number;
    expired: number;
    expiring_2d: { username: string; expires_at: string | null }[];
  } | null;
  synced_at: string | null;
  prices: { credits: number; price: number }[];
};
type Home = {
  reseller: { name: string; since: string | null };
  servers: Server[];
  purchases: { server: string; credits: number; total: number; at: string }[];
};

const KEY = "rp_session";
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" })
    : "—";
const panelDate = (s: string | null) => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s) : null;
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : s || "—";
};

function readSession() {
  try {
    const u = new URL(window.location.href);
    const fromUrl = u.searchParams.get("session");
    if (fromUrl) {
      window.sessionStorage.setItem(KEY, fromUrl);
      u.searchParams.delete("session");
      window.history.replaceState({}, "", u.pathname + u.search);
      return fromUrl;
    }
    return window.sessionStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export default function RevendaPortalPage() {
  const [session, setSession] = useState("");
  const [data, setData] = useState<Home | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "expired" | "error">("loading");

  useEffect(() => {
    const s = readSession();
    setSession(s);
    if (!s) {
      setState("expired");
      return;
    }
    fetch("/api/reseller-portal/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: s }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) {
          try {
            window.sessionStorage.removeItem(KEY);
          } catch {}
          setState("expired");
          return;
        }
        if (!r.ok || !j?.ok) {
          setState("error");
          return;
        }
        setData(j as Home);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, []);

  async function logout() {
    try {
      await fetch("/api/reseller-portal/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout", session_token: session }),
      });
      window.sessionStorage.removeItem(KEY);
    } catch {}
    setData(null);
    setState("expired");
  }

  if (state === "loading") {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm animate-pulse">Carregando...</div>;
  }
  if (state !== "ok" || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-card border border-border rounded-2xl p-6 text-center space-y-2 shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Portal da Revenda</h1>
          <p className="text-sm text-muted-foreground">
            {state === "expired"
              ? "Sua sessão terminou. Abra de novo o link de acesso que você recebeu no WhatsApp."
              : "Não foi possível carregar agora. Tente de novo em instantes."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Portal da Revenda</div>
            <h1 className="text-xl font-semibold text-foreground truncate">Olá, {data.reseller.name.split(" ")[0]}</h1>
          </div>
          <button
            onClick={logout}
            className="h-9 px-3 rounded-lg border border-border text-muted-foreground text-xs font-medium hover:bg-muted inline-flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>

        {data.servers.map((s) => (
          <div key={s.id} className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              {s.logo_url ? (
                <img src={s.logo_url} alt={s.name} className="w-11 h-11 rounded-lg object-cover border border-border" />
              ) : (
                <div className="w-11 h-11 rounded-lg border border-border flex items-center justify-center text-muted-foreground">{s.name.charAt(0)}</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{s.name}</div>
                <div className="text-xs text-muted-foreground">Usuário: {s.username || "—"}</div>
              </div>
              {s.stats && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Saldo</div>
                  <div className="text-lg font-semibold text-emerald-500">{s.stats.credits} cr</div>
                </div>
              )}
            </div>

            {s.stats ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat icon={<Users className="w-4 h-4 text-sky-400" />} label="Clientes" value={s.stats.total} />
                <Stat icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} label="Ativos" value={s.stats.active} />
                <Stat icon={<XCircle className="w-4 h-4 text-rose-500" />} label="Expirados" value={s.stats.expired} />
                <Stat icon={<Clock className="w-4 h-4 text-amber-500" />} label="Vencem em 2 dias" value={s.stats.expiring_2d.length} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Resumo do painel ainda não disponível.</p>
            )}

            {s.stats && s.stats.expiring_2d.length > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Vencem nos próximos 2 dias</div>
                {s.stats.expiring_2d.map((u) => (
                  <div key={u.username} className="flex justify-between text-xs">
                    <span className="text-foreground/90 font-medium">{u.username}</span>
                    <span className="text-muted-foreground">{panelDate(u.expires_at)}</span>
                  </div>
                ))}
              </div>
            )}

            {s.prices.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">Preço do crédito</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {s.prices.map((p) => (
                    <div key={p.credits} className="rounded-lg border border-border px-2 py-1.5">
                      <div className="text-[10px] font-semibold text-emerald-500">a partir de {p.credits} cr</div>
                      <div className="text-sm font-medium text-foreground/90">
                        {brl(p.price)}
                        <span className="text-[10px] text-muted-foreground font-normal">/cr</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s.synced_at && <div className="text-[10px] text-muted-foreground">Atualizado em {dt(s.synced_at)}</div>}
          </div>
        ))}

        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Suas compras de crédito
          </div>
          {data.purchases.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nenhuma compra registrada.</p>
          ) : (
            <div className="divide-y divide-border">
              {data.purchases.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="text-foreground/90 font-medium">
                      {p.credits} créditos · {p.server}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{dt(p.at)}</div>
                  </div>
                  <div className="text-foreground/90">{brl(p.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}
