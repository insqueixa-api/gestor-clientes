"use client";

import { useSearchParams } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import Image from "next/image";

// ========= TYPES =========
interface ClientAccount {
  id: string;
  display_name: string;
  server_username: string;
  server_name: string;
  screens: number;
  plan_label: string;
  vencimento: string;
  price_amount: number;
  price_currency: string;
  plan_table_id: string;
  is_trial: boolean;
  is_archived: boolean;
}

interface PlanPrice {
  period: string;
  price_amount: number;
}

interface SessionData {
  tenant_id: string;
  whatsapp_username: string;
}

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

const PERIOD_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

// ========= SECURITY / NO-LEAK HELPERS =========
const IS_PROD = process.env.NODE_ENV === "production";

function debugLog(...args: any[]) {
  if (!IS_PROD) console.log(...args);
}
function debugErr(...args: any[]) {
  if (!IS_PROD) console.error(...args);
}

function getStoredSession() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem("cp_session") || "";
  } catch {
    return "";
  }
}
function setStoredSession(v: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem("cp_session", v);
  } catch {}
}
function clearStoredSession() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem("cp_session");
  } catch {}
}
function removeSessionFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has("session")) {
      u.searchParams.delete("session");
      window.history.replaceState({}, "", u.pathname + u.search + u.hash);
    }
  } catch {}
}
function safeUserError(msg: unknown) {
  const s = String(msg ?? "");
  const low = s.toLowerCase();

  // ✅ mensagens "permitidas" (genéricas) pro cliente final
  if (low.includes("sess") || low.includes("session")) return "Sessão expirada ou inválida";
  if (low.includes("conta") || low.includes("accounts")) return "Não foi possível carregar suas contas";
  if (low.includes("preço") || low.includes("prices") || low.includes("plano")) return "Não foi possível carregar os planos";

  return "Não foi possível carregar seus dados";
}

// ========= HELPERS =========
function getSPParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  return { hour: parts.find((p) => p.type === "hour")?.value || "12" };
}

function getGreeting() {
  const p = getSPParts(new Date());
  const h = Number(p.hour);
  if (h >= 4 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

function formatMoney(amount: number, currency: string = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amount);
}

function getTimeRemaining(vencimento: string) {
  const now = new Date();
  const due = new Date(vencimento);
  const diff = due.getTime() - now.getTime();
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));

  // Vencido
  if (diff <= 0) {
    const expiredDays = Math.abs(diffDays);
    if (expiredDays === 0) return { expired: true, text: "Assinatura venceu hoje" };
    if (expiredDays === 1) return { expired: true, text: "Assinatura venceu ontem" };
    return { expired: true, text: `Assinatura vencida há ${expiredDays} dias` };
  }

  // Vence hoje (menos de 24h)
  if (diffDays === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const dueFormatted = new Date(vencimento).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    return { expired: false, today: true, text: `Assinatura vence hoje às ${dueFormatted}`, hours, minutes };
  }

  // Vence amanhã
  if (diffDays === 1) return { expired: false, text: "Assinatura vence amanhã" };

  // Vence em X dias
  return { expired: false, text: `Assinatura vence em ${diffDays} dias` };
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calculateDiscount(monthlyPrice: number, totalPrice: number, months: number) {
  const monthlyEquivalent = totalPrice / months;
  const discount = ((monthlyPrice - monthlyEquivalent) / monthlyPrice) * 100;
  return Math.round(discount * 10) / 10; // 1 casa decimal
}

// ========= MAIN COMPONENT =========
export default function RenewClient() {
  const sp = useSearchParams();

  // ✅ sessão agora vem da URL OU do sessionStorage, e removemos da URL depois (sem quebrar reload)
  const [session, setSession] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = (sp.get("session") ?? "").trim();
    const stored = getStoredSession();

    const sess = fromUrl || stored || "";
    if (sess) setStoredSession(sess);

    // ✅ remove o token da barra de endereço (sem perder a sessão)
    if (fromUrl) removeSessionFromUrl();

    setSession(sess);
  }, [sp]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [accounts, setAccounts] = useState<ClientAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [prices, setPrices] = useState<PlanPrice[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("MONTHLY");
  const [showOtherPlans, setShowOtherPlans] = useState(false);

  // Estados do pagamento
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentData, setPaymentData] = useState<any>(null);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // ========= LOAD SESSION & ACCOUNTS =========
  useEffect(() => {
    async function loadData() {
      // ✅ aguarda a hidratação da sessão (URL/storage)
      if (session === null) return;

      if (!session) {
        clearStoredSession();
        setError("Sessão inválida");
        setLoading(false);
        return;
      }

      try {
        // 1. Validar sessão via API (seguro, server-side)
        const res = await fetch("/api/client-portal/validate-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: session }),
          cache: "no-store",
        });

        const result = await res.json().catch(() => null);

        if (!result?.ok) {
          clearStoredSession();
          throw new Error(result?.error || "Sessão expirada ou inválida");
        }

        const sess = result.data;

        setSessionData({
          tenant_id: sess.tenant_id,
          whatsapp_username: sess.whatsapp_username,
        });

        // 2. Buscar contas via API
        const accRes = await fetch("/api/client-portal/get-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: session }),
          cache: "no-store",
        });

        const accResult = await accRes.json().catch(() => null);

        if (!accResult?.ok) throw new Error("Não foi possível carregar suas contas");

        const mapped: ClientAccount[] = accResult.data;
        setAccounts(mapped);

        // Se só tem 1 conta, seleciona automaticamente
        if (mapped.length === 1) {
          setSelectedAccountId(mapped[0].id);
        }

        setLoading(false);
      } catch (err: any) {
        debugErr("Erro ao carregar dados (dev):", err?.message || err);
        setError(safeUserError(err?.message));
        setLoading(false);
      }
    }

    loadData();
  }, [session]);

  // ========= LOAD PRICES WHEN ACCOUNT SELECTED =========
  useEffect(() => {
    async function loadPrices() {
      if (!selectedAccountId) return;
      if (!session) return;

      const account = accounts.find((a) => a.id === selectedAccountId);
      if (!account || !account.plan_table_id) return;

      try {
        const res = await fetch("/api/client-portal/get-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_token: session,
            client_id: selectedAccountId,
          }),
          cache: "no-store",
        });

        const result = await res.json().catch(() => null);
        if (!result?.ok) throw new Error("Não foi possível carregar os planos");

        setPrices(result.data);

        // Define período inicial baseado no plano atual
        const currentPeriod = Object.keys(PERIOD_LABELS).find(
          (k) => PERIOD_LABELS[k] === account.plan_label
        );
        if (currentPeriod) setSelectedPeriod(currentPeriod);
      } catch (err: any) {
        debugErr("Erro ao carregar preços (dev):", err?.message || err);
      }
    }

    loadPrices();
  }, [selectedAccountId, accounts, session]);

  // ========= COMPUTED =========
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  const selectedPrice = useMemo(
    () => prices.find((p) => p.period === selectedPeriod),
    [prices, selectedPeriod]
  );

  const monthlyPrice = useMemo(
    () => prices.find((p) => p.period === "MONTHLY"),
    [prices]
  );

  const discount = useMemo(() => {
    if (!monthlyPrice || !selectedPrice || selectedPeriod === "MONTHLY") return 0;
    const months = PERIOD_MONTHS[selectedPeriod];
    return calculateDiscount(monthlyPrice.price_amount, selectedPrice.price_amount, months);
  }, [monthlyPrice, selectedPrice, selectedPeriod]);

  const timeRemaining = useMemo(() => {
    if (!selectedAccount) return null;
    return getTimeRemaining(selectedAccount.vencimento);
  }, [selectedAccount]);

  // ========= HANDLERS =========
  const handleSelectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ✅ NOVO: interceptar botão voltar do celular
  useEffect(() => {
    if (!selectedAccountId) return;

    // Adiciona estado no histórico
    window.history.pushState({ page: "account" }, "");

    const handlePopState = () => {
      setSelectedAccountId(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedAccountId]);

  const handleRenew = async () => {
    if (!selectedAccount) return;
    if (!session) {
      alert("Sessão expirada. Abra o link novamente.");
      clearStoredSession();
      return;
    }

    // Usa plano selecionado nas ofertas, senão usa o plano atual
    const renewPrice =
      selectedPrice && selectedPrice.price_amount > 0
        ? selectedPrice
        : prices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);

    if (!renewPrice || !renewPrice.price_amount) {
      alert("Erro: valor do plano não encontrado");
      return;
    }

    const renewPeriod =
      selectedPeriod ||
      Object.keys(PERIOD_LABELS).find((k) => PERIOD_LABELS[k] === selectedAccount.plan_label);

    if (!renewPeriod) return;

    try {
      setPaymentStatus("pending");

      // Chamar API de criação de pagamento
      const res = await fetch("/api/client-portal/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: session,
          client_id: selectedAccount.id,
          period: renewPeriod,
          price_amount: renewPrice.price_amount,
        }),
        cache: "no-store",
      });

      const result = await res.json().catch(() => null);

      if (!result?.ok) {
        debugErr("create-payment error (dev):", result);
        alert("Não foi possível criar o pagamento. Tente novamente.");
        return;
      }

      // ✅ payload real pode estar em result.data
      const payment = result.data ?? result;

      setPaymentData(payment);
      setPaymentModal(true);

      // ✅ iniciar polling usando o payload real
      if (payment?.payment_method === "online" && payment?.payment_id) {
        startPolling(String(payment.payment_id));
      }
    } catch (err: any) {
      debugErr("Erro ao renovar (dev):", err?.message || err);
      alert("Erro ao processar renovação. Tente novamente.");
    }
  };

  // Polling para verificar status do pagamento
  function startPolling(paymentId: string) {
    if (!session) return;

    // Limpar intervalo anterior se existir
    if (pollingInterval) clearInterval(pollingInterval);

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/client-portal/payment-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: session, payment_id: paymentId }),
          cache: "no-store",
        });

        if (!res.ok) {
          clearInterval(interval);
          setPollingInterval(null);
          return;
        }

        const result = await res.json().catch(() => null);

        if (!result?.ok) {
          clearInterval(interval);
          setPollingInterval(null);
          return;
        }

        const status = String(result.status || "").toLowerCase();
        const fulfillment = String(result.fulfillment_status || "").toLowerCase();

        // ✅ 1) Aprovado: só finaliza quando fulfillment estiver DONE
        if (status === "approved") {
          if (fulfillment === "done") {
            setPaymentStatus("approved");
            setPaymentData((prev: any) => ({
              ...prev,
              new_vencimento: result.new_vencimento,
            }));

            clearInterval(interval);
            setPollingInterval(null);

            // ✅ reload rápido (já foi tudo feito no backend)
            setTimeout(() => window.location.reload(), 1500);
            return;
          }

          // ✅ 1.1) Aprovado, mas backend falhou: parar e avisar suporte (SEM detalhes técnicos)
          if (fulfillment === "error") {
            debugErr("Fulfillment error (dev):", result?.error);

            alert(
              "Pagamento aprovado, mas houve falha ao renovar no servidor.\n" +
                "Procure o suporte."
            );

            clearInterval(interval);
            setPollingInterval(null);
            return;
          }

          // ✅ 1.2) approved + processing/pending => continua polling
          return;
        }

        // ✅ 2) Rejeitado/cancelado => parar
        if (status === "rejected" || status === "cancelled") {
          setPaymentStatus("rejected");
          clearInterval(interval);
          setPollingInterval(null);
          return;
        }

        // ✅ 3) pending / in_process / etc => continua polling
        return;
      } catch (err: any) {
        debugErr("Erro ao verificar status (dev):", err?.message || err);
        // continua tentando (não derruba o polling por erro de rede momentâneo)
      }
    }, 3000); // A cada 3 segundos

    setPollingInterval(interval);
  }

  // Limpar polling ao desmontar
  useEffect(() => {
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [pollingInterval]);

  function PaymentModal() {
    if (!paymentModal || !paymentData) return null;

    const isOnline = paymentData.payment_method === "online";
    const isManual = paymentData.payment_method === "manual";
    const isApproved = paymentStatus === "approved";
    const isRejected = paymentStatus === "rejected";

    // ✅ evita qualquer lixo/char inválido no link externo
    const waNumber = String((selectedAccount as any)?.whatsapp_username ?? "").replace(/[^\d]/g, "");

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Success */}
          {isApproved && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Pagamento Aprovado! 🎉</h2>
              <p className="text-slate-600 mb-4">Sua assinatura foi renovada com sucesso.</p>
              {paymentData.new_vencimento && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <p className="text-sm text-emerald-700 font-medium">
                    Novo vencimento:{" "}
                    {new Date(paymentData.new_vencimento).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      timeZone: "America/Sao_Paulo",
                    })}
                  </p>
                </div>
              )}
              <p className="text-xs text-slate-400 mt-4">Atualizando página...</p>
            </div>
          )}

          {/* Rejected */}
          {isRejected && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Pagamento Não Aprovado</h2>
              <p className="text-slate-600 mb-6">O pagamento foi cancelado ou não foi aprovado.</p>
              <button
                onClick={() => {
                  setPaymentModal(false);
                  setPaymentData(null);
                  setPaymentStatus("pending");
                }}
                className="px-6 py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-700 transition-colors"
              >
                Tentar Novamente
              </button>
            </div>
          )}

          {/* Online - QR Code PIX */}
          {isOnline && !isApproved && !isRejected && (
            <>
              <div className="bg-gradient-to-r from-emerald-500 to-green-600 p-6 text-white text-center">
                <h2 className="text-xl font-bold mb-1">Pague com PIX</h2>
                <p className="text-sm text-white/80">{paymentData.gateway_name}</p>
              </div>

              <div className="p-6 space-y-4">
                {/* QR Code */}
                <div className="bg-white p-4 rounded-xl border-2 border-slate-200">
                  {paymentData.pix_qr_code_base64 ? (
                    <img
                      src={`data:image/png;base64,${paymentData.pix_qr_code_base64}`}
                      alt="QR Code PIX"
                      className="w-full max-w-[280px] mx-auto"
                    />
                  ) : (
                    <div className="w-64 h-64 bg-slate-100 rounded-lg flex items-center justify-center mx-auto">
                      <p className="text-slate-400 text-sm">QR Code não disponível</p>
                    </div>
                  )}
                </div>

                {/* Instruções */}
                <div className="space-y-2 text-sm">
                  <p className="font-bold text-slate-700 flex items-center gap-2">
                    <span>📱</span> Como pagar:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-600 pl-6">
                    <li>Abra o app do seu banco</li>
                    <li>Escaneie o QR Code</li>
                    <li>Confirme o pagamento</li>
                  </ol>
                </div>

                {/* Código Copia e Cola */}
                {paymentData.pix_qr_code && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Ou copie o código:</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={paymentData.pix_qr_code}
                        readOnly
                        className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-700 truncate"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(paymentData.pix_qr_code);
                          alert("Código copiado!");
                        }}
                        className="px-4 py-2 bg-blue-500 text-white font-bold text-sm rounded-lg hover:bg-blue-600 transition-colors"
                      >
                        📋
                      </button>
                    </div>
                  </div>
                )}

                {/* Status */}
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 flex items-center gap-3">
                  <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-blue-800">Aguardando pagamento...</p>
                    <p className="text-xs text-blue-600">Detectaremos automaticamente quando você pagar</p>
                  </div>
                </div>

                {/* Botão Cancelar */}
                <button
                  onClick={() => {
                    if (pollingInterval) clearInterval(pollingInterval);
                    setPaymentModal(false);
                    setPaymentData(null);
                    setPaymentStatus("pending");
                  }}
                  className="w-full py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}

          {/* Manual - PIX Manual */}
          {isManual && !isApproved && !isRejected && (
            <>
              <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-6 text-white text-center">
                <h2 className="text-xl font-bold mb-1">PIX Manual</h2>
                <p className="text-sm text-white/80">Pagamento Offline</p>
              </div>

              <div className="p-6 space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-sm font-bold text-amber-800 mb-1">⚠️ Atenção</p>
                  <p className="text-xs text-amber-700">
                    Nossos gateways automáticos estão temporariamente indisponíveis. Use os dados abaixo para fazer o PIX manualmente.
                  </p>
                </div>

                {/* Dados do PIX */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Chave PIX</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={paymentData.pix_key}
                        readOnly
                        className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-800"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(paymentData.pix_key);
                          alert("Chave copiada!");
                        }}
                        className="px-4 py-2 bg-violet-500 text-white font-bold rounded-lg hover:bg-violet-600 transition-colors"
                      >
                        📋
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Tipo: {paymentData.pix_key_type?.toUpperCase() || "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Titular</p>
                    <p className="text-sm font-medium text-slate-700">{paymentData.holder_name}</p>
                  </div>

                  {paymentData.bank_name && (
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Banco</p>
                      <p className="text-sm font-medium text-slate-700">{paymentData.bank_name}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Valor</p>
                    <p className="text-2xl font-bold text-slate-800">
                      {formatMoney(paymentData.price_amount, paymentData.currency)}
                    </p>
                  </div>
                </div>

                {/* Instruções */}
                {paymentData.instructions && (
                  <div className="p-3 bg-violet-50 border border-violet-200 rounded-xl">
                    <p className="text-xs text-violet-700">{paymentData.instructions}</p>
                  </div>
                )}

                {/* Botão WhatsApp */}
                <a
                  href={`https://wa.me/${waNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3 bg-[#25D366] text-white font-bold rounded-xl hover:bg-[#20BA5A] transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                  </svg>
                  Enviar Comprovante
                </a>

                <button
                  onClick={() => {
                    setPaymentModal(false);
                    setPaymentData(null);
                  }}
                  className="w-full py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ========= RENDER: LOADING =========
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4 py-8">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-white/60">Carregando...</p>
        </div>
      </div>
    );
  }

  // ========= RENDER: ERROR =========
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-[#0a0f1a] dark:via-[#0d1321] dark:to-[#0f1629] p-4">
        <div className="max-w-md w-full bg-white dark:bg-[#161b22] rounded-2xl shadow-2xl p-8 text-center border border-red-200 dark:border-red-500/20">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-red-500 mb-2">Sessão Inválida</h1>
          <p className="text-slate-500 dark:text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  // ========= RENDER: ACCOUNT SELECTOR =========
  if (!selectedAccountId && accounts.length > 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Header com Logo */}
          <div className="text-center mb-2">
            <Image src="/brand/logo-full-light.png" alt="UniGestor" width={130} height={44} className="mx-auto" />

            <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-1">
              Olá, {accounts[0]?.display_name?.split(" ")[0]}! 👋
            </h1>
            <p className="text-lg font-medium text-slate-600 dark:text-white/70 mb-1">{getGreeting()}!</p>
            <p className="text-slate-500 dark:text-white/50 text-sm">Selecione a conta que deseja gerenciar</p>
          </div>

          {/* Lista de Contas */}
          <div className="space-y-3">
            {accounts.map((account) => {
              const time = getTimeRemaining(account.vencimento);
              return (
                <button
                  key={account.id}
                  onClick={() => handleSelectAccount(account.id)}
                  className="w-full bg-white dark:bg-[#161b22] rounded-xl p-4 border-2 border-slate-200 dark:border-white/10 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-lg hover:shadow-xl group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-left flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-slate-800 dark:text-white">{account.display_name}</h3>
                        {account.is_trial && (
                          <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 text-xs font-bold rounded">
                            TESTE
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 dark:text-white/50">
                        {account.server_name} • {account.screens} tela{account.screens > 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-white/40 mt-1">{account.server_username}</p>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold mb-1 ${time?.expired ? "text-red-500" : "text-emerald-500"}`}>
                        {time?.text}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-white/40">{account.plan_label}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ========= RENDER: NO ACCOUNTS =========
  if (accounts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-[#0a0f1a] dark:via-[#0d1321] dark:to-[#0f1629] p-4">
        <div className="max-w-md w-full bg-white dark:bg-[#161b22] rounded-2xl shadow-2xl p-8 text-center">
          <p className="text-slate-500 dark:text-white/60">Nenhuma conta encontrada</p>
        </div>
      </div>
    );
  }

  // ========= RENDER: MAIN PAGE =========
  if (!selectedAccount) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4 py-8">
      <div className="max-w-2xl mx-auto space-y-4 px-0 sm:px-4">
        {/* Header com Logo */}
        <div className="text-center mb-6">
          <Image src="/brand/logo-full-light.png" alt="UniGestor" width={130} height={44} className="mx-auto" />
        </div>

        {/* Saudação */}
        <div className="relative bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 rounded-2xl p-6 text-white shadow-xl overflow-hidden">
          {/* Decoração de fundo */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8" />
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-8 -translate-x-8" />

          <div className="relative">
            <p className="text-blue-200 text-sm font-medium mb-1">{getGreeting()}! 👋</p>
            <h1 className="text-2xl font-bold mb-3">{selectedAccount.display_name}</h1>

            {/* Status badge */}
            <div className="flex justify-center">
              {timeRemaining?.expired ? (
                <div className="inline-flex items-center gap-2 bg-red-500/30 border border-red-400/30 px-3 py-1.5 rounded-lg">
                  <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                  <span className="text-sm font-bold text-red-100">{timeRemaining.text}</span>
                </div>
              ) : selectedAccount.is_trial ? (
                <div className="inline-flex items-center gap-2 bg-sky-500/30 border border-sky-400/30 px-3 py-1.5 rounded-lg">
                  <span className="w-2 h-2 bg-sky-300 rounded-full animate-pulse" />
                  <span className="text-sm font-bold text-sky-100">Período de Teste — {timeRemaining?.text}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 bg-emerald-500/30 border border-emerald-400/30 px-3 py-1.5 rounded-lg">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                  <span className="text-sm font-bold text-emerald-100">{timeRemaining?.text}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Botão Voltar (se tem múltiplas contas) */}
        {accounts.length > 1 && (
          <button
            onClick={() => setSelectedAccountId(null)}
            className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/60 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Trocar de conta
          </button>
        )}

        {/* Card de Dados */}
        <div className="bg-white dark:bg-[#161b22] rounded-2xl shadow-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-white/5 dark:to-blue-500/5 px-6 py-4 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">📺 Dados de Acesso</h2>
          </div>

          <div className="p-3 space-y-2">
            {/* Linha 1: Usuário (grande) + Servidor (pequeno) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Usuário</label>
                <div className="text-sm font-mono text-slate-800 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 truncate">
                  {selectedAccount.server_username}
                </div>
              </div>
              <div className="col-span-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Servidor</label>
                <div className="text-sm font-medium text-slate-800 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 truncate">
                  {selectedAccount.server_name}
                </div>
              </div>
            </div>

            {/* Linha 2: Vencimento (grande) + Telas (pequeno) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vencimento</label>
                <div className="text-sm font-medium text-slate-800 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                  {formatDateTime(selectedAccount.vencimento)}
                </div>
              </div>
              <div className="col-span-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Telas</label>
                <div className="text-sm font-bold text-slate-800 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                  {selectedAccount.screens} {selectedAccount.screens > 1 ? "telas" : "tela"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Seção de Planos */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-50 to-green-50 px-4 py-3 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">💰 Planos</h2>
          </div>

          <div className="p-4 space-y-3">
            {/* Plano Atual */}
            {(() => {
              const currentPrice = prices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);
              return (
                <div className="p-4 rounded-xl bg-blue-50 border-2 border-blue-200">
                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-2">✅ Seu Plano Atual</p>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-lg">{selectedAccount.plan_label}</span>
                    <span className="text-xl font-bold text-blue-600">
                      {currentPrice && currentPrice.price_amount > 0
                        ? formatMoney(currentPrice.price_amount, selectedAccount.price_currency)
                        : "—"}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Botão Ofertas */}
            {prices.filter((p) => PERIOD_LABELS[p.period] !== selectedAccount.plan_label).length > 0 && (
              <button
                onClick={() => setShowOtherPlans(!showOtherPlans)}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-orange-200"
              >
                🏷️ {showOtherPlans ? "Fechar Ofertas" : "Ver Ofertas Disponíveis"}
                <svg
                  className={`w-4 h-4 transition-transform ${showOtherPlans ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}

            {/* Planos Disponíveis (expandível) */}
            {showOtherPlans && (
              <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Planos Disponíveis</p>
                {prices
                  .filter((p) => PERIOD_LABELS[p.period] !== selectedAccount.plan_label)
                  .map((price) => {
                    const months = PERIOD_MONTHS[price.period];
                    const currentMonthlyEquiv = (() => {
                      const currentPrice = prices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);
                      const currentMonths =
                        PERIOD_MONTHS[
                          Object.keys(PERIOD_LABELS).find((k) => PERIOD_LABELS[k] === selectedAccount.plan_label) || "MONTHLY"
                        ] || 1;
                      return currentPrice ? currentPrice.price_amount / currentMonths : 0;
                    })();

                    const thisMonthlyEquiv = price.price_amount / months;
                    const diffPercent =
                      currentMonthlyEquiv > 0
                        ? Math.round(((thisMonthlyEquiv - currentMonthlyEquiv) / currentMonthlyEquiv) * 100 * 10) / 10
                        : 0;

                    const isSelected = selectedPeriod === price.period;
                    const isCheaper = diffPercent < 0;

                    return (
                      <button
                        key={price.period}
                        onClick={() => setSelectedPeriod(price.period)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                          isSelected ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                  isSelected ? "border-emerald-500 bg-emerald-500" : "border-slate-300"
                                }`}
                              >
                                {isSelected && (
                                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path
                                      fillRule="evenodd"
                                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                              </div>
                              <span className="font-bold text-slate-800">{PERIOD_LABELS[price.period]}</span>
                              {diffPercent !== 0 && price.price_amount > 0 && (
                                <span
                                  className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                                    isCheaper ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                                  }`}
                                >
                                  {isCheaper ? `${Math.abs(diffPercent)}% mais barato/mês` : `+${diffPercent}% por mês`}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-1 ml-7">
                              {price.price_amount > 0
                                ? `${formatMoney(price.price_amount / months, selectedAccount.price_currency)}/mês`
                                : "—"}
                            </p>
                          </div>
                          <div className="text-right ml-2">
                            <div className="text-lg font-bold text-slate-800">
                              {price.price_amount > 0 ? formatMoney(price.price_amount, selectedAccount.price_currency) : "—"}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {(() => {
          // Usa plano selecionado nas ofertas, senão usa o plano atual
          const renewPrice =
            selectedPrice && selectedPrice.price_amount > 0
              ? selectedPrice
              : prices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);

          return (
            <button
              onClick={handleRenew}
              disabled={!renewPrice || !renewPrice.price_amount}
              className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Renovar Agora •{" "}
              {renewPrice && renewPrice.price_amount > 0 ? formatMoney(renewPrice.price_amount, selectedAccount.price_currency) : "—"}
            </button>
          );
        })()}

        {/* Modal de Pagamento */}
        <PaymentModal />
      </div>
    </div>
  );
}
