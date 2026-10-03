"use client";
// components/alerts/AppTrustPrompt.tsx
//
// Pergunta depois de ativar/renovar um app PAGO pelo admin (GPC Roku "Marcar
// como pago", "Renovar Duplecast", "Ativar via Appativa") — 02/10/2026,
// docs/alertas-confianca/PLANO.md:
//   • Em confiança  → cria o sino "Ativação de aplicativo" (cliente paga depois)
//   • Já recebi     → cria o sino e já dá baixa (settle_client_alert): o
//                     pagamento entra no Log do Portal/saldo como Aplicativo
//                     (antes, ativação paga por fora nunca era computada)
//   • Não registrar → só fecha
// Cupom pessoal opcional (código aleatório, % ou valor) — desconto já no valor.
import { useState } from "react";
import { Modal, ModalHeader, ModalBody } from "@/components/ui/Modal";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  couponDiscount,
  createAppActivationAlert,
  randomCouponCode,
} from "@/lib/alerts/app-activation-alert";

export type AppTrustPromptData = {
  clientAppId: string;
  appName: string;
  amount: number | null;
};

function isoDateToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const fmt = (v: number, c: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: c || "BRL" }).format(v);

export default function AppTrustPrompt({
  data,
  onClose,
  tenantId,
  clientId,
  clientName,
  currency = "BRL",
  addToast,
  onDone,
}: {
  data: AppTrustPromptData | null;
  onClose: () => void;
  tenantId: string | null;
  clientId: string;
  clientName: string;
  currency?: string;
  addToast: (type: "success" | "error", title: string, message?: string) => void;
  onDone?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [useCoupon, setUseCoupon] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // reinicia o formulário a cada app novo (sem useEffect: compara a chave)
  const key = data ? `${data.clientAppId}-${data.amount}` : null;
  if (key !== lastKey) {
    setLastKey(key);
    setAmount(data?.amount != null ? String(data.amount) : "");
    setUseCoupon(false);
    setCode(data ? randomCouponCode(data.appName) : "");
    setType("percent");
    setValue("");
  }

  if (!data) return null;

  const base = Number(amount.replace(",", ".")) || 0;
  const coupon = useCoupon ? { code, type, value: Number(value.replace(",", ".")) || 0 } : null;
  const discount = couponDiscount(base, coupon);

  async function submit(settleNow: boolean) {
    if (!tenantId || !data) return;
    setBusy(true);
    try {
      const res = await createAppActivationAlert({
        tenantId,
        clientId,
        clientName,
        clientAppId: data.clientAppId,
        appName: data.appName,
        amount: base,
        currency,
        activationDate: isoDateToday(),
        coupon,
      });
      if (res.ok === false) {
        addToast("error", "Não deu pra registrar", res.error);
        return;
      }
      if (settleNow) {
        const { error } = await supabaseBrowser.rpc("settle_client_alert", {
          p_tenant_id: tenantId,
          p_alert_id: res.alertId,
        });
        if (error) {
          addToast("error", "Sino criado, mas a baixa falhou", error.message);
          return;
        }
        addToast("success", "Pagamento lançado", `${data.appName}: ${fmt(base - discount, currency)} no Log do Portal.`);
      } else {
        addToast("success", "Registrado em confiança", `Sino criado: ${fmt(base - discount, currency)} a receber.`);
      }
      onDone?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md" zIndex="z-[100001]">
      <ModalHeader onClose={onClose}>
        <h3 className="font-semibold text-foreground">{data.appName} ativado</h3>
      </ModalHeader>
      <ModalBody className="p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Essa ativação já foi paga? Registre aqui pra entrar no seu saldo — agora (já recebeu) ou
          quando o cliente pagar (em confiança).
        </p>

        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
            Valor da licença ({currency})
          </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
          />
        </div>

        <div className="rounded-xl border border-border p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={useCoupon}
              onChange={(e) => setUseCoupon(e.target.checked)}
              className="w-4 h-4 accent-purple-600"
            />
            Dar cupom de desconto
          </label>
          {useCoupon && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="col-span-3 sm:col-span-1 h-9 px-2 bg-transparent border border-border rounded-lg text-sm font-mono text-foreground outline-none focus:border-purple-500"
                  title="Código do cupom"
                />
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as "percent" | "fixed")}
                  className="h-9 px-2 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                >
                  <option value="percent">%</option>
                  <option value="fixed">{currency}</option>
                </select>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={type === "percent" ? "Ex: 50" : "Ex: 10,00"}
                  inputMode="decimal"
                  className="h-9 px-2 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                />
              </div>
              {discount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Desconto {fmt(discount, currency)} → total <strong className="text-foreground">{fmt(base - discount, currency)}</strong>
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid gap-2">
          <button
            type="button"
            disabled={busy || !(base > 0)}
            onClick={() => void submit(false)}
            className="h-10 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold disabled:opacity-50"
          >
            🤝 Em confiança — cliente paga depois
          </button>
          <button
            type="button"
            disabled={busy || !(base > 0)}
            onClick={() => void submit(true)}
            className="h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
          >
            ✅ Já recebi — lançar o pagamento agora
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-9 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
          >
            Não registrar
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}
