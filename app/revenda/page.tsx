"use client";
// app/revenda/page.tsx
// ✅ 06/10/2026: Portal da Revenda — "cópia" do portal do cliente (/renew),
// pedido do Márcio: mesma barra preta no topo, mesma saudação + 2 cards
// (Pagamentos e Recargas / Meus Aplicativos), mesmos cards "📺 / 💰".
// Diferenças: em vez de vencimento a revenda tem SALDO DE CRÉDITOS; os
// "planos" são as faixas da Tabela Revenda (preço por crédito).
// Entrada: link mágico (/#t=TOKEN → login → sessionStorage "rp_session") ou
// "Acessar o Portal" do admin (/revenda?session=...).
// O resumo do painel é sincronizado sozinho ao abrir (app/api/reseller-portal/home).
// Ainda NÃO tem pagamento: "Comprar créditos" abre o WhatsApp do suporte com
// o pedido pronto (PIX automático é a próxima etapa do plano).
// Aplicativos dos clientes da revenda: próxima fase (docs/revenda-portal/PLANO.md).
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import AppsSection from "./AppsSection";
import PaymentModal from "./PaymentModal";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { BRAND_LOGO_MOBILE_URL, BRAND_LOGO_URL } from "@/lib/brand";

type Server = {
  id: string;
  name: string;
  logo_url: string | null;
  username: string | null;
  password: string | null;
  telegram_url: string | null;
  stats: {
    credits: number;
    account_status?: string;
    total: number;
    active: number;
    expired: number;
    expiring_2d: { username: string; expires_at: string | null }[];
  } | null;
  synced_at: string | null;
  // ✅ 09/10/2026: Elite não lista clientes de sub-revenda → sem "Seus Clientes"
  provider?: string | null;
  clients_available?: boolean;
  min_credits?: number;
  // ✅ 08/10/2026: já na moeda da revenda (price = por crédito; total = valor do pacote)
  prices: { credits: number; price: number; total?: number }[];
};
type Home = {
  reseller: { name: string; since: string | null };
  support_phone: string | null;
  currency?: "BRL" | "USD" | "EUR";
  servers: Server[];
};
type Section = "menu" | "payment" | "apps";
type OrderView = {
  order_id: string;
  gateway_type: string;
  gateway_name: string;
  has_alternate_gateway: boolean;
  credits: number;
  amount: number;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  // ✅ 08/10/2026: revenda USD/EUR paga no Stripe (cartão)
  currency?: "BRL" | "USD" | "EUR";
  payment_method?: "pix" | "stripe";
  client_secret?: string | null;
  publishable_key?: string | null;
  expires_at: string;
  state: "waiting" | "sending" | "done" | "failed" | "expired";
  new_balance?: number | null;
};

const KEY = "rp_session";
const money = (n: number, currency = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);
const dateTimeBR = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";
const panelDate = (s: string | null) => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s) : null;
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : s || "—";
};
function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
/** Faixa da Tabela Revenda: maior pacote com créditos ≤ quantidade (abaixo do menor, vale o menor). */
function tierPrice(prices: { credits: number; price: number }[], qty: number) {
  const sorted = [...prices].sort((a, b) => a.credits - b.credits);
  if (!sorted.length || qty <= 0) return null;
  let t = sorted[0];
  for (const p of sorted) if (p.credits <= qty) t = p;
  return t;
}

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

// ✅ 07/10/2026: confirmação do sistema (useConfirm) disponível no portal da revenda
export default function RevendaPortalPage() {
  return (
    <ConfirmProvider>
      <RevendaPortal />
    </ConfirmProvider>
  );
}

function RevendaPortal() {
  const [session, setSession] = useState("");
  const [data, setData] = useState<Home | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "expired" | "error">("loading");
  const [section, setSection] = useState<Section>("menu");
  const [serverId, setServerId] = useState<string>("");
  const [qty, setQty] = useState<number>(0);
  const [syncing, setSyncing] = useState(false);
  const [showPass, setShowPass] = useState(false);

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
        setServerId((j as Home).servers[0]?.id || "");
        setState("ok");
        // 2ª chamada: sincroniza com o painel e atualiza os números
        setSyncing(true);
        fetch("/api/reseller-portal/home", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: s, sync: true }),
        })
          .then(async (r2) => {
            const j2 = await r2.json().catch(() => ({}));
            if (r2.ok && j2?.ok) setData(j2 as Home);
          })
          .catch(() => {})
          .finally(() => setSyncing(false));
      })
      .catch(() => setState("error"));
  }, []);

  const server = useMemo(() => data?.servers.find((s) => s.id === serverId) || null, [data, serverId]);
  const sortedPrices = useMemo(() => [...(server?.prices || [])].sort((a, b) => a.credits - b.credits), [server]);
  // quantidade inicial = menor pacote do servidor (chave por conteúdo: o
  // 2º carregamento, do sync, não apaga a quantidade que a revenda escolheu)
  const firstPackageCredits = sortedPrices[0]?.credits || 0;
  useEffect(() => {
    setQty(firstPackageCredits);
  }, [serverId, firstPackageCredits]);
  const tier = server ? tierPrice(server.prices, qty) : null;
  const cur = data?.currency || "BRL";
  const pkgTotal = sortedPrices.find((p) => p.credits === qty)?.total;
  const total = typeof pkgTotal === "number" ? pkgTotal : tier ? qty * tier.price : 0;

  // ✅ compra de créditos por PIX (app/api/reseller-portal/credit-order)
  const [creating, setCreating] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderView | null>(null);

  async function startPurchase(excludeGatewayType?: string) {
    if (!server || creating) return;
    setCreating(true);
    setBuyError(null);
    try {
      const r = await fetch("/api/reseller-portal/credit-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          session_token: session,
          reseller_server_id: server.id,
          credits: qty,
          exclude_gateway_type: excludeGatewayType,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setState("expired");
        return;
      }
      if (!r.ok || !j?.ok) {
        setBuyError(j?.error || "Não foi possível gerar o PIX. Tente de novo.");
        return;
      }
      setOrder({ ...(j as OrderView), state: "waiting" });
    } catch {
      setBuyError("Não foi possível gerar o PIX. Tente de novo.");
    } finally {
      setCreating(false);
    }
  }

  function closeOrder() {
    setOrder(null);
  }

  // acompanhamento do pedido: pago → enviando → concluído
  useEffect(() => {
    if (!order || order.state === "done" || order.state === "failed" || order.state === "expired") return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/reseller-portal/credit-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", session_token: session, order_id: order.order_id }),
        });
        const j = await r.json().catch(() => ({}));
        if (!alive || !r.ok || !j?.ok) return;
        let next: OrderView["state"] = order.state;
        if (j.status === "cancelled" || j.status === "rejected") next = "expired";
        else if (j.status === "pending" && j.expires_at && new Date(j.expires_at).getTime() < Date.now()) next = "expired";
        else if (j.status === "approved") {
          if (j.fulfillment_status === "done") next = "done";
          else if (j.fulfillment_status === "error" || j.fulfillment_status === "unknown") next = "failed";
          else next = "sending";
        }
        if (next !== order.state) {
          setOrder((o) => (o ? { ...o, state: next, new_balance: j.new_balance ?? o.new_balance } : o));
          if (next === "done" && typeof j.new_balance === "number") {
            // saldo novo já na tela
            setData((d) =>
              d
                ? {
                    ...d,
                    servers: d.servers.map((s) =>
                      s.id === serverId && s.stats ? { ...s, stats: { ...s.stats, credits: j.new_balance } } : s,
                    ),
                  }
                : d,
            );
          }
        }
      } catch {}
    };
    const iv = setInterval(tick, order.state === "sending" ? 3000 : 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [order?.order_id, order?.state]);

  async function logout() {
    try {
      await fetch("/api/reseller-portal/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout", session_token: session }),
      });
      window.sessionStorage.removeItem(KEY);
    } catch {}
    window.location.href = "/";
  }

  if (state === "loading") {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm animate-pulse">Carregando...</div>;
  }
  if (state !== "ok" || !data) {
    // ✅ 12/10/2026, pedido do Márcio: mesmo visual da "Sessão Expirada" do
    // portal do cliente (app/renew/RenewClient.tsx)
    const expired = state === "expired";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-2xl p-8 text-center border border-rose-500/20">
          <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-rose-500 mb-2">{expired ? "Sessão Expirada" : "Não foi possível carregar"}</h1>
          <p className="text-foreground/70 mb-6">
            {expired
              ? "Sua sessão terminou. Abra o link novamente para continuar."
              : "Tente de novo em instantes."}
          </p>
          <button
            onClick={() => {
              if (!expired) return window.location.reload();
              try {
                window.sessionStorage.removeItem(KEY);
              } catch {}
              window.location.href = "/";
            }}
            className="px-6 py-3 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors"
          >
            {expired ? "Fazer Login Novamente" : "Tentar novamente"}
          </button>
        </div>
      </div>
    );
  }

  const firstName = data.reseller.name.split(" ")[0];
  const supportDigits = String(data.support_phone || "").replace(/\D/g, "");
  const waLink = (text: string) => `https://wa.me/${supportDigits}?text=${encodeURIComponent(text)}`;

  const topBar = (
    <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {section !== "menu" && (
            <button
              onClick={() => setSection("menu")}
              className="w-8 h-8 flex items-center justify-center bg-card/10 hover:bg-card/20 rounded-lg text-white transition-colors shrink-0"
              title="Voltar"
            >
              <span className="text-lg leading-none mt-[-2px]">←</span>
            </button>
          )}
          <img src={BRAND_LOGO_MOBILE_URL} alt="Gestor" width={44} height={44} className="h-10 w-10 select-none object-contain sm:hidden" draggable={false} />
          <img src={BRAND_LOGO_URL} alt="Gestor" width={160} height={40} className="hidden sm:block h-10 w-auto select-none object-contain" draggable={false} />
          <div className="min-w-0 flex flex-col justify-center">
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold leading-none mb-0.5">Revenda</div>
            <div className="text-xs font-bold text-white truncate max-w-[130px] sm:max-w-66 tracking-tight uppercase">{data.reseller.name}</div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          {supportDigits && (
            <a
              href={waLink("Olá, sou revenda e preciso de ajuda!")}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[#25D366] hover:opacity-80 transition-opacity"
              title="Fale com o Suporte"
            >
              <IconWhatsapp />
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-[9px] uppercase tracking-wider text-white/50 leading-none">Suporte</span>
                <span className="text-xs font-bold tracking-wide leading-none mt-0.5">{data.support_phone}</span>
              </div>
            </a>
          )}
          <button onClick={logout} className="text-white/50 hover:text-rose-500 transition-colors" title="Sair">
            <IconLogout />
          </button>
        </div>
      </div>
    </div>
  );

  // ================= MENU (2 blocos, igual ao portal do cliente) =================
  if (section === "menu") {
    return (
      <div className="h-dvh sm:h-auto sm:min-h-screen bg-background flex flex-col overflow-hidden sm:overflow-visible">
        {topBar}
        <div className="flex-1 min-h-0 flex flex-col sm:block max-w-6xl mx-auto w-full px-0 sm:px-4 py-3 sm:py-6 sm:space-y-4">
          <div className="mb-2 px-3 sm:px-0 shrink-0">
            <h1 className="text-lg sm:text-2xl font-bold text-foreground tracking-tight">
              {greeting()}, {firstName}! 👋
            </h1>
            <p className="text-foreground/70 text-xs sm:text-sm mt-0.5 sm:mt-1">Escolha abaixo o que você quer resolver agora.</p>
          </div>
          <div className="flex-1 min-h-0 flex flex-col gap-2.5 px-3 pb-3 sm:flex-none sm:grid sm:grid-cols-2 sm:gap-6 sm:px-0 sm:pb-0">
            <button
              onClick={() => setSection("payment")}
              className="flex-1 min-h-0 sm:flex-none sm:min-h-[240px] w-full text-left rounded-2xl p-4 sm:p-7 border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent hover:border-emerald-500/60 transition-all shadow-sm hover:shadow-md group overflow-hidden"
            >
              <div className="h-full flex flex-col items-center justify-center text-center gap-2.5 sm:items-start sm:justify-start sm:text-left sm:gap-3">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center shrink-0 border border-emerald-500/20 text-3xl sm:w-16 sm:h-16 sm:text-4xl">💳</div>
                <div className="min-w-0 sm:flex-1">
                  <p className="text-xl font-bold text-foreground sm:text-2xl">Pagamentos e Recargas</p>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-3 sm:text-base sm:mt-2 sm:leading-relaxed">
                    Veja seu saldo de créditos, seus clientes e quem vence nos próximos dias. Compre créditos na hora, no preço da sua faixa.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-sm font-semibold px-4 py-1.5 sm:text-base sm:px-5 sm:py-2 group-hover:bg-emerald-500/25 transition-colors">
                  Comprar créditos
                  <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </span>
              </div>
            </button>

            <button
              onClick={() => setSection("apps")}
              className="flex-1 min-h-0 sm:flex-none sm:min-h-[240px] w-full text-left rounded-2xl p-4 sm:p-7 border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent hover:border-amber-500/60 hover:shadow-md transition-all shadow-sm group overflow-hidden"
            >
              <div className="h-full flex flex-col items-center justify-center text-center gap-2.5 sm:items-start sm:justify-start sm:text-left sm:gap-3">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center shrink-0 border border-amber-500/20 text-3xl sm:w-16 sm:h-16 sm:text-4xl">📱</div>
                <div className="min-w-0 sm:flex-1">
                  <p className="text-xl font-bold text-foreground sm:text-2xl">Gerenciar clientes e aplicativos</p>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-3 sm:text-base sm:mt-2 sm:leading-relaxed">
                    Veja seus clientes, configure o aplicativo de cada um com um toque e ative licenças sem sair daqui.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-sm font-semibold px-4 py-1.5 sm:text-base sm:px-5 sm:py-2 group-hover:bg-amber-500/25 transition-colors">
                  Gerenciar
                  <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ================= GERENCIAR CLIENTES E APLICATIVOS =================
  if (section === "apps") {
    return (
      <div className="min-h-screen bg-background">
        {topBar}
        <div className="max-w-6xl mx-auto px-0 sm:px-4 py-4 sm:py-6">
          {/* ✅ 07/10/2026: Gerenciar clientes e aplicativos (dashboard + Adicionar/Ativar) */}
          <AppsSection session={session} supportPhone={data.support_phone} resellerName={data.reseller.name} />
        </div>
      </div>
    );
  }

  // ================= PAGAMENTOS E RECARGAS =================
  const st = server?.stats || null;
  const lowBalance = !!st && st.credits <= 5;
  return (
    <div className="min-h-screen bg-background">
      {topBar}
      <div className="max-w-6xl mx-auto space-y-3 sm:space-y-4 px-0 sm:px-4 py-4 sm:py-6">
        {data.servers.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-3 sm:px-0">
            {data.servers.map((s) => (
              <button
                key={s.id}
                onClick={() => setServerId(s.id)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium whitespace-nowrap ${
                  s.id === serverId ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-600" : "border-border text-muted-foreground"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {!server ? (
          <div className="bg-card rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">Nenhum servidor vinculado.</div>
        ) : (
          <>
            {/* Saldo (no lugar do "Status da Assinatura") */}
            <div
              className={`w-full text-center py-2.5 sm:py-4 rounded-xl shadow-sm border-2 ${
                !st ? "bg-muted border-border" : lowBalance ? "bg-amber-500/10 border-amber-500/20" : "bg-emerald-500/10 border-emerald-500/20"
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Saldo de créditos · {server.name}</p>
              <div className="flex items-center justify-center gap-2">
                <span className={`w-3 h-3 rounded-full animate-pulse ${!st ? "bg-muted-foreground" : lowBalance ? "bg-amber-500" : "bg-emerald-500"}`} />
                <span className={`text-lg sm:text-xl font-black tracking-tight ${!st ? "text-muted-foreground" : lowBalance ? "text-amber-600" : "text-emerald-500"}`}>
                  {st ? `${st.credits} ${st.credits === 1 ? "crédito" : "créditos"}` : "Saldo indisponível no momento"}
                  {lowBalance && " · saldo baixo"}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {syncing ? "Atualizando com o painel..." : server.synced_at ? `Atualizado ${dateTimeBR(server.synced_at)}` : ""}
              </p>
            </div>

            {/* Dados de acesso */}
            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <div className="bg-muted/50 px-3 sm:px-4 py-2 sm:py-3 border-b border-border">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">📺 Dados de Acesso</h2>
              </div>
              <div className="p-2.5 sm:p-4 flex items-end gap-2 sm:gap-3">
                {server.logo_url ? (
                  <img src={server.logo_url} alt={server.name} title={server.name} className="w-[54px] h-[54px] rounded-lg object-cover border border-border shrink-0" />
                ) : (
                  <div className="w-[54px] h-[54px] rounded-lg border border-border flex items-center justify-center text-muted-foreground font-bold shrink-0">
                    {server.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 sm:gap-3">
                  <Field label="Usuário" mono value={server.username || "—"} />
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Senha</label>
                    <div className="flex items-center gap-1 text-sm font-mono text-foreground bg-muted pl-2.5 pr-1 py-1 sm:pl-3 rounded-lg border border-border">
                      <span className="flex-1 truncate">{server.password ? (showPass ? server.password : "••••••••") : "—"}</span>
                      {server.password && (
                        <button
                          onClick={() => setShowPass((v) => !v)}
                          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-background"
                          title={showPass ? "Ocultar senha" : "Mostrar senha"}
                        >
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {server.telegram_url && (
                  <a
                    href={server.telegram_url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Abrir o Telegram do ${server.name}`}
                    className="w-[38px] h-[38px] sm:w-[42px] sm:h-[42px] rounded-lg bg-[#229ED9] hover:bg-[#1c8cc2] text-white flex items-center justify-center shrink-0 transition-colors"
                  >
                    <IconTelegram />
                  </a>
                )}
              </div>
            </div>

            {/* Seus clientes — só onde o painel informa (NaTV); Elite não lista clientes de sub-revenda */}
            {server.clients_available !== false && (
            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <div className="bg-muted/50 px-3 sm:px-4 py-2 sm:py-3 border-b border-border">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">👥 Seus Clientes</h2>
              </div>
              <div className="p-2.5 sm:p-4 space-y-2 sm:space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  <Field label="Clientes" value={st ? String(st.total) : "—"} bold />
                  <Field label="Ativos" value={st ? String(st.active) : "—"} tone="text-emerald-600" bold />
                  <Field label="Expirados" value={st ? String(st.expired) : "—"} tone="text-rose-500" bold />
                  <Field label="Vencem em 2 dias" value={st ? String(st.expiring_2d.length) : "—"} tone="text-amber-600" bold />
                </div>
                {st && st.expiring_2d.length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Vencem nos próximos 2 dias</div>
                    {st.expiring_2d.map((u) => (
                      <div key={u.username} className="flex justify-between text-sm">
                        <span className="font-mono text-foreground">{u.username}</span>
                        <span className="text-muted-foreground">{panelDate(u.expires_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Comprar créditos — faixas da Tabela Revenda */}
            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <div className="bg-muted/50 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">💰 Comprar Créditos</h2>
              </div>
              <div className="p-3 sm:p-4 space-y-3">
                {sortedPrices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Preços ainda não disponíveis — fale com o suporte.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {sortedPrices.map((p) => {
                        const active = tier?.credits === p.credits;
                        return (
                          <button
                            key={p.credits}
                            onClick={() => setQty(p.credits)}
                            className={`rounded-xl border-2 px-2.5 py-2 text-left transition-colors ${
                              active ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:border-emerald-500/40"
                            }`}
                          >
                            <div className="text-[11px] font-semibold text-emerald-600">{p.credits} Créditos</div>
                            {/* ✅ 12/10/2026: mesmo desenho dos planos do cliente —
                                desconto à esquerda, valor à direita */}
                            <div className="mt-1 flex items-end justify-between gap-1.5">
                              <div className="min-w-0">
                                {(() => {
                                  // % de desconto comparado ao menor pacote
                                  const base = Number(sortedPrices[0]?.price || 0);
                                  const pct = base > 0 ? Math.round(((base - p.price) / base) * 1000) / 10 : 0;
                                  return pct > 0 ? (
                                    <span className="inline-block px-1.5 py-px text-[9px] font-bold rounded uppercase tracking-wider bg-emerald-500/15 text-emerald-600">
                                      {pct}% off
                                    </span>
                                  ) : null;
                                })()}
                              </div>
                              <div className="text-sm sm:text-base font-bold text-foreground whitespace-nowrap">
                                {money(p.price, cur)}
                                <span className="text-[10px] text-muted-foreground font-normal">/cr</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {sortedPrices.length > 0 && (
              <button
                onClick={() => void startPurchase()}
                disabled={qty < 5 || creating}
                className="w-full bg-[#25D366] hover:bg-[#20BA5A] text-white font-bold py-3 sm:py-4 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 text-base sm:text-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                {creating ? "Gerando pagamento..." : `Comprar ${qty} créditos • ${money(total, cur)}`}
              </button>
            )}
            {buyError && <p className="text-sm text-center text-rose-500 -mt-1">{buyError}</p>}

            {order && (
              <PaymentModal
                order={order}
                summary={[
                  {
                    label: `${order.credits} créditos · ${server.name}`,
                    value: `${money(order.amount / order.credits, order.currency || "BRL")} cada`,
                  },
                  ...(server.username ? [{ label: "Usuário que recebe", value: server.username }] : []),
                ]}
                waitingHint="Os créditos são enviados na hora pra sua conta."
                processingText="Enviando os créditos para a sua conta…"
                done={{
                  title: `${order.credits} créditos enviados!`,
                  children: (
                    <>
                      {server.username && (
                        <p className="text-xs text-muted-foreground">
                          Para o usuário <span className="font-mono font-bold text-foreground">{server.username}</span>
                        </p>
                      )}
                      {typeof order.new_balance === "number" && (
                        <div className="mt-1 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                          <p className="text-[10px] text-emerald-600/80 uppercase font-bold tracking-wide">Seu saldo agora</p>
                          <p className="text-sm font-bold text-emerald-600">{order.new_balance} créditos</p>
                        </div>
                      )}
                    </>
                  ),
                }}
                failedText="O envio automático dos créditos não confirmou. O suporte já foi avisado e vai concluir manualmente — você não precisa pagar de novo."
                supportLink={supportDigits ? waLink(`Olá! Paguei ${order.credits} créditos no Portal da Revenda e preciso de ajuda.`) : null}
                onClose={closeOrder}
                onRetryOther={order.has_alternate_gateway && order.state === "waiting" && !creating ? () => void startPurchase(order.gateway_type) : undefined}
                onStripePaid={() => setOrder((o) => (o ? { ...o, state: "sending" } : o))}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono, bold, tone }: { label: string; value: string; mono?: boolean; bold?: boolean; tone?: string }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">{label}</label>
      <div
        className={`text-sm ${mono ? "font-mono" : bold ? "font-bold" : "font-medium"} ${tone || "text-foreground"} bg-muted px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-border truncate`}
      >
        {value}
      </div>
    </div>
  );
}

function IconWhatsapp() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function IconTelegram() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.78 15.27 9.6 19.3c.39 0 .56-.17.76-.37l1.83-1.75 3.79 2.78c.7.38 1.19.18 1.38-.65l2.5-11.73c.23-1.03-.37-1.43-1.05-1.18L3.92 12.04c-1 .39-.99.95-.17 1.2l3.76 1.17 8.73-5.5c.41-.27.79-.12.48.15" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
