"use client";
// app/revenda/StripeCardForm.tsx
// ✅ 08/10/2026: pagamento por cartão (Stripe) da revenda em USD/EUR — mesmo
// formulário do portal do cliente (3 campos do Stripe Elements: número,
// validade, CVC; confirmCardPayment com o client_secret do PaymentIntent).
// Depois do "succeeded" quem confirma de verdade é o servidor (webhook do
// Stripe ou o acompanhamento do pedido, que reconsulta o PaymentIntent).
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

export default function StripeCardForm({
  clientSecret,
  publishableKey,
  amountLabel,
  onPaid,
}: {
  clientSecret: string;
  publishableKey: string;
  amountLabel: string;
  onPaid: () => void;
}) {
  const [ready, setReady] = useState(typeof window !== "undefined" && !!(window as any).Stripe);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const numberEl = useRef<HTMLDivElement>(null);
  const expiryEl = useRef<HTMLDivElement>(null);
  const cvcEl = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<any>(null);
  const cardRef = useRef<any>(null);

  // Stripe.js uma vez
  useEffect(() => {
    if ((window as any).Stripe) return setReady(true);
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]');
    if (existing) {
      existing.addEventListener("load", () => setReady(true));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!ready || !numberEl.current || !expiryEl.current || !cvcEl.current) return;
    const stripe = (window as any).Stripe(publishableKey);
    stripeRef.current = stripe;
    const elements = stripe.elements({ disableLink: true });
    const style = { base: { fontSize: "16px", color: "#1e293b", fontFamily: "ui-sans-serif, system-ui, sans-serif", "::placeholder": { color: "#94a3b8" } } };
    const cardNumber = elements.create("cardNumber", { style, showIcon: true });
    const cardExpiry = elements.create("cardExpiry", { style });
    const cardCvc = elements.create("cardCvc", { style });
    cardNumber.mount(numberEl.current);
    cardExpiry.mount(expiryEl.current);
    cardCvc.mount(cvcEl.current);
    cardRef.current = cardNumber;
    cardExpiry.on("change", (e: any) => e.complete && cardCvc.focus());
    return () => {
      for (const el of [cardNumber, cardExpiry, cardCvc]) {
        try {
          el.unmount();
        } catch {}
      }
    };
  }, [ready, publishableKey]);

  async function pay() {
    if (!stripeRef.current || !cardRef.current) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await stripeRef.current.confirmCardPayment(clientSecret, { payment_method: { card: cardRef.current } });
      if (r.error) return setError("Não foi possível processar o cartão. Confira os dados e tente novamente.");
      if (r.paymentIntent?.status === "succeeded") onPaid();
    } catch {
      setError("Não foi possível processar o pagamento. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  const box = "h-11 px-3 rounded-lg border border-border bg-white flex items-center";
  return (
    <div className="space-y-2">
      <div>
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Número do cartão</label>
        <div ref={numberEl} className={box} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Validade</label>
          <div ref={expiryEl} className={box} />
        </div>
        <div>
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">CVC</label>
          <div ref={cvcEl} className={box} />
        </div>
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <button
        onClick={() => void pay()}
        disabled={!ready || submitting}
        className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? "Processando..." : `Pagar ${amountLabel}`}
      </button>
      <p className="text-[11px] text-center text-muted-foreground">Pagamento seguro processado pelo Stripe.</p>
    </div>
  );
}
