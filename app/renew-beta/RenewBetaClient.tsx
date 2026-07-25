"use client";
// app/renew/RenewClient.tsx

import { useSearchParams, useRouter } from "next/navigation"; // ✅ useRouter adicionado
import { useState, useEffect, useMemo, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import Image from "next/image";
import { useConfirm } from "@/hooks/useConfirm";
import { Pencil, CheckCircle2, ShieldCheck, Loader2 } from "lucide-react";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import AddAppModal from "./AddAppModal";
import { normalizeMacInput } from "@/lib/apps/field-types";

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
  has_integration?: boolean;
  technology?: string;
  modalidade?: string | null;
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

const SERVER_GUIA_MAP: Record<string, string> = {
  "EliteTV": "ELITE",
  "NaTV": "NATV",
  "FastTV": "FAST",
  "UniGestor": "TODOS",
};

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
  if (low.includes("sess") || low.includes("session"))
    return "Sessão expirada ou inválida";
  if (low.includes("conta") || low.includes("accounts"))
    return "Não foi possível carregar suas contas";
  if (low.includes("preço") || low.includes("prices") || low.includes("plano"))
    return "Não foi possível carregar os planos";

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
  const todaySP = new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Sao_Paulo",
  });

  const d1 = new Date(`${todaySP}T12:00:00`);
  const d2 = new Date(`${isoTarget}T12:00:00`);
  const diffDays = Math.ceil(
    (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Vencido
  if (diffDays < 0) {
    const expiredDays = Math.abs(diffDays);
    if (expiredDays === 1)
      return { expired: true, text: "Assinatura venceu ontem" };
    return { expired: true, text: `Assinatura vencida há ${expiredDays} dias` };
  }

  // Vence hoje
  if (diffDays === 0) {
    const dueFormatted = new Date(vencimento).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      expired: false,
      today: true,
      text: `Assinatura vence hoje às ${dueFormatted}`,
    };
  }

  // Vence amanhã
  if (diffDays === 1)
    return { expired: false, text: "Assinatura vence amanhã" };

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

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}`;
}

function calculateDiscount(
  monthlyPrice: number,
  totalPrice: number,
  months: number,
) {
  const monthlyEquivalent = totalPrice / months;
  const discount = ((monthlyPrice - monthlyEquivalent) / monthlyPrice) * 100;
  return Math.round(discount * 10) / 10; // 1 casa decimal
}

// ========= MAIN COMPONENT =========
export default function RenewClient() {
  const sp = useSearchParams();
  const router = useRouter(); // ✅ router instanciado para redirecionamento
  const { confirm } = useConfirm();
  const alertError = (msg: string) =>
    confirm({
      title: "Aviso",
      subtitle: msg,
      tone: "rose",
      confirmText: "OK",
      cancelText: "",
    });

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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  // ✅ Menu de 3 blocos (novidade do /renew-beta): "menu" é a tela inicial
  // depois de escolher a conta; "payment" e "apps" são os blocos 1 e 3.
  const [activeSection, setActiveSection] = useState<
    "menu" | "payment" | "apps"
  >("menu");
  type InstalledAppField = { id: string; type: string; label: string; value: string };
  type InstalledApp = {
    id: string;
    app_id: string;
    name: string;
    icon_url: string | null;
    has_integration: boolean;
    can_check_validity: boolean;
    has_pending_setup_request: boolean;
    has_pending_removal_request: boolean;
    expiration: string | null;
    fields: InstalledAppField[];
    license_price: number | null;
    license_period: "annual" | "lifetime" | null;
  };
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [installedAppsLoading, setInstalledAppsLoading] = useState(false);
  const [installedAppsError, setInstalledAppsError] = useState<string | null>(
    null,
  );
  // Bloco 3 — sub-abas
  const [appsSubTab, setAppsSubTab] = useState<"meus-apps" | "duvidas">("meus-apps");

  // Edição inline de um card de app instalado
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [appActionBusy, setAppActionBusy] = useState<string | null>(null);

  // ✅ Pagamento avulso de licença — pedido do Márcio (25/07/2026): movido da
  // página de detalhe pra cá (tela principal), embaixo do "Excluir
  // Aplicativo" no mesmo card. Não mexe na assinatura IPTV.
  type AppPayment = { clientAppId: string; payment_id: string; pix_qr_code?: string; pix_qr_code_base64?: string; price_amount: number };
  const [renewPayment, setRenewPayment] = useState<AppPayment | null>(null);
  const [renewPaymentBusyId, setRenewPaymentBusyId] = useState<string | null>(null);
  const [renewPaymentDone, setRenewPaymentDone] = useState(false);
  const [renewPollInterval, setRenewPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (renewPollInterval) clearInterval(renewPollInterval);
    };
  }, [renewPollInterval]);

  function startPollingAppPayment(paymentId: string) {
    if (!session) return;
    if (renewPollInterval) clearInterval(renewPollInterval);
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/client-portal/payment-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: session, payment_id: paymentId }),
          cache: "no-store",
        });
        const result = await res.json().catch(() => null);
        if (!result?.ok) return;
        if (String(result.phase || "").toLowerCase() === "done") {
          clearInterval(interval);
          setRenewPollInterval(null);
          setRenewPaymentDone(true);
        }
      } catch {
        // continua tentando
      }
    }, 3000);
    setRenewPollInterval(interval);
  }

  async function handleRenewPayment(clientAppId: string) {
    if (!selectedAccountId || !session) return;
    setRenewPaymentBusyId(clientAppId);
    try {
      const res = await fetch("/api/client-portal/apps/renew-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao gerar pagamento.");
      setRenewPaymentDone(false);
      setRenewPayment({
        clientAppId,
        payment_id: result.payment_id,
        pix_qr_code: result.pix_qr_code,
        pix_qr_code_base64: result.pix_qr_code_base64,
        price_amount: result.price_amount,
      });
      startPollingAppPayment(result.payment_id);
    } catch (err: any) {
      addToast("error", "Falha ao gerar pagamento", err?.message);
    } finally {
      setRenewPaymentBusyId(null);
    }
  }

  function closeRenewPaymentModal() {
    if (renewPollInterval) clearInterval(renewPollInterval);
    setRenewPollInterval(null);
    setRenewPayment(null);
    setRenewPaymentDone(false);
  }

  // Toasts (feedback de sucesso/erro nas ações do Bloco 3)
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  function addToast(type: ToastMessage["type"], title: string, message?: string) {
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), type, title, message }]);
  }
  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Picker "+ Adicionar aplicativo" (modal por tipo de equipamento)
  const [showAddAppPicker, setShowAddAppPicker] = useState(false);
  const [appCatalog, setAppCatalog] = useState<
    {
      id: string;
      name: string;
      icon_url: string | null;
      device_types?: string[];
      license_price?: number | null;
      license_period?: "annual" | "lifetime" | null;
    }[]
  >([]);
  const [appCatalogLoading, setAppCatalogLoading] = useState(false);

  // Sub-aba "Dúvidas" — conteúdo vindo de bot_knowledge (curado no admin)
  const [faqData, setFaqData] = useState<{
    device_setup: { title: string; content: string; device_types: string[] }[];
    faq: { title: string; content: string; category: string }[];
  } | null>(null);
  const [faqLoading, setFaqLoading] = useState(false);

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
        .map((v) => String(v || ""))
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
  const [paymentStatus, setPaymentStatus] = useState<
    "pending" | "approved" | "rejected"
  >("pending");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false); // ✅ NOVO
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [pendingRenew, setPendingRenew] = useState<{
    price: PlanPrice;
    period: string;
  } | null>(null);

  // ✅ Pendências financeiras (ativação de app não paga etc.) — some ao total
  const [pendingCharges, setPendingCharges] = useState<{
    total: number;
    currency: string;
    items: {
      message: string;
      appName: string | null;
      convertedAmount: number;
      activationDate: string | null;
    }[];
  } | null>(null);
  const [showPendingChargesModal, setShowPendingChargesModal] = useState(false);
  const [pendingChargesContinuation, setPendingChargesContinuation] = useState<
    (() => void) | null
  >(null);
  const [checkingPendingCharges, setCheckingPendingCharges] = useState(false);
  // ✅ Guardado no momento da confirmação, pro Resumo no modal de pagamento
  const [confirmedPeriod, setConfirmedPeriod] = useState<string | null>(null);
  const [confirmedBasePrice, setConfirmedBasePrice] = useState<number | null>(
    null,
  );

  // ✅ Cupom de desconto — só existe pra contas em BRL. Nunca manda o
  // valor do desconto pro servidor, só o código; quem recalcula é o
  // create-payment.
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discountAmount: number;
    planPriceOnly: number;
    discountType: "percent" | "fixed" | null;
    discountValue: number | null;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  // ✅ NOVO: Estados para controle visual do botão de copiar
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // ✅ NOVO: Controle de abas para a transferência EUR
  const [eurTab, setEurTab] = useState<"local" | "intl">("local");

  const [stripeReady, setStripeReady] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const stripeRef = useRef<any>(null);
  const cardNumberRef = useRef<any>(null);
  const cardExpiryRef = useRef<any>(null);
  const cardCvcRef = useRef<any>(null);
  const [cardNumberMountEl, setCardNumberMountEl] =
    useState<HTMLDivElement | null>(null);
  const [cardExpiryMountEl, setCardExpiryMountEl] =
    useState<HTMLDivElement | null>(null);
  const [cardCvcMountEl, setCardCvcMountEl] = useState<HTMLDivElement | null>(
    null,
  );
  const [stripeStep, setStripeStep] = useState<1 | 2>(1);
  const [paymentRequest, setPaymentRequest] = useState<any>(null);
  const [prButtonMountEl, setPrButtonMountEl] = useState<HTMLDivElement | null>(
    null,
  );

  function copyField(key: string, value: string) {
    navigator.clipboard.writeText(value ?? "");
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 3000);
  }

  // ✅ NOVO: fases do fluxo (UI mais clara)
  const [paymentPhase, setPaymentPhase] = useState<
    "awaiting_payment" | "renewing" | "done" | "error"
  >("awaiting_payment");

  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
    null,
  );
  const [tenantBrand, setTenantBrand] = useState<{
    logo_url?: string | null;
  } | null>(null);

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
          admin_whatsapp: sess.admin_whatsapp,
        });

        const { data: brand } = await supabaseBrowser
          .from("vw_tenant_branding")
          .select("logo_url")
          .eq("id", sess.tenant_id)
          .maybeSingle();
        if (brand) setTenantBrand(brand);

        // 2. Buscar contas via API
        const accRes = await fetch("/api/client-portal/get-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: session }),
          cache: "no-store",
        });

        const accResult = await accRes.json().catch(() => null);

        if (!accResult?.ok)
          throw new Error("Não foi possível carregar suas contas");

        const mapped: ClientAccount[] = accResult.data;
        setAccounts(mapped);

        // Se só tem 1 conta, seleciona automaticamente
        if (mapped.length === 1) {
          setSelectedAccountId(mapped[0].id);
        }

        setLoading(false);
      } catch (err: any) {
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
          (k) => PERIOD_LABELS[k] === account.plan_label,
        );
        if (currentPeriod) setSelectedPeriod(currentPeriod);
      } catch {}
    }

    loadPrices();
  }, [selectedAccountId, accounts, session]);

  // ========= BLOCO 3 — CARREGAMENTO E AÇÕES =========
  async function refreshInstalledApps() {
    if (!selectedAccountId || !session) return;
    setInstalledAppsLoading(true);
    setInstalledAppsError(null);
    try {
      const res = await fetch("/api/client-portal/apps/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId }),
        cache: "no-store",
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error("Não foi possível carregar seus aplicativos");
      setInstalledApps(result.data || []);
    } catch (err: any) {
      setInstalledAppsError(safeUserError(err?.message));
    } finally {
      setInstalledAppsLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection !== "apps") return;
    refreshInstalledApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, selectedAccountId, session]);

  // FAQ / instruções de novo dispositivo — carrega uma vez ao entrar no Bloco 3
  useEffect(() => {
    async function loadFaq() {
      if (activeSection !== "apps" || !session || faqData) return;
      setFaqLoading(true);
      try {
        const res = await fetch("/api/client-portal/faq", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: session }),
          cache: "no-store",
        });
        const result = await res.json().catch(() => null);
        if (result?.ok) setFaqData(result.data);
      } catch {
      } finally {
        setFaqLoading(false);
      }
    }
    loadFaq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, session]);

  async function loadAppCatalog() {
    if (!selectedAccountId || !session) return;
    setAppCatalogLoading(true);
    try {
      const res = await fetch("/api/client-portal/apps/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId }),
        cache: "no-store",
      });
      const result = await res.json().catch(() => null);
      if (result?.ok) setAppCatalog(result.data || []);
    } catch {
    } finally {
      setAppCatalogLoading(false);
    }
  }

  function startEditingApp(app: InstalledApp) {
    setEditingAppId(app.id);
    const vals: Record<string, string> = {};
    for (const f of app.fields) vals[f.id] = f.value;
    setEditingValues(vals);
  }

  async function handleSaveAppFields(clientAppId: string) {
    if (!selectedAccountId || !session) return;
    setAppActionBusy(clientAppId);
    try {
      const res = await fetch("/api/client-portal/apps/update-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: session,
          client_id: selectedAccountId,
          client_app_id: clientAppId,
          fields: editingValues,
        }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Não foi possível salvar.");
      setEditingAppId(null);
      addToast("success", "Salvo!", "Campos atualizados.");
      await refreshInstalledApps();
    } catch (err: any) {
      addToast("error", "Não foi possível salvar", err?.message);
    } finally {
      setAppActionBusy(null);
    }
  }

  async function handleConfigureApp(clientAppId: string) {
    if (!selectedAccountId || !session) return;
    setAppActionBusy(clientAppId);
    try {
      const res = await fetch("/api/client-portal/apps/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao configurar.");
      addToast("success", "Configurado!", result.expireDate ? `Vencimento: ${String(result.expireDate).split("-").reverse().join("/")}` : undefined);
      await refreshInstalledApps();
    } catch (err: any) {
      addToast("error", "Falha ao configurar", err?.message);
    } finally {
      setAppActionBusy(null);
    }
  }

  async function handleRequestSetup(clientAppId: string) {
    if (!selectedAccountId || !session) return;
    setAppActionBusy(clientAppId);
    try {
      const res = await fetch("/api/client-portal/apps/request-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao solicitar configuração.");
      addToast(
        "success",
        result.data?.already_pending ? "Já solicitado" : "Solicitado!",
        "Nosso suporte vai configurar esse aplicativo pra você em breve.",
      );
      await refreshInstalledApps();
    } catch (err: any) {
      addToast("error", "Falha ao solicitar", err?.message);
    } finally {
      setAppActionBusy(null);
    }
  }

  async function handleCheckValidity(clientAppId: string) {
    if (!selectedAccountId || !session) return;
    setAppActionBusy(clientAppId);
    try {
      const res = await fetch("/api/client-portal/apps/check-validity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao verificar.");
      addToast("success", "Validade verificada!", result.expireDate ? `Vencimento: ${String(result.expireDate).split("-").reverse().join("/")}` : "Não encontrado no painel.");
      await refreshInstalledApps();
    } catch (err: any) {
      addToast("error", "Falha ao verificar", err?.message);
    } finally {
      setAppActionBusy(null);
    }
  }

  async function handleRemoveApp(clientAppId: string, appName: string) {
    if (!selectedAccountId || !session) return;
    const ok = await confirm({
      title: "Excluir aplicativo?",
      subtitle: `"${appName}" será removido dessa conta. Se tiver configuração automática, também some do painel do parceiro; se não tiver, seu pedido vai pro nosso suporte concluir.`,
      tone: "rose",
      confirmText: "Excluir",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    setAppActionBusy(clientAppId);
    try {
      const res = await fetch("/api/client-portal/apps/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId, client_app_id: clientAppId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao excluir.");
      if (result.data?.pending_admin) {
        addToast(
          "success",
          result.data?.already_requested ? "Já solicitado" : "Exclusão solicitada",
          "Nosso suporte vai remover esse aplicativo em breve.",
        );
      } else {
        addToast("success", "Excluído!", `"${appName}" foi removido dessa conta.`);
      }
      await refreshInstalledApps();
    } catch (err: any) {
      addToast("error", "Falha ao excluir", err?.message);
    } finally {
      setAppActionBusy(null);
    }
  }

  async function handleAddApp(appId: string) {
    if (!selectedAccountId || !session) return;
    setAppActionBusy(`add-${appId}`);
    try {
      const res = await fetch("/api/client-portal/apps/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: session, client_id: selectedAccountId, app_id: appId }),
      });
      const result = await res.json().catch(() => null);
      if (!result?.ok) throw new Error(result?.error || "Falha ao adicionar.");
      setShowAddAppPicker(false);
      addToast("success", "Adicionado!", "Preencha os campos e configure quando estiver pronto.");
      await refreshInstalledApps();
    } catch (err: any) {
      addToast("error", "Falha ao adicionar", err?.message);
    } finally {
      setAppActionBusy(null);
    }
  }

  // ========= COMPUTED =========
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId],
  );

  const selectedPrice = useMemo(
    () => availablePrices.find((p) => p.period === selectedPeriod),
    [availablePrices, selectedPeriod],
  );

  // ✅ Mesmo fallback já usado em handleRenew/botão "Pagar e Renovar":
  // plano selecionado, senão o plano atual do cliente. Usado pro cupom
  // (prévia + modal de pendência) precisar de um preço antes de clicar
  // em renovar.
  const activeRenewPrice = useMemo(() => {
    if (selectedPrice && selectedPrice.price_amount > 0) return selectedPrice;
    return prices.find(
      (p) => PERIOD_LABELS[p.period] === selectedAccount?.plan_label,
    );
  }, [selectedPrice, prices, selectedAccount]);

  // ✅ Desconto depende do preço da CONTA (client_id) + período escolhidos
  // — trocar de período OU de conta invalida o cupom aplicado (precisa
  // reaplicar). Faltava selectedAccountId aqui: como uma pessoa pode ter
  // várias contas com preços diferentes no mesmo WhatsApp, trocar de conta
  // sem trocar de período deixava o discountAmount da conta anterior
  // "vazar" pra conta nova (achado grave: mostrava desconto calculado em
  // cima do preço errado antes de pagar).
  useEffect(() => {
    setAppliedCoupon(null);
    setCouponError(null);
  }, [selectedPeriod, selectedAccountId]);

  const monthlyPrice = useMemo(
    () => availablePrices.find((p) => p.period === "MONTHLY"),
    [availablePrices],
  );

  const discount = useMemo(() => {
    if (!monthlyPrice || !selectedPrice || selectedPeriod === "MONTHLY")
      return 0;
    const months = PERIOD_MONTHS[selectedPeriod];
    return calculateDiscount(
      monthlyPrice.price_amount,
      selectedPrice.price_amount,
      months,
    );
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

  // ✅ Prévia (nunca autoritativa) — o create-payment recalcula tudo de
  // novo do zero na hora de pagar, nunca confia no que essa chamada
  // devolveu (mesma regra da checagem de pendência abaixo).
  async function handleApplyCoupon() {
    if (!couponInput.trim() || !selectedAccount || !session) return;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const res = await fetch("/api/client-portal/validate-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: session,
          client_id: selectedAccount.id,
          period: selectedPeriod,
          code: couponInput.trim(),
        }),
        cache: "no-store",
      });
      const result = await res.json().catch(() => null);
      if (result?.ok) {
        setAppliedCoupon({
          code: result.code,
          discountAmount: result.discountAmount,
          planPriceOnly: result.planPriceOnly,
          discountType: result.discountType ?? null,
          discountValue: result.discountValue ?? null,
        });
        setCouponInput("");
      } else {
        setCouponError(result?.reason || result?.error || "Cupom inválido.");
      }
    } catch {
      setCouponError("Erro ao validar cupom. Tente novamente.");
    } finally {
      setCouponChecking(false);
    }
  }

  function handleRemoveCoupon() {
    setAppliedCoupon(null);
    setCouponError(null);
  }

  const handleRenew = async () => {
    // ✅ Bloqueia execução duplicada
    if (isProcessingPayment) return;

    if (!selectedAccount) return;
    if (!session) {
      await alertError("Sessão expirada. Abra o link novamente.");
      clearStoredSession();
      return;
    }

    // Usa plano selecionado nas ofertas, senão usa o plano atual
    const renewPrice =
      selectedPrice && selectedPrice.price_amount > 0
        ? selectedPrice
        : availablePrices.find(
            (p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label,
          );

    if (!renewPrice || !renewPrice.price_amount) {
      await alertError("Erro: valor do plano não encontrado");
      return;
    }

    const renewPeriod =
      selectedPeriod ||
      Object.keys(PERIOD_LABELS).find(
        (k) => PERIOD_LABELS[k] === selectedAccount.plan_label,
      );

    if (!renewPeriod) return;

    // ✅ Sem trava de manual no front: TODOS os BRL pagam via PIX automático.
    // Servidores sem integração (UniGestor) e Elite são detectados pelo fulfillment
    // do backend e marcados como manual_pending APÓS a confirmação do pagamento.
    const proceed = async () => {
      if (selectedAccount.price_currency === "BRL") {
        await handleMethodConfirmDirect("card", renewPrice, renewPeriod);
        return;
      }
      // Internacional com integração: mostra seletor (Apple Pay / Stripe)
      setPendingRenew({ price: renewPrice, period: renewPeriod });
      setShowMethodSelector(true);
    };

    // ✅ Checa pendências financeiras em aberto ANTES de seguir — se tiver,
    // avisa o cliente que o valor será somado ao total. Se a checagem falhar
    // por qualquer motivo, segue normalmente (o create-payment recalcula
    // tudo de novo no servidor de qualquer forma, então nunca sub-cobra).
    setCheckingPendingCharges(true);
    try {
      const res = await fetch("/api/client-portal/pending-charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: session,
          client_id: selectedAccount.id,
        }),
        cache: "no-store",
      });
      const result = await res.json().catch(() => null);
      if (result?.ok && result.total > 0) {
        setPendingCharges({
          total: result.total,
          currency: result.currency,
          items: result.items || [],
        });
        setPendingChargesContinuation(() => proceed);
        setShowPendingChargesModal(true);
        return;
      }
    } catch {
      // segue normalmente
    } finally {
      setCheckingPendingCharges(false);
    }

    await proceed();
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
          body: JSON.stringify({
            session_token: session,
            payment_id: paymentId,
          }),
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

          // ✅ AJUSTE FINO 1: Aceitar manual_pending como sucesso visual
          if (phaseRaw === "done" || phaseRaw === "manual_pending") {
            if ((window as any).__cp_done_scheduled) return;
            (window as any).__cp_done_scheduled = true;

            const isManual = phaseRaw === "manual_pending";

            setPaymentPhase("done");
            setPaymentStatus("approved");
            setPaymentData((prev: any) => ({
              ...prev,
              new_vencimento: result.new_vencimento,
              is_manual: isManual, // 👈 Flag silenciosa para UI
            }));

            clearInterval(interval);
            setPollingInterval(null);

            // ✅ MUDANÇA: Só faz refresh automático se for renovação via API (done).
            // Para renovação manual, NUNCA recarrega (cliente deve aguardar mensagem WA).
            if (!isManual) {
              setTimeout(() => window.location.reload(), 10000);
            }
            return;
          }

          if (phaseRaw === "error") {
            setPaymentPhase("error");
            setPaymentStatus("rejected");

            alertError(
              "Pagamento aprovado, mas houve falha ao concluir a renovação.\nProcure o suporte.",
            );

            clearInterval(interval);
            setPollingInterval(null);
            return;
          }

          // Qualquer phase desconhecida -> segue polling sem travar
          return;
        }

        // ✅ Fallback (caso seu backend ainda esteja devolvendo status/fulfillment antigo)
        const status = String(result.status || "").toLowerCase();
        const fulfillment = String(
          result.fulfillment_status || "",
        ).toLowerCase();

        if (status === "approved") {
          // Pagamento ok, mas fulfillment ainda rodando -> UI deve mostrar renovando
          setPaymentPhase("renewing");

          if (fulfillment === "done" || fulfillment === "manual_pending") {
            if ((window as any).__cp_done_scheduled) return;
            (window as any).__cp_done_scheduled = true;

            const isManual = fulfillment === "manual_pending";

            setPaymentPhase("done");
            setPaymentStatus("approved");
            setPaymentData((prev: any) => ({
              ...prev,
              new_vencimento: result.new_vencimento,
              is_manual: isManual, // 👈 Flag silenciosa para UI
            }));

            clearInterval(interval);
            setPollingInterval(null);

            // ✅ MUDANÇA: Só faz refresh automático se for renovação via API (done).
            // Para renovação manual, NUNCA recarrega (cliente deve aguardar mensagem WA).
            if (!isManual) {
              setTimeout(() => window.location.reload(), 10000);
            }
            return;
          }

          if (fulfillment === "error") {
            setPaymentPhase("error");
            setPaymentStatus("rejected");

            alertError(
              "Pagamento aprovado, mas houve falha ao concluir a renovação.\nProcure o suporte.",
            );

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
      } catch {
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
    if ((window as any).Stripe) {
      setStripeReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.onload = () => setStripeReady(true);
    document.head.appendChild(script);
  }, []);

  // ✅ Script de segurança do Mercado Pago (Device ID) — mesmo padrão do
  // Stripe.js acima. Sem UI, só gera window.MP_DEVICE_SESSION_ID, que a
  // gente manda pro create-payment na hora de pagar (melhora a
  // "Qualidade da Integração" e a taxa de aprovação no MP).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (document.getElementById("mp-security-script")) return;
    const script = document.createElement("script");
    script.id = "mp-security-script";
    script.src = "https://www.mercadopago.com/v2/security.js";
    script.setAttribute("view", "checkout");
    document.head.appendChild(script);
  }, []);

  // Montar 3 card elements quando modal Stripe abrir
  useEffect(() => {
    if (
      !paymentModal ||
      !paymentData ||
      paymentData.payment_method !== "stripe"
    )
      return;
    if (
      !stripeReady ||
      !cardNumberMountEl ||
      !cardExpiryMountEl ||
      !cardCvcMountEl
    )
      return;
    if (!(window as any).Stripe) return;

    const stripe = (window as any).Stripe(paymentData.publishable_key);
    stripeRef.current = stripe;
    const elements = stripe.elements({ disableLink: true });

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
      try {
        cardNumber.unmount();
      } catch {}
      try {
        cardExpiry.unmount();
      } catch {}
      try {
        cardCvc.unmount();
      } catch {}
    };
  }, [
    paymentModal,
    paymentData,
    stripeReady,
    cardNumberMountEl,
    cardExpiryMountEl,
    cardCvcMountEl,
  ]);

  // Montar PaymentRequestButton (Apple Pay / Google Pay)
  useEffect(() => {
    if (
      !paymentModal ||
      !paymentData ||
      paymentData.payment_method !== "apple_google"
    )
      return;
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
        style: {
          paymentRequestButton: { height: "52px", borderRadius: "12px" },
        },
      });
      prButton.mount(prButtonMountEl);

      pr.on("paymentmethod", async (ev: any) => {
        const { error, paymentIntent } = await stripe.confirmCardPayment(
          paymentData.client_secret,
          { payment_method: ev.paymentMethod.id },
          { handleActions: false },
        );

        if (error) {
          ev.complete("fail");
          await alertError(error.message || "Erro ao processar pagamento.");
          return;
        }

        ev.complete("success");

        if (paymentIntent.status === "succeeded") {
          setPaymentPhase("renewing");
          startPolling(String(paymentData.payment_id));
        } else if (paymentIntent.status === "requires_action") {
          const { error: actionError } = await stripe.confirmCardPayment(
            paymentData.client_secret,
          );
          if (actionError) {
            await alertError(actionError.message || "Autenticação necessária falhou.");
            return;
          }
          setPaymentPhase("renewing");
          startPolling(String(paymentData.payment_id));
        }
      });

      setPaymentRequest(pr);
    });

    return () => {
      try {
        prButtonMountEl.innerHTML = "";
      } catch {}
    };
  }, [paymentModal, paymentData, stripeReady, prButtonMountEl]);

  // ✅ REGRA DO SUPORTE: Pega estritamente o do admin.
  const supportPhone = sessionData?.admin_whatsapp || "";
  async function handleMethodConfirmDirect(
    choice: "card" | "apple_google" | "manual",
    overridePrice?: PlanPrice,
    overridePeriod?: string,
  ) {
    const resolvedPeriod = overridePeriod ?? pendingRenew?.period;
    if (!resolvedPeriod || !selectedAccount || !session) return;
    setShowMethodSelector(false);

    // ✅ Guarda o que foi de fato confirmado, pro Resumo no modal de
    // pagamento — independe de vir por override (BRL/PIX) ou pendingRenew
    // (seletor internacional).
    const resolvedPriceForSummary = overridePrice ?? pendingRenew?.price;
    setConfirmedPeriod(resolvedPeriod);
    setConfirmedBasePrice(resolvedPriceForSummary?.price_amount ?? null);

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
          coupon_code: appliedCoupon?.code || null,
          // ✅ Device ID do Mercado Pago (gerado pelo security.js carregado
          // no useEffect acima) — melhora a "Qualidade da Integração" e a
          // taxa de aprovação no MP. Undefined/vazio se o script ainda não
          // rodou ou o método não for MP; o backend trata como opcional.
          mp_device_id: (window as any).MP_DEVICE_SESSION_ID || null,
        }),
        cache: "no-store",
      });

      const result = await res.json().catch(() => null);

      if (!result?.ok) {
        await alertError("Não foi possível criar o pagamento. Tente novamente.");
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
    } catch {
      await alertError("Erro ao processar renovação. Tente novamente.");
    } finally {
      setIsProcessingPayment(false);
      setPendingRenew(null);
    }
  }

  async function handleStripeConfirm() {
    if (!stripeRef.current || !cardNumberRef.current || !paymentData) return;
    setStripeLoading(true);
    try {
      const result = await stripeRef.current.confirmCardPayment(
        paymentData.client_secret,
        {
          payment_method: { card: cardNumberRef.current },
        },
      );

      if (result.error) {
        await alertError(result.error.message || "Erro ao processar cartão.");
        return;
      }

      if (result.paymentIntent?.status === "succeeded") {
        // Pagamento confirmado — mostra "renovando" e inicia polling
        setPaymentPhase("renewing");
        startPolling(String(paymentData.payment_id));
      }
    } catch (e: any) {
      await alertError(e?.message || "Erro ao processar pagamento. Tente novamente.");
    } finally {
      setStripeLoading(false);
    }
  }

  function MethodSelectorModal() {
    if (!showMethodSelector || !pendingRenew || !selectedAccount) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm bg-card rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 py-4 px-6 text-white text-center">
            <h2 className="text-lg font-bold">Como deseja pagar?</h2>
            <p className="text-sm text-white/70 mt-0.5">
              {formatMoney(
                pendingRenew.price.price_amount,
                selectedAccount.price_currency,
              )}
            </p>
          </div>

          <div className="p-4 space-y-3">
            <button
              onClick={() => handleMethodConfirmDirect("card")}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-border hover:border-indigo-500 hover:bg-indigo-500/10 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-xl shrink-0">
                💳
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="font-bold text-foreground">
                    Cartão de Crédito / Débito
                  </p>
                </div>
                <p className="text-xs text-foreground/70 mb-1">
                  Somente Visa ou Mastercard
                </p>
                <span className="inline-block px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold rounded-full">
                  ✅ Renovação Automática
                </span>
              </div>
            </button>

            <button
              onClick={() => handleMethodConfirmDirect("apple_google")}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-border hover:border-indigo-500 hover:bg-indigo-500/10 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xl shrink-0">
                📱
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-foreground mb-0.5">
                  Apple Pay / Google Pay
                </p>
                <p className="text-xs text-foreground/70 mb-1">
                  Utilize a carteira digital do seu dispositivo
                </p>
                <span className="inline-block px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold rounded-full">
                  ✅ Renovação Automática
                </span>
              </div>
            </button>

            <button
              onClick={() => handleMethodConfirmDirect("manual")}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-border hover:border-amber-400 hover:bg-amber-500/10 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-xl shrink-0">
                🏦
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-foreground mb-0.5">
                  Transferência Bancária
                </p>
                <p className="text-xs text-foreground/70 mb-1">
                  IBAN / SEPA — confirmação via suporte
                </p>
                <span className="inline-block px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] font-bold rounded-full">
                  ⚠️ Renovação Manual
                </span>
              </div>
            </button>

            <button
              onClick={() => {
                setShowMethodSelector(false);
                setPendingRenew(null);
              }}
              className="w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors pt-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  function PendingChargesModal() {
    if (!showPendingChargesModal || !pendingCharges) return null;

    // ✅ Resumo (plano + desconto do cupom, se houver) — pedido do Marcio
    // pra esse modal também refletir o desconto nos somatórios. Só
    // aparece quando dá pra saber o preço do plano nesse ponto do fluxo.
    const summaryBase = activeRenewPrice?.price_amount ?? null;
    const summaryCouponDiscount = appliedCoupon?.discountAmount || 0;
    const summaryGrandTotal =
      (summaryBase || 0) - summaryCouponDiscount + pendingCharges.total;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-card rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-amber-600 to-amber-700 py-4 px-6 text-white text-center">
            <h2 className="text-lg font-bold">📋 Pendência identificada</h2>
          </div>

          <div className="p-5 space-y-3">
            {summaryBase != null && selectedAccount && (
              <div className="space-y-1 pb-3 border-b border-border text-sm">
                <div className="flex justify-between text-foreground/80">
                  <span>Plano</span>
                  <span>{formatMoney(summaryBase, selectedAccount.price_currency)}</span>
                </div>
                {summaryCouponDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Desconto (cupom {appliedCoupon?.code})</span>
                    <span>-{formatMoney(summaryCouponDiscount, selectedAccount.price_currency)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              {pendingCharges.items.map((it, idx) => {
                const dateLabel = it.activationDate
                  ? new Date(`${it.activationDate}T12:00:00`).toLocaleDateString("pt-BR")
                  : "";
                return (
                  <div
                    key={idx}
                    className="flex justify-between items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border"
                  >
                    <div className="text-sm text-foreground/90 whitespace-nowrap overflow-hidden text-ellipsis">
                      {it.appName
                        ? `Ativação: ${it.appName}${dateLabel ? ` dia ${dateLabel}` : ""}`
                        : it.message || "Pendência"}
                    </div>
                    <div className="text-sm font-bold text-foreground shrink-0">
                      {formatMoney(it.convertedAmount, pendingCharges.currency)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-border">
              <span className="text-sm font-medium text-muted-foreground">
                Total da Pendência
              </span>
              <span className="text-lg font-bold text-amber-500">
                {formatMoney(pendingCharges.total, pendingCharges.currency)}
              </span>
            </div>

            {summaryBase != null && selectedAccount && (
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-foreground">Total Geral</span>
                <span className="text-lg font-bold text-foreground">
                  {formatMoney(summaryGrandTotal, selectedAccount.price_currency)}
                </span>
              </div>
            )}

            <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs text-muted-foreground leading-relaxed">
              Se você já regularizou essa pendência, entre em contato direto
              com o Márcio
              {supportPhone && (
                <>
                  {" "}
                  clicando aqui:{" "}
                  <a
                    href={`https://wa.me/${supportPhone.replace(/\D/g, "")}?text=Olá,%20sobre%20a%20pendência%20da%20minha%20renovação:%20já%20paguei%20isso%20antes.`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 underline decoration-emerald-600/40 underline-offset-2 hover:text-emerald-500"
                  >
                    WhatsApp suporte
                  </a>
                </>
              )}
              .
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowPendingChargesModal(false);
                  setPendingCharges(null);
                  setPendingChargesContinuation(null);
                }}
                className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground font-medium text-sm hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowPendingChargesModal(false);
                  const cont = pendingChargesContinuation;
                  setPendingChargesContinuation(null);
                  cont?.();
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm shadow-lg shadow-amber-900/20 transition-all"
              >
                Continuar
              </button>
            </div>
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
    const waNumber = String(sessionData?.admin_whatsapp ?? "").replace(
      /[^\d]/g,
      "",
    );

    // ✅ Resumo (plano + pendência + total) — mostrado antes do QR/cartão,
    // igual pra PIX (Mercado Pago) e cartão (Stripe).
    const summaryCurrency = selectedAccount.price_currency;
    const summaryPeriodLabel = confirmedPeriod
      ? PERIOD_LABELS[confirmedPeriod] || confirmedPeriod
      : null;
    const summaryCouponDiscount = appliedCoupon?.discountAmount || 0;
    const summaryTotal =
      (confirmedBasePrice || 0) -
      summaryCouponDiscount +
      (pendingCharges?.total || 0);
    const showSummary =
      !isApproved &&
      !isRejected &&
      paymentPhase !== "renewing" &&
      confirmedBasePrice != null;

    const summaryBlock = showSummary && (
      <div className="px-5 pt-4 space-y-1.5 text-sm">
        <div className="flex justify-between text-foreground/80">
          <span>Plano {summaryPeriodLabel}</span>
          <span>{formatMoney(confirmedBasePrice as number, summaryCurrency)}</span>
        </div>
        {summaryCouponDiscount > 0 && (
          <div className="flex justify-between text-emerald-600">
            <span>Desconto (cupom {appliedCoupon?.code})</span>
            <span>-{formatMoney(summaryCouponDiscount, summaryCurrency)}</span>
          </div>
        )}
        {pendingCharges && pendingCharges.total > 0 && (
          <div className="flex justify-between text-foreground/80">
            <span>Pendência Aplicativo</span>
            <span>{formatMoney(pendingCharges.total, summaryCurrency)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-foreground pt-1.5 border-t border-border">
          <span>Total a Pagar</span>
          <span>{formatMoney(summaryTotal, summaryCurrency)}</span>
        </div>
      </div>
    );

    const securityNote = !isApproved && !isRejected && paymentPhase !== "renewing" && (
      <div className="px-5 pb-4 pt-2">
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          Conexão segura (SSL) — pagamento processado direto pelo{" "}
          {isStripe ? "Stripe" : "Mercado Pago"}
        </div>
      </div>
    );

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-md bg-card rounded-3xl shadow-2xl overflow-y-auto max-h-[95vh]">
          {/* Success */}
          {isApproved && (
            <div className="p-6 sm:p-8 text-center">
              {paymentData?.is_manual ? (
                <>
                  {/* Icone de Sucesso (Substituindo a ampulheta) */}
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-10 h-10 text-emerald-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>

                  {/* Título */}
                  <h2 className="text-2xl sm:text-3xl font-black text-foreground mb-5 leading-tight tracking-tight">
                    Pagamento Confirmado!
                  </h2>

                  {/* Caixa Verde - Pagamento OK */}
                  <div className="bg-emerald-500/10 border-2 border-emerald-500/20 rounded-xl p-3 sm:p-4 mb-3 text-left">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                        <svg
                          className="w-5 h-5 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-emerald-500 mb-0.5">
                          Pagamento recebido
                        </p>
                        <p className="text-xs text-emerald-500 leading-relaxed">
                          Sua transação foi confirmada com sucesso.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Caixa Azul - Suporte notificado */}
                  <div className="bg-sky-500/10 border-2 border-sky-500/20 rounded-xl p-3 sm:p-4 mb-3 text-left">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-base">🔔</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-sky-500 mb-0.5">
                          Suporte já foi notificado
                        </p>
                        <p className="text-xs text-sky-500 leading-relaxed">
                          Nossa equipe já está processando sua renovação no
                          servidor.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Caixa Amarela - Instruções finais */}
                  <div className="bg-amber-500/10 border-2 border-amber-500/20 rounded-xl p-3 sm:p-4 mb-5 text-left">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-base">⚠️</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-amber-500 mb-0.5">
                          Tudo certo! Pode fechar esta janela.
                        </p>
                        <p className="text-xs text-amber-500/90 leading-relaxed">
                          <strong>
                            Não é necessário enviar o comprovante.
                          </strong>{" "}
                          Apenas aguarde — você receberá a confirmação da
                          renovação no seu WhatsApp em instantes.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Botão de Fechar */}
                  <button
                    onClick={() => {
                      // Tenta fechar a aba
                      window.close();

                      // Fallback: se o navegador bloquear o fechamento da aba, fechamos o modal após um instante
                      setTimeout(() => {
                        setPaymentModal(false);
                        setPaymentData(null);
                        setPaymentStatus("pending");
                        setPaymentPhase("awaiting_payment");
                      }, 300);
                    }}
                    className="w-full py-3 sm:py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
                  >
                    Clique aqui para fechar
                  </button>
                </>
              ) : (
                <>
                  {/* Renovação automática (fluxo original) */}
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-10 h-10 text-emerald-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>

                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    Renovação com sucesso ✅
                  </h2>

                  <p className="text-sm text-muted-foreground mb-4 font-medium">
                    Pagamento confirmado e assinatura atualizada.
                  </p>

                  {paymentData?.new_vencimento && (
                    <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                      <p className="text-sm text-emerald-500 font-medium">
                        Novo vencimento:{" "}
                        {formatDateTime(paymentData.new_vencimento)}
                      </p>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground mt-4">
                    Atualizando página...
                  </p>
                </>
              )}
            </div>
          )}

          {/* Rejected */}
          {isRejected && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-10 h-10 text-rose-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Falha na Renovação
              </h2>
              <p className="text-muted-foreground mb-6">
                Confirme se a transferência foi realizada e entre em contato com
                o suporte.
              </p>
              <button
                onClick={() => {
                  setPaymentModal(false);
                  setPaymentData(null);
                  setPaymentStatus("pending");
                }}
                className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-500 transition-colors"
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
                  {paymentPhase === "renewing"
                    ? "Pagamento confirmado ✅"
                    : "Pague com PIX"}
                </h2>

                <p className="text-sm text-white/80">
                  {paymentPhase === "renewing"
                    ? "Renovação em andamento…"
                    : paymentData.gateway_name || "Mercado Pago"}
                </p>

                {/* ✅ extra: ainda mostra o gateway, mas sem poluir */}
                {paymentPhase === "renewing" && paymentData.gateway_name && (
                  <p className="text-[11px] text-white/70 mt-1">
                    {paymentData.gateway_name}
                  </p>
                )}
              </div>

              {summaryBlock}

              <div className="px-5 pt-4 pb-3 space-y-3">
                {/* QR Code */}
                {paymentPhase !== "renewing" && (
                  <div className="bg-card p-2 sm:p-4 rounded-xl border-2 border-border">
                    {paymentData.pix_qr_code_base64 ? (
                      <img
                        src={`data:image/png;base64,${paymentData.pix_qr_code_base64}`}
                        alt="QR Code PIX"
                        className="w-full max-w-[180px] sm:max-w-[220px] mx-auto"
                      />
                    ) : (
                      <div className="w-48 h-48 sm:w-56 sm:h-56 bg-muted rounded-lg flex items-center justify-center mx-auto">
                        <p className="text-muted-foreground text-sm text-center">
                          QR Code não disponível
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Instruções */}
                {paymentPhase !== "renewing" && (
                  <div className="space-y-2 text-sm">
                    <p className="font-bold text-foreground/90 flex items-center gap-2">
                      <span>📱</span> Como pagar:
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground pl-6">
                      <li>Abra o app do seu banco</li>
                      <li>Escaneie o QR Code</li>
                      <li>Confirme o pagamento</li>
                    </ol>
                  </div>
                )}

                {/* Código Copia e Cola - Visual Premium */}
                {paymentPhase !== "renewing" && paymentData.pix_qr_code && (
                  <div className="bg-muted/50 p-3 rounded-xl border border-border space-y-2">
                    <p className="text-xs font-bold text-foreground/70 uppercase tracking-wider text-center">
                      Ou copie o código:
                    </p>
                    <div className="relative group">
                      <input
                        type="text"
                        value={paymentData.pix_qr_code}
                        readOnly
                        className="w-full pr-28 pl-3 py-2.5 bg-card border-2 border-border rounded-lg text-xs font-mono text-foreground/90 outline-none focus:border-sky-500 transition-colors shadow-sm"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            paymentData.pix_qr_code,
                          );
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 3000);
                        }}
                        className={`absolute right-1 top-1 bottom-1 px-4 text-white font-bold text-xs rounded-md transition-all flex items-center justify-center gap-1.5 min-w-[90px] ${
                          copiedCode
                            ? "bg-emerald-500 hover:bg-emerald-600"
                            : "bg-sky-500 hover:bg-sky-600 shadow-sm"
                        }`}
                      >
                        {copiedCode ? "✅ Copiado" : "📋 Copiar"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Status */}
                <div className="p-3 bg-sky-500/10 rounded-xl border border-sky-500/20 flex items-center gap-3">
                  <div className="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-sky-500">
                      {paymentPhase === "renewing"
                        ? "Processando renovação..."
                        : "Aguardando pagamento..."}
                    </p>
                    <p className="text-xs text-sky-500/80">
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
                    className="w-full pb-1 pt-0 !mt-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancelar
                  </button>
                )}
              </div>
              {securityNote}
            </>
          )}

          {/* Stripe - Cartão Internacional */}
          {isStripe && !isApproved && !isRejected && (
            <>
              <div className="bg-gradient-to-r from-indigo-600 to-violet-600 py-3 px-6 text-white text-center">
                <h2 className="text-xl font-bold mb-1">
                  {paymentPhase === "renewing"
                    ? "Pagamento confirmado ✅"
                    : stripeStep === 1
                      ? "Dados do Cartão"
                      : "Confirmar Pagamento"}
                </h2>
                <p className="text-sm text-white/80">
                  {paymentPhase === "renewing"
                    ? "Renovação em andamento…"
                    : paymentData.gateway_name || "Stripe"}
                </p>
              </div>

              {summaryBlock}

              <div className="px-5 pt-5 pb-4 space-y-4">
                {paymentPhase !== "renewing" && (
                  <>
                    {/* Trust signals */}
                    {(paymentData.beneficiary_name ||
                      paymentData.institution) && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 text-lg">
                          🔒
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                            Pagamento para
                          </p>
                          {paymentData.beneficiary_name && (
                            <p className="text-sm font-bold text-foreground truncate">
                              {paymentData.beneficiary_name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {paymentData.institution || "Stripe"}
                          </p>
                        </div>
                        <span className="ml-auto shrink-0 px-2 py-0.5 bg-emerald-500/20 text-emerald-500 text-[10px] font-bold rounded-full">
                          ✅ Seguro
                        </span>
                      </div>
                    )}

                    {/* 2-step card fields */}
                    <div className="relative">
                      {/* Step 1: Número do cartão */}
                      <div
                        className={
                          stripeStep === 1
                            ? "space-y-3"
                            : "absolute top-0 left-0 w-full opacity-0 pointer-events-none space-y-3"
                        }
                      >
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                            Número do Cartão
                          </p>
                          <div
                            ref={setCardNumberMountEl}
                            className="w-full px-4 py-3 bg-muted/50 border-2 border-border rounded-xl focus-within:border-indigo-500 transition-colors min-h-[46px]"
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
                      <div
                        className={
                          stripeStep === 2
                            ? "space-y-3"
                            : "absolute top-0 left-0 w-full opacity-0 pointer-events-none space-y-3"
                        }
                      >
                        <button
                          onClick={() => setStripeStep(1)}
                          className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                        >
                          ← Voltar
                        </button>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                              Validade
                            </p>
                            <div
                              ref={setCardExpiryMountEl}
                              className="w-full px-4 py-3 bg-muted/50 border-2 border-border rounded-xl focus-within:border-indigo-500 transition-colors min-h-[46px]"
                            />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                              CVC
                            </p>
                            <div
                              ref={setCardCvcMountEl}
                              className="w-full px-4 py-3 bg-muted/50 border-2 border-border rounded-xl focus-within:border-indigo-500 transition-colors min-h-[46px]"
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
                              <svg
                                className="animate-spin h-5 w-5 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                              </svg>
                              Processando...
                            </>
                          ) : (
                            <>🔒 Confirmar Pagamento</>
                          )}
                        </button>
                      </div>
                    </div>

                    <p className="text-center text-[10px] text-muted-foreground">
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
                      className="w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancelar
                    </button>
                  </>
                )}

{/* Renovando */}
                {paymentPhase === "renewing" && (
                  <div className="p-4 bg-muted/50 rounded-xl border border-border flex items-center gap-3">
                    <div className="w-6 h-6 border-4 border-muted-foreground/30 border-t-transparent rounded-full animate-spin shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        Processando renovação...
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Atualizando sua assinatura no servidor.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Apple Pay / Google Pay */}
          {paymentData.payment_method === "apple_google" &&
            !isApproved &&
            !isRejected && (
              <>
                <div className="bg-gradient-to-r from-slate-800 to-slate-900 py-3 px-6 text-white text-center">
                  <h2 className="text-xl font-bold mb-1">
                    {paymentPhase === "renewing"
                      ? "Pagamento confirmado ✅"
                      : "Apple Pay / Google Pay"}
                  </h2>
                  <p className="text-sm text-white/80">
                    {paymentPhase === "renewing"
                      ? "Renovação em andamento…"
                      : paymentData.gateway_name || "Stripe"}
                  </p>
                </div>

                <div className="px-5 pt-5 pb-4 space-y-4">
                  {paymentPhase !== "renewing" && (
                    <>
                      <div className="text-center">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                          Total a pagar
                        </p>
                        <p className="text-3xl font-black text-foreground">
                          {formatMoney(
                            paymentData.price_amount ?? 0,
                            paymentData.currency ?? "EUR",
                          )}
                        </p>
                      </div>

                      {(paymentData.beneficiary_name ||
                        paymentData.institution) && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 text-lg">
                            🔒
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                              Pagamento para
                            </p>
                            {paymentData.beneficiary_name && (
                              <p className="text-sm font-bold text-foreground truncate">
                                {paymentData.beneficiary_name}
                              </p>
                            )}
                            <p className="text-xs text-foreground/70">
                              {paymentData.institution || "Stripe"}
                            </p>
                          </div>
                          <span className="ml-auto shrink-0 px-2 py-0.5 bg-emerald-500/20 text-emerald-500 text-[10px] font-bold rounded-full">
                            ✅ Seguro
                          </span>
                        </div>
                      )}

                      {/* div sempre renderizado para o ref funcionar */}
                      <div
                        ref={setPrButtonMountEl}
                        className={`min-h-[52px] ${paymentRequest ? "" : "hidden"}`}
                      />
                      {!paymentRequest && (
                        <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground text-sm">
                          <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
                          Verificando disponibilidade...
                        </div>
                      )}

                      <p className="text-center text-[10px] text-muted-foreground">
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
                        className="w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancelar
                      </button>
                    </>
                  )}

                  {paymentPhase === "renewing" && (
                    <div className="p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20 flex items-center gap-3">
                      <div className="w-6 h-6 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-indigo-500">
                          Processando renovação...
                        </p>
                        <p className="text-xs text-indigo-500/80">
                          Atualizando sua assinatura no servidor.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {securityNote}
              </>
            )}

          {/* Manual - Fallbacks (PIX ou Internacional) */}
          {isManual && !isApproved && !isRejected && (
            <>
              {/* HEADER DINÂMICO BASEADO NO TIPO */}
              <div
                className={`py-3 px-6 text-white text-center ${
                  effectiveGatewayType === "transfer_manual_eur" ||
                  effectiveGatewayType === "transfer_manual_usd"
                    ? "bg-gradient-to-r from-blue-600 to-indigo-700"
                    : "bg-gradient-to-r from-violet-500 to-purple-600"
                }`}
              >
                <h2 className="text-xl font-bold mb-1">
                  {effectiveGatewayType === "transfer_manual_eur"
                    ? "Transferência em Euros"
                    : effectiveGatewayType === "transfer_manual_usd"
                      ? "Transferência em Dólares"
                      : "PIX Manual"}
                </h2>
                <p className="text-sm text-white/80">Pagamento Offline</p>
              </div>

              <div className="px-5 pt-4 pb-3 space-y-3">
                {/* 1. DADOS PARA PIX MANUAL */}
                {effectiveGatewayType === "pix_manual" && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                        Chave PIX
                      </p>
                      <div className="relative group">
                        <input
                          type="text"
                          value={paymentData.pix_key || ""}
                          readOnly
                          className="w-full pr-28 pl-3 py-2.5 bg-card border-2 border-border rounded-lg text-sm font-mono text-foreground outline-none focus:border-violet-500 transition-colors shadow-sm"
                        />
                        <button
                          onClick={() => {
                            if (paymentData.pix_key)
                              navigator.clipboard.writeText(
                                paymentData.pix_key,
                              );
                            setCopiedKey(true);
                            setTimeout(() => setCopiedKey(false), 3000);
                          }}
                          className={`absolute right-1 top-1 bottom-1 px-4 text-white font-bold text-xs rounded-md transition-all flex items-center justify-center gap-1.5 min-w-[90px] ${
                            copiedKey
                              ? "bg-emerald-500 hover:bg-emerald-600"
                              : "bg-violet-500 hover:bg-violet-600 shadow-sm"
                          }`}
                        >
                          {copiedKey ? "✅ Copiado" : "📋 Copiar"}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Tipo: {paymentData.pix_key_type?.toUpperCase() || "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                        Titular (Favorecido)
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground/90">
                          {paymentData.beneficiary_name ||
                            paymentData.holder_name}
                        </p>
                        <button
                          onClick={() =>
                            copyField(
                              "pix_name",
                              paymentData.beneficiary_name ||
                                paymentData.holder_name,
                            )
                          }
                          className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "pix_name" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                        >
                          {copiedField === "pix_name"
                            ? "✅ Copiado"
                            : "📋 Copiar"}
                        </button>
                      </div>
                    </div>

                    {paymentData.institution && (
                      <div>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                          Instituição Bancária
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground/90">
                            {paymentData.institution}
                          </p>
                          <button
                            onClick={() =>
                              copyField("pix_inst", paymentData.institution)
                            }
                            className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "pix_inst" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                          >
                            {copiedField === "pix_inst"
                              ? "✅ Copiado"
                              : "📋 Copiar"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. DADOS PARA TRANSFERÊNCIA EUR */}
                {effectiveGatewayType === "transfer_manual_eur" && (
                  <div className="space-y-4 bg-muted/50 p-4 rounded-xl border border-border">
                    
                    {/* --- DADOS COMPARTILHADOS (Topo) --- */}
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                        Nome do Favorecido
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {paymentData.beneficiary_name}
                        </p>
                        <button
                          onClick={() => copyField("eur_name", paymentData.beneficiary_name)}
                          className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_name" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                        >
                          {copiedField === "eur_name" ? "✅ Copiado" : "📋 Copiar"}
                        </button>
                      </div>
                    </div>

                    {paymentData.bank_name && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                          Nome do Banco
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {paymentData.bank_name}
                          </p>
                          <button
                            onClick={() => copyField("eur_bank", paymentData.bank_name)}
                            className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_bank" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                          >
                            {copiedField === "eur_bank" ? "✅ Copiado" : "📋 Copiar"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* --- BLOCO: DADOS LOCAIS (SEPA) --- */}
                    {(paymentData.iban_local || paymentData.bic_local) && (
                      <div className="pt-2">
                        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-3 space-y-3">
                          <p className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider flex items-center gap-2 border-b border-sky-500/20 pb-2 mb-2">
                            <span>🇪🇺</span> Local (SEPA)
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                                IBAN
                              </p>
                              <div className="flex flex-col gap-1.5">
                                <p className="text-xs font-mono font-medium text-foreground break-all">
                                  {paymentData.iban_local || "—"}
                                </p>
                                {paymentData.iban_local && (
                                  <button
                                    onClick={() => copyField("eur_iban_local", paymentData.iban_local)}
                                    className={`self-start px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_iban_local" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                                  >
                                    {copiedField === "eur_iban_local" ? "✅ Copiado" : "📋 Copiar"}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="min-w-0 border-l border-sky-500/20 pl-3">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                                BIC
                              </p>
                              <div className="flex flex-col gap-1.5">
                                <p className="text-xs font-mono font-medium text-foreground break-all">
                                  {paymentData.bic_local || "—"}
                                </p>
                                {paymentData.bic_local && (
                                  <button
                                    onClick={() => copyField("eur_bic_local", paymentData.bic_local)}
                                    className={`self-start px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_bic_local" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                                  >
                                    {copiedField === "eur_bic_local" ? "✅ Copiado" : "📋 Copiar"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* --- BLOCO: DADOS INTERNACIONAIS (SWIFT) --- */}
                    {(paymentData.account_number_intl || paymentData.bic_intl) && (
                      <div className="pt-1">
                        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3 space-y-3">
                          <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-2 border-b border-indigo-500/20 pb-2 mb-2">
                            <span>🌍</span> Internacional (SWIFT)
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                                Número da Conta
                              </p>
                              <div className="flex flex-col gap-1.5">
                                <p className="text-xs font-mono font-medium text-foreground break-all">
                                  {paymentData.account_number_intl || "—"}
                                </p>
                                {paymentData.account_number_intl && (
                                  <button
                                    onClick={() => copyField("eur_acc_intl", paymentData.account_number_intl)}
                                    className={`self-start px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_acc_intl" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                                  >
                                    {copiedField === "eur_acc_intl" ? "✅ Copiado" : "📋 Copiar"}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="min-w-0 border-l border-indigo-500/20 pl-3">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                                BIC (SWIFT)
                              </p>
                              <div className="flex flex-col gap-1.5">
                                <p className="text-xs font-mono font-medium text-foreground break-all">
                                  {paymentData.bic_intl || "—"}
                                </p>
                                {paymentData.bic_intl && (
                                  <button
                                    onClick={() => copyField("eur_bic_intl", paymentData.bic_intl)}
                                    className={`self-start px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "eur_bic_intl" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                                  >
                                    {copiedField === "eur_bic_intl" ? "✅ Copiado" : "📋 Copiar"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    
                  </div>
                )}

                {/* 3. DADOS PARA TRANSFERÊNCIA USD */}
                {effectiveGatewayType === "transfer_manual_usd" && (
                  <div className="space-y-3 bg-muted/50 p-4 rounded-xl border border-border">
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                        Nome do Favorecido
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {paymentData.beneficiary_name}
                        </p>
                        <button
                          onClick={() =>
                            copyField("usd_name", paymentData.beneficiary_name)
                          }
                          className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_name" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                        >
                          {copiedField === "usd_name"
                            ? "✅ Copiado"
                            : "📋 Copiar"}
                        </button>
                      </div>
                    </div>
                    {paymentData.bank_name && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                          Nome do Banco
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {paymentData.bank_name}
                          </p>
                          <button
                            onClick={() =>
                              copyField("usd_bank", paymentData.bank_name)
                            }
                            className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_bank" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                          >
                            {copiedField === "usd_bank"
                              ? "✅ Copiado"
                              : "📋 Copiar"}
                          </button>
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                        Número da conta
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-mono font-medium text-foreground">
                          {paymentData.account_number}
                        </p>
                        <button
                          onClick={() =>
                            copyField("usd_acc", paymentData.account_number)
                          }
                          className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_acc" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                        >
                          {copiedField === "usd_acc"
                            ? "✅ Copiado"
                            : "📋 Copiar"}
                        </button>
                      </div>
                    </div>
                    {paymentData.account_type && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                          Tipo da conta
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {paymentData.account_type}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                        Routing number
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-mono font-medium text-foreground">
                          {paymentData.routing_number}
                        </p>
                        <button
                          onClick={() =>
                            copyField("usd_routing", paymentData.routing_number)
                          }
                          className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_routing" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                        >
                          {copiedField === "usd_routing"
                            ? "✅ Copiado"
                            : "📋 Copiar"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">
                        Swift/BIC
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-mono font-medium text-foreground">
                          {paymentData.swift_bic}
                        </p>
                        <button
                          onClick={() =>
                            copyField("usd_swift", paymentData.swift_bic)
                          }
                          className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${copiedField === "usd_swift" ? "bg-emerald-500 text-white" : "bg-muted text-foreground hover:bg-muted/70"}`}
                        >
                          {copiedField === "usd_swift"
                            ? "✅ Copiado"
                            : "📋 Copiar"}
                        </button>
                      </div>
                    </div>
                    
                  </div>
                )}

{/* AVISO IMPORTANTE (Piscando) */}
                <div className="pt-2 animate-pulse">
                  <p className="text-xs font-bold text-rose-500 uppercase text-center bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                    ⚠️ Importante: Favor não colocar observações na
                    transferência.
                  </p>
                </div>

                {/* VALOR A TRANSFERIR (GLOBAL PARA TODOS OS MANUAIS) */}
                <div className="pt-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Valor a Transferir
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {formatMoney(
                      paymentData.price_amount,
                      paymentData.currency,
                    )}
                  </p>
                </div>

                {/* Instruções */}
                {paymentData.instructions && (
                  <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-xl">
                    <p className="text-xs text-sky-500">
                      {paymentData.instructions}
                    </p>
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
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
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
                  className="w-full pb-1 pt-0 !mt-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
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

  const showTenantLogo = !!tenantBrand?.logo_url;

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 py-8">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  // ========= RENDER: ERROR =========
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-2xl p-8 text-center border border-rose-500/20">
          <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-rose-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-rose-500 mb-2">
            Sessão Expirada
          </h1>
          <p className="text-foreground/70 mb-6">{error}</p>
          <button
            onClick={() => {
              clearStoredSession();
              router.push("/");
            }}
            className="px-6 py-3 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors"
          >
            Fazer Login Novamente
          </button>
        </div>
      </div>
    );
  }

  // ========= RENDER: ACCOUNT SELECTOR =========
  if (!selectedAccountId && accounts.length > 0) {
    return (
      <div className="min-h-screen bg-background">
        {/* --- TOPO FIXO IDÊNTICO AO SEU ADMIN --- */}
        <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-2">
            {/* Logo Responsiva */}
            <div className="flex items-center gap-3 min-w-0 cursor-pointer group">
              {showTenantLogo ? (
                <img
                  src={tenantBrand!.logo_url!}
                  alt="Logo"
                  className="h-10 w-auto max-w-[140px] object-contain select-none"
                />
              ) : (
                <>
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
                </>
              )}
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
                    <span className="text-[9px] uppercase tracking-wider text-white/50 leading-none">
                      Suporte
                    </span>
                    <span className="text-xs font-bold tracking-wide leading-none mt-0.5">
                      {supportPhone}
                    </span>
                  </div>
                </a>
              )}

              <button
                onClick={() => {
                  clearStoredSession();
                  router.push("/");
                }}
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
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              {getGreeting()}! 👋
            </h1>
            <p className="text-foreground/70 text-sm mt-1">
              Qual conta você deseja gerenciar hoje?
            </p>
          </div>

          {/* Busca (Opcional) */}
          {accounts.length > 3 && (
            <div className="mb-4 sm:mb-6 relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">
                🔍
              </span>
              <input
                type="text"
                placeholder="Buscar conta..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-12 pl-12 pr-4 bg-card border border-border rounded-xl text-sm text-foreground outline-none focus:border-sky-500 transition-colors shadow-sm"
              />
            </div>
          )}

          {/* --- CARDS DE CONTAS (Layout 3 Linhas) --- */}
<div className="space-y-4">
            {filteredAccounts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/40 rounded-xl border border-dashed border-border">
                Nenhuma conta encontrada.
              </div>
            ) : (
              filteredAccounts.map((account) => {
                const time = getTimeRemaining(account.vencimento);
                return (
                  <button
                    key={account.id}
                    onClick={() => handleSelectAccount(account.id)}
                    className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-sky-500 transition-all shadow-sm hover:shadow-md group relative overflow-hidden"
                  >
                    {/* Linha 1: Nome (Esq) | Username (Dir, preservando maiúsculas/minúsculas) */}
<div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-bold text-foreground truncate pr-2 flex items-center gap-2">
                        {account.display_name}
                        {account.is_trial && (
                          <span className="px-1.5 py-0.5 bg-sky-500/10 text-sky-500 border border-sky-500/20 text-[9px] font-bold rounded uppercase tracking-wider">
                            TESTE
                          </span>
                        )}
                      </h3>
<span className="text-xs font-mono font-medium text-muted-foreground shrink-0 bg-muted px-2 py-1 rounded border border-border">
                        {account.server_username}
                      </span>
                    </div>

                    {/* Linha 2: Servidor + Telas (Esq) | Plano (Dir) */}
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm font-medium text-foreground/70 truncate">
                        {account.server_name} • {account.screens} tela
                        {account.screens > 1 ? "s" : ""}
                      </p>
                      <div className="inline-block px-2 py-0.5 bg-sky-500/10 text-sky-500 rounded text-[10px] font-bold uppercase tracking-wider border border-sky-500/20 shrink-0">
                        {account.plan_label}
                      </div>
                    </div>

                    {/* Linha 3: Vencimento (Centralizado) */}
                    <div
                      className={`w-full text-center py-2 rounded-lg border ${
                        time?.expired
                          ? "bg-rose-500/10 border-rose-500/20 text-rose-500"
                          : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                      }`}
                    >
                      <span className="text-sm font-bold block tracking-tight">
                        {time?.text}
                      </span>
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
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-2xl p-8 text-center">
          <p className="text-foreground/70">
            Nenhuma conta encontrada
          </p>
        </div>
      </div>
    );
  }

  // ========= RENDER: MAIN PAGE =========
  if (!selectedAccount) return null;

  // ========= TOPO FIXO REUTILIZÁVEL (menu / apps) =========
  function renderTopBar(onBack: (() => void) | null) {
    return (
      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {onBack && (
              <button
                onClick={onBack}
                className="w-8 h-8 flex items-center justify-center bg-card/10 hover:bg-card/20 rounded-lg text-white transition-colors shrink-0"
                title="Voltar"
              >
                <span className="text-lg leading-none mt-[-2px]">←</span>
              </button>
            )}

            {showTenantLogo ? (
              <img
                src={tenantBrand!.logo_url!}
                alt="Logo"
                className="h-10 w-auto max-w-[120px] object-contain select-none"
              />
            ) : (
              <Image
                src="/brand/logo-gestor-celular.png"
                alt="Gestor"
                width={44}
                height={44}
                className="h-10 w-10 select-none object-contain transition-transform group-hover:scale-105"
                draggable={false}
                priority
              />
            )}

            <div className="min-w-0 flex flex-col justify-center">
              <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold leading-none mb-0.5">
                Logado como
              </div>
              <div className="text-xs font-bold text-white truncate max-w-[140px] sm:max-w-66 tracking-tight uppercase">
                {selectedAccount!.display_name}
              </div>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
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
                  <span className="text-[9px] uppercase tracking-wider text-white/50 leading-none">
                    Suporte
                  </span>
                  <span className="text-xs font-bold tracking-wide leading-none mt-0.5">
                    {supportPhone}
                  </span>
                </div>
              </a>
            )}

            <button
              onClick={() => {
                clearStoredSession();
                router.push("/");
              }}
              className="text-white/50 hover:text-rose-500 transition-colors"
              title="Sair"
            >
              <IconLogout />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========= RENDER: MENU (3 BLOCOS) =========
  if (activeSection === "menu") {
    const srvKey = SERVER_GUIA_MAP[selectedAccount.server_name];

    return (
      <div className="min-h-screen bg-background">
        {renderTopBar(accounts.length > 1 ? () => setSelectedAccountId(null) : null)}

        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
          <div className="mb-2">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              {getGreeting()}! 👋
            </h1>
            <p className="text-foreground/70 text-sm mt-1">
              O que você deseja fazer?
            </p>
          </div>

          {/* Bloco 1 — Pagamentos e Renovação */}
          <button
            onClick={() => setActiveSection("payment")}
            className="w-full text-left rounded-2xl p-5 border-2 border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent hover:border-emerald-500/60 transition-all shadow-sm hover:shadow-md group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0 border border-emerald-500/20 text-2xl">
                💳
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-foreground">
                  Pagamentos e Renovação
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  Confira seu plano, renove sua assinatura ou quite pendências
                </p>
              </div>
              <span className="text-emerald-500 text-xl group-hover:translate-x-0.5 transition-transform shrink-0">
                →
              </span>
            </div>
          </button>

          {/* Bloco 2 — Novidades / Conteúdo */}
          {srvKey && (
            <a
              href={`/renew/guia-tv?servidor=${srvKey}&conta=${selectedAccount.id}`}
              className="block rounded-2xl p-5 border-2 border-sky-500/30 bg-gradient-to-r from-sky-500/10 via-indigo-500/5 to-transparent hover:border-sky-500/60 transition-all shadow-sm hover:shadow-md group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0 border border-sky-500/20 text-2xl">
                  🔥
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-foreground">
                    Novidades e Conteúdo
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    Grade de canais e jogos do dia, confira lançamentos de filmes e séries
                  </p>
                </div>
                <span className="text-sky-500 text-xl group-hover:translate-x-0.5 transition-transform shrink-0">
                  →
                </span>
              </div>
            </a>
          )}

          {/* Bloco 3 — Configuração de aplicativo */}
          <button
            onClick={() => setActiveSection("apps")}
            className="w-full text-left rounded-2xl p-5 border-2 border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent hover:border-amber-500/60 transition-all shadow-sm hover:shadow-md group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 border border-amber-500/20 text-2xl">
                📱
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-foreground">
                  Configuração de Aplicativo
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  Reconfigure, atualize seus dados ou instale novos aplicativos
                </p>
              </div>
              <span className="text-amber-500 text-xl group-hover:translate-x-0.5 transition-transform shrink-0">
                →
              </span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ========= RENDER: APPS (BLOCO 3) =========
  if (activeSection === "apps") {
    const SUB_TABS: { id: typeof appsSubTab; label: string }[] = [
      { id: "meus-apps", label: "Meus aplicativos" },
      { id: "duvidas", label: "Dúvidas" },
    ];

    return (
      <div className="min-h-screen bg-background">
        <ToastNotifications toasts={toasts} removeToast={removeToast} />
        {renderTopBar(() => setActiveSection("menu"))}

        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
          <div className="mb-2">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              Configuração de Aplicativo
            </h1>
          </div>

          {/* Sub-abas */}
          <div className="flex gap-1.5 p-1 bg-muted rounded-xl">
            {SUB_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAppsSubTab(tab.id)}
                className={`flex-1 text-xs sm:text-sm font-bold py-2 rounded-lg transition-colors ${
                  appsSubTab === tab.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ===== SUB-ABA 1: MEUS APLICATIVOS ===== */}
          {appsSubTab === "meus-apps" && (
            <div className="space-y-4">
              {installedAppsLoading && (
                <div className="text-center py-8 text-muted-foreground">Carregando...</div>
              )}
              {!installedAppsLoading && installedAppsError && (
                <div className="text-center py-8 text-rose-500 bg-rose-500/10 rounded-xl border border-dashed border-rose-500/30">
                  {installedAppsError}
                </div>
              )}
              {!installedAppsLoading && !installedAppsError && installedApps.length === 0 && (
                <div className="text-center py-8 text-muted-foreground bg-muted/40 rounded-xl border border-dashed border-border">
                  Nenhum aplicativo instalado nessa conta.
                </div>
              )}

              {!installedAppsLoading &&
                !installedAppsError &&
                installedApps.map((app) => {
                  const isEditing = editingAppId === app.id;
                  const busy = appActionBusy === app.id;
                  return (
                    <div key={app.id} className="bg-card rounded-xl p-4 border border-border shadow-sm space-y-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => router.push(`/renew-beta/apps/${app.id}?conta=${selectedAccountId}`)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          title="Ver detalhes do aplicativo"
                        >
                          {app.icon_url ? (
                            <img src={app.icon_url} alt={app.name} className="w-10 h-10 rounded-lg object-cover border border-border shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-lg shrink-0">📱</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground truncate hover:underline">{app.name}</p>
                            {app.expiration && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Vencimento do aplicativo: {String(app.expiration).split("T")[0].split("-").reverse().join("/")}
                              </p>
                            )}
                          </div>
                        </button>
                        {app.has_pending_removal_request ? (
                          <span className="shrink-0 px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border text-[10px] font-bold">
                            Exclusão solicitada
                          </span>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => handleRemoveApp(app.id, app.name)}
                            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] font-bold uppercase hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                          >
                            {busy ? "..." : "Excluir Aplicativo"}
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          {app.fields.map((f) => (
                            <div key={f.id}>
                              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{f.label}</label>
                              <input
                                type="text"
                                value={editingValues[f.id] ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const next = f.type === "mac" ? normalizeMacInput(raw) : raw;
                                  setEditingValues((prev) => ({ ...prev, [f.id]: next }));
                                }}
                                placeholder={f.type === "obs" ? "Ex: Sala, Quarto, Escritório..." : undefined}
                                autoCapitalize={f.type === "mac" ? "characters" : "none"}
                                spellCheck={false}
                                className="w-full h-9 px-3 bg-muted border border-border rounded-lg text-sm text-foreground outline-none focus:border-sky-500"
                              />
                            </div>
                          ))}
                          <div className="flex gap-2 pt-1">
                            <button
                              disabled={busy}
                              onClick={() => handleSaveAppFields(app.id)}
                              className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {busy ? "Salvando..." : "Salvar"}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => setEditingAppId(null)}
                              className="flex-1 h-9 rounded-lg bg-muted text-foreground border border-border text-xs font-bold"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {app.fields.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {app.fields.map((f) => (
                                <span key={f.id} className="px-2 py-0.5 bg-muted text-muted-foreground border border-border text-[10px] font-mono rounded">
                                  {f.label}: {f.value || "—"}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => startEditingApp(app)}
                              className="px-3 py-1.5 rounded-lg bg-muted text-foreground border border-border text-xs font-bold hover:bg-muted/70 transition-colors"
                            >
                              Editar
                            </button>
                            {app.has_integration && (
                              <button
                                disabled={busy}
                                onClick={() => handleConfigureApp(app.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-500 border border-sky-500/20 text-xs font-bold hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                              >
                                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {busy ? "Configurando..." : "Configurar aplicativo"}
                              </button>
                            )}
                            {/* ✅ Apps sem integração automática (ex: IboSol hoje, ou
                                qualquer app sempre manual) — cliente pede pro suporte
                                configurar em vez de tentar sozinho. */}
                            {!app.has_integration && (
                              app.has_pending_setup_request ? (
                                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground border border-border text-xs font-bold">
                                  ✓ Configuração solicitada
                                </span>
                              ) : (
                                <button
                                  disabled={busy}
                                  onClick={() => handleRequestSetup(app.id)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-bold hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                                >
                                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  {busy ? "Solicitando..." : "Solicitar configuração"}
                                </button>
                              )
                            )}
                            {app.can_check_validity && (
                              <button
                                disabled={busy}
                                onClick={() => handleCheckValidity(app.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-xs font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                              >
                                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {busy ? "Verificando..." : "Verificar validade"}
                              </button>
                            )}
                          </div>
                          {/* ✅ Renovar licença — embaixo, alinhado à direita
                              (Excluir Aplicativo fica em cima, no cabeçalho) */}
                          {app.license_price != null && (
                            <div className="flex justify-end">
                              <button
                                disabled={renewPaymentBusyId === app.id}
                                onClick={() => handleRenewPayment(app.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50"
                              >
                                {renewPaymentBusyId === app.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {renewPaymentBusyId === app.id
                                  ? "Gerando pagamento..."
                                  : `Renovar aplicativo — ${formatMoney(app.license_price, "BRL")}${app.license_period === "annual" ? "/ano" : ""}`}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

              {/* + Adicionar aplicativo — abre o modal por tipo de equipamento */}
              <button
                onClick={() => {
                  setShowAddAppPicker(true);
                  loadAppCatalog();
                }}
                className="w-full py-3 rounded-xl border-2 border-dashed border-border text-sm font-bold text-muted-foreground hover:border-sky-500 hover:text-sky-500 transition-colors"
              >
                + Adicionar aplicativo
              </button>

              <AddAppModal
                open={showAddAppPicker}
                onClose={() => setShowAddAppPicker(false)}
                catalog={appCatalog}
                catalogLoading={appCatalogLoading}
                busyAppId={appActionBusy?.startsWith("add-") ? appActionBusy.slice(4) : null}
                onSelectApp={(appId) => handleAddApp(appId)}
              />

              {/* Modal de pagamento avulso da licença — nunca mexe na assinatura */}
              {renewPayment && (
                <div
                  className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget && renewPaymentDone) closeRenewPaymentModal();
                  }}
                >
                  <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
                    {renewPaymentDone ? (
                      <>
                        <div className="flex flex-col items-center gap-2 text-center py-4">
                          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center text-3xl">✅</div>
                          <p className="text-base font-bold text-foreground">Pagamento confirmado!</p>
                          <p className="text-xs text-muted-foreground">
                            {installedApps.find((a) => a.id === renewPayment.clientAppId)?.has_integration
                              ? 'O pagamento da licença foi registrado. Agora clique em "Configurar aplicativo" pra ativar de verdade.'
                              : "O pagamento da licença foi registrado. Nosso suporte vai finalizar a ativação em breve."}
                          </p>
                        </div>
                        <button
                          onClick={closeRenewPaymentModal}
                          className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
                        >
                          Fechar
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-foreground">
                            Renovar licença — {installedApps.find((a) => a.id === renewPayment.clientAppId)?.name}
                          </p>
                          <button onClick={closeRenewPaymentModal} className="text-muted-foreground hover:text-foreground text-xs">
                            ✕
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground text-center">
                          {formatMoney(renewPayment.price_amount, "BRL")} — escaneie o QR Code ou copie o código PIX
                        </p>
                        {renewPayment.pix_qr_code_base64 && (
                          <img
                            src={`data:image/png;base64,${renewPayment.pix_qr_code_base64}`}
                            alt="QR Code PIX"
                            className="w-48 h-48 mx-auto rounded-lg border border-border"
                          />
                        )}
                        {renewPayment.pix_qr_code && (
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(renewPayment.pix_qr_code || "");
                              addToast("success", "Copiado!", "Código PIX copiado.");
                            }}
                            className="w-full h-10 rounded-lg bg-muted border border-border text-xs font-bold text-foreground hover:bg-muted/70 transition-colors"
                          >
                            Copiar código PIX
                          </button>
                        )}
                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando pagamento...
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== SUB-ABA 2: DÚVIDAS E SUGESTÕES ===== */}
          {appsSubTab === "duvidas" && (
            <div className="space-y-4">
              {faqLoading && <p className="text-center text-muted-foreground py-8">Carregando...</p>}

              {!faqLoading && (faqData?.faq || []).length === 0 && (
                <div className="text-center py-8 text-muted-foreground bg-muted/40 rounded-xl border border-dashed border-border">
                  Nenhuma pergunta frequente cadastrada ainda.
                </div>
              )}

              {!faqLoading &&
                Object.entries(
                  (faqData?.faq || []).reduce<Record<string, typeof faqData.faq>>((acc, item) => {
                    (acc[item.category] ||= []).push(item);
                    return acc;
                  }, {}),
                ).map(([category, items]) => (
                  <div key={category} className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{category}</p>
                    {items!.map((item, i) => (
                      <details key={i} className="bg-card rounded-xl p-4 border border-border shadow-sm group">
                        <summary className="text-sm font-bold text-foreground cursor-pointer list-none">{item.title}</summary>
                        <p className="text-xs text-muted-foreground whitespace-pre-line mt-2">{item.content}</p>
                      </details>
                    ))}
                  </div>
                ))}

              {supportPhone && (
                <a
                  href={`https://wa.me/${supportPhone.replace(/\D/g, "")}?text=Olá,%20tenho%20uma%20dúvida%20sobre%20configuração%20de%20aplicativo!`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20 text-sm font-bold hover:bg-[#25D366]/20 transition-colors"
                >
                  <IconWhatsapp /> Falar com o suporte
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* --- TOPO FIXO IDÊNTICO AO SEU ADMIN --- */}
      <div className="sticky top-0 z-50 bg-[#050505] text-white border-b border-white/10 shadow-lg">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Botão de Voltar para o Menu */}
            <button
              onClick={() => setActiveSection("menu")}
              className="w-8 h-8 flex items-center justify-center bg-card/10 hover:bg-card/20 rounded-lg text-white transition-colors shrink-0"
              title="Voltar"
            >
              <span className="text-lg leading-none mt-[-2px]">←</span>
            </button>

            {showTenantLogo ? (
              <img
                src={tenantBrand!.logo_url!}
                alt="Logo"
                className="h-10 w-auto max-w-[140px] object-contain select-none"
              />
            ) : (
              <>
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
              </>
            )}
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
                  <span className="text-[9px] uppercase tracking-wider text-white/50 leading-none">
                    Suporte
                  </span>
                  <span className="text-xs font-bold tracking-wide leading-none mt-0.5">
                    {supportPhone}
                  </span>
                </div>
              </a>
            )}

            <button
              onClick={() => {
                clearStoredSession();
                router.push("/");
              }}
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
        {/* ✅ Banner de novidades removido daqui — virou o Bloco 2 do menu */}

{/* Vencimento Centralizado (Substitui Card Azul) */}
<div
  className={`w-full text-center py-2.5 sm:py-4 rounded-xl shadow-sm border-2 animate-in fade-in zoom-in duration-500 ${
            timeRemaining?.expired
              ? "bg-rose-500/10 border-rose-500/20"
              : selectedAccount.is_trial
                ? "bg-sky-500/10 border-sky-500/20"
                : "bg-emerald-500/10 border-emerald-500/20"
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
            Status da Assinatura
          </p>
          <div className="flex items-center justify-center gap-2">
            <span
              className={`w-3 h-3 rounded-full animate-pulse ${
                timeRemaining?.expired
                  ? "bg-rose-500"
                  : selectedAccount.is_trial
                    ? "bg-sky-500"
                    : "bg-emerald-500"
              }`}
            />
            <span
              className={`text-lg sm:text-xl font-black tracking-tight ${
                timeRemaining?.expired
                  ? "text-rose-500"
                  : selectedAccount.is_trial
                    ? "text-sky-500"
                    : "text-emerald-500"
              }`}
            >
              {selectedAccount.is_trial && "Teste • "}
              {timeRemaining?.text}
            </span>
          </div>
        </div>

        {/* Card de Dados de Acesso */}
        <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="bg-muted/50 px-3 sm:px-4 py-2 sm:py-3 border-b border-border">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              📺 Dados de Acesso
            </h2>
          </div>
          <div className="p-2.5 sm:p-4 space-y-2 sm:space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  Usuário
                </label>
                <div className="text-sm font-mono text-foreground bg-muted px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-border truncate">
                  {selectedAccount.server_username}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  Servidor
                </label>
                <div className="text-sm font-medium text-foreground bg-muted px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-border truncate">
                  {selectedAccount.server_name}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  Vencimento em
                </label>
                <div className="text-sm font-medium text-foreground bg-muted px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-border">
                  {formatDateTime(selectedAccount.vencimento)}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">
                  Telas
                </label>
                <div className="text-sm font-bold text-foreground bg-muted px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-border">
                  {selectedAccount.screens}{" "}
                  {selectedAccount.screens > 1 ? "telas" : "tela"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Seção de Planos */}
        <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="bg-muted/50 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              💰 Escolha o Plano
            </h2>
          </div>

          <div className="p-3 sm:p-4 space-y-3">
            {/* Plano Atual */}
            {(() => {
              const currentPrice = availablePrices.find(
                (p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label,
              );
              if (!currentPrice) return null;
              const isSelected = selectedPeriod === currentPrice.period;
              return (
                <button
                  onClick={() =>
                    currentPrice && setSelectedPeriod(currentPrice.period)
                  }
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    isSelected
                      ? "border-sky-500 bg-sky-500/10"
                      : "border-border hover:border-sky-500/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? "border-sky-500 bg-sky-500" : "border-border"}`}
                        >
                          {isSelected && (
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
<span className="font-bold text-foreground">
                          {selectedAccount.plan_label}{" "}
                          <span className="text-xs font-normal text-sky-500 uppercase tracking-wider ml-1">
                            (Atual)
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right ml-2">
                      <div
                        className={`text-lg font-bold ${isSelected ? "text-sky-500" : "text-muted-foreground"}`}
                      >
                        {currentPrice.price_amount > 0
                          ? formatMoney(
                              currentPrice.price_amount,
                              selectedAccount.price_currency,
                            )
                          : "—"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })()}

            {/* ✅ PLANO ESCOLHIDO (Se não for o Atual e a sanfona estiver FECHADA) */}
            {(() => {
              const currentPrice = availablePrices.find(
                (p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label,
              );
              const isSelectedNotCurrent =
                selectedPeriod !== currentPrice?.period;

              if (!showOtherPlans && isSelectedNotCurrent && selectedPrice) {
                return (
                  <button
                    onClick={() => setShowOtherPlans(true)}
                    className="w-full text-left p-4 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 transition-all animate-in slide-in-from-top-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="w-5 h-5 rounded-full border-2 border-emerald-500 bg-emerald-500 flex items-center justify-center shrink-0">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                          <span className="font-bold text-foreground">
                            {PERIOD_LABELS[selectedPrice.period]}{" "}
                            <span className="text-xs font-normal text-emerald-500 tracking-wider ml-1">
                              (Selecionado)
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="text-right ml-2">
                        <div className="text-lg font-bold text-emerald-500">
                          {selectedPrice.price_amount > 0
                            ? formatMoney(
                                selectedPrice.price_amount,
                                selectedAccount.price_currency,
                              )
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              }
              return null;
            })()}

            {/* Botão para Mostrar/Esconder as Ofertas */}
            {availablePrices.filter(
              (p) => PERIOD_LABELS[p.period] !== selectedAccount.plan_label,
            ).length > 0 && (
              <button
                onClick={() => setShowOtherPlans(!showOtherPlans)}
                className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-border text-muted-foreground font-bold flex items-center justify-center gap-2 hover:bg-muted/50 transition-all"
              >
                🏷️ {showOtherPlans ? "Ocultar Ofertas" : "Planos disponíveis"}
                <svg
                  className={`w-4 h-4 transition-transform ${showOtherPlans ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            )}

            {/* Expansível de Ofertas */}
            {showOtherPlans && (
<div className="space-y-2 animate-in slide-in-from-top-2 duration-200 mt-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">
                  Todas as Opções
                </p>
                {availablePrices
                  .filter(
                    (p) =>
                      PERIOD_LABELS[p.period] !== selectedAccount.plan_label,
                  )
                  .map((price) => {
                    const months = PERIOD_MONTHS[price.period];
                    const currentMonthlyEquiv = (() => {
                      const currentPrice = availablePrices.find(
                        (p) =>
                          PERIOD_LABELS[p.period] ===
                          selectedAccount.plan_label,
                      );
                      if (!currentPrice) {
                        const baseMonthly = availablePrices.find(
                          (p) => p.period === "MONTHLY",
                        );
                        return baseMonthly ? baseMonthly.price_amount : 0;
                      }
                      const currentMonths =
                        PERIOD_MONTHS[
                          Object.keys(PERIOD_LABELS).find(
                            (k) =>
                              PERIOD_LABELS[k] === selectedAccount.plan_label,
                          ) || "MONTHLY"
                        ] || 1;
                      return currentPrice.price_amount / currentMonths;
                    })();

                    const thisMonthlyEquiv = price.price_amount / months;
                    const diffPercent =
                      currentMonthlyEquiv > 0
                        ? Math.round(
                            ((thisMonthlyEquiv - currentMonthlyEquiv) /
                              currentMonthlyEquiv) *
                              100 *
                              10,
                          ) / 10
                        : 0;

                    const isSelected = selectedPeriod === price.period;
                    const isCheaper = diffPercent < 0;

                    return (
                      <button
                        key={price.period}
                        onClick={() => setSelectedPeriod(price.period)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-border hover:border-emerald-500/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? "border-emerald-500 bg-emerald-500" : "border-border"}`}
                              >
                                {isSelected && (
                                  <svg
                                    className="w-3 h-3 text-white"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                              </div>
                              <span className="font-bold text-foreground">
                                {PERIOD_LABELS[price.period]}
                              </span>
                              {diffPercent !== 0 && price.price_amount > 0 && (
                                <span
                                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider ${isCheaper ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/20" : "bg-amber-500/20 text-amber-500 border border-amber-500/20"}`}
                                >
                                  {isCheaper
                                    ? `${Math.abs(diffPercent)}% off`
                                    : `+${diffPercent}%`}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 ml-7">
                              {price.price_amount > 0
                                ? `${formatMoney(price.price_amount / months, selectedAccount.price_currency)}/mês`
                                : "—"}
                            </p>
                          </div>
                          <div className="text-right ml-2">
                            <div className="text-lg font-bold text-foreground">
                              {price.price_amount > 0
                                ? formatMoney(
                                    price.price_amount,
                                    selectedAccount.price_currency,
                                  )
                                : "—"}
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

        {/* Cupom de desconto — só pra contas em BRL */}
        {selectedAccount.price_currency === "BRL" && (
          <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
            <div className="bg-muted/50 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                🎟️ Cupom de desconto
              </h2>
            </div>
            <div className="p-3 sm:p-4">
              {appliedCoupon ? (
                <div className="flex items-center justify-between gap-2 h-10 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3">
                  <span className="text-sm font-medium text-emerald-600 truncate">
                    🎉 {appliedCoupon.code} aplicado:{" "}
                    {appliedCoupon.discountType === "percent" && appliedCoupon.discountValue != null ? (
                      <strong className="font-bold">
                        {String(appliedCoupon.discountValue).replace(".", ",")}% de desconto
                      </strong>
                    ) : (
                      <strong className="font-bold">desconto</strong>
                    )}{" "}
                    (-{formatMoney(appliedCoupon.discountAmount, selectedAccount.price_currency)})
                  </span>
                  <button
                    onClick={handleRemoveCoupon}
                    className="text-xs text-muted-foreground hover:text-rose-500 underline shrink-0"
                  >
                    Remover
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleApplyCoupon()}
                      placeholder="Código do cupom"
                      className="flex-1 h-10 rounded-xl border border-border bg-muted px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <button
                      onClick={handleApplyCoupon}
                      disabled={!couponInput.trim() || couponChecking}
                      className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50 transition-colors shrink-0"
                    >
                      {couponChecking ? "..." : "Aplicar"}
                    </button>
                  </div>
                  {couponError && <p className="text-xs text-rose-500">{couponError}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Botão Concluir */}
        {(() => {
          const renewPrice =
            selectedPrice && selectedPrice.price_amount > 0
              ? selectedPrice
              : prices.find(
                  (p) => PERIOD_LABELS[p.period] === selectedAccount.plan_label,
                );
          const displayTotal =
            renewPrice && renewPrice.price_amount > 0
              ? Math.max(0, renewPrice.price_amount - (appliedCoupon?.discountAmount || 0))
              : null;

          return (
            <button
              onClick={handleRenew}
              disabled={
                !renewPrice ||
                !renewPrice.price_amount ||
                isProcessingPayment ||
                showMethodSelector ||
                checkingPendingCharges
              }
              className="w-full bg-[#25D366] hover:bg-[#20BA5A] text-white font-bold py-3 sm:py-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base sm:text-lg mt-2"
            >
              {isProcessingPayment ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Processando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  Pagar e Renovar •{" "}
                  {displayTotal != null
                    ? formatMoney(displayTotal, selectedAccount.price_currency)
                    : "—"}
                </>
              )}
            </button>
          );
        })()}

        {/* Pendência financeira em aberto */}
        {PendingChargesModal()}

        {/* Seletor de Método */}
        {MethodSelectorModal()}

        {/* Modal de Pagamento */}
        {PaymentModal()}
      </div>
    </div>
  );
}

// --- ÍCONES ---
function IconWhatsapp() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
