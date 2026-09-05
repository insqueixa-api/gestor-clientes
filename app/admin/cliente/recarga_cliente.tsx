"use client";
// app/admin/cliente/recarga_cliente.tsx
import { Loader2, X } from "lucide-react";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom"; // ✅ Importação necessária
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import FormattedDateInput from "@/components/ui/FormattedDateInput";
import FormattedTimeInput from "@/components/ui/FormattedTimeInput";
import { Suspense } from "react";
import { convertAmount } from "@/lib/fx";
import { buildWhatsAppSessionLabel } from "@/lib/admin/whatsapp-modal-data";

// --- INTERFACES ---
interface ClientFromView {
  id: string;
  display_name: string | null;
  username: string | null;
  external_user_id?: string | null; // ✅ ADICIONADO PARA A ELITE
  server_id: string | null;
  server_name: string | null;

  plan_name: string | null;

  // ✅ NOVO (fonte da verdade da tabela)
  plan_table_id?: string | null;
  plan_table_name?: string | null;

  vencimento: string | null; // timestamptz
  computed_status: string | null;
  screens: number | null;

  price_amount: number | null;
  price_currency: string | null;

  notes?: string | null;
}

type Currency = "BRL" | "USD" | "EUR";

interface PlanTableItemPrice {
  screens_count: number;
  price_amount: number | null;
}

interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  image_url?: string | null;
  category?: string | null; // ✅ NOVO: Busca a Categoria
}

interface PlanTableItem {
  id: string;
  period: string;
  credits_base: number;
  prices: PlanTableItemPrice[];
}

interface PlanTable {
  id: string;
  name: string;
  currency: Currency;
  is_system_default?: boolean | null;
  table_type?: string | null;
  items: PlanTableItem[];
}

interface Props {
  clientId: string;
  clientName: string;
  paymentLogId?: string; // ✅ Recebe o ID da Auditoria
  onClose: () => void;
  onSuccess: (logId?: string) => void | Promise<void>; // ✅ Permite devolver o ID e aguardar
  onError?: (msg: string) => void;
  allowConvertWithoutPayment?: boolean;
  toastKey?:
    "clients_list_toasts" | "trials_list_toasts" | "auditoria_list_toasts"; // ✅ Nova chave
}

// --- CONSTANTES ---
const PLAN_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

const PLAN_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

// Helpers
function getLocalISOString() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(n);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toBRDate(dateISO: string) {
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y}`;
}

function safeNumberFromMoneyBR(s: string) {
  return (
    Number(
      String(s || "0")
        .replace(/\./g, "")
        .replace(",", "."),
    ) || 0
  );
}

// ✅ Mostra o nome real da tabela, sem reconstruir/ocultar nada — antes,
// qualquer tabela is_system_default=true tinha o nome forçado pra
// "{primeira palavra} {moeda}" mesmo depois de renomeada (ex: "BRL 40"
// virava "BRL BRL" na tela, porque pegava só a primeira palavra do nome
// novo e colava a moeda de novo em cima).
function formatTableLabel(t: PlanTable) {
  return (t.name || "").trim();
}

function pickPriceFromTable(
  table: PlanTable | null,
  period: string,
  screens: number,
) {
  if (!table) return null;
  const item = table.items?.find((i) => i.period === period);
  if (!item) return null;

  const exact = item.prices?.find((p) => p.screens_count === screens);
  if (exact && exact.price_amount != null) return Number(exact.price_amount);

  const one = item.prices?.find((p) => p.screens_count === 1);
  if (one && one.price_amount != null)
    return Number(one.price_amount) * screens;

  return 0;
}

function pickCreditsUsed(
  table: PlanTable | null,
  period: string,
  screens: number,
) {
  if (!table) return null;
  const item = table.items?.find((i) => i.period === period);
  if (!item) return null;

  const base = Number(item.credits_base || 0);
  const used = base * Math.max(1, Number(screens || 1));
  return { base, used };
}

function nowInSaoPauloParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

  return {
    dateISO: `${get("year")}-${get("month")}-${get("day")}`,
    timeHHmm: `${get("hour")}:${get("minute")}`,
  };
}

function hhmmFromTimestamptzInSaoPaulo(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "00:00";

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return fmt.format(d);
}

function saoPauloDateTimeToIso(dateISO: string, timeHHmm: string) {
  if (!dateISO || !timeHHmm) throw new Error("Data/hora inválida.");
  const isoWithTZ = `${dateISO}T${timeHHmm}:00-03:00`;
  const d = new Date(isoWithTZ);
  if (Number.isNaN(d.getTime())) throw new Error("Data/hora inválida.");
  return d.toISOString();
}

// ✅ Função auxiliar para mandar toasts para a tela de listagem (Session Storage)
function queueToast(
  type: "success" | "error",
  title: string,
  message?: string,
  key:
    | "clients_list_toasts"
    | "trials_list_toasts"
    | "auditoria_list_toasts" = "clients_list_toasts",
) {
  try {
    const raw = window.sessionStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ type, title, message, ts: Date.now() });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

export default function RecargaCliente({
  clientId,
  clientName,
  paymentLogId, // ✅ Recebido aqui
  onClose,
  onSuccess,
  allowConvertWithoutPayment = false,
  toastKey = "clients_list_toasts",
}: Props) {
  const tenantId = useTenantId();
  // ✅ 1. Estado para garantir renderização no client (evita erro de hidratação no Portal)
  const [mounted, setMounted] = useState(false);

  // ✅ 2. Efeito para TRAVAR O SCROLL da página de fundo
  const modalScrollYRef = useRef(0);

  useEffect(() => {
    setMounted(true);

    if (typeof window === "undefined") return;

    const body = document.body;
    const html = document.documentElement;

    const scrollY = window.scrollY || window.pageYOffset || 0;
    modalScrollYRef.current = scrollY;

    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevHtmlOverflow = html.style.overflow;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;

      window.scrollTo(0, modalScrollYRef.current || 0);
    };
  }, []);

  // Estados globais
  const [loading, setLoading] = useState(false);
  // ✅ NOVO: Texto dinâmico para feedback sequencial no botão
  const [loadingText, setLoadingText] = useState("Processando...");
  const [fetching, setFetching] = useState(true);

  // ✅ TRANCA SÍNCRONA ANTI-DUPLO CLIQUE
  const isSavingRef = useRef(false);
  const isCheckingRef = useRef(false);

  // Toast Local
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = (
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) => {
    const id = Date.now();
    setToasts((prev) => [
      ...prev,
      { id, type, title, message, durationMs: 5000 },
    ]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      5000,
    );
  };

  // Dados do Cliente e Tabelas
  const [clientData, setClientData] = useState<ClientFromView | null>(null);
  const [tables, setTables] = useState<PlanTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>("");

  // ✅ Adicionado isFirstLoad para evitar reset de preço ao abrir
  const tableChangedByUserRef = useRef(false);
  const isFirstLoad = useRef(true);

  // ✅ Cupom aplicado no pagamento do portal que originou este paymentLogId
  // (via Auditoria) — guardado em ref (não precisa re-render) pra ficar
  // acessível lá embaixo no handleSave, fora do escopo do useEffect que
  // buscou o client_portal_payments.
  const paymentLogCouponRef = useRef<{
    coupon_id: string | null;
    coupon_discount_amount: number | null;
    price_currency: string | null;
  } | null>(null);

  const selectedTable = useMemo(() => {
    return tables.find((t) => t.id === selectedTableId) || null;
  }, [tables, selectedTableId]);

  // Formulário
  const [selectedPlanPeriod, setSelectedPlanPeriod] = useState("MONTHLY");
  const [screens, setScreens] = useState(1);
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [planPrice, setPlanPrice] = useState("0,00");
  const [priceTouched, setPriceTouched] = useState(false);

  // ✅ Pendências financeiras em aberto — oferece quitar junto da recarga manual
  const [pendingChargesForClient, setPendingChargesForClient] = useState<
    {
      id: string;
      message: string;
      appName: string | null;
      convertedAmount: number;
    }[]
  >([]);
  const [settlePendingCharges, setSettlePendingCharges] = useState(true);

  // Tecnologia
  const [technology, setTechnology] = useState("IPTV");
  const [customTechnology, setCustomTechnology] = useState("");

  // Vencimento (Inicia com Data de Hoje e Hora Atual de SP)
  const [dueDate, setDueDate] = useState<string>(
    () => nowInSaoPauloParts().dateISO,
  );
  const [dueTime, setDueTime] = useState(() => nowInSaoPauloParts().timeHHmm);

  // Auxiliares e Pagamento
  const [fxRate, setFxRate] = useState<number>(1);
  const [totalBrl, setTotalBrl] = useState(0);
  const [obs, setObs] = useState("");
  const [registerPayment, setRegisterPayment] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [payDate, setPayDate] = useState(getLocalISOString());

  // ✅ MENSAGENS E WHATSAPP (Estados que faltavam)
  const [sendWhats, setSendWhats] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [messageContent, setMessageContent] = useState("");

  // ✅ NOVO: Controle de Sessão
  const [selectedSession, setSelectedSession] = useState("default");
  const [sessionOptions, setSessionOptions] = useState<
    { id: string; label: string }[]
  >([{ id: "default", label: "Carregando..." }]);

  async function loadWhatsAppSessions() {
    try {
      const [res1, res2] = await Promise.all([
        fetch("/api/whatsapp/profile", { cache: "no-store" }).catch(() => null),
        fetch("/api/whatsapp/profile2", { cache: "no-store" }).catch(
          () => null,
        ),
      ]);

      const prof1 = res1 && res1.ok ? await res1.json().catch(() => ({})) : {};
      const prof2 = res2 && res2.ok ? await res2.json().catch(() => ({})) : {};

      const name1 =
        typeof window !== "undefined"
          ? localStorage.getItem("wa_label_1") || "Contato Principal"
          : "Contato Principal";
      const name2 =
        typeof window !== "undefined"
          ? localStorage.getItem("wa_label_2") || "Contato Secundário"
          : "Contato Secundário";

      const options = [
        { id: "default", label: buildWhatsAppSessionLabel(prof1, name1) },
      ]; // ✅ TRAVA: Só exibe a opção de envio pela sessão 2 se ela estiver conectada

      if (prof2 && prof2.connected) {
        options.push({
          id: "session2",
          label: buildWhatsAppSessionLabel(prof2, name2),
        });
      }

      setSessionOptions(options);
    } catch {}
  }

  // ✅ NOVO: Renovação Automática
  const [hasIntegration, setHasIntegration] = useState(false);
  const [isEliteProvider, setIsEliteProvider] = useState(false);
  const [integrationProvider, setIntegrationProvider] = useState("NONE"); // ✅ NOVO
  const [renewAutomatic, setRenewAutomatic] = useState(false);

  // Hook de Confirmação
  const { confirm, ConfirmUI } = useConfirm();

  // ========= LOAD =========
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        // ✅ OTIMIZAÇÃO (02/08/2026): tenant e cliente não dependem um do
        // outro — buscados em paralelo em vez de um atrás do outro. Sessões
        // de WhatsApp (só usadas lá embaixo, no Select de sessão) deixam de
        // ser esperadas aqui — antes, se a VM estivesse fora do ar, essa
        // chamada sozinha travava a abertura do modal inteiro até 12s.
        const [tid, { data: rawClient, error: cErr }] = await Promise.all([
          Promise.resolve(tenantId),
          supabaseBrowser
            .from("clients")
            .select("*, servers(name)")
            .eq("id", clientId)
            .single(),
        ]);

        if (tid) loadWhatsAppSessions(); // fire-and-forget — não bloqueia o resto

        if (!alive) return;

        if (cErr || !rawClient) {
          onClose();
          return;
        }

        // Simula o formato da view antiga para não quebrar nada no seu código
        const client = {
          ...rawClient,
          display_name: rawClient.display_name,
          username: rawClient.server_username,
          server_name: rawClient.servers?.name || null,
          plan_name: rawClient.plan_label,
          // ✅ Espelha exatamente a CASE de computed_status das views
          // vw_clients_list_* (docs/sql/add_name_prefix_to_list_views.sql) —
          // faltava o ramo OVERDUE (achado em auditoria: todo cliente não
          // arquivado/trial aqui sempre virava "ACTIVE", mesmo vencido).
          computed_status: rawClient.is_archived
            ? "ARCHIVED"
            : rawClient.is_trial
              ? "TRIAL"
              : rawClient.vencimento &&
                  new Date(rawClient.vencimento) < new Date()
                ? "OVERDUE"
                : "ACTIVE",
        };

        const c = client as unknown as ClientFromView;

        // ✅ OTIMIZAÇÃO (02/08/2026): removida uma 2ª consulta em "clients"
        // que buscava de novo notes/plan_table_id/price_currency — a MESMA
        // linha da MESMA tabela que o select("*") acima já trouxe. Puro
        // round-trip repetido, sem motivo (RLS já escopa pro tenant certo).
        const cFixed: ClientFromView = {
          ...c,
          notes: c.notes ?? null,
          plan_table_id: c.plan_table_id ?? null,
          price_currency: c.price_currency ?? null,
        };

        setClientData(cFixed);
        setScreens(cFixed.screens || 1);

        // ✅ Prefill Observações (agora certo)
        setObs(cFixed.notes || "");

        // ✅ OTIMIZAÇÃO (02/08/2026): as duas buscas abaixo (log de
        // pagamento da Auditoria x servidor/integração) não dependem uma da
        // outra — rodam em paralelo em vez de sequenciais.
        type PaymentLog = {
          period: string | null;
          plan_label: string | null;
          price_amount: number | null;
          plan_price_amount: number | null;
          price_currency: string | null;
          coupon_id: string | null;
          coupon_code: string | null;
          coupon_discount_amount: number | null;
        };

        async function fetchPaymentLog(): Promise<PaymentLog | null> {
          if (!paymentLogId) return null;
          try {
            const { data: logData, error: logErr } = await supabaseBrowser
              .from("client_portal_payments")
              .select(
                "period, plan_label, price_amount, plan_price_amount, price_currency, coupon_id, coupon_code, coupon_discount_amount",
              )
              .eq("id", paymentLogId)
              .eq("tenant_id", tid)
              .maybeSingle();
            if (!logErr && logData) return logData as any;
          } catch {}
          return null;
        }

        // ✅ NOVO: Detectar se servidor tem integração e QUAL O SERVIDOR
        async function fetchIntegration(): Promise<{
          hasInteg: boolean;
          provider: string;
        } | null> {
          if (!c.server_id) return { hasInteg: false, provider: "NONE" };
          try {
            const { data: srv } = await supabaseBrowser
              .from("servers")
              .select("panel_integration")
              .eq("id", c.server_id)
              .single();

            if (!srv?.panel_integration)
              return { hasInteg: false, provider: "NONE" };

            const { data: integ } = await supabaseBrowser
              .from("server_integrations")
              .select("provider")
              .eq("id", srv.panel_integration)
              .single();

            return {
              hasInteg: true,
              provider: String(integ?.provider || "").toUpperCase(),
            };
          } catch {
            return null; // erro real — trata como "sem integração" abaixo
          }
        }

        const [paymentLog, integrationResult] = await Promise.all([
          fetchPaymentLog(),
          fetchIntegration(),
        ]);

        if (paymentLog) {
          paymentLogCouponRef.current = {
            coupon_id: paymentLog.coupon_id ?? null,
            coupon_discount_amount: paymentLog.coupon_discount_amount ?? null,
            price_currency: paymentLog.price_currency ?? null,
          };
        }

        const hasInteg = integrationResult?.hasInteg ?? false;
        setHasIntegration(hasInteg);
        setRenewAutomatic(hasInteg);
        setIntegrationProvider(integrationResult?.provider ?? "NONE");
        setIsEliteProvider((integrationResult?.provider ?? "NONE") === "ELITE");

        // 2) Plano (detectar período)
        let foundPeriod = "MONTHLY";

        // ✅ Se aberto via Auditoria, usa o período EXATO que o cliente
        // pagou (vindo do client_portal_payments). Senão, detecta pelo
        // label do plano atual do cliente (fluxo antigo).
        if (paymentLog?.period && PLAN_LABELS[paymentLog.period]) {
          foundPeriod = paymentLog.period;
        } else {
          const pName = (c.plan_name || "").toUpperCase();
          if (pName.includes("ANUAL")) foundPeriod = "ANNUAL";
          else if (pName.includes("SEMESTRAL")) foundPeriod = "SEMIANNUAL";
          else if (pName.includes("TRIMESTRAL")) foundPeriod = "QUARTERLY";
          else if (pName.includes("BIMESTRAL")) foundPeriod = "BIMONTHLY";
        }
        setSelectedPlanPeriod(foundPeriod);

        // 3) LÓGICA DE VENCIMENTO (ATIVO vs VENCIDO)
        {
          const monthsToAdd = PLAN_MONTHS[foundPeriod] || 1;
          const vencDate = c.vencimento ? new Date(c.vencimento) : null;
          const isActive = vencDate != null && vencDate > new Date();
          let baseDate: Date;
          let newTimeStr: string;

          if (isActive && c.vencimento) {
            // ✅ ATIVO: baseia no vencimento do banco e mantém a hora (em São Paulo)
            baseDate = new Date(c.vencimento);
            newTimeStr = hhmmFromTimestamptzInSaoPaulo(c.vencimento);
          } else {
            // ✅ NÃO ATIVO: base = agora, hora = agora (São Paulo)
            baseDate = new Date();
            newTimeStr = nowInSaoPauloParts().timeHHmm;
          }

          // soma meses (a parte de "dia" pode variar com setMonth, mantém teu comportamento)
          const target = new Date(baseDate);
          target.setMonth(target.getMonth() + monthsToAdd);

          // ✅ grava a data em São Paulo (YYYY-MM-DD)
          const fmtDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          const dISO = fmtDate.format(target);

          setDueDate(dISO);
          setDueTime(newTimeStr);
        }

        // 4) Tabelas + templates de mensagem (✅ OTIMIZAÇÃO 02/08/2026: as
        // duas não dependem uma da outra nem do que veio acima — buscadas
        // juntas. O uso do resultado de templates continua lá embaixo, só o
        // fetch em si que subiu pra cá.)
        const [{ data: tData, error: tErr }, { data: tmplData }] =
          await Promise.all([
            supabaseBrowser
              .from("plan_tables")
              .select(
                `id, name, currency, is_system_default, table_type,
                items:plan_table_items (id, period, credits_base, prices:plan_table_item_prices (screens_count, price_amount))`,
              )
              .eq("tenant_id", tid)
              .eq("is_active", true)
              .eq("table_type", "iptv")
              .order("name", { ascending: true }),
            supabaseBrowser
              .from("message_templates")
              .select("id, name, content, image_url, category")
              .eq("tenant_id", tid)
              .order("name", { ascending: true }),
          ]);

        if (tErr) {
          addToast("error", "Falha ao carregar tabelas", tErr.message);
        }

        const allTables = (tData || []) as unknown as PlanTable[];

        // 5) Seleção inicial de tabela (✅ respeita a tabela real do cliente,
        // ou a moeda paga no portal se vier via Auditoria)
        const desiredCurrency =
          (paymentLog?.price_currency as Currency) ||
          (cFixed.price_currency as Currency) ||
          "BRL";

        // 5.1) tenta usar a tabela REAL salva no cliente
        let fromClient = cFixed.plan_table_id
          ? allTables.find((t) => t.id === cFixed.plan_table_id)
          : null;

        // ✅ Rede de segurança: cliente tem plan_table_id mas ela não veio na lista
        // filtrada (is_active/table_type) — busca direto pelo ID antes de cair
        // no fallback por moeda, pra nunca trocar silenciosamente pro Padrão.
        if (cFixed.plan_table_id && !fromClient) {
          try {
            const { data: directTable } = await supabaseBrowser
              .from("plan_tables")
              .select(
                `id, name, currency, is_system_default, table_type, is_active,
                 items:plan_table_items (id, period, credits_base, prices:plan_table_item_prices (screens_count, price_amount))`,
              )
              .eq("id", cFixed.plan_table_id)
              .eq("tenant_id", tid)
              .maybeSingle();

            if (directTable) {
              allTables.push(directTable as unknown as PlanTable);
              fromClient = directTable as unknown as PlanTable;
              if ((directTable as any).is_active === false) {
                addToast(
                  "warning",
                  "Tabela do cliente está inativa",
                  `A tabela "${(directTable as any).name}" foi reativada nesta renovação pois é a tabela salva do cliente.`,
                );
              }
            } else if (!paymentLog) {
              addToast(
                "error",
                "Tabela de preço não encontrada",
                "A tabela salva deste cliente não existe mais no banco. Selecione a tabela correta manualmente antes de renovar.",
              );
            }
          } catch {
            // segue pro fallback abaixo
          }
        }

        setTables(allTables);

        // 5.2) fallback: mesma lógica antiga (default por moeda)
        const fallbackByCurrency =
          allTables.find(
            (t) => t.currency === desiredCurrency && t.is_system_default,
          ) ||
          allTables.find((t) => t.currency === desiredCurrency) ||
          allTables[0];

        const initialTable = fromClient || fallbackByCurrency || null;

        if (initialTable) {
          setSelectedTableId(initialTable.id);
          setCurrency((initialTable.currency as Currency) || "BRL");
        } else {
          setCurrency(desiredCurrency);
        }

        // 6) Valor inicial (✅ pagamento do portal tem prioridade sobre o atual
        // do cliente). Usa plan_price_amount — o preço do PLANO puro, sem
        // pendência nem desconto de cupom — senão a próxima renovação
        // herdava o valor já descontado/com pendência como se fosse o
        // preço normal da assinatura (mesmo bug já corrigido pra
        // pendência; price_amount é só fallback pra logs antigos de antes
        // dessa coluna existir).
        const initialAmount =
          paymentLog?.plan_price_amount ??
          paymentLog?.price_amount ??
          cFixed.price_amount ??
          null;

        if (initialAmount != null) {
          setPlanPrice(Number(initialAmount).toFixed(2).replace(".", ","));
          setPriceTouched(true);
        } else {
          const initialPrice = pickPriceFromTable(
            initialTable || null,
            foundPeriod,
            cFixed.screens || 1,
          );
          setPlanPrice(
            Number(initialPrice || 0)
              .toFixed(2)
              .replace(".", ","),
          );
          setPriceTouched(false);
        }

        // 7) FX (✅ usa desiredCurrency que já veio de cFixed lá no Patch 2)
        if (desiredCurrency !== "BRL") {
          const { data: fx, error: fxErr } = await supabaseBrowser
            .from("tenant_fx_rates")
            .select("usd_to_brl, eur_to_brl, as_of_date")
            .eq("tenant_id", tid)
            .order("as_of_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (fxErr) {
            addToast("error", "Falha ao carregar câmbio", fxErr.message);
            setFxRate(5);
          } else {
            const rate =
              desiredCurrency === "USD"
                ? Number(fx?.usd_to_brl || 5)
                : Number(fx?.eur_to_brl || 5);

            setFxRate(rate);
          }
        } else {
          setFxRate(1);
        }

        // ✅ PREFILL TECNOLOGIA
        // O campo 'technology' deve vir da view. Se não vier, assume padrão.
        // Se a view ainda não retorna 'technology', isso ficará como undefined e cairá no "IPTV".
        // Caso você já tenha atualizado a view vw_clients_list para trazer technology, adicione na interface ClientFromView lá em cima.
        // Por segurança, vou fazer um cast aqui para evitar erro de TS se a interface não tiver sido atualizada ainda.
        const tecRaw = (c as any).technology || "IPTV";
        const isStandard = ["IPTV", "P2P", "OTT"].some(
          (t) => t.toUpperCase() === tecRaw.toUpperCase(),
        );

        if (isStandard) {
          setTechnology(tecRaw.toUpperCase());
          setCustomTechnology("");
        } else {
          setTechnology("Personalizado");
          setCustomTechnology(tecRaw);
        }

        // ✅ Templates (categoria + pré-seleção) — dado já veio no Promise.all lá em cima
        if (tmplData) {
          // ✅ Mantém apenas a categoria real, sem forçar nomes antigos Revenda
          const mappedTpls = tmplData.map((r: any) => ({
            ...r,
            category: r.category || "Geral",
          }));

          setTemplates(mappedTpls);
          const defaultTpl = mappedTpls.find((t) =>
            t.name.toLowerCase().includes("pagamento realizado"),
          );
          if (defaultTpl) {
            setSelectedTemplateId(defaultTpl.id);
            setMessageContent(defaultTpl.content);
          }
        }

        // ✅ Libera a trava de "Primeira Carga" após carregar tudo
        setTimeout(() => {
          isFirstLoad.current = false;
        }, 500);
      } catch {
      } finally {
        if (alive) setFetching(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
    // ⚠️ IMPORTANTE: NÃO depende de onClose (evita re-fetch em loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // ✅ Carrega pendências financeiras abertas deste cliente (convertidas pra
  // moeda atual da renovação), pra oferecer quitar tudo junto.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tid = tenantId;
        if (!tid || !clientId) return;

        const { data, error } = await supabaseBrowser
          .from("client_alerts")
          .select("id, message, amount, currency, client_apps(apps(name))")
          .eq("tenant_id", tid)
          .eq("client_id", clientId)
          .eq("status", "OPEN")
          .not("amount", "is", null);

        if (error || !data?.length || !alive) {
          if (alive) setPendingChargesForClient([]);
          return;
        }

        const items = await Promise.all(
          (data as any[]).map(async (row) => {
            const amount = Number(row.amount);
            const convertedAmount = await convertAmount(
              supabaseBrowser,
              tid,
              amount,
              String(row.currency || "BRL"),
              currency,
            );
            return {
              id: String(row.id),
              message: String(row.message || ""),
              appName: row.client_apps?.apps?.name ?? null,
              convertedAmount,
            };
          }),
        );

        if (alive) setPendingChargesForClient(items);
      } catch {
        if (alive) setPendingChargesForClient([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, currency]);

  // ========= REGRAS DE UI =========

  // 1. Vencimento ao mudar plano (Corrigido para forçar a Hora Atual de SP em vencidos)
  useEffect(() => {
    if (!clientData) return;
    const monthsToAdd = PLAN_MONTHS[selectedPlanPeriod] || 1;
    const vencDate = clientData.vencimento
      ? new Date(clientData.vencimento)
      : null;
    const isActive = vencDate != null && vencDate > new Date();

    let base: Date;
    if (isActive && clientData.vencimento) {
      base = new Date(clientData.vencimento);
      // Cliente ativo: Mantém a hora exata que já estava no vencimento dele
      setDueTime(hhmmFromTimestamptzInSaoPaulo(clientData.vencimento));
    } else {
      base = new Date();
      // Cliente vencido/novo: Força a hora para AGORA no fuso de São Paulo
      setDueTime(nowInSaoPauloParts().timeHHmm);
    }

    const target = new Date(base);
    target.setMonth(target.getMonth() + monthsToAdd);

    // Garante que o dia/mês/ano salvo seja correspondente a São Paulo
    const fmtDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    setDueDate(fmtDate.format(target));
  }, [clientData, selectedPlanPeriod]);

  // ✅ Regra: se converter SEM pagamento, por padrão não faz sentido enviar mensagem.
  // MAS o usuário pode ligar manualmente depois.
  useEffect(() => {
    const isFromTrial = Boolean(allowConvertWithoutPayment);

    if (!isFromTrial) return;

    // quando desliga "Registrar pagamento", auto-desliga Whats
    if (!registerPayment) {
      setSendWhats(false);
    }
  }, [allowConvertWithoutPayment, registerPayment]);

  // 2. Resetar Override (priceTouched) se mudar estrutura, MAS IGNORA NO LOAD
  useEffect(() => {
    if (isFirstLoad.current) return; // ✅ Não reseta se acabou de carregar
    setPriceTouched(false);
  }, [screens, selectedPlanPeriod, selectedTableId]);

  // 3. Calcular Preço (Respeita Tabela se !priceTouched)
  useEffect(() => {
    if (!selectedTable) return;
    if (priceTouched) return;

    const p = pickPriceFromTable(
      selectedTable,
      selectedPlanPeriod,
      Number(screens) || 1,
    );
    setPlanPrice(
      Number(p || 0)
        .toFixed(2)
        .replace(".", ","),
    );
  }, [screens, selectedTable, selectedPlanPeriod, priceTouched]);

  // 4. Troca de Tabela (Atualiza Moeda e Taxa)
  useEffect(() => {
    if (!selectedTable) return;
    setCurrency(selectedTable.currency || "BRL");

    const userChanged = tableChangedByUserRef.current === true;
    if (userChanged) setPriceTouched(false);

    (async () => {
      try {
        const tid = tenantId;
        if (selectedTable.currency === "BRL") {
          setFxRate(1);
          return;
        }
        const { data: fx } = await supabaseBrowser
          .from("tenant_fx_rates")
          .select("*")
          .eq("tenant_id", tid)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (fx) {
          const rate =
            selectedTable.currency === "USD"
              ? Number(fx.usd_to_brl)
              : Number(fx.eur_to_brl);
          setFxRate(rate || 5);
        } else {
          setFxRate(5);
        }
      } catch {
        setFxRate(5);
      }
    })();
    tableChangedByUserRef.current = false;
  }, [selectedTableId]);

  // Total BRL
  useEffect(() => {
    const rawVal = safeNumberFromMoneyBR(planPrice);
    setTotalBrl(currency === "BRL" ? rawVal : rawVal * (Number(fxRate) || 0));
  }, [planPrice, fxRate, currency]);

  // ✅ TRAVA DE TECNOLOGIA POR Servidor (Evita envios errados para API)
  useEffect(() => {
    if (integrationProvider === "FAST" || integrationProvider === "NATV") {
      if (technology !== "IPTV") {
        setTechnology("IPTV");
        setCustomTechnology("");
      }
    } else if (integrationProvider === "ELITE") {
      if (technology !== "IPTV" && technology !== "P2P") {
        setTechnology("IPTV");
        setCustomTechnology("");
      }
    }
  }, [integrationProvider, technology]);

  // ✅ TRAVA DO PLANO ANUAL APENAS PARA ELITE
  useEffect(() => {
    if (isEliteProvider && selectedPlanPeriod === "ANNUAL") {
      setSelectedPlanPeriod("SEMIANNUAL");
      addToast(
        "success",
        "Plano ajustado",
        "A integração Elite permite no máximo 6 meses.",
      );
    }
  }, [isEliteProvider, selectedPlanPeriod]);

  const creditsInfo = useMemo(() => {
    return pickCreditsUsed(selectedTable, selectedPlanPeriod, screens);
  }, [selectedTable, selectedPlanPeriod, screens]);

  const showFx = currency !== "BRL";

  // ========= LOGICA DE CONFIRMAÇÃO =========

  // 1. Valida e Abre o Popup
  const handlePreCheck = async () => {
    // ✅ TRANCA 1: Aborta se já estiver a abrir o popup ou a salvar
    if (loading || isCheckingRef.current || isSavingRef.current || !clientData)
      return;
    isCheckingRef.current = true;

    // Validação Tecnologia
    if (technology === "Personalizado" && !customTechnology.trim()) {
      addToast("error", "Tecnologia", "Para 'Personalizado', digite o nome.");
      isCheckingRef.current = false; // destranca
      return;
    }

    if (!clientData.server_id) {
      addToast("error", "Erro", "Cliente está sem servidor vinculado.");
      isCheckingRef.current = false; // destranca
      return;
    }

    const rawPlanPrice = safeNumberFromMoneyBR(planPrice);

    // ✅ Trava contra acidente: um "-" digitado sem querer no campo de valor
    // (ou colado de outro lugar) corrompia o preço do cliente e, se
    // "Registrar Pagamento" estivesse ligado, também o valor do
    // client_renewals — sem nenhum aviso, direto pro banco.
    if (rawPlanPrice < 0) {
      addToast(
        "error",
        "Valor inválido",
        "O valor a cobrar não pode ser negativo.",
      );
      isCheckingRef.current = false; // destranca
      return;
    }

    const creditsUsed = creditsInfo?.used ?? 0;
    const isFromTrial = Boolean(allowConvertWithoutPayment);
    const isPaymentFlow = Boolean(registerPayment);

    // Monta o resumo para o popup (voltamos ao string[] puro para evitar bullets vazios)
    const details: string[] = [];

    const nameToShow = clientData?.display_name || clientName || "—";
    const usernameToShow = clientData?.username || "—";
    const serverToShow = clientData?.server_name || "—";

    details.push(`Cliente: ${nameToShow}`);
    details.push(`Username: ${usernameToShow}`);
    details.push(`Servidor: ${serverToShow}`);

    // ✅ Linha fina feita com traço EM (mais limpo e longo, funde-se nativamente)
    details.push(`---`);

    details.push(`Plano: ${PLAN_LABELS[selectedPlanPeriod]}`);
    details.push(`Telas: ${screens}`);
    details.push(`Vencimento: ${toBRDate(dueDate)} às ${dueTime}`);

    if (isFromTrial && !isPaymentFlow) {
      details.push(`Tipo: Conversão (Sem pagamento)`);
    } else {
      // Formata apenas o número para não duplicar o símbolo da moeda
      const formattedVal = rawPlanPrice.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      details.push(`Valor: ${currency} ${formattedVal}`);

      if (settlePendingCharges && pendingChargesForClient.length > 0) {
        const pendingTotal = pendingChargesForClient.reduce(
          (sum, p) => sum + p.convertedAmount,
          0,
        );
        const formattedPending = pendingTotal.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        details.push(`Pendência: ${currency} ${formattedPending}`);

        const formattedTotal = (rawPlanPrice + pendingTotal).toLocaleString(
          "pt-BR",
          { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        );
        details.push(`Total a Cobrar: ${currency} ${formattedTotal}`);
      }

      if (creditsUsed > 0) details.push(`Créditos a descontar: ${creditsUsed}`);
    }

    // Abre o Modal Bonito
    const ok = await confirm({
      // ✅ NOVO: deixa o título com o nome também (fica bem claro)
      title:
        isFromTrial && !isPaymentFlow
          ? `Converter Cliente`
          : `Confirmar Renovação`,
      subtitle: "Confira os dados antes de salvar.",
      tone: isFromTrial && !isPaymentFlow ? "sky" : "emerald",
      icon: isFromTrial && !isPaymentFlow ? "✨" : "💰",
      details,
      confirmText: "Confirmar",
      cancelText: "Voltar",
    });

    if (!ok) {
      isCheckingRef.current = false; // destranca ao cancelar
      return;
    }

    await executeSave();
    isCheckingRef.current = false; // destranca ao terminar
  };

  // 2. Executa a Gravação (Chamado pelo botão "Confirmar" do popup)
  const executeSave = async () => {
    // ✅ TRANCA 2: Aborta imediatamente se já iniciou a gravação
    if (isSavingRef.current) return;

    // ✅ Trava de segurança: nunca grava plan_table_id vazio/null por engano.
    // Se isso disparar, é porque a tabela do cliente não foi resolvida no load
    // (veja os toasts de aviso/erro no prefill) — bloqueia o save em vez de
    // sobrescrever silenciosamente a tabela real do cliente no banco.
    if (!selectedTableId) {
      addToast(
        "error",
        "Tabela de preço não selecionada",
        "Não foi possível confirmar a tabela de preço deste cliente. Selecione a tabela manualmente antes de renovar.",
      );
      return;
    }

    // ✅ Mesma trava do handlePreCheck, repetida aqui (defesa em profundidade
    // — executeSave é a função que de fato grava no banco).
    if (safeNumberFromMoneyBR(planPrice) < 0) {
      addToast(
        "error",
        "Valor inválido",
        "O valor a cobrar não pode ser negativo.",
      );
      return;
    }

    isSavingRef.current = true;

    setLoading(true);
    setLoadingText("Salvando dados...");

    try {
      let finalTechnology = technology;
      if (technology === "Personalizado")
        finalTechnology = customTechnology.trim();

      const rawPlanPrice = safeNumberFromMoneyBR(planPrice);
      const monthsToRenew = Number(PLAN_MONTHS[selectedPlanPeriod] ?? 1);
      const tid = tenantId;
      const nameToSend = clientData?.display_name || clientName;

      // ✅ 05/09/2026: id da linha nova em client_portal_payments quando esta
      // renovação NÃO veio de uma pendência já existente no Log do Portal
      // (paymentLogId ausente) — preenchido logo após registrar o pagamento
      // manual mais abaixo, usado só pra também rastrear o envio de WhatsApp.
      let newPortalLogId: string | undefined;
      // ✅ Mesma condição do PASSO 4 abaixo — se não vai nem tentar mandar
      // (toggle desligado), a linha nova já nasce com whatsapp_status='na'
      // em vez de ficar "Aguardando" pra sempre na Auditoria.
      const willAttemptWhatsapp = Boolean(
        sendWhats && messageContent && messageContent.trim(),
      );

      // ✅ VARIÁVEIS para dados da API
      let apiVencimento = saoPauloDateTimeToIso(dueDate, dueTime); // inicial
      let apiPassword: string | null = null;
      let serverName = "Servidor"; // ✅ DECLARAR AQUI

      // --- PASSO 1: RENOVAÇÃO AUTOMÁTICA (SE MARCADA) ---
      if (renewAutomatic && clientData?.server_id) {
        try {
          setLoadingText("Renovando no servidor...");

          // 1.1. Buscar integração
          const { data: srv, error: srvErr } = await supabaseBrowser
            .from("servers")
            .select("panel_integration")
            .eq("id", clientData.server_id)
            .single();

          if (srvErr) {
            throw new Error("Erro ao buscar servidor: " + srvErr.message);
          }

          if (srv?.panel_integration) {
            // 1.2. Buscar provider
            const { data: integ } = await supabaseBrowser
              .from("server_integrations")
              .select("provider")
              .eq("id", srv.panel_integration)
              .single();

            const provider = String(integ?.provider || "").toUpperCase();

            // ✅ Pegamos o Token da sua sessão logada
            const { data: userSess } = await supabaseBrowser.auth.getSession();
            const token = userSess?.session?.access_token;

            // ====================================================================
            // 🔴 RENOVAÇÃO ELITE (VIA EXTENSÃO)
            // ====================================================================
            if (provider === "ELITE") {
              setLoadingText("Conectando ao Elite...");

              const credRes = await fetch("/api/integrations/elite/sync", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                  action: "get_credentials",
                  integration_id: srv.panel_integration,
                }),
              });
              const credJson = await credRes.json().catch(() => ({}));
              if (!credRes.ok || !credJson?.ok)
                throw new Error(
                  credJson?.error || "Falha ao buscar credenciais do Elite.",
                );

              setLoadingText("Renovando no Elite...");

              await new Promise((resolve, reject) => {
                // ✅ Timeout de segurança — sem isso, se a extensão não
                // responder (não instalada, desconectada, aba sem foco), o
                // modal ficava travado pra sempre em "Renovando no Elite...",
                // com o botão desabilitado e sem nenhuma forma de destravar
                // a não ser fechar o modal manualmente.
                // 95s (não 30s) — conferido direto no código da extensão
                // (unigestor-extensao/background.js, runEliteFlow): ela tem
                // seu PRÓPRIO teto interno de 90s (abre aba + login + navega
                // + roda a API de renovação, com direito a retentativa se
                // cair desafio do Cloudflare no meio) antes de desistir
                // sozinha com um erro específico ("Timeout: O painel Elite
                // não liberou o acesso em 90s"). Um timeout menor aqui
                // cortaria renovações legítimas que só terminam perto desse
                // teto — 95s dá aquela margem pra deixar o erro real da
                // extensão (mais útil) chegar primeiro.
                const timeoutId = setTimeout(() => {
                  window.removeEventListener(
                    "UNIGESTOR_INTEGRATION_RESPONSE",
                    evtHandler,
                  );
                  reject(
                    new Error(
                      "A Extensão não respondeu a tempo (95s). Verifique se ela está instalada, conectada e com a aba em foco.",
                    ),
                  );
                }, 95_000);

                const evtHandler = (e: any) => {
                  clearTimeout(timeoutId);
                  window.removeEventListener(
                    "UNIGESTOR_INTEGRATION_RESPONSE",
                    evtHandler,
                  );
                  if (e.detail?.ok) {
                    const extData = e.detail.data;

                    if (extData.id && !clientData.external_user_id) {
                      clientData.external_user_id = String(extData.id);
                    }

                    const expRaw = extData.exp_date;
                    if (expRaw) {
                      const expStr = String(expRaw);
                      if (
                        typeof expRaw === "number" ||
                        /^\d{10}$/.test(expStr)
                      ) {
                        // Unix timestamp → UTC direto
                        apiVencimento = new Date(
                          Number(expRaw) * 1000,
                        ).toISOString();
                      } else if (expStr.includes("/")) {
                        // DD/MM/YYYY HH:mm → força -03:00
                        const m = expStr.match(
                          /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/,
                        );
                        if (m)
                          apiVencimento = new Date(
                            `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`,
                          ).toISOString();
                      } else if (expStr.includes("T")) {
                        // ISO com ou sem fuso
                        const hasTZ =
                          /[Z+\-]\d{2}:\d{2}$/.test(expStr) ||
                          expStr.endsWith("Z");
                        if (hasTZ) {
                          // Já tem fuso declarado — confia
                          const d = new Date(expStr);
                          if (!Number.isNaN(d.getTime()))
                            apiVencimento = d.toISOString();
                        } else {
                          // SEM fuso → assume Brasília (-03:00)
                          const d = new Date(expStr + "-03:00");
                          if (!Number.isNaN(d.getTime()))
                            apiVencimento = d.toISOString();
                        }
                      } else if (expStr.includes("-") && expStr.length === 10) {
                        // Apenas data YYYY-MM-DD → assume fim do dia em Brasília
                        const d = new Date(expStr + "T23:59:00-03:00");
                        if (!Number.isNaN(d.getTime()))
                          apiVencimento = d.toISOString();
                      }
                    }
                    resolve(true);
                  } else {
                    reject(
                      new Error(
                        e.detail?.error ||
                          "A Extensão falhou ao renovar o cliente.",
                      ),
                    );
                  }
                };
                window.addEventListener(
                  "UNIGESTOR_INTEGRATION_RESPONSE",
                  evtHandler,
                );
                window.dispatchEvent(
                  new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
                    detail: {
                      action: "ELITE_RENEW",
                      baseUrl: credJson.credentials.baseUrl,
                      username: credJson.credentials.username,
                      password: credJson.credentials.password,
                      technology: finalTechnology,
                      months: monthsToRenew,
                      searchTarget: clientData.username,
                      externalUserId: clientData.external_user_id || "",
                    },
                  }),
                );
              });

              // 🌟 SYNC AUTOMÁTICO DO SALDO VIA EXTENSÃO APÓS RENOVAÇÃO
              setLoadingText("Sincronizando saldo do servidor...");
              try {
                await new Promise<void>((resolveSync) => {
                  const syncHandler = async (e: any) => {
                    window.removeEventListener(
                      "UNIGESTOR_INTEGRATION_RESPONSE",
                      syncHandler,
                    );

                    if (e.detail?.ok && e.detail?.saldo != null) {
                      // ✅ Usa a rota correta (save_sync) igual ao fluxo da página de listagem
                      try {
                        const saveRes = await fetch(
                          "/api/integrations/elite/sync",
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              ...(token
                                ? { Authorization: `Bearer ${token}` }
                                : {}),
                            },
                            body: JSON.stringify({
                              integration_id: srv.panel_integration,
                              action: "save_sync",
                              saldo: e.detail.saldo,
                              loggedUser: e.detail.loggedUser,
                            }),
                          },
                        );
                        // ✅ FALTAVA: save_sync só atualiza
                        // server_integrations.credits_last_known —
                        // servers.credits_available (o que o card de saldo e
                        // o alerta de saldo baixo leem) nunca era tocado pela
                        // renovação automática via Elite. Mesmo passo que
                        // novo_servidor.tsx/recarga_servidor.tsx já fazem.
                        if (saveRes.ok) {
                          const { data: afterSync } = await supabaseBrowser
                            .from("server_integrations")
                            .select("credits_last_known")
                            .eq("id", srv.panel_integration)
                            .eq("tenant_id", tid)
                            .single();

                          if (afterSync?.credits_last_known != null) {
                            await supabaseBrowser.rpc(
                              "update_server_credits_manual",
                              {
                                p_server_id: clientData.server_id,
                                p_new_credits: Number(
                                  afterSync.credits_last_known,
                                ),
                              },
                            );
                          }
                        }
                      } catch {}
                    }

                    resolveSync();
                  };

                  window.addEventListener(
                    "UNIGESTOR_INTEGRATION_RESPONSE",
                    syncHandler,
                  );
                  window.dispatchEvent(
                    new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
                      detail: {
                        action: "ELITE_SYNC",
                        baseUrl: credJson.credentials.baseUrl,
                        username: credJson.credentials.username,
                        password: credJson.credentials.password,
                      },
                    }),
                  );

                  // Timeout de segurança pra não congelar a tela — era 15s,
                  // curto demais: a extensão (background.js, ação
                  // ELITE_SYNC) tem seu próprio teto interno de 60s (abre
                  // aba + login + lê o saldo, 1500ms × 40 tentativas) antes
                  // de desistir sozinha. 65s dá margem pra deixar a
                  // extensão terminar sozinha primeiro — de toda forma essa
                  // etapa é só um "bônus" (sync automático de saldo pós-
                  // renovação), sem timeout ou com ele, uma falha aqui
                  // nunca bloqueia a renovação em si (fica só sem atualizar
                  // o saldo na hora).
                  setTimeout(() => {
                    window.removeEventListener(
                      "UNIGESTOR_INTEGRATION_RESPONSE",
                      syncHandler,
                    );
                    resolveSync();
                  }, 65_000);
                });
              } catch {}
            } else {
              // ====================================================================
              // 🔵 RENOVAÇÃO ANTIGA (FAST / NATV) - MANTIDA INTACTA!
              // ====================================================================
              let apiUrl = "";
              if (provider === "FAST")
                apiUrl = "/api/integrations/fast/renew-client";
              else if (provider === "NATV")
                apiUrl = "/api/integrations/natv/renew-client";

              if (!apiUrl)
                throw new Error(
                  `Servidor de integração não suportado: ${provider}`,
                );

              const apiRes = await fetch(apiUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                  tenant_id: tid,
                  integration_id: srv.panel_integration,
                  username: clientData.username,
                  external_user_id:
                    clientData.external_user_id || clientData.username,
                  technology: finalTechnology,
                  months: monthsToRenew,
                }),
              });

              const apiJson = await apiRes.json();

              if (!apiRes.ok || !apiJson.ok) {
                const errorMsg =
                  apiJson.error || "A API do Servidor recusou a renovação.";
                throw new Error(errorMsg);
              }

              const expDateISO = apiJson.data?.exp_date_iso;

              if (expDateISO) {
                apiVencimento = expDateISO;
              }

              if (provider === "NATV" && apiJson.data?.password) {
                apiPassword = apiJson.data.password;
              }

              let syncUrl = "";
              if (provider === "FAST") syncUrl = "/api/integrations/fast/sync";
              else if (provider === "NATV")
                syncUrl = "/api/integrations/natv/sync";

              if (syncUrl) {
                const syncRes = await fetch(syncUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  },
                  body: JSON.stringify({
                    integration_id: srv.panel_integration,
                    tenant_id: tid,
                  }),
                });

                // ✅ FALTAVA: o sync acima só atualiza
                // server_integrations.credits_last_known — servers.credits_available
                // (o que o card de saldo e o alerta de saldo baixo leem) nunca
                // era tocado pela renovação automática. Mesmo passo que
                // novo_servidor.tsx/recarga_servidor.tsx já fazem. Best-effort
                // — não bloqueia a renovação, que já está concluída aqui.
                if (syncRes.ok) {
                  try {
                    const { data: afterSync } = await supabaseBrowser
                      .from("server_integrations")
                      .select("credits_last_known")
                      .eq("id", srv.panel_integration)
                      .eq("tenant_id", tid)
                      .single();

                    if (afterSync?.credits_last_known != null) {
                      await supabaseBrowser.rpc(
                        "update_server_credits_manual",
                        {
                          p_server_id: clientData.server_id,
                          p_new_credits: Number(afterSync.credits_last_known),
                        },
                      );
                    }
                  } catch {}
                }
              }
            }
            // ✅ Buscar nome do servidor
            try {
              const { data: srvData } = await supabaseBrowser
                .from("servers")
                .select("name")
                .eq("id", clientData.server_id)
                .single();

              serverName = srvData?.name || "Servidor";
            } catch {
              serverName = "Servidor";
            }
          }
        } catch (apiErr: any) {
          // ✅ Toast LOCAL (aparece no modal)
          addToast(
            "error",
            "Falha na Renovação Automática",
            apiErr.message || "Não foi possível renovar no servidor.",
          );

          // ✅ Toast na LISTA (aparece depois)
          queueToast(
            "error",
            "Falha na Renovação Automática",
            apiErr.message ||
              "Não foi possível renovar no servidor. Verifique e tente novamente.",
            toastKey,
          );

          // Para a execução (não salva nada se API falhar)
          setLoading(false);
          setLoadingText("Processando..."); // ✅ Reseta texto
          return;
        }
      }

      // --- PASSO 2: ATUALIZAR CLIENTE ---
      setLoadingText("Atualizando cadastro...");

      // ✅ DECISÃO DA DATA E ID EXTERNO
      // Se for apenas conversão (sem registrar log financeiro), o update_client TEM de gravar a data nova.
      // Se registrar financeiro, o update_client não mexe na data (quem mexe é o renew_client_and_log).
      const dateForUpdate = registerPayment
        ? clientData?.vencimento
        : apiVencimento;

      // Garante que o ID externo descoberto pelo Sync é salvo
      const finalExternalId = clientData?.external_user_id || null;

      const updatePayload: any = {
        p_tenant_id: tid,
        p_client_id: clientId,
        p_display_name: nameToSend,
        p_name_prefix: null,
        p_notes: obs || null,
        p_clear_notes: !!clientData?.notes && !obs,
        p_server_id: clientData?.server_id,
        p_server_username: clientData?.username,
        p_server_password: apiPassword,
        p_screens: Number(screens),
        p_plan_label: PLAN_LABELS[selectedPlanPeriod],
        p_plan_table_id: selectedTableId || null,
        p_price_amount: rawPlanPrice,
        p_price_currency: currency as any,
        p_vencimento: dateForUpdate,
        // ✅ Se vier via Auditoria (paymentLogId presente), o cliente está
        // concluindo uma renovação paga pelo portal. Trial deve virar cliente.
        // Em outros fluxos (clientes/trials), mantém a lógica antiga.
        p_is_trial: paymentLogId
          ? false
          : allowConvertWithoutPayment
            ? false
            : null,
        p_whatsapp_opt_in: true,
        p_whatsapp_username: null,
        p_whatsapp_snooze_until: null,
        p_is_archived: false,
        p_technology: finalTechnology,

        // ✅ Prevenção contra erro de "schema cache"
        p_clear_whatsapp_snooze_until: false,
        p_clear_secondary: false,
      };

      // ✅ Atualiza o ID externo no banco caso o Sync da Elite o tenha resgatado (via trigger/RPC ou direto no supabase)
      if (finalExternalId) {
        // Executa um patch silencioso apenas para garantir o ID numérico
        supabaseBrowser
          .from("clients")
          .update({ external_user_id: finalExternalId })
          .eq("id", clientId)
          .then();
      }

      const { error: updateError } = await supabaseBrowser.rpc(
        "update_client",
        updatePayload,
      );

      if (updateError) throw new Error(`Erro Update: ${updateError.message}`);

      // --- PASSO 3: RENOVAR (REGISTRAR PAGAMENTO) ---
      // ⚠️ SÓ chama renew_client_and_log se MANUAL (não automática)
      // ✅ E SÓ CRIA NOVO SE NÃO FOR UMA CONFIRMAÇÃO DE AUDITORIA MANUAL (paymentLogId presente)
      if (registerPayment && !renewAutomatic && !paymentLogId) {
        setLoadingText("Registrando pagamento...");

        // ✅ MENSAGENS SEPARADAS: Uma limpa para o cliente, outra detalhada para o servidor
        const clientMessageManual = `Renovação manual via painel Admin · ${monthsToRenew} mês(es) · ${screens} tela(s) · ${fmtMoney(currency, rawPlanPrice)}`;
        const serverNotesManual = `${nameToSend} (${clientData?.username || "-"})${obs ? ` · ${obs}` : ""}`;

        const { error: renewError } = await supabaseBrowser.rpc(
          "renew_client_and_log",
          {
            p_tenant_id: tid,
            p_client_id: clientId,
            p_months: monthsToRenew,
            p_status: "PAID",
            p_notes: serverNotesManual, // ✅ Vai para a view do SERVIDOR (Com nome e obs)
            p_new_vencimento: saoPauloDateTimeToIso(dueDate, dueTime),
            p_is_automatic: false,
            p_message: clientMessageManual, // ✅ Vai para a linha do tempo do CLIENTE (Sem nome)
            p_unit_price: Number((totalBrl / monthsToRenew).toFixed(2)),
            p_total_amount: totalBrl,
          },
        );
        if (renewError) throw new Error(`Erro Renew: ${renewError.message}`);

        // ✅ 05/09/2026, pedido do Márcio: renovação manual avulsa (não veio
        // de uma pendência do Log do Portal) também vira uma linha lá —
        // "Banco" = PIX (Manual)/Revolut (Manual) conforme a moeda do
        // cliente, já nasce Aprovado (Manual) + Concluído (Manual), porque
        // o pagamento e a renovação já aconteceram de verdade acima.
        const { data: loggedId, error: logErr } = await supabaseBrowser.rpc(
          "log_manual_renewal_payment",
          {
            p_tenant_id: tid,
            p_client_id: clientId,
            p_price_amount: rawPlanPrice,
            p_price_currency: currency,
            p_period: selectedPlanPeriod,
            p_plan_label: PLAN_LABELS[selectedPlanPeriod],
            p_new_vencimento: apiVencimento,
            p_whatsapp_status: willAttemptWhatsapp ? null : "na",
          },
        );
        if (!logErr && loggedId) {
          newPortalLogId = loggedId as string;
        } else if (logErr) {
          // ✅ Não bloqueia a renovação (já aconteceu de verdade acima) —
          // só avisa que o registro no Log do Portal falhou, pra não passar
          // batido em silêncio.
          console.error("[recarga_cliente] log_manual_renewal_payment falhou", logErr.message);
          addToast(
            "warning",
            "Renovado, mas sem registro no Log do Portal",
            "A renovação foi concluída normalmente, mas não foi possível gravar essa transação na Auditoria.",
          );
        }
      }

      // ✅ NOVO: servidor SEM integração (ex: UniGestor), concluído manualmente
      // pela Auditoria (paymentLogId presente). Esse caso nunca era coberto —
      // faltava exatamente essa combinação, e por isso o crédito nunca era
      // consumido nem o histórico gravado.
      if (registerPayment && !renewAutomatic && paymentLogId) {
        setLoadingText("Registrando renovação manual...");

        const clientMessageManualAud = `Renovação manual via Portal do Cliente · ${monthsToRenew} mês(es) · ${screens} tela(s) · ${fmtMoney(currency, rawPlanPrice)}`;
        const serverNotesManualAud = `${nameToSend} (${clientData?.username || "-"})${obs ? ` · ${obs}` : ""}`;

        const { error: renewErrorAud } = await supabaseBrowser.rpc(
          "renew_client_and_log",
          {
            p_tenant_id: tid,
            p_client_id: clientId,
            p_months: monthsToRenew,
            p_status: "PAID",
            p_notes: serverNotesManualAud,
            p_new_vencimento: saoPauloDateTimeToIso(dueDate, dueTime),
            p_is_automatic: false,
            p_message: clientMessageManualAud,
            p_unit_price: Number((totalBrl / monthsToRenew).toFixed(2)),
            p_total_amount: totalBrl,
          },
        );
        if (renewErrorAud)
          throw new Error(`Erro Renew: ${renewErrorAud.message}`);
      }

      // ✅ Se automático, registra LOG + client_renewals
      if (registerPayment && renewAutomatic) {
        setLoadingText("Registrando renovação...");

        // ✅ MENSAGENS SEPARADAS: Uma limpa para o cliente, outra detalhada para o servidor
        const clientMessageAuto = `Renovação automática via painel Admin · ${monthsToRenew} mês(es) · ${screens} tela(s) · ${fmtMoney(currency, rawPlanPrice)}`;
        const serverNotesAuto = `${nameToSend} (${clientData?.username || "-"})${obs ? ` · ${obs}` : ""}`;

        // ✅ NOVO: registra em client_renewals igual ao manual
        const { error: renewError } = await supabaseBrowser.rpc(
          "renew_client_and_log",
          {
            p_tenant_id: tid,
            p_client_id: clientId,
            p_months: monthsToRenew,
            p_status: "PAID",
            p_notes: serverNotesAuto, // ✅ Vai para a view do SERVIDOR (Com nome e obs)
            p_new_vencimento: apiVencimento,
            p_is_automatic: true, // ✅ CRÍTICO: Faltava essa flag aqui para não quebrar a assinatura no banco!
            p_message: clientMessageAuto, // ✅ Vai para a linha do tempo do CLIENTE (Sem nome)
            p_unit_price: Number((totalBrl / monthsToRenew).toFixed(2)),
            p_total_amount: totalBrl,
          },
        );
        if (renewError) throw new Error(`Erro Renew: ${renewError.message}`);

        // ✅ 05/09/2026: mesma lógica do bloco manual acima — só grava linha
        // nova no Log do Portal quando NÃO é a conclusão de uma pendência já
        // existente (paymentLogId ausente). Cobre exatamente o caso da tela
        // (Renovação Automática ligada + Método PIX, pago por fora).
        if (!paymentLogId) {
          const { data: loggedId, error: logErr } = await supabaseBrowser.rpc(
            "log_manual_renewal_payment",
            {
              p_tenant_id: tid,
              p_client_id: clientId,
              p_price_amount: rawPlanPrice,
              p_price_currency: currency,
              p_period: selectedPlanPeriod,
              p_plan_label: PLAN_LABELS[selectedPlanPeriod],
              p_new_vencimento: apiVencimento,
              p_whatsapp_status: willAttemptWhatsapp ? null : "na",
            },
          );
          if (!logErr && loggedId) {
            newPortalLogId = loggedId as string;
          } else if (logErr) {
            console.error("[recarga_cliente] log_manual_renewal_payment falhou", logErr.message);
            addToast(
              "warning",
              "Renovado, mas sem registro no Log do Portal",
              "A renovação foi concluída normalmente, mas não foi possível gravar essa transação na Auditoria.",
            );
          }
        }
      }

      // ✅ NOVO: verifica o saldo do servidor direto no banco (sem depender de sync
      // externo) e atualiza a notificação de saldo baixo — cria se está baixo,
      // resolve se subiu
      if (clientData?.server_id) {
        try {
          await supabaseBrowser.rpc("check_and_notify_low_credits", {
            p_tenant_id: tid,
            p_server_id: clientData.server_id,
          });
        } catch {}
      }

      // --- PASSO 4: ENVIAR WHATSAPP ---
      if (sendWhats && messageContent && messageContent.trim()) {
        setLoadingText("Enviando WhatsApp...");

        try {
          const { data: session } = await supabaseBrowser.auth.getSession();
          const token = session.session?.access_token;

          // ✅ BUSCA O TEMPLATE INTEIRO PARA PEGAR A IMAGEM (se foi escolhido um modelo)
          let imageUrlToSend = null;
          let finalMessage = messageContent;
          if (selectedTemplateId) {
            const tpl = templates.find((t) => t.id === selectedTemplateId);
            if (tpl && tpl.image_url) {
              imageUrlToSend = tpl.image_url;
            }

            // ✅ Sorteia entre o texto do template e as variantes cadastradas
            // (mesma estratégia anti-detecção usada no billing automático e
            // no fulfillment do portal) — sem variantes, envia o original.
            const { data: variants } = await supabaseBrowser
              .from("message_template_variants")
              .select("content")
              .eq("tenant_id", tid)
              .eq("template_id", selectedTemplateId);
            const pool = [
              tpl?.content,
              ...(variants || []).map((v: any) => v.content),
            ].filter((c): c is string => !!c && String(c).trim().length > 0);
            if (pool.length > 0) {
              finalMessage = pool[Math.floor(Math.random() * pool.length)];
            }
          }

          const res = await fetch("/api/whatsapp/envio_agora", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tenant_id: tid,
              client_id: clientId,
              message: finalMessage,
              message_template_id: selectedTemplateId || null, // Opcional, para histórico
              image_url: imageUrlToSend, // ✅ ENVIA A IMAGEM AQUI!
              whatsapp_session: selectedSession, // ✅ Usando a sessão escolhida
            }),
          });

          if (!res.ok) throw new Error("API retornou erro");

          // ✅ Atualiza via RPC (RLS bloqueia UPDATE direto no client_portal_payments pelo browser)
          // — usa paymentLogId (pendência já existente) ou newPortalLogId
          // (linha nova gravada acima, renovação avulsa) — nunca os dois.
          const waLogId = paymentLogId || newPortalLogId;
          if (waLogId) {
            const { error: waUpErr } = await supabaseBrowser.rpc(
              "update_whatsapp_status",
              {
                p_log_id: waLogId,
                p_tenant_id: tid,
                p_status: "sent",
              },
            );
            // ✅ NOVO: resolve a notificação de falha de WhatsApp, se existir
            try {
              await supabaseBrowser.rpc("resolve_notification", {
                p_tenant_id: tid,
                p_type: "whatsapp_falha",
                p_source_id: waLogId,
              });
            } catch {}
          }

          // ✅ Usa queueToast para garantir que apareça na lista de clientes após o modal fechar
          queueToast(
            "success",
            "Mensagem enviada",
            "Comprovante entregue no WhatsApp.",
            toastKey,
          );
        } catch {
          // ✅ Atualiza via RPC (RLS bloqueia UPDATE direto no client_portal_payments pelo browser)
          const waLogIdErr = paymentLogId || newPortalLogId;
          if (waLogIdErr) {
            const { error: waUpErr } = await supabaseBrowser.rpc(
              "update_whatsapp_status",
              {
                p_log_id: waLogIdErr,
                p_tenant_id: tid,
                p_status: "error",
              },
            );
          }

          queueToast(
            "error",
            "Erro no envio",
            "Renovado, mas o WhatsApp falhou.",
            toastKey,
          );
        }
      }

      // --- FIM ---
      setLoadingText("Concluído!");

      // ✅ NOVO: resolve as notificações do sino ligadas a este pagamento
      // (tenta os dois tipos possíveis — o que não bater simplesmente não encontra linha)
      if (paymentLogId) {
        try {
          await supabaseBrowser.rpc("resolve_notification", {
            p_tenant_id: tid,
            p_type: "manual_pending",
            p_source_id: paymentLogId,
          });
          await supabaseBrowser.rpc("resolve_notification", {
            p_tenant_id: tid,
            p_type: "transfer_aguardando",
            p_source_id: paymentLogId,
          });
        } catch {}
      }

      // ✅ Toast final baseado no tipo de operação
      if (renewAutomatic) {
        const isConversion = Boolean(allowConvertWithoutPayment);
        const title = isConversion
          ? `Cliente convertido e renovado no ${serverName}`
          : `Cliente renovado no ${serverName}`;
        const description = isConversion
          ? "Conversão e renovação automática registrada com sucesso."
          : "Renovação automática registrada com sucesso.";

        queueToast("success", title, description, toastKey);
      } else {
        queueToast(
          "success",
          `Cliente renovado manualmente`,
          "Renovação manual registrada com sucesso.",
          toastKey,
        );
      }

      // ✅ Quita as pendências financeiras junto, se marcado
      if (settlePendingCharges && pendingChargesForClient.length) {
        try {
          await supabaseBrowser
            .from("client_alerts")
            .update({ status: "CLOSED", closed_at: new Date().toISOString() })
            .in(
              "id",
              pendingChargesForClient.map((p) => p.id),
            )
            .eq("status", "OPEN");
        } catch {
          // não bloqueia o fluxo principal por causa disso
        }
      }

      // ✅ Se o pagamento concluído manualmente (Auditoria) tinha cupom
      // aplicado, grava o resgate e desativa cupom pessoal — mesmo efeito
      // que o fluxo automático já faz em lib/client-portal/fulfillment.ts.
      // coupon_redemptions só aceita escrita via service_role, por isso
      // passa por uma rota de API em vez de update direto (igual ao
      // client_alerts acima).
      const paymentLogCoupon = paymentLogCouponRef.current;
      if (
        paymentLogCoupon?.coupon_id &&
        Number(paymentLogCoupon.coupon_discount_amount) > 0
      ) {
        try {
          const { data: session } = await supabaseBrowser.auth.getSession();
          const token = session.session?.access_token;
          await fetch("/api/admin/coupons/redeem-manual", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tenant_id: tid,
              coupon_id: paymentLogCoupon.coupon_id,
              client_id: clientId,
              payment_id: paymentLogId || null,
              discount_amount: paymentLogCoupon.coupon_discount_amount,
              currency: paymentLogCoupon.price_currency || currency,
            }),
          });
        } catch {
          // não bloqueia o fluxo principal por causa disso
        }
      }

      setTimeout(async () => {
        // ✅ Avisa a Auditoria qual ID foi concluído e AGUARDA ela salvar no banco
        // (paymentLogId numa conclusão de pendência já existente, ou
        // newPortalLogId na linha nova criada acima pra uma renovação avulsa)
        await onSuccess(paymentLogId || newPortalLogId);
        onClose(); // Só destrói o modal depois que a auditoria terminar
      }, 500);
    } catch (err: any) {
      addToast("error", "Erro ao salvar", err.message || "Falha desconhecida");
      setLoading(false);
      isSavingRef.current = false; // ✅ Destranca se der erro para permitir tentar novamente
    }
  };

  if (fetching || !mounted) return null; // ✅ Aguarda montagem

  const isFromTrial = Boolean(allowConvertWithoutPayment);
  const headerTitle = isFromTrial
    ? "Converter em Assinante"
    : "Renovação de Assinatura";

  // ✅ Wrap com createPortal para renderizar no document.body
  return createPortal(
    <>
      {/* --- MODAL PRINCIPAL --- */}
      <div
        className="fixed inset-0 z-[99990] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-hidden overscroll-contain"
        onPointerDown={(e) => {
          // Só fecha se começar o clique exatamente no fundo escuro
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="w-full max-w-3xl bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden min-h-0 max-h-[90vh] transition-all animate-in fade-in zoom-in-95 duration-200"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* HEADER (MANTÉM IGUAL) */}
          <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent rounded-t-xl shrink-0">
            {/* ... conteúdo do header ... */}
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${isFromTrial ? "bg-sky-500/10 text-sky-500" : "bg-emerald-500/10 text-emerald-500"}`}
              >
                {isFromTrial ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                )}
              </div>
              <div>
                <h2 className="text-base font-medium text-foreground leading-tight">
                  {headerTitle}
                </h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-medium">
                    {clientData
                      ? `${clientData.username || "—"} (${clientData.server_name || "—"})`
                      : clientName}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <IconX />
            </button>
          </div>

          {/* BODY - ✅ Espaçamento Reduzido (p-3 sm:p-4) */}
          <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-y-auto overscroll-contain custom-scrollbar flex-1 min-h-0">
            {/* 1. SEÇÃO VENCIMENTO */}
            <div className="bg-transparent border border-border rounded-xl p-3">
              {/* ... (Conteúdo igual, inputs já estão bons) ... */}
              <div className="flex items-center gap-2 mb-3 border-b border-border pb-2">
                <span className="text-emerald-500">📅</span>
                <span className="text-xs font-medium uppercase text-muted-foreground tracking-wider">
                  Novo Vencimento
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Data do Vencimento</Label>
                  <DateInputBR value={dueDate} onChange={setDueDate} />
                </div>
                <div>
                  <Label>Hora Limite</Label>
                  <div className="flex gap-2">
                    <FormattedTimeInput
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="flex-1 text-sm font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setDueTime("23:59")}
                      className="px-3 h-10 rounded-lg bg-muted border border-border text-xs font-medium text-muted-foreground hover:text-emerald-500 hover:border-emerald-500/50 transition-all"
                    >
                      23:59
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. SEÇÃO PLANO & FINANCEIRO (Unificado Visualmente ou Estilo Card NovoCliente) */}
            <div className="bg-muted/40 border border-border rounded-xl p-3 sm:p-4 space-y-4">
              {/* 3. SEÇÃO FINANCEIRO */}
              <div className="bg-card border border-border rounded-xl p-3 sm:p-4 shadow-sm">
                {/* HEADER FINANCEIRO - ✅ IGUAL NOVO CLIENTE */}
                <div className="flex justify-between items-center gap-3 border-b border-border pb-3 mb-3">
                  <span className="text-xs font-medium uppercase text-emerald-400 flex items-center gap-1">
                    💰 Financeiro
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">
                      Tabela:
                    </span>
                    <select
                      value={selectedTableId}
                      onChange={(e) => {
                        tableChangedByUserRef.current = true;
                        setSelectedTableId(e.target.value);
                      }}
                      className="h-6 w-[160px] px-2 bg-transparent border border-border rounded text-xs font-medium text-foreground/90 outline-none cursor-pointer hover:border-emerald-500/50 transition-all truncate"
                    >
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {formatTableLabel(t)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* GRID DE PLANOS */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <Label>Período</Label>
                  <Select
                    value={selectedPlanPeriod}
                    onChange={(e) => setSelectedPlanPeriod(e.target.value)}
                  >
                    {Object.entries(PLAN_LABELS)
                      .filter(([k]) => {
                        // ✅ TRAVA NA UI: Se for Elite, esconde a opção Anual
                        if (isEliteProvider && k === "ANNUAL") return false;
                        return true;
                      })
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                  </Select>
                </div>
                <div>
                  <Label>Telas</Label>
                  <Input
                    type="number"
                    min={1}
                    value={screens}
                    onChange={(e) => {
                      const val = e.target.value;
                      setScreens(
                        val === "" ? ("" as any) : Math.max(1, Number(val)),
                      );
                    }}
                    onBlur={() => {
                      if (!screens || Number(screens) < 1) setScreens(1);
                    }}
                  />
                </div>
                <div>
                  <Label>Créditos</Label>
                  <div className="h-10 w-full bg-sky-500/10 border border-sky-500/20 rounded-lg flex items-center justify-center text-sm font-medium text-sky-500">
                    {creditsInfo ? creditsInfo.used : "-"}
                  </div>
                </div>
              </div>

              {/* GRID DE VALORES */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Moeda</Label>
                  <div className="h-10 w-full bg-transparent border border-border rounded-lg flex items-center justify-center text-sm font-medium text-foreground/90">
                    {currency}
                  </div>
                </div>
                <div className="col-span-2">
                  <Label>Valor a Cobrar</Label>
                  <Input
                    value={planPrice}
                    onChange={(e) => {
                      setPlanPrice(e.target.value);
                      setPriceTouched(true);
                    }}
                    className="text-right font-medium text-foreground text-lg tracking-tight"
                    placeholder="0,00"
                  />
                </div>
              </div>

              {/* CÂMBIO (Se houver) */}
              {showFx && (
                <div className="p-3 bg-sky-500/10 rounded-lg border border-sky-500/20 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Câmbio</Label>
                    <input
                      type="number"
                      step="0.0001"
                      value={Number(fxRate || 0).toFixed(4)}
                      onChange={(e) => setFxRate(Number(e.target.value))}
                      className="w-full h-9 px-3 bg-transparent border border-sky-500/20 rounded text-sm outline-none focus:border-sky-500/50 text-foreground transition-colors"
                    />
                  </div>
                  <div>
                    <Label>Total BRL</Label>
                    <div className="w-full h-9 flex items-center justify-center bg-emerald-500/20 border border-emerald-500/20 rounded text-emerald-500 font-medium">
                      {fmtMoney("BRL", totalBrl)}
                    </div>
                  </div>
                </div>
              )}

              {/* BOTÃO REGISTRAR PAGAMENTO */}
              {Boolean(allowConvertWithoutPayment) && (
                <div
                  onClick={() => setRegisterPayment(!registerPayment)}
                  className={`cursor-pointer p-2.5 rounded-lg border transition-all flex items-center justify-between ${registerPayment ? "bg-emerald-500/10 border-emerald-500/20" : "bg-muted/50 border-border"}`}
                >
                  <span
                    className={`text-xs font-medium ${registerPayment ? "text-emerald-500" : "text-muted-foreground"}`}
                  >
                    Registrar Pagamento?
                  </span>
                  <Switch
                    checked={registerPayment}
                    onChange={setRegisterPayment}
                    label=""
                  />
                </div>
              )}

              {registerPayment && (
                <div className="bg-transparent p-3 rounded-lg border border-border animate-in slide-in-from-top-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Método</Label>
                      <Select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                      >
                        <option value="PIX">PIX</option>
                        <option value="Dinheiro">Dinheiro</option>
                        <option value="Cartão">Cartão</option>
                      </Select>
                    </div>
                    <div>
                      <Label>Data Pagto</Label>
                      <FormattedDateInput
                        type="datetime-local"
                        value={payDate}
                        onChange={(e) => setPayDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 4. OUTROS + OBS */}
            <div className="space-y-3">
              {/* ... (Bloco de Tecnologia e Notificação mantém, mas com gap-3 e labels ajustados) ... */}
              {/* ✅ TOGGLE RENOVAÇÃO AUTOMÁTICA (Cliente + Teste) */}
              <div
                onClick={() =>
                  hasIntegration && setRenewAutomatic(!renewAutomatic)
                }
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  renewAutomatic
                    ? "bg-emerald-500/10 border-emerald-500/20"
                    : "bg-muted/50 border-border"
                } ${!hasIntegration ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {renewAutomatic ? "🔄" : "📝"}
                    </span>
                    <div>
                      <span
                        className={`text-xs font-medium block ${renewAutomatic ? "text-emerald-500" : "text-muted-foreground"}`}
                      >
                        Renovação Automática
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {hasIntegration
                          ? "Sincronizar com servidor"
                          : "Servidor sem integração"}
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={renewAutomatic}
                    onChange={(v) => hasIntegration && setRenewAutomatic(v)}
                    label=""
                  />
                </div>
              </div>

              <div
                className={`grid grid-cols-1 ${sendWhats ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3 items-end`}
              ></div>

              {/* Pendências financeiras em aberto — oferece quitar junto */}
              {pendingChargesForClient.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-500">
                      ⚠️ Pendência em aberto
                    </span>
                    <Switch
                      checked={settlePendingCharges}
                      onChange={setSettlePendingCharges}
                      label=""
                    />
                  </div>
                  <div className="space-y-1">
                    {pendingChargesForClient.map((p) => (
                      <div
                        key={p.id}
                        className="flex justify-between text-xs text-muted-foreground"
                      >
                        <span>
                          {p.appName ? `Ativação: ${p.appName}` : p.message}
                        </span>
                        <span className="font-semibold text-foreground">
                          {fmtMoney(currency, p.convertedAmount)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {settlePendingCharges
                      ? "Será marcada como quitada ao salvar esta recarga."
                      : "Não será quitada — continua em aberto."}
                  </p>
                </div>
              )}

              {/* WhatsApp: Toggle, Modelo e Sessão */}
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                  {/* Botão de Ligar/Desligar Envio */}
                  <div
                    onClick={() => setSendWhats(!sendWhats)}
                    className="h-10 px-3 bg-muted/50 border border-border rounded-lg cursor-pointer hover:bg-muted transition-colors flex items-center justify-between"
                  >
                    <span className="text-[11px] font-medium text-muted-foreground tracking-tight">
                      Enviar Mensagem?
                    </span>
                    <Switch
                      checked={sendWhats}
                      onChange={setSendWhats}
                      label=""
                    />
                  </div>

                  {/* Seletor de Modelo (Na mesma linha do Toggle no Mobile) */}
                  {sendWhats && (
                    <div className="animate-in fade-in zoom-in duration-200 col-span-1 sm:col-span-1">
                      <Label>Mensagem pronta</Label>
                      <Select
                        value={selectedTemplateId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setSelectedTemplateId(id);
                          const tpl = templates.find((t) => t.id === id);
                          if (tpl) setMessageContent(tpl.content);
                        }}
                      >
                        <option value="">-- Manual --</option>
                        {Object.entries(
                          templates
                            // ✅ Trava de Revenda Removida! Mostra tudo.
                            .reduce(
                              (acc, t) => {
                                const cat = t.category || "Geral";
                                if (!acc[cat]) acc[cat] = [];
                                acc[cat].push(t);
                                return acc;
                              },
                              {} as Record<string, typeof templates>,
                            ),
                        ).map(([catName, tmpls]) => (
                          // 3. Renderiza com os separadores visuais
                          <optgroup key={catName} label={`— ${catName} —`}>
                            {tmpls.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                    </div>
                  )}

                  {/* Seletor de Sessão (No Desktop fica do lado, no Mobile vai pra baixo) */}
                  {sendWhats && (
                    <div className="animate-in fade-in zoom-in duration-200 col-span-2 sm:col-span-1">
                      <Label>Sessão WhatsApp</Label>
                      <Select
                        value={selectedSession}
                        onChange={(e) => setSelectedSession(e.target.value)}
                      >
                        {sessionOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>
              </div>

              {/* OBSERVAÇÕES */}
              <div>
                <Label>Observações (Internas)</Label>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  className="w-full h-16 px-2.5 py-2 bg-transparent border border-border rounded-lg text-[13px] text-foreground outline-none focus:border-emerald-500/50 resize-none transition-all"
                  placeholder="Nota interna sobre esta renovação..."
                />
              </div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-border bg-transparent flex justify-end gap-3 sm:rounded-b-xl shrink-0">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-border text-muted-foreground font-medium text-sm hover:bg-muted transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePreCheck();
              }}
              disabled={loading}
              className="px-8 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 disabled:opacity-80 disabled:cursor-not-allowed transition-all flex items-center gap-2 min-w-[160px] justify-center"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {/* ✅ Texto Dinâmico */}
                  {loadingText}
                </>
              ) : (
                <>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {Boolean(allowConvertWithoutPayment) && !registerPayment
                    ? "Converter"
                    : "Confirmar"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ✅ Confirm Dialog Global */}
      {ConfirmUI}

      <div className="fixed inset-x-0 top-2 z-[999999] px-3 sm:px-6 pointer-events-none">
        <div className="pointer-events-auto">
          <ToastNotifications
            toasts={toasts}
            removeToast={(id) => setToasts((p) => p.filter((t) => t.id !== id))}
          />
        </div>
      </div>
    </>,
    document.body, // ✅ Alvo do Portal
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[9px] font-medium text-muted-foreground mb-0.5 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-9 px-2 bg-transparent border border-border rounded-lg text-[13px] text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors dark:[color-scheme:dark] ${className}`}
    />
  );
}

function DateInputBR({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Converte yyyy-mm-dd → dd/mm/aaaa para exibir
  const toDisplay = (iso: string) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  // Converte dd/mm/aaaa → yyyy-mm-dd para o estado
  const toISO = (br: string) => {
    const clean = br.replace(/\D/g, "");
    const d = clean.slice(0, 2);
    const m = clean.slice(2, 4);
    const y = clean.slice(4, 8);
    if (y.length === 4) return `${y}-${m}-${d}`;
    return "";
  };

  const [display, setDisplay] = useState(toDisplay(value));

  useEffect(() => {
    setDisplay(toDisplay(value));
  }, [value]);

  return (
    <input
      type="text"
      value={display}
      maxLength={10}
      placeholder="DD/MM/AAAA"
      onChange={(e) => {
        let v = e.target.value.replace(/\D/g, "");
        if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
        if (v.length > 5) v = v.slice(0, 5) + "/" + v.slice(5);
        setDisplay(v);
        const iso = toISO(v);
        if (iso) onChange(iso);
      }}
      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-foreground outline-none focus:border-emerald-500/50 transition-colors text-sm font-medium"
    />
  );
}

function Select({
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-9 px-2 bg-transparent border border-border rounded-lg text-[13px] text-foreground/90 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function IconX() {
  return <X className="w-4 h-4" />;
}
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-foreground/90">{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={`relative w-12 h-7 rounded-full transition-colors border ${
          checked
            ? "bg-emerald-600 border-emerald-600"
            : "bg-muted border-border"
        }`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-card transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
