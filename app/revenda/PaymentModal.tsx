"use client";
// app/revenda/PaymentModal.tsx
// ✅ 12/10/2026, pedido do Márcio: o pagamento do Portal da Revenda (compra
// de créditos e ativação de aplicativo) tinha 2 visuais diferentes e mais
// pobres que o do portal do cliente. Agora os dois usam este modal, no mesmo
// padrão do pagamento de aplicativo do portal do cliente
// (app/renew/RenewClient.tsx): cabeçalho verde com o gateway, resumo com
// "Total a Pagar", QR numa moldura, "Ou copie o código" com o código visível
// e o botão Copiar ao lado, cartão de status, "Problemas com o pagamento?",
// Cancelar e a linha de conexão segura.
import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import StripeCardForm from "./StripeCardForm";

export type PaymentOrder = {
  order_id: string;
  state: string; // waiting | sending/activating | done | failed | expired
  payment_method?: "pix" | "stripe" | string | null;
  gateway_name?: string | null;
  amount: number;
  currency?: string | null;
  pix_qr_code?: string | null;
  pix_qr_code_base64?: string | null;
  client_secret?: string | null;
  publishable_key?: string | null;
  expires_at?: string | null;
};

const money = (n: number, currency = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);

export default function PaymentModal({
  order,
  summary,
  processingTitle = "Pagamento confirmado!",
  processingText,
  waitingHint,
  done,
  failedText,
  supportLink,
  onClose,
  onRetryOther,
  onStripePaid,
}: {
  order: PaymentOrder;
  /** linhas do resumo (o total vem do pedido) */
  summary: { label: string; value?: string }[];
  processingTitle?: string;
  processingText: string;
  /** o que acontece depois que o pagamento cair */
  waitingHint: string;
  /** conteúdo da tela de concluído (título + detalhes) */
  done: { title: string; children?: React.ReactNode };
  failedText: string;
  supportLink?: string | null;
  onClose: () => void;
  onRetryOther?: () => void;
  onStripePaid?: () => void;
}) {
  const currency = order.currency || "BRL";
  const isStripe = order.payment_method === "stripe";
  const gatewayLabel = order.gateway_name || (isStripe ? "Stripe" : "Mercado Pago");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // trocou de gateway → código novo: aviso até copiar de novo (igual ao cliente)
  const [switched, setSwitched] = useState(false);
  const prevId = useRef(order.order_id);
  useEffect(() => {
    if (prevId.current !== order.order_id) {
      prevId.current = order.order_id;
      setSwitched(true);
      setCopied(false);
    }
  }, [order.order_id]);

  const left = order.expires_at ? Math.max(0, new Date(order.expires_at).getTime() - now) : null;
  const mm = left != null ? String(Math.floor(left / 60000)).padStart(2, "0") : "";
  const ss = left != null ? String(Math.floor((left % 60000) / 1000)).padStart(2, "0") : "";
  const waiting = order.state === "waiting";
  const expired = order.state === "expired" || (waiting && left === 0);
  const processing = order.state === "sending" || order.state === "activating";
  const finished = order.state === "done" || order.state === "failed";

  async function copy() {
    if (!order.pix_qr_code) return;
    try {
      await navigator.clipboard.writeText(order.pix_qr_code);
      setCopied(true);
      setSwitched(false);
      setTimeout(() => setCopied(false), 3000);
    } catch {}
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-[calc(100vw-1rem)] sm:max-w-xl bg-card border border-border rounded-2xl shadow-2xl max-h-[90dvh] overflow-x-hidden overflow-y-auto">
        {order.state === "done" ? (
          <div className="p-6 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center text-3xl">🎉</div>
              <p className="text-base font-bold text-foreground">{done.title}</p>
              {done.children}
            </div>
            <button onClick={onClose} className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">
              Fechar
            </button>
          </div>
        ) : order.state === "failed" ? (
          <div className="p-6 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center text-3xl">⏳</div>
              <p className="text-base font-bold text-foreground">Pagamento recebido</p>
              <p className="text-xs text-muted-foreground">{failedText}</p>
            </div>
            {supportLink && (
              <a href={supportLink} target="_blank" rel="noreferrer" className="w-full h-11 rounded-xl bg-[#25D366] text-white text-sm font-bold inline-flex items-center justify-center">
                Falar com o suporte
              </a>
            )}
            <button onClick={onClose} className="w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="bg-gradient-to-r from-emerald-500 to-green-600 py-3 px-6 text-white text-center relative">
              <button onClick={onClose} className="absolute right-3 top-3 text-white/80 hover:text-white text-sm leading-none" title="Fechar">
                ✕
              </button>
              <h2 className="text-lg font-bold">{isStripe ? "Pague com cartão" : "Pague com PIX"}</h2>
              <p className="text-xs text-white/80">{gatewayLabel}</p>
            </div>

            {/* resumo */}
            <div className="px-5 pt-4 space-y-1.5 text-sm">
              {summary.map((l, i) => (
                <div key={i} className="flex justify-between gap-3 text-foreground/80">
                  <span className="min-w-0 truncate">{l.label}</span>
                  {l.value && <span className="shrink-0">{l.value}</span>}
                </div>
              ))}
              <div className="flex justify-between font-bold text-foreground pt-1.5 border-t border-border">
                <span>Total a Pagar</span>
                <span>{money(Number(order.amount), currency)}</span>
              </div>
            </div>

            {isStripe && waiting && !expired && order.client_secret && order.publishable_key ? (
              <div className="px-5 pt-4 pb-3 space-y-3">
                <StripeCardForm
                  clientSecret={order.client_secret}
                  publishableKey={order.publishable_key}
                  amountLabel={money(Number(order.amount), currency)}
                  onPaid={onStripePaid || (() => {})}
                />
                <button onClick={onClose} className="w-full pb-1 pt-0 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="px-5 pt-4 pb-3 space-y-3">
                {switched && waiting && !expired && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
                    <p className="text-xs font-bold text-amber-600">🔄 Novos dados de pagamento gerados!</p>
                    <p className="text-[11px] text-amber-600/80 mt-0.5">
                      O código anterior não vale mais — copie o código abaixo de novo ou escaneie o QR Code atualizado.
                    </p>
                  </div>
                )}

                {waiting && !expired && order.pix_qr_code_base64 && (
                  <div className="bg-white p-2 sm:p-4 rounded-xl border-2 border-border">
                    <img
                      src={`data:image/png;base64,${order.pix_qr_code_base64}`}
                      alt="QR Code PIX"
                      className="w-full max-w-[180px] sm:max-w-[220px] mx-auto"
                    />
                  </div>
                )}

                {waiting && !expired && order.pix_qr_code && (
                  <div className="bg-muted/50 p-3 rounded-xl border border-border space-y-2">
                    <p className="text-xs font-bold text-foreground/70 uppercase tracking-wider text-center">Ou copie o código:</p>
                    <div className="relative">
                      <input
                        type="text"
                        value={order.pix_qr_code}
                        readOnly
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full pr-28 pl-3 py-2.5 bg-card border-2 border-border rounded-lg text-xs font-mono text-foreground/90 outline-none focus:border-sky-500 transition-colors shadow-sm"
                      />
                      <button
                        onClick={() => void copy()}
                        className={`absolute right-1 top-1 bottom-1 px-4 text-white font-bold text-xs rounded-md transition-all flex items-center justify-center gap-1.5 min-w-[90px] ${
                          copied ? "bg-emerald-500 hover:bg-emerald-600" : "bg-sky-500 hover:bg-sky-600 shadow-sm"
                        }`}
                      >
                        {copied ? "✅ Copiado" : "📋 Copiar"}
                      </button>
                    </div>
                  </div>
                )}

                {/* status */}
                <div
                  className={`p-3 rounded-xl border flex items-center gap-3 ${
                    expired ? "bg-rose-500/10 border-rose-500/20" : processing ? "bg-emerald-500/10 border-emerald-500/20" : "bg-sky-500/10 border-sky-500/20"
                  }`}
                >
                  {expired ? (
                    <div className="w-6 h-6 flex items-center justify-center text-lg shrink-0">⏱️</div>
                  ) : (
                    <div
                      className={`w-6 h-6 border-4 border-t-transparent rounded-full animate-spin shrink-0 ${processing ? "border-emerald-500" : "border-sky-500"}`}
                    />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-bold ${expired ? "text-rose-500" : processing ? "text-emerald-600" : "text-sky-500"}`}>
                      {expired ? "Código Pix expirado" : processing ? processingTitle : "Aguardando pagamento..."}
                    </p>
                    <p className={`text-xs ${expired ? "text-rose-500/80" : processing ? "text-emerald-600/80" : "text-sky-500/80"}`}>
                      {expired
                        ? "Nenhum valor foi cobrado. Feche e gere um novo pagamento."
                        : processing
                          ? processingText
                          : `Detectaremos automaticamente quando você pagar. ${waitingHint}${left != null && left > 0 ? ` Expira em ${mm}:${ss}.` : ""}`}
                    </p>
                  </div>
                </div>

                {waiting && !expired && onRetryOther && (
                  <button
                    type="button"
                    onClick={onRetryOther}
                    className="w-full p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-left hover:bg-amber-500/10 transition-colors"
                  >
                    <p className="text-xs font-bold text-amber-600">Problemas com o pagamento?</p>
                    <p className="text-[11px] text-amber-600/80">Tente outra forma aqui</p>
                  </button>
                )}

                {!processing && (
                  <button onClick={onClose} className="w-full pb-1 pt-0 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                    {expired ? "Fechar" : "Cancelar"}
                  </button>
                )}
              </div>
            )}

            <div className="px-5 pb-4 pt-2">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground text-center">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                Conexão segura (SSL) — pagamento processado direto pelo {gatewayLabel}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
