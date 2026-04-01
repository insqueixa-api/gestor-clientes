"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ============================================================
// TIPOS
// ============================================================
interface PlanTier {
  period: string;
  days: number;
  label: string;
  price: number | null;
  credits: number;
}

interface Props {
  tenantId: string;
  role: "MASTER" | "USER";
  saasPlanTableId: string | null;
  creditBalance: number;
  currentExpiry: string | null;
  whatsappSessions: number;
  onClose: () => void;
  onSuccess: () => void;
}

// ============================================================
// CONSTANTES
// ============================================================
const PERIODS: { period: string; days: number; label: string }[] = [
  { period: "MONTHLY",    days: 30,  label: "Mensal"     },
  { period: "BIMONTHLY",  days: 60,  label: "Bimestral"  },
  { period: "QUARTERLY",  days: 90,  label: "Trimestral" },
  { period: "SEMIANNUAL", days: 180, label: "Semestral"  },
  { period: "ANNUAL",     days: 365, label: "Anual"      },
];

const BILLING_TZ = "America/Sao_Paulo";

function fmtDate(s?: string | null) {
  if (!s) return "--";
  return new Date(s).toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}

function calcNewExpiry(currentExpiry: string | null, days: number): string {
  const base = currentExpiry ? new Date(currentExpiry) : new Date();
  const isActive = currentExpiry ? new Date(currentExpiry) > new Date() : false;
  const start = isActive ? base : new Date();
  const result = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return result.toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}


// ── Componente de pagamento reutilizável dentro do modal ──
function PaymentUI({
  step, paymentData, paymentPhase, copiedPix, setCopiedPix,
  stripeStep, setStripeStep, stripeLoading, stripeReady,
  handleStripeConfirm, cardNumberEl, setCardNumberEl,
  cardExpiryEl, setCardExpiryEl, cardCvcEl, setCardCvcEl,
  fmtMoney, onCancel,
}: any) {
  const isOnline = paymentData.payment_method === "online";
  const isStripe = paymentData.payment_method === "stripe";

  if (paymentPhase === "done") {
    return (
      <div className="py-8 flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/10 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-base font-bold text-slate-800 dark:text-white">Concluído com sucesso! ✅</div>
        <p className="text-xs text-slate-400">Atualizando...</p>
      </div>
    );
  }

  if (paymentPhase === "error") {
    return (
      <div className="py-8 flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 bg-amber-100 dark:bg-amber-500/10 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="text-base font-bold text-slate-800 dark:text-white">Pagamento Confirmado! ✅</div>
        <p className="text-sm text-slate-500 dark:text-white/60 px-6">
          Identificamos seu pagamento, mas houve uma falha ao processar a {step === "auto" ? "renovação" : "entrega dos créditos"}. 
          <br /><br />
          <strong>Por favor, entre em contato com seu Master para conclusão manual.</strong>
        </p>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600 underline">Fechar</button>
      </div>
    );
  }

  if (paymentPhase === "renewing") {
    return (
      <div className="py-8 flex flex-col items-center gap-4 text-center">
        <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-sm font-bold text-slate-700 dark:text-white">Processando...</div>
        <div className="text-xs text-slate-400">Aguarde enquanto concluímos sua solicitação.</div>
      </div>
    );
  }

  // PIX
  if (isOnline) return (
    <div className="space-y-4">
      <div className="text-center text-sm font-bold text-emerald-600 dark:text-emerald-400">Pague com PIX</div>
      {paymentData.pix_qr_code_base64 && (
        <div className="flex justify-center">
          <img src={`data:image/png;base64,${paymentData.pix_qr_code_base64}`} alt="QR PIX"
            className="w-48 h-48 rounded bg-white p-2 border border-slate-200" />
        </div>
      )}
      {paymentData.pix_qr_code && (
        <div className="relative">
          <input readOnly value={paymentData.pix_qr_code}
            className="w-full pr-24 pl-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono text-slate-700 dark:text-white outline-none" />
          <button onClick={() => { navigator.clipboard.writeText(paymentData.pix_qr_code); setCopiedPix(true); setTimeout(() => setCopiedPix(false), 3000); }}
            className={`absolute right-1 top-1 bottom-1 px-3 text-white font-bold text-xs rounded-md transition-all ${copiedPix ? "bg-emerald-500" : "bg-blue-500"}`}>
            {copiedPix ? "✅ Copiado" : "📋 Copiar"}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 p-3 bg-sky-50 dark:bg-sky-500/10 rounded-xl border border-sky-200 dark:border-sky-500/20">
        <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="text-xs font-bold text-sky-700 dark:text-sky-300">Aguardando confirmação do pagamento...</p>
      </div>
      <button onClick={onCancel} className="w-full text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancelar</button>
    </div>
  );

  // Stripe
  if (isStripe) return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total</p>
        <p className="text-2xl font-black text-slate-800 dark:text-white">
          {fmtMoney(paymentData.price_amount, paymentData.currency)}
        </p>
      </div>
      <div className="relative">
        <div className={stripeStep === 1 ? "space-y-3" : "hidden"}>
          <p className="text-xs font-bold text-slate-400 uppercase">Número do Cartão</p>
          <div ref={setCardNumberEl} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl min-h-[46px]" />
          <button onClick={() => setStripeStep(2)} disabled={!stripeReady}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl disabled:opacity-60">
            Continuar →
          </button>
        </div>
        <div className={stripeStep === 2 ? "space-y-3" : "hidden"}>
          <button onClick={() => setStripeStep(1)} className="text-xs text-slate-400 hover:text-slate-600">← Voltar</button>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2">Validade</p>
              <div ref={setCardExpiryEl} className="px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl min-h-[46px]" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2">CVC</p>
              <div ref={setCardCvcEl} className="px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl min-h-[46px]" />
            </div>
          </div>
          <button onClick={handleStripeConfirm} disabled={stripeLoading || !stripeReady}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl disabled:opacity-60 flex items-center justify-center gap-2">
            {stripeLoading ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Processando...</> : <>🔒 Confirmar Pagamento</>}
          </button>
        </div>
      </div>
      <button onClick={onCancel} className="w-full text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancelar</button>
    </div>
  );

  return null;
}


// ============================================================
// MODAL PRINCIPAL
// ============================================================
export default function SaasProfileRenewModal({
  tenantId,
  role,
  saasPlanTableId,
  creditBalance,
  currentExpiry,
  whatsappSessions,
  onClose,
  onSuccess,
}: Props) {
  // "select" | "own_balance" | "auto" | "buy_credits"
  const [step, setStep] = useState<"select" | "own_balance" | "auto" | "buy_credits">(
    role === "USER" ? "auto" : "select"
  );

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingText, setLoadingText] = useState("Renovando...");
  const [error, setError] = useState<string | null>(null);

  // Plano (own_balance)
  const [tiers, setTiers] = useState<PlanTier[]>([]);
  const [currency, setCurrency] = useState("BRL");
  const [selectedPeriod, setSelectedPeriod] = useState("MONTHLY");

  // Plano do pai (auto + buy_credits)
  const [parentTiers, setParentTiers] = useState<PlanTier[]>([]);
  const [parentCurrency, setParentCurrency] = useState("BRL");
  const [parentSelectedPeriod, setParentSelectedPeriod] = useState("MONTHLY");
  const [parentLoading, setParentLoading] = useState(false);

  // Créditos do pai
  const CREDIT_TIERS = ["C_10","C_20","C_30","C_50","C_100","C_150","C_200","C_300","C_400","C_500"];
  const CREDIT_LABELS: Record<string, number> = {
    C_10:10,C_20:20,C_30:30,C_50:50,C_100:100,
    C_150:150,C_200:200,C_300:300,C_400:400,C_500:500,
  };
  const [creditTiers, setCreditTiers] = useState<{period:string;credits:number;price:number|null}[]>([]);
  const [selectedCreditTier, setSelectedCreditTier] = useState<string>("C_10");

  // Payment UI (auto + buy_credits)
  const [paymentData, setPaymentData] = useState<any>(null);
  const [paymentPhase, setPaymentPhase] = useState<"awaiting"|"renewing"|"done"|"error">("awaiting");
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedPix, setCopiedPix] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Stripe
  const [stripeReady, setStripeReady] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeStep, setStripeStep] = useState<1|2>(1);
  const stripeRef = useRef<any>(null);
  const cardNumberRef = useRef<any>(null);
  const cardExpiryRef = useRef<any>(null);
  const cardCvcRef = useRef<any>(null);
  const [cardNumberEl, setCardNumberEl] = useState<HTMLDivElement|null>(null);
  const [cardExpiryEl, setCardExpiryEl] = useState<HTMLDivElement|null>(null);
  const [cardCvcEl, setCardCvcEl] = useState<HTMLDivElement|null>(null);

  
  
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTier = useMemo(
    () => tiers.find(t => t.period === selectedPeriod) ?? null,
    [tiers, selectedPeriod]
  );

  const creditsNeeded = useMemo(() => {
    if (!selectedTier) return 0;
    return selectedTier.credits * whatsappSessions;
  }, [selectedTier, whatsappSessions]);

  const hasSufficientBalance = creditsNeeded <= creditBalance;

  const newExpiry = useMemo(() => {
    if (!selectedTier) return "--";
    return calcNewExpiry(currentExpiry, selectedTier.days);
  }, [selectedTier, currentExpiry]);

  
  // ── Carrega tiers quando entra em "own_balance" ──
  useEffect(() => {
    if (step !== "own_balance") return;
    
    // Para renovação com saldo próprio, o custo em créditos é fixo
    // e independe de tabelas monetárias.
    const staticTiers: PlanTier[] = [
      { period: "MONTHLY", days: 30, label: "Mensal", price: null, credits: 1 },
      { period: "BIMONTHLY", days: 60, label: "Bimestral", price: null, credits: 2 },
      { period: "QUARTERLY", days: 90, label: "Trimestral", price: null, credits: 3 },
      { period: "SEMIANNUAL", days: 180, label: "Semestral", price: null, credits: 6 },
      { period: "ANNUAL", days: 365, label: "Anual", price: null, credits: 12 },
    ];
    
    setTiers(staticTiers);
    setSelectedPeriod("MONTHLY");
    setLoading(false);
  }, [step]);

  // ── Salvar renovação com saldo próprio ──
  async function handleSaveOwnBalance() {
    if (!selectedTier || saving) return;
    if (!hasSufficientBalance) {
      setError(`Saldo insuficiente. Necessário: ${creditsNeeded} cr. Disponível: ${creditBalance} cr.`);
      return;
    }
    setSaving(true);
    setError(null);
    setLoadingText("Renovando licença...");

    try {
      // Renova o próprio tenant — sem price_amount (custo já foi registrado na compra)
      const { error: rpcErr } = await supabaseBrowser.rpc("saas_renew_license", {
  p_tenant_id: tenantId,
  p_days: selectedTier.days,
  p_description: `Auto-renovação ${selectedTier.label} · ${creditsNeeded} crédito(s)`
  // Preço e Moeda removidos: o Banco decidirá baseado na tabela do cliente
});
      if (rpcErr) throw new Error(rpcErr.message);

      

      setLoadingText("Concluído!");
      setTimeout(() => { onSuccess(); onClose(); }, 500);
    } catch (e: any) {
      setError(e?.message || "Erro ao renovar");
    } finally {
      setSaving(false);
    }
  }

  // ── Carrega preços do pai para auto/buy_credits ──
  useEffect(() => {
    if (step !== "auto" && step !== "buy_credits") return;
    let alive = true;
    (async () => {
      setParentLoading(true);
      try {
        const { data: sess } = await supabaseBrowser.auth.getSession();
        const token = sess?.session?.access_token;
        const res = await fetch("/api/saas/get-parent-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ payment_type: step === "auto" ? "renewal" : "credits" }),
        });
        const result = await res.json().catch(() => ({}));
        if (!alive || !result?.ok) return;

        if (step === "auto") {
          setParentTiers(result.tiers || []);
          setParentCurrency(result.currency || "BRL");
          const first = (result.tiers || []).find((t: any) => t.price !== null);
          if (first) setParentSelectedPeriod(first.period);
        } else {
          setCreditTiers(result.tiers || []);
          setParentCurrency(result.currency || "BRL");
          const first = (result.tiers || []).find((t: any) => t.price !== null);
          if (first) setSelectedCreditTier(first.period);
        }
      } finally {
        if (alive) setParentLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [step]);

  // ── Stripe.js ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).Stripe) { setStripeReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => setStripeReady(true);
    document.head.appendChild(s);
  }, []);

  // ── Montar Stripe Elements ──
  useEffect(() => {
    if (!paymentData || paymentData.payment_method !== "stripe") return;
    if (!stripeReady || !cardNumberEl || !cardExpiryEl || !cardCvcEl) return;

    const stripe = (window as any).Stripe(paymentData.publishable_key);
    stripeRef.current = stripe;
    const elements = stripe.elements({ disableLink: true });
    const style = { base: { fontSize: "16px", color: "#1e293b", "::placeholder": { color: "#94a3b8" } } };

    const cn = elements.create("cardNumber", { style, showIcon: true });
    const ce = elements.create("cardExpiry", { style });
    const cv = elements.create("cardCvc", { style });

    cn.mount(cardNumberEl); ce.mount(cardExpiryEl); cv.mount(cardCvcEl);
    cardNumberRef.current = cn; cardExpiryRef.current = ce; cardCvcRef.current = cv;
    ce.on("change", (e: any) => { if (e.complete) cv.focus(); });

    return () => { try { cn.unmount(); ce.unmount(); cv.unmount(); } catch {} };
  }, [paymentData, stripeReady, cardNumberEl, cardExpiryEl, cardCvcEl]);

  // ── Cleanup polling ──
  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  function startPolling(paymentId: string) {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const { data: sess } = await supabaseBrowser.auth.getSession();
        const token = sess?.session?.access_token;
        const res = await fetch("/api/saas/payment-status", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ payment_id: paymentId }),
        });
        const result = await res.json().catch(() => ({}));
        if (!result?.ok) return;

        const phase = String(result.phase || "").toLowerCase();
        if (phase === "awaiting_payment") { setPaymentPhase("awaiting"); return; }
        if (phase === "renewing") { setPaymentPhase("renewing"); return; }
        if (phase === "done") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPaymentPhase("done");
          setTimeout(() => { onSuccess(); onClose(); }, 3000);
        }
        if (phase === "error") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPaymentPhase("error");
        }
      } catch {}
    }, 3000);
  }

  async function handleCreatePayment(paymentType: "renewal" | "credits") {
    if (isProcessing) return;
    setIsProcessing(true);
    setPaymentData(null);
    setPaymentPhase("awaiting");
    setStripeStep(1);

    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;

      const period = paymentType === "renewal" ? parentSelectedPeriod : selectedCreditTier;

      const res = await fetch("/api/saas/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payment_type: paymentType, period }),
      });
      const result = await res.json().catch(() => ({}));
      if (!result?.ok) { setError(result?.error || "Erro ao criar pagamento"); return; }

      setPaymentData(result);
      if (result.payment_method === "online" && result.payment_id) {
        startPolling(String(result.payment_id));
      }
    } catch (e: any) {
      setError(e?.message || "Erro ao criar pagamento");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleStripeConfirm() {
    if (!stripeRef.current || !cardNumberRef.current || !paymentData) return;
    setStripeLoading(true);
    try {
      const result = await stripeRef.current.confirmCardPayment(paymentData.client_secret, {
        payment_method: { card: cardNumberRef.current },
      });
      if (result.error) { alert(result.error.message || "Erro no cartão."); return; }
      if (result.paymentIntent?.status === "succeeded") {
        setPaymentPhase("renewing");
        startPolling(String(paymentData.payment_id));
      }
    } catch (e: any) {
      alert(e?.message || "Erro ao processar pagamento.");
    } finally {
      setStripeLoading(false);
    }
  }

  function fmtMoney(amount: number, cur: string) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur || "BRL" })
      .format(amount).replace(/^US(\$)/, "$1");
  }

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden">

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800 dark:text-white tracking-tight">
              {step === "select" ? "Renovar Assinatura" :
               step === "own_balance" ? "Renovar com Saldo" :
               step === "auto" ? "Renovação Automática" :
               "Comprar Créditos"}
            </h2>
            <div className="text-xs text-slate-500 dark:text-white/40 mt-0.5">
              Vence: <strong>{fmtDate(currentExpiry)}</strong>
              {step === "own_balance" && (
                <span className="ml-2">· Saldo: <strong className="text-emerald-600 dark:text-emerald-400">{creditBalance} cr</strong></span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step !== "select" && role === "MASTER" && (
              <button onClick={() => setStep("select")} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white/60 px-2 py-1 rounded border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                ← Voltar
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors">✕</button>
          </div>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-[#161b22]">

          {/* ── STEP: SELEÇÃO (MASTER) ── */}
          {step === "select" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-white/50 mb-4">
                Como deseja renovar sua assinatura?
              </p>

              {/* Opção 1: Renovar com saldo */}
              <button
                onClick={() => setStep("own_balance")}
                disabled={creditBalance <= 0}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-emerald-500/50 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                  🪙
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-white">Renovar com Saldo</div>
                  <div className="text-xs text-slate-400 dark:text-white/40 mt-0.5">
                    {creditBalance > 0
                      ? `Usar seus ${creditBalance} créditos disponíveis`
                      : "Sem créditos disponíveis"}
                  </div>
                </div>
                <span className="text-slate-300 dark:text-white/20 group-hover:text-emerald-500 transition-colors">→</span>
              </button>

              {/* Opção 2: Renovação Automática */}
              <button
                onClick={() => setStep("auto")}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-sky-500/50 hover:bg-sky-50/50 dark:hover:bg-sky-500/5 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 shrink-0 group-hover:bg-sky-500/20 transition-colors">
                  🔄
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-white">Renovação Automática</div>
                  <div className="text-xs text-slate-400 dark:text-white/40 mt-0.5">Pagamento via PIX, cartão ou boleto</div>
                </div>
                
              </button>

              {/* Opção 3: Comprar Créditos */}
              <button
                onClick={() => setStep("buy_credits")}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-violet-500/50 hover:bg-violet-50/50 dark:hover:bg-violet-500/5 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-600 shrink-0 group-hover:bg-violet-500/20 transition-colors">
                  💳
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-white">Comprar Créditos</div>
                  <div className="text-xs text-slate-400 dark:text-white/40 mt-0.5">Adicione créditos à sua conta</div>
                </div>
                
              </button>
            </div>
          )}

          {/* ── STEP: RENOVAR COM SALDO PRÓPRIO ── */}
          {step === "own_balance" && (
            <div className="space-y-5">
              {loading ? (
                <div className="py-12 text-center text-slate-400 animate-pulse">Carregando plano...</div>
              ) : (
                <>
                  {error && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
                      {error}
                    </div>
                  )}

                  {/* PERÍODOS */}
                  <div className="flex flex-col gap-2">
                    {tiers.map(tier => {
                      const cost = tier.credits * whatsappSessions;
                      const canAfford = cost <= creditBalance;
                      return (
                        <button
                          key={tier.period}
                          type="button"
                          disabled={!canAfford}
                          onClick={() => setSelectedPeriod(tier.period)}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            selectedPeriod === tier.period
                              ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                              : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-emerald-500/50"
                          }`}
                        >
                          <span>{tier.label}</span>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-bold ${selectedPeriod === tier.period ? "text-white/80" : "text-slate-400"}`}>
                              {cost} cr{whatsappSessions > 1 ? ` (${whatsappSessions} sessões)` : ""}
                            </span>
                            <span className={`text-xs font-bold ${selectedPeriod === tier.period ? "text-white/60" : "text-slate-300 dark:text-white/20"}`}>
                              Gratuito
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* RESUMO */}
                  {selectedTier && (
                    <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">Novo Vencimento</div>
                          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{newExpiry}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Saldo após: <strong className={hasSufficientBalance ? "text-slate-700 dark:text-white" : "text-rose-500"}>
                              {creditBalance - creditsNeeded} cr
                            </strong>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">Custo</div>
                          <div className="text-xl font-bold text-slate-700 dark:text-white">{creditsNeeded} cr</div>
                          <div className="text-[10px] text-emerald-500 font-bold">R$ 0,00</div>
                        </div>
                      </div>
                    </div>
                  )}

                  
                </>
              )}
            </div>
          )}

          {/* ── STEP: RENOVAÇÃO AUTOMÁTICA ── */}
          {step === "auto" && (
            <div className="space-y-4">
              {/* Payment UI — aparece após criar pagamento */}
              {paymentData ? (
                <PaymentUI
                  step={step}
                  paymentData={paymentData} paymentPhase={paymentPhase}
                  copiedPix={copiedPix} setCopiedPix={setCopiedPix}
                  stripeStep={stripeStep} setStripeStep={setStripeStep}
                  stripeLoading={stripeLoading} stripeReady={stripeReady}
                  handleStripeConfirm={handleStripeConfirm}
                  cardNumberEl={cardNumberEl} setCardNumberEl={setCardNumberEl}
                  cardExpiryEl={cardExpiryEl} setCardExpiryEl={setCardExpiryEl}
                  cardCvcEl={cardCvcEl} setCardCvcEl={setCardCvcEl}
                  fmtMoney={fmtMoney}
                  onCancel={() => {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    setPaymentData(null); setPaymentPhase("awaiting");
                  }}
                />
              ) : parentLoading ? (
                <div className="py-12 text-center text-slate-400 animate-pulse">Carregando planos...</div>
              ) : (
                <>
                  {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">{error}</div>}
                  {(() => {
  const monthlyTier = parentTiers.find(t => t.period === "MONTHLY");
  const monthlyPrice = monthlyTier?.price ?? null;
  const selectedParentTier = parentTiers.find(t => t.period === parentSelectedPeriod) ?? null;
  const selectedDays = PERIODS.find(p => p.period === parentSelectedPeriod)?.days ?? 30;
  const autoNewExpiry = calcNewExpiry(currentExpiry, selectedDays);

  return (
    <>
      <div className="flex flex-col gap-2">
        {parentTiers.map(tier => {
          const days = PERIODS.find(p => p.period === tier.period)?.days ?? 30;
          const months = days / 30;
          const perMonth = tier.price !== null ? tier.price / months : null;
          const discount = (monthlyPrice && perMonth !== null && tier.period !== "MONTHLY")
            ? ((monthlyPrice - perMonth) / monthlyPrice) * 100
            : null;
          const isSelected = parentSelectedPeriod === tier.period;

          return (
            <button key={tier.period} type="button"
              onClick={() => setParentSelectedPeriod(tier.period)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
                isSelected
                  ? "bg-sky-500 border-sky-500 text-white shadow-lg shadow-sky-500/20"
                  : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-sky-500/50"
              }`}
            >
              {/* Esquerda: label + badge desconto */}
              <div className="flex items-center gap-2">
                <span>{tier.label}</span>
                {discount !== null && (
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                    discount > 0
                      ? isSelected ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                      : isSelected ? "bg-white/20 text-white" : "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400"
                  }`}>
                    {discount > 0 ? `${discount.toFixed(1)}% OFF` : `+${Math.abs(discount).toFixed(1)}%`}
                  </span>
                )}
              </div>

              {/* Direita: preço total + preço/mês */}
              <div className="text-right">
                <div className="font-bold">
                  {tier.price !== null ? fmtMoney(tier.price, parentCurrency) : "—"}
                </div>
                {perMonth !== null && months > 1 && (
                  <div className={`text-[10px] font-medium ${isSelected ? "text-white/70" : "text-slate-400 dark:text-white/30"}`}>
                    {fmtMoney(perMonth, parentCurrency)}/mês
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Resumo novo vencimento */}
      {selectedParentTier && (
        <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/5 mt-1">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">Novo Vencimento</div>
              <div className="text-xl font-bold text-sky-600 dark:text-sky-400">{autoNewExpiry}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">Total</div>
              <div className="text-xl font-bold text-slate-700 dark:text-white">
                {selectedParentTier.price !== null ? fmtMoney(selectedParentTier.price, parentCurrency) : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {parentTiers.length === 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-600 dark:text-amber-400 text-sm">
          Nenhum plano disponível. Contate seu gestor.
        </div>
      )}
    </>
  );
})()}
                </>
              )}
            </div>
          )}

          {/* ── STEP: COMPRAR CRÉDITOS ── */}
          {step === "buy_credits" && (
            <div className="space-y-4">
              {paymentData ? (
                <PaymentUI
                  paymentData={paymentData} paymentPhase={paymentPhase}
                  copiedPix={copiedPix} setCopiedPix={setCopiedPix}
                  stripeStep={stripeStep} setStripeStep={setStripeStep}
                  stripeLoading={stripeLoading} stripeReady={stripeReady}
                  handleStripeConfirm={handleStripeConfirm}
                  cardNumberEl={cardNumberEl} setCardNumberEl={setCardNumberEl}
                  cardExpiryEl={cardExpiryEl} setCardExpiryEl={setCardExpiryEl}
                  cardCvcEl={cardCvcEl} setCardCvcEl={setCardCvcEl}
                  fmtMoney={fmtMoney}
                  onCancel={() => {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    setPaymentData(null); setPaymentPhase("awaiting");
                  }}
                />
              ) : parentLoading ? (
                <div className="py-12 text-center text-slate-400 animate-pulse">Carregando pacotes...</div>
              ) : (
                <>
                  {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">{error}</div>}
                  {(() => {
  // base = pacote mais barato por crédito (geralmente o menor)
  const baseTier = creditTiers.reduce((best, t) => {
    if (t.price === null || t.credits === 0) return best;
    if (!best || t.price / t.credits > best.price / best.credits) return t;
    return best;
  }, null as typeof creditTiers[0] | null);
  const basePricePerCredit = baseTier ? baseTier.price! / baseTier.credits : null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {creditTiers.map(t => {
        const isSelected = selectedCreditTier === t.period;
        const pricePerCredit = (t.price !== null && t.credits > 0) ? t.price / t.credits : null;
        const discount = (basePricePerCredit && pricePerCredit && t.period !== baseTier?.period)
          ? ((basePricePerCredit - pricePerCredit) / basePricePerCredit) * 100
          : null;

        return (
          <button key={t.period} type="button"
            onClick={() => setSelectedCreditTier(t.period)}
            className={`relative flex flex-col items-center py-3 rounded-xl border text-xs font-bold transition-all ${
              isSelected
                ? "bg-violet-500 border-violet-500 text-white shadow-lg shadow-violet-500/20"
                : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-violet-500/50"
            }`}
          >
            {/* Badge desconto */}
            {discount !== null && discount > 0 && (
              <span className={`absolute top-1.5 right-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                isSelected
                  ? "bg-white/20 text-white"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
              }`}>
                {discount.toFixed(0)}% OFF
              </span>
            )}

            <span className="text-base font-black">{t.credits}</span>
            <span className="text-[10px] mt-0.5 opacity-80">créditos</span>
            <span className="font-bold mt-1">
              {t.price !== null ? fmtMoney(t.price, parentCurrency) : "—"}
            </span>
            {pricePerCredit !== null && (
              <span className={`text-[9px] mt-0.5 ${isSelected ? "text-white/60" : "text-slate-400 dark:text-white/30"}`}>
                {fmtMoney(pricePerCredit, parentCurrency)}/cr
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
})()}
                  {creditTiers.length === 0 && (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-600 dark:text-amber-400 text-sm">
                      Nenhum pacote disponível. Contate seu gestor.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-sm hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            {step === "select" || step === "auto" || step === "buy_credits" ? "Fechar" : "Cancelar"}
          </button>
          {step === "own_balance" && !loading && (
            <button onClick={handleSaveOwnBalance} disabled={!selectedTier || !hasSufficientBalance || saving}
              className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 disabled:opacity-50 transition-all flex items-center gap-2">
              {saving && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              {saving ? loadingText : `Renovar — ${selectedTier?.label ?? ""}`}
            </button>
          )}
          {step === "auto" && !parentLoading && !paymentData && parentTiers.length > 0 && (
            <button onClick={() => handleCreatePayment("renewal")} disabled={isProcessing}
              className="px-6 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm shadow-lg disabled:opacity-50 transition-all flex items-center gap-2">
              {isProcessing && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              {isProcessing ? "Aguarde..." : "Pagar e Renovar"}
            </button>
          )}
          {step === "buy_credits" && !parentLoading && !paymentData && creditTiers.length > 0 && (
            <button onClick={() => handleCreatePayment("credits")} disabled={isProcessing}
              className="px-6 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm shadow-lg disabled:opacity-50 transition-all flex items-center gap-2">
              {isProcessing && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
              {isProcessing ? "Aguarde..." : "Pagar e Receber Créditos"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}