"use client";

import { useSearchParams } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
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
  admin_whatsapp?: string; // ✅ Adicionado
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
  const formatted = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amount);
  return formatted.replace(/^US(\$)/, "$1");
}

// ✅ PARA — usa a mesma lógica do admin (meio-dia SP + ceil)
// ✅ PARA — sem dependência externa, lógica idêntica ao admin
function getTimeRemaining(vencimento: string) {
  // ✅ PARA — converte para SP antes de extrair a data
const isoTarget = new Date(vencimento).toLocaleDateString("sv-SE", {
  timeZone: "America/Sao_Paulo",
});

  // Hoje em SP
  const todaySP = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  const d1 = new Date(`${todaySP}T12:00:00`);
  const d2 = new Date(`${isoTarget}T12:00:00`);
  const diffDays = Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

  // Vencido
  if (diffDays < 0) {
    const expiredDays = Math.abs(diffDays);
    if (expiredDays === 1) return { expired: true, text: "Assinatura venceu ontem" };
    return { expired: true, text: `Assinatura vencida há ${expiredDays} dias` };
  }

  // Vence hoje
  if (diffDays === 0) {
    const dueFormatted = new Date(vencimento).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    return { expired: false, today: true, text: `Assinatura vence hoje às ${dueFormatted}` };
  }

  // Vence amanhã
  if (diffDays === 1) return { expired: false, text: "Assinatura vence amanhã" };

  // Vence em X dias
  return { expired: false, text: `Assinatura vence em ${diffDays} dias` };
}

// ✅ PARA — sem depender de locale do navegador
function formatDateTime(dateStr: string) {
  const date = new Date(dateStr);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}`;
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

  // -------------------------------------------------------------------------
  // INÍCIO DO ESTADO DE BUSCA (Movido para o topo para respeitar as regras do React)
  // -------------------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    
    // ✅ Normaliza a busca: minúsculas e sem acentos
    const normalizedQuery = searchQuery
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return accounts.filter((a) => {
      // ✅ Junta os campos do cliente e normaliza também
      const hay = [a.display_name, a.server_username, a.server_name]
        .map(v => String(v || ""))
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      return hay.includes(normalizedQuery);
    });
  }, [accounts, searchQuery]);
  // -------------------------------------------------------------------------

  // ✅ O Backend agora é inteligente e já manda a lista certa (com ou sem Anual)
  const availablePrices = prices;

  
// Estados do pagamento
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentData, setPaymentData] = useState<any>(null);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "approved" | "rejected">("pending");
const [isProcessingPayment, setIsProcessingPayment] = useState(false); // ✅ NOVO
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [pendingRenew, setPendingRenew] = useState<{ price: PlanPrice; period: string } | null>(null);
  
  // ✅ NOVO: Estados para controle visual do botão de copiar
const [copiedCode, setCopiedCode] = useState(false);
const [copiedKey, setCopiedKey] = useState(false);
const [copiedField, setCopiedField] = useState<string | null>(null);

const [stripeReady, setStripeReady] = useState(false);
const [stripeLoading, setStripeLoading] = useState(false);
const stripeRef = useRef<any>(null);
const cardNumberRef = useRef<any>(null);
const cardExpiryRef = useRef<any>(null);
const cardCvcRef = useRef<any>(null);
const [cardNumberMountEl, setCardNumberMountEl] = useState<HTMLDivElement | null>(null);
const [cardExpiryMountEl, setCardExpiryMountEl] = useState<HTMLDivElement | null>(null);
const [cardCvcMountEl, setCardCvcMountEl] = useState<HTMLDivElement | null>(null);
const [stripeStep, setStripeStep] = useState<1 | 2>(1);
const [paymentRequest, setPaymentRequest] = useState<any>(null);
const [prButtonMountEl, setPrButtonMountEl] = useState<HTMLDivElement | null>(null);

function copyField(key: string, value: string) {
  navigator.clipboard.writeText(value ?? "");
  setCopiedField(key);
  setTimeout(() => setCopiedField(null), 3000);
}

  // ✅ NOVO: fases do fluxo (UI mais clara)
  const [paymentPhase, setPaymentPhase] = useState<
    "awaiting_payment" | "renewing" | "done" | "error"
  >("awaiting_payment");

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
          admin_whatsapp: sess.admin_whatsapp, // ✅ Pegando direto da resposta mágica da API
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
    () => availablePrices.find((p) => p.period === selectedPeriod),
    [availablePrices, selectedPeriod]
  );

  const monthlyPrice = useMemo(
    () => availablePrices.find((p) => p.period === "MONTHLY"),
    [availablePrices]
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
    // ✅ Bloqueia execução duplicada
    if (isProcessingPayment) return;
    
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
        : availablePrices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);

    if (!renewPrice || !renewPrice.price_amount) {
      alert("Erro: valor do plano não encontrado");
      return;
    }

    const renewPeriod =
      selectedPeriod ||
      Object.keys(PERIOD_LABELS).find((k) => PERIOD_LABELS[k] === selectedAccount.plan_label);

    if (!renewPeriod) return;

// BRL: vai direto pro PIX, sem seletor
    if (selectedAccount.price_currency === "BRL") {
      await handleMethodConfirmDirect("card", renewPrice, renewPeriod);
      return;
    }

    // Internacional: mostra seletor
    setPendingRenew({ price: renewPrice, period: renewPeriod });
    setShowMethodSelector(true);
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

                const phaseRaw = String(result.phase || "").toLowerCase();

        // ✅ Preferência: usar "phase" (novo contrato)
        if (phaseRaw) {
          if (phaseRaw === "awaiting_payment") {
            setPaymentPhase("awaiting_payment");
            // status visual segue pendente
            return;
          }

          if (phaseRaw === "renewing") {
            setPaymentPhase("renewing");
            // continua polling
            return;
          }

            if (phaseRaw === "done") {
              // ✅ evita agendar duas vezes se o interval rodar de novo antes de limpar
              if ((window as any).__cp_done_scheduled) return;
              (window as any).__cp_done_scheduled = true;

              setPaymentPhase("done");
              setPaymentStatus("approved");
              setPaymentData((prev: any) => ({
                ...prev,
                new_vencimento: result.new_vencimento,
              }));

              clearInterval(interval);
              setPollingInterval(null);

              // ✅ aguarda 5s com a tela "concluído" antes de atualizar a página
              setTimeout(() => window.location.reload(), 5000);
              return;
            }


          if (phaseRaw === "error") {
            setPaymentPhase("error");
            setPaymentStatus("rejected");

            alert("Pagamento aprovado, mas houve falha ao concluir a renovação.\nProcure o suporte.");

            clearInterval(interval);
            setPollingInterval(null);
            return;
          }

          // Qualquer phase desconhecida -> segue polling sem travar
          return;
        }

        // ✅ Fallback (caso seu backend ainda esteja devolvendo status/fulfillment antigo)
        const status = String(result.status || "").toLowerCase();
        const fulfillment = String(result.fulfillment_status || "").toLowerCase();

        if (status === "approved") {
          // Pagamento ok, mas fulfillment ainda rodando -> UI deve mostrar renovando
          setPaymentPhase("renewing");

if (fulfillment === "done") {
  // ✅ evita agendar duas vezes
  if ((window as any).__cp_done_scheduled) return;
  (window as any).__cp_done_scheduled = true;

  setPaymentPhase("done");
  setPaymentStatus("approved");
  setPaymentData((prev: any) => ({
    ...prev,
    new_vencimento: result.new_vencimento,
  }));

  clearInterval(interval);
  setPollingInterval(null);

  // ✅ aguarda 5s com a tela "concluído" antes de atualizar a página
  setTimeout(() => window.location.reload(), 5000);
  return;
}


          if (fulfillment === "error") {
            setPaymentPhase("error");
            setPaymentStatus("rejected");

            alert("Pagamento aprovado, mas houve falha ao concluir a renovação.\nProcure o suporte.");

            clearInterval(interval);
            setPollingInterval(null);
            return;
          }

          return;
        }

        if (status === "rejected" || status === "cancelled") {
          setPaymentPhase("error");
          setPaymentStatus("rejected");
          clearInterval(interval);
          setPollingInterval(null);
          return;
        }

        // pending/in_process/etc.
        setPaymentPhase("awaiting_payment");
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

  // Carregar Stripe.js uma vez
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).Stripe) { setStripeReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.onload = () => setStripeReady(true);
    document.head.appendChild(script);
  }, []);

  // Montar 3 card elements quando modal Stripe abrir
  useEffect(() => {
    if (!paymentModal || !paymentData || paymentData.payment_method !== "stripe") return;
    if (!stripeReady || !cardNumberMountEl || !cardExpiryMountEl || !cardCvcMountEl) return;
    if (!(window as any).Stripe) return;

    const stripe = (window as any).Stripe(paymentData.publishable_key);
    stripeRef.current = stripe;
    const elements = stripe.elements();

    const style = {
      base: {
        fontSize: "16px",
        color: "#1e293b",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        "::placeholder": { color: "#94a3b8" },
      },
    };

    const cardNumber = elements.create("cardNumber", { style, showIcon: true });
    const cardExpiry = elements.create("cardExpiry", { style });
    const cardCvc = elements.create("cardCvc", { style });

cardNumber.mount(cardNumberMountEl);
    cardExpiry.mount(cardExpiryMountEl);
    cardCvc.mount(cardCvcMountEl);

    cardNumberRef.current = cardNumber;
    cardExpiryRef.current = cardExpiry;
    cardCvcRef.current = cardCvc;

    // Auto-avanço de validade → CVC
    cardExpiry.on("change", (e: any) => {
      if (e.complete) cardCvc.focus();
    });

    return () => {
      try { cardNumber.unmount(); } catch {}
      try { cardExpiry.unmount(); } catch {}
      try { cardCvc.unmount(); } catch {}
    };
  }, [paymentModal, paymentData, stripeReady, cardNumberMountEl, cardExpiryMountEl, cardCvcMountEl]);

// Montar PaymentRequestButton (Apple Pay / Google Pay)
  useEffect(() => {
    if (!paymentModal || !paymentData || paymentData.payment_method !== "apple_google") return;
    if (!stripeReady || !prButtonMountEl) return;
    if (!(window as any).Stripe) return;

    const stripe = (window as any).Stripe(paymentData.publishable_key);
    stripeRef.current = stripe;

    const pr = stripe.paymentRequest({
      country: "BR",
      currency: (paymentData.currency || "eur").toLowerCase(),
      total: {
        label: paymentData.gateway_name || "UniGestor",
        amount: Math.round((paymentData.price_amount ?? 0) * 100),
      },
      requestPayerName: false,
      requestPayerEmail: false,
    });

    pr.canMakePayment().then((result: any) => {
      if (!result) {
        // Dispositivo não suporta Apple/Google Pay — cai no cartão normal
        setPaymentData((prev: any) => ({ ...prev, payment_method: "stripe" }));
        return;
      }

      const elements = stripe.elements();
      const prButton = elements.create("paymentRequestButton", {
        paymentRequest: pr,
        style: { paymentRequestButton: { height: "52px", borderRadius: "12px" } },
      });
      prButton.mount(prButtonMountEl);

      pr.on("paymentmethod", async (ev: any) => {
        const { error, paymentIntent } = await stripe.confirmCardPayment(
          paymentData.client_secret,
          { payment_method: ev.paymentMethod.id },
          { handleActions: false }
        );

        if (error) {
          ev.complete("fail");
          alert(error.message || "Erro ao processar pagamento.");
          return;
        }

        ev.complete("success");

        if (paymentIntent.status === "succeeded") {
          setPaymentPhase("renewing");
          startPolling(String(paymentData.payment_id));
        } else if (paymentIntent.status === "requires_action") {
          const { error: actionError } = await stripe.confirmCardPayment(paymentData.client_secret);
          if (actionError) {
            alert(actionError.message || "Autenticação necessária falhou.");
            return;
          }
          setPaymentPhase("renewing");
          startPolling(String(paymentData.payment_id));
        }
      });

      setPaymentRequest(pr);
    });

    return () => { try { prButtonMountEl.innerHTML = ""; } catch {} };
  }, [paymentModal, paymentData, stripeReady, prButtonMountEl]);

// ✅ REGRA DO SUPORTE: Pega estritamente o do admin.
  const supportPhone = sessionData?.admin_whatsapp || "";
async function handleMethodConfirmDirect(
    choice: "card" | "apple_google" | "manual",
    overridePrice?: PlanPrice,
    overridePeriod?: string
  ) {
    const resolvedPeriod = overridePeriod ?? pendingRenew?.period;
    if (!resolvedPeriod || !selectedAccount || !session) return;
    setShowMethodSelector(false);

    try {
      setIsProcessingPayment(true);
      (window as any).__cp_done_scheduled = false;
      setPaymentStatus("pending");
      setPaymentPhase("awaiting_payment");
      setPaymentData(null);

      const res = await fetch("/api/client-portal/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: session,
          client_id: selectedAccount.id,
          period: resolvedPeriod,
          screens: selectedAccount.screens,
          force_manual: choice === "manual",
        }),
        cache: "no-store",
      });

      const result = await res.json().catch(() => null);

      if (!result?.ok) {
        debugErr("create-payment error (dev):", result);
        alert("Não foi possível criar o pagamento. Tente novamente.");
        return;
      }

      const payment = result.data ?? result;
      // Apple/Google Pay usa o mesmo PaymentIntent do Stripe mas com UI diferente
      if (choice === "apple_google" && payment.payment_method === "stripe") {
        payment.payment_method = "apple_google";
      }
      setPaymentData(payment);
      setStripeStep(1);
      setPaymentModal(true);

      // Stripe: NÃO inicia polling aqui — só após confirmCardPayment ter sucesso
      if (payment?.payment_method === "online" && payment?.payment_id) {
        startPolling(String(payment.payment_id));
      }
    } catch (err: any) {
      debugErr("Erro ao renovar (dev):", err?.message || err);
      alert("Erro ao processar renovação. Tente novamente.");
    } finally {
      setIsProcessingPayment(false);
      setPendingRenew(null);
    }
  }

  async function handleStripeConfirm() {
    if (!stripeRef.current || !cardNumberRef.current || !paymentData) return;
    setStripeLoading(true);
    try {
      const result = await stripeRef.current.confirmCardPayment(paymentData.client_secret, {
        payment_method: { card: cardNumberRef.current },
      });

      if (result.error) {
        alert(result.error.message || "Erro ao processar cartão.");
        return;
      }

      if (result.paymentIntent?.status === "succeeded") {
        // Pagamento confirmado — mostra "renovando" e inicia polling
        setPaymentPhase("renewing");
        startPolling(String(paymentData.payment_id));
      }
    } catch (e: any) {
      console.error("STRIPE ERROR:", e);
      alert((e?.message) || "Erro ao processar pagamento. Tente novamente.");
    } finally {
      setStripeLoading(false);
    }
  }

  function MethodSelectorModal() {
    if (!showMethodSelector || !pendingRenew || !selectedAccount) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 py-4 px-6 text-white text-center">
            <h2 className="text-lg font-bold">Como deseja pagar?</h2>
            <p className="text-sm text-white/70 mt-0.5">
              {formatMoney(pendingRenew.price.price_amount, selectedAccount.price_currency)}
            </p>
          </div>

          <div className="p-4 space-y-3">
            <button
              onClick={() => handleMethodConfirmDirect("card")}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-xl shrink-0">💳</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="font-bold text-slate-800">Cartão de Crédito / Débito</p>
                </div>
                <p className="text-xs text-slate-500 mb-1">Visa, Mastercard, Amex...</p>
                <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">✅ Renovação Automática</span>
              </div>
            </button>

            <button
              onClick={() => handleMethodConfirmDirect("apple_google")}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">📱</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 mb-0.5">Apple Pay / Google Pay</p>
                <p className="text-xs text-slate-500 mb-1">Utilize a carteira digital do seu dispositivo</p>
                <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">✅ Renovação Automática</span>
              </div>
            </button>

            <button
              onClick={() => handleMethodConfirmDirect("manual")}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 hover:border-amber-400 hover:bg-amber-50 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl shrink-0">🏦</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 mb-0.5">Transferência Bancária</p>
                <p className="text-xs text-slate-500 mb-1">IBAN / SEPA — confirmação via suporte</p>
                <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">⚠️ Renovação Manual</span>
              </div>
            </button>

            <button
              onClick={() => { setShowMethodSelector(false); setPendingRenew(null); }}
              className="w-full text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors pt-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  function PaymentModal() {
    if (!paymentModal || !paymentData) return null;

const isOnline = paymentData.payment_method === "online";
    const isManual = paymentData.payment_method === "manual";
    const isStripe = paymentData.payment_method === "stripe";

const effectiveGatewayType: string =
  paymentData.gateway_type ||
  (paymentData.currency === "EUR"
    ? "transfer_manual_eur"
    : paymentData.currency === "USD"
    ? "transfer_manual_usd"
    : "pix_manual");
    const isApproved = paymentStatus === "approved";
    const isRejected = paymentStatus === "rejected";

    // ✅ evita qualquer lixo/char inválido no link externo
    const waNumber = String(sessionData?.admin_whatsapp ?? "").replace(/[^\d]/g, "");


return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-y-auto max-h-[95vh]">
          {/* Success */}
          {isApproved && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
<h2 className="text-2xl font-bold text-slate-800 mb-2">Renovação realizada com sucesso ✅</h2>
<p className="text-slate-600 mb-4">Pagamento confirmado e assinatura atualizada.</p>

              {paymentData.new_vencimento && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <p className="text-sm text-emerald-700 font-medium">
                    Novo vencimento:{" "}
{paymentData.new_vencimento && (
  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
    <p className="text-sm text-emerald-700 font-medium">
      Novo vencimento:{" "}
      {formatDateTime(paymentData.new_vencimento)}
    </p>
  </div>
)}



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
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Falha na Renovação</h2>
              <p className="text-slate-600 mb-6">Confirme se a transferência foi realizada e entre em contato com o suporte.</p>
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
    <div className="bg-gradient-to-r from-emerald-500 to-green-600 py-3 px-6 text-white text-center">
      <h2 className="text-xl font-bold mb-1">
        {paymentPhase === "renewing" ? "Pagamento confirmado ✅" : "Pague com PIX"}
      </h2>

      <p className="text-sm text-white/80">
        {paymentPhase === "renewing"
          ? "Renovação em andamento…"
          : (paymentData.gateway_name || "Mercado Pago")}
      </p>

      {/* ✅ extra: ainda mostra o gateway, mas sem poluir */}
      {paymentPhase === "renewing" && paymentData.gateway_name && (
        <p className="text-[11px] text-white/70 mt-1">{paymentData.gateway_name}</p>
      )}
    </div>


              <div className="px-5 pt-4 pb-3 space-y-3">
                {/* QR Code */}
                {paymentPhase !== "renewing" && (
                  <div className="bg-white p-2 sm:p-4 rounded-xl border-2 border-slate-200">
                    {paymentData.pix_qr_code_base64 ? (
                      <img
                        src={`data:image/png;base64,${paymentData.pix_qr_code_base64}`}
                        alt="QR Code PIX"
                        className="w-full max-w-[180px] sm:max-w-[220px] mx-auto"
                      />
                    ) : (
                      <div className="w-48 h-48 sm:w-56 sm:h-56 bg-slate-100 rounded-lg flex items-center justify-center mx-auto">
                        <p className="text-slate-400 text-sm text-center">QR Code não disponível</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Instruções */}
                {paymentPhase !== "renewing" && (
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
                )}

                {/* Código Copia e Cola - Visual Premium */}
                {paymentPhase !== "renewing" && paymentData.pix_qr_code && (
                  <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-slate-200 dark:border-white/10 space-y-2">
                    <p className="text-xs font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider text-center">Ou copie o código:</p>
                    <div className="relative group">
                      <input
                        type="text"
                        value={paymentData.pix_qr_code}
                        readOnly
                        className="w-full pr-28 pl-3 py-2.5 bg-white dark:bg-[#161b22] border-2 border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono text-slate-700 dark:text-white outline-none focus:border-blue-500 transition-colors shadow-sm"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(paymentData.pix_qr_code);
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 3000);
                        }}
                        className={`absolute right-1 top-1 bottom-1 px-4 text-white font-bold text-xs rounded-md transition-all flex items-center justify-center gap-1.5 min-w-[90px] ${
                          copiedCode ? "bg-emerald-500 hover:bg-emerald-600" : "bg-blue-500 hover:bg-blue-600 shadow-sm"
                        }`}
                      >
                        {copiedCode ? "✅ Copiado" : "📋 Copiar"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Status */}
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 flex items-center gap-3">
                  <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-blue-800">
                      {paymentPhase === "renewing" ? "Processando renovação..." : "Aguardando pagamento..."}
                    </p>
                    <p className="text-xs text-blue-600">
                      {paymentPhase === "renewing"
                        ? "Estamos atualizando sua assinatura no servidor. Isso pode levar alguns segundos."
                        : "Detectaremos automaticamente quando você pagar"}
                    </p>
                  </div>
                </div>


                {/* Botão Cancelar */}
                {paymentPhase !== "renewing" && (
                  <button
                    onClick={() => {
                      if (pollingInterval) clearInterval(pollingInterval);
                      setPaymentModal(false);
                      setPaymentData(null);
                      setPaymentStatus("pending");
                      setPaymentPhase("awaiting_payment");
                    }}
                    className="w-full pb-1 pt-0 !mt-3 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </>
          )}

{/* Stripe - Cartão Internacional */}
          {isStripe && !isApproved && !isRejected && (
            <>
              <div className="bg-gradient-to-r from-indigo-600 to-violet-600 py-3 px-6 text-white text-center">
                <h2 className="text-xl font-bold mb-1">
                  {paymentPhase === "renewing" ? "Pagamento confirmado ✅" : stripeStep === 1 ? "Dados do Cartão" : "Confirmar Pagamento"}
                </h2>
                <p className="text-sm text-white/80">
                  {paymentPhase === "renewing" ? "Renovação em andamento…" : paymentData.gateway_name || "Stripe"}
                </p>
              </div>

              <div className="px-5 pt-5 pb-4 space-y-4">

                {paymentPhase !== "renewing" && (
                  <>
                    {/* Valor */}
                    <div className="text-center">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total a pagar</p>
                      <p className="text-3xl font-black text-slate-800">
                        {formatMoney(paymentData.price_amount ?? 0, paymentData.currency ?? selectedAccount?.price_currency ?? "EUR")}
                      </p>
                    </div>

                    {/* Trust signals */}
                    {(paymentData.beneficiary_name || paymentData.institution) && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-lg">🔒</div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Pagamento para</p>
                          {paymentData.beneficiary_name && (
                            <p className="text-sm font-bold text-slate-800 truncate">{paymentData.beneficiary_name}</p>
                          )}
                          <p className="text-xs text-slate-500">{paymentData.institution || "Stripe"}</p>
                        </div>
                        <span className="ml-auto shrink-0 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">✅ Seguro</span>
                      </div>
                    )}

                    {/* 2-step card fields */}
                    <div className="relative">
                      {/* Step 1: Número do cartão */}
                      <div className={stripeStep === 1 ? "space-y-3" : "absolute top-0 left-0 w-full opacity-0 pointer-events-none space-y-3"}>
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Número do Cartão</p>
                          <div
                            ref={setCardNumberMountEl}
                            className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus-within:border-indigo-500 transition-colors min-h-[46px]"
                          />
                        </div>
                        <button
                          onClick={() => setStripeStep(2)}
                          disabled={!stripeReady}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          Continuar →
                        </button>
                      </div>

                      {/* Step 2: Validade + CVC */}
                      <div className={stripeStep === 2 ? "space-y-3" : "absolute top-0 left-0 w-full opacity-0 pointer-events-none space-y-3"}>
                        <button
                          onClick={() => setStripeStep(1)}
                          className="text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1"
                        >
                          ← Voltar
                        </button>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Validade</p>
                            <div
                              ref={setCardExpiryMountEl}
                              className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus-within:border-indigo-500 transition-colors min-h-[46px]"
                            />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">CVC</p>
                            <div
                              ref={setCardCvcMountEl}
                              className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus-within:border-indigo-500 transition-colors min-h-[46px]"
                            />
                          </div>
                        </div>
                        <button
                          onClick={handleStripeConfirm}
                          disabled={stripeLoading || !stripeReady}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {stripeLoading ? (
                            <>
                              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Processando...
                            </>
                          ) : (
                            <>🔒 Confirmar Pagamento</>
                          )}
                        </button>
                      </div>
                    </div>

                    <p className="text-center text-[10px] text-slate-400">
                      Pagamento processado com segurança via Stripe
                    </p>

                    <button
                      onClick={() => {
                        setPaymentModal(false);
                        setPaymentData(null);
                        setPaymentStatus("pending");
                        setPaymentPhase("awaiting_payment");
                        setStripeStep(1);
                      }}
                      className="w-full text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      Cancelar
                    </button>
                  </>
                )}

                {/* Renovando */}
                {paymentPhase === "renewing" && (
                  <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-200 flex items-center gap-3">
                    <div className="w-6 h-6 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-indigo-800">Processando renovação...</p>
                      <p className="text-xs text-indigo-600">Atualizando sua assinatura no servidor.</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Apple Pay / Google Pay */}
          {paymentData.payment_method === "apple_google" && !isApproved && !isRejected && (
            <>
              <div className="bg-gradient-to-r from-slate-800 to-slate-900 py-3 px-6 text-white text-center">
                <h2 className="text-xl font-bold mb-1">
                  {paymentPhase === "renewing" ? "Pagamento confirmado ✅" : "Apple Pay / Google Pay"}
                </h2>
                <p className="text-sm text-white/80">
                  {paymentPhase === "renewing" ? "Renovação em andamento…" : paymentData.gateway_name || "Stripe"}
                </p>
              </div>

              <div className="px-5 pt-5 pb-4 space-y-4">
                {paymentPhase !== "renewing" && (
                  <>
                    <div className="text-center">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total a pagar</p>
                      <p className="text-3xl font-black text-slate-800">
                        {formatMoney(paymentData.price_amount ?? 0, paymentData.currency ?? "EUR")}
                      </p>
                    </div>

                    {(paymentData.beneficiary_name || paymentData.institution) && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-lg">🔒</div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Pagamento para</p>
                          {paymentData.beneficiary_name && (
                            <p className="text-sm font-bold text-slate-800 truncate">{paymentData.beneficiary_name}</p>
                          )}
                          <p className="text-xs text-slate-500">{paymentData.institution || "Stripe"}</p>
                        </div>
                        <span className="ml-auto shrink-0 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">✅ Seguro</span>
                      </div>
                    )}

                    {/* div sempre renderizado para o ref funcionar */}
                    <div ref={setPrButtonMountEl} className={`min-h-[52px] ${paymentRequest ? "" : "hidden"}`} />
                    {!paymentRequest && (
                      <div className="flex items-center justify-center py-4 gap-2 text-slate-400 text-sm">
                        <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                        Verificando disponibilidade...
                      </div>
                    )}

                    <p className="text-center text-[10px] text-slate-400">
                      Pagamento processado com segurança via Stripe
                    </p>

                    <button
                      onClick={() => {
                        setPaymentModal(false);
                        setPaymentData(null);
                        setPaymentStatus("pending");
                        setPaymentPhase("awaiting_payment");
                        setStripeStep(1);
                      }}
                      className="w-full text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      Cancelar
                    </button>
                  </>
                )}

                {paymentPhase === "renewing" && (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                    <div className="w-6 h-6 border-4 border-slate-600 border-t-transparent rounded-full animate-spin shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-slate-800">Processando renovação...</p>
                      <p className="text-xs text-slate-500">Atualizando sua assinatura no servidor.</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Manual - Fallbacks (PIX ou Internacional) */}
          {isManual && !isApproved && !isRejected && (
            <>
              {/* HEADER DINÂMICO BASEADO NO TIPO */}
              <div className={`py-3 px-6 text-white text-center ${
  effectiveGatewayType === "transfer_manual_eur" || effectiveGatewayType === "transfer_manual_usd" 
    ? "bg-gradient-to-r from-blue-600 to-indigo-700" 
    : "bg-gradient-to-r from-violet-500 to-purple-600"
}`}>
  <h2 className="text-xl font-bold mb-1">
    {effectiveGatewayType === "transfer_manual_eur" ? "Transferência em Euros" : 
     effectiveGatewayType === "transfer_manual_usd" ? "Transferência em Dólares" : 
     "PIX Manual"}
  </h2>
                <p className="text-sm text-white/80">Pagamento Offline</p>
              </div>

              <div className="px-5 pt-4 pb-3 space-y-3">
  
                {/* 1. DADOS PARA PIX MANUAL */}
                {(effectiveGatewayType === "pix_manual") && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Chave PIX</p>
                      <div className="relative group">
                        <input
                          type="text"
                          value={paymentData.pix_key || ""}
                          readOnly
                          className="w-full pr-28 pl-3 py-2.5 bg-white dark:bg-[#161b22] border-2 border-slate-200 dark:border-white/10 rounded-lg text-sm font-mono text-slate-800 dark:text-white outline-none focus:border-violet-500 transition-colors shadow-sm"
                        />
                        <button
                          onClick={() => {
                            if (paymentData.pix_key) navigator.clipboard.writeText(paymentData.pix_key);
                            setCopiedKey(true);
                            setTimeout(() => setCopiedKey(false), 3000);
                          }}
                          className={`absolute right-1 top-1 bottom-1 px-4 text-white font-bold text-xs rounded-md transition-all flex items-center justify-center gap-1.5 min-w-[90px] ${
                            copiedKey ? "bg-emerald-500 hover:bg-emerald-600" : "bg-violet-500 hover:bg-violet-600 shadow-sm"
                          }`}
                        >
                          {copiedKey ? "✅ Copiado" : "📋 Copiar"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Tipo: {paymentData.pix_key_type?.toUpperCase() || "—"}
                      </p>
                    </div>
                    
                    <div>
  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Titular (Favorecido)</p>
  <div className="flex items-center justify-between gap-2">
    <p className="text-sm font-medium text-slate-700 dark:text-white/80">{paymentData.beneficiary_name || paymentData.holder_name}</p>
    <button onClick={() => copyField("pix_name", paymentData.beneficiary_name || paymentData.holder_name)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "pix_name" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "pix_name" ? "✅ Copiado" : "📋 Copiar"}</button>
  </div>
</div>

{paymentData.institution && (
  <div>
    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Instituição Bancária</p>
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium text-slate-700 dark:text-white/80">{paymentData.institution}</p>
      <button onClick={() => copyField("pix_inst", paymentData.institution)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "pix_inst" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "pix_inst" ? "✅ Copiado" : "📋 Copiar"}</button>
    </div>
  </div>
)}
                  </div>
                )}

                {/* 2. DADOS PARA TRANSFERÊNCIA EUR */}
{effectiveGatewayType === "transfer_manual_eur" && (
  <div className="space-y-3 bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/10">
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Nome do Favorecido</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 dark:text-white">{paymentData.beneficiary_name}</p>
        <button onClick={() => copyField("eur_name", paymentData.beneficiary_name)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_name" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "eur_name" ? "✅ Copiado" : "📋 Copiar"}</button>
      </div>
    </div>
    {paymentData.bank_name && (
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Nome do Banco</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-800 dark:text-white">{paymentData.bank_name}</p>
          <button onClick={() => copyField("eur_bank", paymentData.bank_name)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_bank" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "eur_bank" ? "✅ Copiado" : "📋 Copiar"}</button>
        </div>
      </div>
    )}
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">IBAN</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-mono font-medium text-slate-800 dark:text-white break-all">{paymentData.iban}</p>
        <button onClick={() => copyField("eur_iban", paymentData.iban)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_iban" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "eur_iban" ? "✅ Copiado" : "📋 Copiar"}</button>
      </div>
    </div>
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Swift/BIC</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-mono font-medium text-slate-800 dark:text-white">{paymentData.swift_bic}</p>
        <button onClick={() => copyField("eur_swift", paymentData.swift_bic)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_swift" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "eur_swift" ? "✅ Copiado" : "📋 Copiar"}</button>
      </div>
    </div>
    {paymentData.bank_address && (
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Endereço do Banco</p>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-slate-600 dark:text-white/70 leading-snug">{paymentData.bank_address}</p>
          <button onClick={() => copyField("eur_addr", paymentData.bank_address)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_addr" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "eur_addr" ? "✅ Copiado" : "📋 Copiar"}</button>
        </div>
      </div>
    )}
  </div>
)}

                {/* 3. DADOS PARA TRANSFERÊNCIA USD */}
{effectiveGatewayType === "transfer_manual_usd" && (
  <div className="space-y-3 bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/10">
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Nome do Favorecido</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 dark:text-white">{paymentData.beneficiary_name}</p>
        <button onClick={() => copyField("usd_name", paymentData.beneficiary_name)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_name" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "usd_name" ? "✅ Copiado" : "📋 Copiar"}</button>
      </div>
    </div>
    {paymentData.bank_name && (
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Nome do Banco</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-800 dark:text-white">{paymentData.bank_name}</p>
          <button onClick={() => copyField("usd_bank", paymentData.bank_name)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_bank" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "usd_bank" ? "✅ Copiado" : "📋 Copiar"}</button>
        </div>
      </div>
    )}
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Número da conta</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-mono font-medium text-slate-800 dark:text-white">{paymentData.account_number}</p>
        <button onClick={() => copyField("usd_acc", paymentData.account_number)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_acc" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "usd_acc" ? "✅ Copiado" : "📋 Copiar"}</button>
      </div>
    </div>
    {paymentData.account_type && (
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Tipo da conta</p>
        <p className="text-sm font-medium text-slate-800 dark:text-white">{paymentData.account_type}</p>
      </div>
    )}
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Routing number</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-mono font-medium text-slate-800 dark:text-white">{paymentData.routing_number}</p>
        <button onClick={() => copyField("usd_routing", paymentData.routing_number)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_routing" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "usd_routing" ? "✅ Copiado" : "📋 Copiar"}</button>
      </div>
    </div>
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Swift/BIC</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-mono font-medium text-slate-800 dark:text-white">{paymentData.swift_bic}</p>
        <button onClick={() => copyField("usd_swift", paymentData.swift_bic)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_swift" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "usd_swift" ? "✅ Copiado" : "📋 Copiar"}</button>
      </div>
    </div>
    {paymentData.bank_address && (
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Endereço do Banco</p>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-slate-600 dark:text-white/70 leading-snug">{paymentData.bank_address}</p>
          <button onClick={() => copyField("usd_addr", paymentData.bank_address)} className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_addr" ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300"}`}>{copiedField === "usd_addr" ? "✅ Copiado" : "📋 Copiar"}</button>
        </div>
      </div>
    )}
  </div>
)}

                {/* AVISO IMPORTANTE (Piscando) */}
                <div className="pt-2 animate-pulse">
                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase text-center bg-rose-50 dark:bg-rose-500/10 p-2 rounded-lg border border-rose-200 dark:border-rose-500/30">
                    ⚠️ Importante: Favor não colocar observações na transferência.
                  </p>
                </div>

                {/* VALOR A TRANSFERIR (GLOBAL PARA TODOS OS MANUAIS) */}
                <div className="pt-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Valor a Transferir</p>
                  <p className="text-2xl font-bold text-slate-800 dark:text-white">
                    {formatMoney(paymentData.price_amount, paymentData.currency)}
                  </p>
                </div>

                {/* Instruções */}
                {paymentData.instructions && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-xs text-blue-700">{paymentData.instructions}</p>
                  </div>
                )}

                {/* Botão WhatsApp */}
                {waNumber ? (
                  <a
                    href={`https://wa.me/${waNumber}?text=Olá,%20acabei%20de%20fazer%20uma%20transferência.%20Segue%20o%20comprovante.`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 py-3 bg-[#25D366] text-white font-bold rounded-xl hover:bg-[#20BA5A] transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                    </svg>
                    Enviar Comprovante
                  </a>
                ) : null}

                <button
                  onClick={() => {
                    setPaymentModal(false);
                    setPaymentData(null);
                  }}
                  className="w-full pb-1 pt-0 !mt-3 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
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
      <div className="min-h-screen bg-slate-50 dark:bg-[#0f141a]">
        
        {/* --- TOPO FIXO IDÊNTICO AO SEU ADMIN --- */}
        <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-2">
            
            {/* Logo Responsiva */}
            <div className="flex items-center gap-3 min-w-0 cursor-pointer group">
              <Image
                src="/brand/logo-gestor-celular.png"
                alt="Gestor"
                width={44}
                height={44}
                className="h-10 w-10 select-none object-contain sm:hidden transition-transform group-hover:scale-105"
                draggable={false}
                priority
              />
              <Image
                src="/brand/logo-gestor.png"
                alt="Gestor"
                width={160}
                height={40}
                className="hidden sm:block h-10 w-auto select-none object-contain transition-transform group-hover:scale-105"
                draggable={false}
                priority
              />
              {/* Usuário Logado */}
              <div className="min-w-0 flex flex-col justify-center">
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold leading-none mb-0.5 transition-colors">
                  Logado como
                </div>
                <div className="text-xs font-bold text-white truncate max-w-[140px] sm:max-w-66 tracking-tight uppercase">
                  {accounts[0]?.display_name}
                </div>
              </div>
            </div>

            <div className="flex-1" />

            {/* Ações (Direita) */}
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {/* ✅ Suporte do Sistema Seguro */}
            {supportPhone && (
              <a 
                href={`https://wa.me/${supportPhone.replace(/\D/g, "")}?text=Olá,%20preciso%20de%20ajuda%20com%20minha%20assinatura!`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[#25D366] hover:opacity-80 transition-opacity"
                title="Fale com o Suporte"
              >
                <IconWhatsapp />
                <div className="hidden sm:flex flex-col text-left">
                   <span className="text-[9px] uppercase tracking-wider text-white/50 leading-none">Suporte</span>
                   <span className="text-xs font-bold tracking-wide leading-none mt-0.5">
                     {supportPhone}
                   </span>
                </div>
              </a>
            )}
              
              <button 
                onClick={() => { clearStoredSession(); window.location.reload(); }}
                className="text-white/50 hover:text-rose-500 transition-colors"
                title="Sair"
              >
                <IconLogout />
              </button>
            </div>

          </div>
        </div>

        {/* --- CORPO DA PÁGINA --- */}
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
          <div className="mb-4 sm:mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
              {getGreeting()}! 👋
            </h1>
            <p className="text-slate-500 dark:text-white/60 text-sm mt-1">Qual conta você deseja gerenciar hoje?</p>
          </div>

          {/* Busca (Opcional) */}
          {accounts.length > 3 && (
            <div className="mb-4 sm:mb-6 relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
              <input
                type="text"
                placeholder="Buscar conta..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-12 pl-12 pr-4 bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:border-blue-500 transition-colors shadow-sm"
              />
            </div>
          )}

          {/* --- CARDS DE CONTAS (Layout 3 Linhas) --- */}
          <div className="space-y-4">
            {filteredAccounts.length === 0 ? (
              <div className="text-center py-8 text-slate-400 bg-white/50 dark:bg-white/5 rounded-xl border border-dashed border-slate-300 dark:border-white/10">
                Nenhuma conta encontrada.
              </div>
            ) : (
              filteredAccounts.map((account) => {
                const time = getTimeRemaining(account.vencimento);
                return (
                  <button
                    key={account.id}
                    onClick={() => handleSelectAccount(account.id)}
                    className="w-full text-left bg-white dark:bg-[#161b22] rounded-xl p-4 border border-slate-200 hover:border-blue-500 dark:border-white/10 dark:hover:border-blue-500 transition-all shadow-sm hover:shadow-md group relative overflow-hidden"
                  >
                    {/* Linha 1: Nome (Esq) | Username (Dir, preservando maiúsculas/minúsculas) */}
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-bold text-slate-800 dark:text-white truncate pr-2 flex items-center gap-2">
                        {account.display_name}
                        {account.is_trial && (
                          <span className="px-1.5 py-0.5 bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 text-[9px] font-bold rounded uppercase tracking-wider">
                            TESTE
                          </span>
                        )}
                      </h3>
                      {/* Usuário sem uppercase, usando fonte mono para clareza */}
                      <span className="text-xs font-mono font-medium text-slate-600 dark:text-white/70 shrink-0 bg-slate-50 dark:bg-black/20 px-2 py-1 rounded border border-slate-200 dark:border-white/5">
                        {account.server_username}
                      </span>
                    </div>

                    {/* Linha 2: Servidor + Telas (Esq) | Plano (Dir) */}
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm font-medium text-slate-500 dark:text-white/60 truncate">
                        {account.server_name} <span className="mx-1 opacity-50">•</span> {account.screens} tela{account.screens > 1 ? "s" : ""}
                      </p>
                      <div className="inline-block px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded text-[10px] font-bold uppercase tracking-wider border border-blue-100 dark:border-blue-500/20 shrink-0">
                        {account.plan_label}
                      </div>
                    </div>

                    {/* Linha 3: Vencimento (Centralizado) */}
                    <div className={`w-full text-center py-2 rounded-lg border ${
                      time?.expired 
                        ? "bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400" 
                        : "bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
                    }`}>
                      <span className="text-sm font-bold block tracking-tight">{time?.text}</span>
                    </div>
                  </button>
                );
              })
            )}
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
    <div className="min-h-screen bg-slate-50 dark:bg-[#0f141a]">
      
{/* --- TOPO FIXO IDÊNTICO AO SEU ADMIN --- */}
      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-2">
          
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Botão de Voltar para a Tela 1 */}
            <button
              onClick={() => setSelectedAccountId(null)}
              className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors shrink-0"
              title="Voltar"
            >
              <span className="text-lg leading-none mt-[-2px]">←</span>
            </button>
            
            <Image
              src="/brand/logo-gestor-celular.png"
              alt="Gestor"
              width={44}
              height={44}
              className="h-10 w-10 select-none object-contain sm:hidden"
              draggable={false}
              priority
            />
            <Image
              src="/brand/logo-gestor.png"
              alt="Gestor"
              width={160}
              height={40}
              className="hidden sm:block h-10 w-auto select-none object-contain"
              draggable={false}
              priority
            />
            <div className="min-w-0 flex flex-col justify-center">
              <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold leading-none mb-0.5">
                Logado como
              </div>
              <div className="text-xs font-bold text-white truncate max-w-[130px] sm:max-w-66 tracking-tight uppercase">
                {selectedAccount.display_name}
              </div>
            </div>
          </div>

          <div className="flex-1" />

          {/* Ações */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            {/* ✅ Suporte do Sistema Seguro */}
            {supportPhone && (
              <a 
                href={`https://wa.me/${supportPhone.replace(/\D/g, "")}?text=Olá,%20preciso%20de%20ajuda%20com%20minha%20assinatura!`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[#25D366] hover:opacity-80 transition-opacity"
                title="Fale com o Suporte"
              >
                <IconWhatsapp />
                <div className="hidden sm:flex flex-col text-left">
                   <span className="text-[9px] uppercase tracking-wider text-white/50 leading-none">Suporte</span>
                   <span className="text-xs font-bold tracking-wide leading-none mt-0.5">
                     {supportPhone}
                   </span>
                </div>
              </a>
            )}
            
            <button 
              onClick={() => { clearStoredSession(); window.location.reload(); }}
              className="text-white/50 hover:text-rose-500 transition-colors"
              title="Sair"
            >
              <IconLogout />
            </button>
          </div>
        </div>
      </div>

{/* --- CORPO DA PÁGINA --- */}
      <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4 px-3 sm:px-4 py-4 sm:py-6">
        
        {/* Vencimento Centralizado (Substitui Card Azul) */}
        <div className={`w-full text-center py-3 sm:py-4 rounded-xl shadow-sm border-2 animate-in fade-in zoom-in duration-500 ${
            timeRemaining?.expired 
              ? "bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30" 
              : selectedAccount.is_trial
                ? "bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30"
                : "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30"
          }`}>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Status da Assinatura</p>
            <div className="flex items-center justify-center gap-2">
               <span className={`w-3 h-3 rounded-full animate-pulse ${
                 timeRemaining?.expired ? "bg-rose-500" : selectedAccount.is_trial ? "bg-sky-500" : "bg-emerald-500"
               }`} />
               <span className={`text-lg sm:text-xl font-black tracking-tight ${
                 timeRemaining?.expired ? "text-rose-600 dark:text-rose-400" : selectedAccount.is_trial ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400"
               }`}>
                 {selectedAccount.is_trial && "Teste • "}{timeRemaining?.text}
               </span>
            </div>
        </div>

        {/* Card de Dados de Acesso */}
        <div className="bg-white dark:bg-[#161b22] rounded-xl shadow-sm border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="bg-slate-50 dark:bg-white/5 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">📺 Dados de Acesso</h2>
          </div>
          <div className="p-3 sm:p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Usuário</label>
                <div className="text-sm font-mono text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/5 truncate">
                  {selectedAccount.server_username}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Servidor</label>
                <div className="text-sm font-medium text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/5 truncate">
                  {selectedAccount.server_name}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vencimento em</label>
                <div className="text-sm font-medium text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/5">
                  {formatDateTime(selectedAccount.vencimento)}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Telas</label>
                <div className="text-sm font-bold text-slate-800 dark:text-white bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/5">
                  {selectedAccount.screens} {selectedAccount.screens > 1 ? "telas" : "tela"}
                </div>
              </div>
            </div>
          </div>
        </div>

{/* Seção de Planos */}
        <div className="bg-white dark:bg-[#161b22] rounded-xl shadow-sm border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="bg-slate-50 dark:bg-white/5 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200 dark:border-white/10">
            <h2 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">💰 Escolha o Plano</h2>
          </div>

          <div className="p-3 sm:p-4 space-y-3">
            {/* Plano Atual */}
            {(() => {
              const currentPrice = availablePrices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);
              if (!currentPrice) return null;
              const isSelected = selectedPeriod === currentPrice.period;
              return (
                <button
                  onClick={() => currentPrice && setSelectedPeriod(currentPrice.period)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    isSelected ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10" : "border-slate-200 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-500/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? "border-blue-500 bg-blue-500" : "border-slate-300 dark:border-white/30"}`}>
                          {isSelected && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
                        </div>
                        <span className="font-bold text-slate-800 dark:text-white">
                          {selectedAccount.plan_label} <span className="text-xs font-normal text-blue-600 dark:text-blue-400 uppercase tracking-wider ml-1">(Atual)</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right ml-2">
                      <div className={`text-lg font-bold ${isSelected ? "text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-white/60"}`}>
                        {currentPrice.price_amount > 0 ? formatMoney(currentPrice.price_amount, selectedAccount.price_currency) : "—"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })()}

            {/* ✅ PLANO ESCOLHIDO (Se não for o Atual e a sanfona estiver FECHADA) */}
            {(() => {
                const currentPrice = availablePrices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);
                const isSelectedNotCurrent = selectedPeriod !== currentPrice?.period;
                
                if (!showOtherPlans && isSelectedNotCurrent && selectedPrice) {
                    return (
                        <button
                          onClick={() => setShowOtherPlans(true)}
                          className="w-full text-left p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 transition-all animate-in slide-in-from-top-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="w-5 h-5 rounded-full border-2 border-emerald-500 bg-emerald-500 flex items-center justify-center shrink-0">
                                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                                </div>
                                <span className="font-bold text-slate-800 dark:text-white">
                                  {PERIOD_LABELS[selectedPrice.period]} <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400 tracking-wider ml-1">(Selecionado)</span>
                                </span>
                              </div>
                            </div>
                            <div className="text-right ml-2">
                              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                                {selectedPrice.price_amount > 0 ? formatMoney(selectedPrice.price_amount, selectedAccount.price_currency) : "—"}
                              </div>
                            </div>
                          </div>
                        </button>
                    );
                }
                return null;
            })()}

            {/* Botão para Mostrar/Esconder as Ofertas */}
            {availablePrices.filter((p) => PERIOD_LABELS[p.period] !== selectedAccount.plan_label).length > 0 && (
              <button
                onClick={() => setShowOtherPlans(!showOtherPlans)}
                className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-white/20 text-slate-600 dark:text-white/70 font-bold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
              >
                🏷️ {showOtherPlans ? "Ocultar Ofertas" : "Ver Mais Ofertas"}
                <svg className={`w-4 h-4 transition-transform ${showOtherPlans ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
            )}

            {/* Expansível de Ofertas */}
            {showOtherPlans && (
              <div className="space-y-2 animate-in slide-in-from-top-2 duration-200 mt-2">
                <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider px-1">Todas as Opções</p>
                {availablePrices
                  .filter((p) => PERIOD_LABELS[p.period] !== selectedAccount.plan_label)
                  .map((price) => {
                    const months = PERIOD_MONTHS[price.period];
                    const currentMonthlyEquiv = (() => {
                      const currentPrice = availablePrices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);
                      if (!currentPrice) {
                         const baseMonthly = availablePrices.find(p => p.period === "MONTHLY");
                         return baseMonthly ? baseMonthly.price_amount : 0;
                      }
                      const currentMonths = PERIOD_MONTHS[Object.keys(PERIOD_LABELS).find((k) => PERIOD_LABELS[k] === selectedAccount.plan_label) || "MONTHLY"] || 1;
                      return currentPrice.price_amount / currentMonths;
                    })();

                    const thisMonthlyEquiv = price.price_amount / months;
                    const diffPercent = currentMonthlyEquiv > 0 ? Math.round(((thisMonthlyEquiv - currentMonthlyEquiv) / currentMonthlyEquiv) * 100 * 10) / 10 : 0;

                    const isSelected = selectedPeriod === price.period;
                    const isCheaper = diffPercent < 0;

                    return (
                      <button
                        key={price.period}
                        onClick={() => setSelectedPeriod(price.period)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                          isSelected ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-slate-200 dark:border-white/10 hover:border-emerald-300 dark:hover:border-emerald-500/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? "border-emerald-500 bg-emerald-500" : "border-slate-300 dark:border-white/30"}`}>
                                {isSelected && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
                              </div>
                              <span className="font-bold text-slate-800 dark:text-white">{PERIOD_LABELS[price.period]}</span>
                              {diffPercent !== 0 && price.price_amount > 0 && (
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider ${isCheaper ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"}`}>
                                  {isCheaper ? `${Math.abs(diffPercent)}% off` : `+${diffPercent}%`}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-white/50 mt-1 ml-7">
                              {price.price_amount > 0 ? `${formatMoney(price.price_amount / months, selectedAccount.price_currency)}/mês` : "—"}
                            </p>
                          </div>
                          <div className="text-right ml-2">
                            <div className="text-lg font-bold text-slate-800 dark:text-white">
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

        {/* Botão Concluir */}
        {(() => {
          const renewPrice = selectedPrice && selectedPrice.price_amount > 0 ? selectedPrice : prices.find((p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label);

          return (
            <button
              onClick={handleRenew}
              disabled={!renewPrice || !renewPrice.price_amount || isProcessingPayment || showMethodSelector}
              className="w-full bg-[#25D366] hover:bg-[#20BA5A] text-white font-bold py-3 sm:py-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base sm:text-lg mt-2"
            >
              {isProcessingPayment ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processando...
                </>
              ) : (
                <>
                  💸 Concluir Renovação • {renewPrice && renewPrice.price_amount > 0 ? formatMoney(renewPrice.price_amount, selectedAccount.price_currency) : "—"}
                </>
              )}
            </button>
          );
        })()}

        {/* Seletor de Método */}
        {MethodSelectorModal()}

       {/* Modal de Pagamento */}
        {PaymentModal()}
      </div>
    </div>
  );
}

// --- ÍCONES ---
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconWhatsapp() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
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