"use client";
// app/admin/auditoria/page.tsx
import { X } from "lucide-react";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AplicativosLog from "./AplicativosLog";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";
import ToastNotifications, {
  ToastMessage,
} from "@/hooks/ToastNotifications";
import { EyeToggle } from "@/components/ui/eye-toggle";

// ✅ Importa os modais de recarga
import RecargaCliente from "../cliente/recarga_cliente";
import Pagination from "@/components/ui/Pagination";

// --- TIPOS ---
type LogRow = {
  id: string;
  created_at: string;
  client_id: string;
  client_name: string;
  server_username: string;
  server_name: string;
  screens: number;
  payment_method: string;
  payment_status: string;
  fulfillment_status: string;
  fulfillment_error: string | null;
  whatsapp_status: string | null;
  price_amount: number;
  price_currency: string;
  period: string;
  plan_label: string | null;
  gateway_name: string;
  mp_payment_id: string | null; // ✅ Adicionado
  technology: string; // ✅ Adicionado para controlar qual modal de recarga abrir
  // ✅ Resumo do valor (cupom/pendência) — só preenchido quando o pagamento
  // não é "só assinatura" (ver breakdownLines mais abaixo).
  coupon_code: string | null;
  coupon_discount_amount: number | null;
  pendencies: { label: string; amount: number }[];
};

function fmtMoney(amount: number, currency: string = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
}

/** Extrai o nome do app da mensagem padrão `Ativação: "Nome" - dia DD/MM/AAAA` — cai pra mensagem crua se não bater (formato antigo). */
function pendencyLabelFromMessage(message: string | null): string {
  const m = String(message || "").match(/^Ativação:\s*"(.+?)"/);
  if (m) return m[1];
  return String(message || "").trim() || "Pendência";
}

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

// --- OPÇÕES DE FILTRO (só aparecem no select se houver ao menos 1 registro) ---
const FULFILLMENT_OPTIONS = [
  { value: "done", label: "Concluídos (Auto)" },
  { value: "manual_done", label: "Concluídos Manualmente" },
  { value: "manual_pending", label: "Ação Manual (Pendentes)" },
  { value: "error", label: "Erros na Renovação" },
  { value: "stuck", label: "Travada (sem retorno)" },
  { value: "aguardando_pagamento", label: "Aguardando Pagamento" },
  { value: "awaiting_transfer", label: "Aguardando Transferência" },
  { value: "cancelled", label: "Cancelada" },
  { value: "manual_cancelled", label: "Cancelada Manualmente" },
  { value: "processando", label: "Processando" },
];

// Pagamento aprovado cujo fulfillment nunca terminou nem gerou erro — o
// webhook do MP e o polling do navegador (payment-status) são as ÚNICAS
// coisas que disparam a renovação automática; se os dois falharem (cliente
// fecha a aba logo após pagar, webhook atrasa/não chega), o pagamento fica
// com fulfillment_status "pending"/"processing" pra sempre, indistinguível
// de um pagamento processando normalmente há 2 segundos. Achado em
// auditoria 24/07/2026. 10min de folga é bem mais que o tempo normal de
// fulfillment (segundos) e mais que a janela de "zumbi" do lock (3min).
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

function isStuckFulfillment(status: string, paymentStatus: string, createdAt: string): boolean {
  const isApproved =
    paymentStatus === "approved" || paymentStatus === "PAGO" || paymentStatus === "manual_approved";
  if (!isApproved) return false;
  const st = String(status || "").toLowerCase();
  if (st !== "pending" && st !== "processing" && st !== "") return false;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs > STUCK_THRESHOLD_MS;
}

// ✅ Mesma prioridade de regras usada em getFulfillmentBadge — filtro e badge
// nunca mais podem discordar (ex: pagamento recusado sempre vira "Cancelada",
// mesmo que a coluna fulfillment_status ainda esteja com um valor antigo/"pending").
function getFulfillmentBucket(status: string, paymentStatus: string, createdAt: string): string {
  if (status === "manual_cancelled") return "manual_cancelled";
  if (status === "cancelled" || paymentStatus === "rejected" || paymentStatus === "cancelled")
    return "cancelled";
  if (status === "awaiting_transfer") return "awaiting_transfer";
  if (
    paymentStatus !== "approved" &&
    paymentStatus !== "PAGO" &&
    paymentStatus !== "manual_approved"
  )
    return "aguardando_pagamento";
  if (status === "done") return "done";
  if (status === "manual_done") return "manual_done";
  if (status === "manual_pending") return "manual_pending";
  if (status === "error") return "error";
  if (isStuckFulfillment(status, paymentStatus, createdAt)) return "stuck";
  return "processando";
}

const PAYMENT_OPTIONS = [
  { value: "aprovado", label: "Aprovado" },
  { value: "aprovado_manual", label: "Aprovado Manualmente" },
  { value: "pendente", label: "Pendente" },
  { value: "renovacao_manual", label: "Renovação Manual" },
  { value: "recusado", label: "Recusado" },
];

const WHATSAPP_OPTIONS = [
  { value: "sent", label: "Enviado" },
  { value: "error", label: "Erro" },
  { value: "aguardando", label: "Aguardando" },
  { value: "na", label: "Não se aplica" },
];

function matchesFulfillment(r: LogRow, value: string) {
  return getFulfillmentBucket(r.fulfillment_status, r.payment_status, r.created_at) === value;
}

function matchesPayment(r: LogRow, value: string) {
  const isApproved = r.payment_status === "approved" || r.payment_status === "PAGO";
  const isManualApproved = r.payment_status === "manual_approved";
  const isRejected = r.payment_status === "rejected" || r.payment_status === "cancelled";
  const isManualPending = r.payment_status === "pending" && r.payment_method === "manual";
  const isPending = r.payment_status === "pending" && r.payment_method !== "manual";
  if (value === "aprovado") return isApproved;
  if (value === "aprovado_manual") return isManualApproved;
  if (value === "recusado") return isRejected;
  if (value === "renovacao_manual") return isManualPending;
  if (value === "pendente") return isPending;
  return false;
}

function matchesWhatsapp(r: LogRow, value: string) {
  const isApprovedPayment =
    r.payment_status === "approved" ||
    r.payment_status === "PAGO" ||
    r.payment_status === "manual_approved";
  const isCancelledFulfillment =
    r.fulfillment_status === "manual_cancelled" ||
    r.fulfillment_status === "cancelled";
  const isDoneFulfillment =
    r.fulfillment_status === "done" || r.fulfillment_status === "manual_done";
  const eligible = isApprovedPayment && !isCancelledFulfillment && isDoneFulfillment;
  if (value === "sent") return r.whatsapp_status === "sent";
  if (value === "error") return r.whatsapp_status === "error";
  if (value === "aguardando")
    return eligible && r.whatsapp_status !== "sent" && r.whatsapp_status !== "error";
  if (value === "na") return !eligible;
  return false;
}

// --- ICONES ---

function IconX() {
  return <X className="w-4 h-4" />;
}
function IconCheckCircle() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function AuditoriaPageContent() {
  const searchParams = useSearchParams();
  // ✅ Toggle IPTV (log de pagamentos, existente) / Aplicativos (pedidos de
  // configuração manual do Bloco 3, novo) — mesmo padrão visual do toggle
  // do Dashboard (app/admin/dashboard-filter.tsx), mas local a esta página
  // (não navega, só troca o que renderiza). Aceita ?view=aplicativos pra
  // abrir direto nessa aba (usado pelo link da notificação do sino).
  const [activeLogView, setActiveLogView] = useState<"iptv" | "aplicativos">(
    searchParams.get("view") === "aplicativos" ? "aplicativos" : "iptv",
  );
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true); // Filtros
  const [search, setSearch] = useState("");
  const [filterFulfillment, setFilterFulfillment] = useState("Todos");
  const [filterPayment, setFilterPayment] = useState("Todos");
  const [filterGateway, setFilterGateway] = useState("Todos");
  const [filterWhatsapp, setFilterWhatsapp] = useState("Todos");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Paginação
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25); // ✅ agora editável, independente da busca

  const { confirm, ConfirmUI } = useConfirm();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // ✅ NOVO: id do pagamento sendo reprocessado agora (botão "Reprocessar")
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  // ✅ NOVO: Estado para abrir o modal de renovação
  const [renewState, setRenewState] = useState<{
    logId: string;
    clientId: string;
    clientName: string;
    wasAwaitingTransfer: boolean; // true = pagamento manual real (transferência); false = só o fulfillment é manual (ex: Elite)
  } | null>(null);

  function addToast(
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      5000,
    );
  }

  // ✅ NOVO: contador vermelho no toggle "📱 Aplicativos" — quantos pedidos
  // pendentes existem, mesmo que a aba não esteja aberta agora (senão o
  // admin só descobre que tem pendência abrindo a aba por acaso).
  const [appRequestsPendingCount, setAppRequestsPendingCount] = useState(0);

  async function loadAppRequestsPendingCount(tid: string) {
    const { count } = await supabaseBrowser
      .from("client_app_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .eq("status", "pending");
    setAppRequestsPendingCount(count || 0);
  }

  async function loadData(searchTerm = "") {
    setLoading(true);
    try {
      const tid = await getCurrentTenantId();
      setTenantId(tid);
      if (tid) loadAppRequestsPendingCount(tid);

      if (tid) {
        // 1. Busca os logs exatos de pagamento
        let query = supabaseBrowser
          .from("client_portal_payments")
          .select(
            "id, created_at, client_id, payment_method, status, fulfillment_status, fulfillment_error, price_amount, price_currency, period, plan_label, gateway_type, mp_payment_id, whatsapp_status, coupon_code, coupon_discount_amount, settled_alert_ids",
          ) // ✅ Adicionado whatsapp_status, coupon_code/coupon_discount_amount, settled_alert_ids (resumo do valor)
          .eq("tenant_id", tid)
          .order("created_at", { ascending: false })
          .limit(50); // ✅ traz mais histórico; o pageSize é quem decide quanto aparece por vez

        if (searchTerm) {
          const term = searchTerm.trim();
          const { data: matchedClients } = await supabaseBrowser
            .from("clients")
            .select("id")
            .eq("tenant_id", tid)
            .or(`display_name.ilike.%${term}%,server_username.ilike.%${term}%`);

          if (matchedClients && matchedClients.length > 0) {
            const matchedIds = matchedClients.map((c) => c.id);
            query = query.or(
              `client_id.in.(${matchedIds.join(",")}),gateway_type.ilike.%${term}%`,
            );
          } else {
            query = query.ilike("gateway_type", `%${term}%`);
          }
        }

        const { data: paymentsData, error } = await query;
        if (error) throw error;

        // 2. Extrai clientes e busca dados completos (incluindo telas e ID do servidor)
        const clientIds = [
          ...new Set((paymentsData || []).map((p: any) => p.client_id)),
        ].filter(Boolean);
        const clientsMap: Record<string, any> = {};

        if (clientIds.length > 0) {
          const { data: clientsData } = await supabaseBrowser
            .from("clients")
            .select(
              "id, display_name, server_username, server_id, screens, technology",
            ) // ✅ Adicionado technology
            .in("id", clientIds)
            .eq("tenant_id", tid);

          if (clientsData) {
            clientsData.forEach((c: any) => {
              clientsMap[c.id] = c;
            });
          }
        }

        // 3. Puxa a lista de servidores para mapear o ID para o Nome real
        const { data: serversData } = await supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tid);

        const serversMap: Record<string, string> = {};
        if (serversData) {
          serversData.forEach((s: any) => {
            serversMap[s.id] = s.name;
          });
        }

        // 3.5 Pendências quitadas por esses pagamentos — pra montar o resumo
        // "Cupom X / Pendência Y" abaixo do valor total (pedido do Marcio,
        // pra auditar a diferença entre o total e o que foi desconto/
        // pendência sem abrir cada pagamento).
        const allAlertIds = [
          ...new Set(
            (paymentsData || []).flatMap((p: any) => (p.settled_alert_ids as string[] | null) || []),
          ),
        ];
        const alertsMap: Record<string, { label: string; amount: number }> = {};
        if (allAlertIds.length > 0) {
          const { data: alertsData } = await supabaseBrowser
            .from("client_alerts")
            .select("id, message, amount, client_apps(apps(name))")
            .in("id", allAlertIds);

          (alertsData || []).forEach((a: any) => {
            const appName = a.client_apps?.apps?.name || null;
            alertsMap[a.id] = {
              label: appName || pendencyLabelFromMessage(a.message),
              amount: Number(a.amount || 0),
            };
          });
        }

        // 4. Junta tudo na linha da tabela
        const mapped: LogRow[] = (paymentsData || []).map((r: any) => {
          const cInfo = clientsMap[r.client_id] || {};
          const serverName = serversMap[cInfo.server_id] || "—";
          const pendencies = ((r.settled_alert_ids as string[] | null) || [])
            .map((aid) => alertsMap[aid])
            .filter((p): p is { label: string; amount: number } => !!p);

          return {
            id: r.id,
            created_at: r.created_at,
            client_id: r.client_id,
            client_name: cInfo.display_name || "Cliente Excluído",
            technology: cInfo.technology || "IPTV",
            server_username: cInfo.server_username || "—",
            server_name: serverName,
            screens: cInfo.screens || 1, // Puxa as telas ou assume 1
            payment_method: r.payment_method,
            payment_status: r.status,
            fulfillment_status: r.fulfillment_status,
            fulfillment_error: r.fulfillment_error,
            whatsapp_status: r.whatsapp_status, // ✅ Lendo o campo real do banco!
            price_amount: r.price_amount,
            price_currency: r.price_currency,
            period: r.period,
            plan_label: r.plan_label,
            gateway_name: r.gateway_type,
            mp_payment_id: r.mp_payment_id || null, // ✅ Adicionado ao mapeamento
            coupon_code: r.coupon_code || null,
            coupon_discount_amount: r.coupon_discount_amount != null ? Number(r.coupon_discount_amount) : null,
            pendencies,
          };
        });

        setRows(mapped);
      }
    } catch (e: any) {
      addToast("error", "Erro ao carregar auditoria", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // ✅ NOVO: Escuta os toasts que vieram do Modal quando o loading termina
  useEffect(() => {
    if (loading) return;

    try {
      const key = "auditoria_list_toasts";
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;

      const arr = JSON.parse(raw) as {
        type: "success" | "error" | "warning";
        title: string;
        message?: string;
      }[];
      window.sessionStorage.removeItem(key);

      for (const t of arr) {
        addToast(t.type, t.title, t.message);
      }
    } catch {
      // ignora
    }
  }, [loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      loadData(search);
    }
  };

  const uniqueGateways = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const g = (r.gateway_name || r.payment_method || "").trim();
      if (g) set.add(g);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  // Só mostra no filtro as opções que realmente têm registro (evita filtro vazio)
  const availableFulfillmentOptions = useMemo(
    () => FULFILLMENT_OPTIONS.filter((o) => rows.some((r) => matchesFulfillment(r, o.value))),
    [rows],
  );
  const availablePaymentOptions = useMemo(
    () => PAYMENT_OPTIONS.filter((o) => rows.some((r) => matchesPayment(r, o.value))),
    [rows],
  );
  const availableWhatsappOptions = useMemo(
    () => WHATSAPP_OPTIONS.filter((o) => rows.some((r) => matchesWhatsapp(r, o.value))),
    [rows],
  );

  // ✅ NOVO: contador vermelho no toggle "📺 IPTV" — quantas linhas têm
  // botão de ação esperando por você (ação manual, transferência aguardando,
  // whatsapp com erro, ou travada sem retorno).
  const iptvActionableCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.fulfillment_status === "manual_pending" ||
          r.fulfillment_status === "awaiting_transfer" ||
          (r.whatsapp_status === "error" && (r.fulfillment_status === "done" || r.fulfillment_status === "manual_done")) ||
          isStuckFulfillment(r.fulfillment_status, r.payment_status, r.created_at),
      ).length,
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return rows.filter((r) => {
      if (filterFulfillment !== "Todos" && !matchesFulfillment(r, filterFulfillment))
        return false;

      if (filterGateway !== "Todos") {
        const g = r.gateway_name || r.payment_method || "";
        if (g !== filterGateway) return false;
      }

      if (filterPayment !== "Todos" && !matchesPayment(r, filterPayment))
        return false;

      if (filterWhatsapp !== "Todos" && !matchesWhatsapp(r, filterWhatsapp))
        return false;

      if (q) {
        const hay = [
          r.client_name,
          r.server_username,
          r.server_name,
          r.gateway_name,
          r.payment_method,
        ]
          .join(" ")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    rows,
    search,
    filterFulfillment,
    filterGateway,
    filterPayment,
    filterWhatsapp,
  ]);

  const hasActiveFilters =
    filterFulfillment !== "Todos" ||
    filterGateway !== "Todos" ||
    filterPayment !== "Todos" ||
    filterWhatsapp !== "Todos";

  function clearFilters() {
    setSearch("");
    setFilterFulfillment("Todos");
    setFilterGateway("Todos");
    setFilterPayment("Todos");
    setFilterWhatsapp("Todos");
    loadData("");
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  // Volta para a página 1 sempre que um filtro muda (mesmo padrão da página de clientes)
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterFulfillment, filterPayment, filterGateway, filterWhatsapp]);

  // --- AÇÕES ---

  // ✅ NOVO: "Reprocessar" — pagamento aprovado que ficou sem fulfillment
  // (webhook do MP e polling do cliente falharam/não aconteceram, achado em
  // auditoria 24/07/2026). Chama a mesma sequência de lock+runFulfillment
  // que roda normalmente, só que disparada por você em vez de por uma aba
  // aberta do cliente.
  const handleReprocessar = async (log: LogRow) => {
    if (!tenantId) return;
    setReprocessingId(log.id);
    try {
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/admin/payments/retry-fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, payment_id: log.id }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.error || "Falha ao reprocessar.");

      if (result.outcome === "manual_pending") {
        addToast("success", "Caiu pra ação manual", "Esse cliente precisa de renovação manual — veja o botão roxo.");
      } else {
        addToast("success", "Reprocessado!", "Renovação concluída com sucesso.");
      }
      loadData();
    } catch (e: any) {
      addToast("error", "Não foi possível reprocessar", e?.message);
    } finally {
      setReprocessingId(null);
    }
  };

  const handleMarcarConcluido = async (log: LogRow) => {
    if (!tenantId) return;

    const ok = await confirm({
      title: "Concluir Renovação Manual",
      subtitle: "A renovação já foi feita no Elite e o cliente já foi avisado?",
      tone: "emerald",
      icon: "✅",
      details: [`Cliente: ${log.client_name}`, `Login: ${log.server_username}`],
      confirmText: "Sim, Marcar como Concluído",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      // ✅ Usa a RPC e manda o status correto de conclusão manual
      const { error } = await supabaseBrowser.rpc("update_fulfillment_status", {
        p_log_id: log.id,
        p_tenant_id: tenantId,
        p_status: "manual_done",
      });

      if (error) throw error;

      addToast(
        "success",
        "Auditoria Atualizada",
        "Processo marcado como concluído com sucesso!",
      );
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao atualizar", e.message);
    }
  };

  // ✅ NOVA FUNÇÃO: Cancela a renovação manual sem abrir o modal
  const handleCancelarAcao = async (log: LogRow) => {
    if (!tenantId) return;

    const ok = await confirm({
      title: "Cancelar Renovação Manual",
      subtitle:
        "Deseja marcar esta renovação como cancelada? Ela sairá da lista de pendências.",
      tone: "rose",
      icon: "🚫",
      details: [`Cliente: ${log.client_name}`, `Login: ${log.server_username}`],
      confirmText: "Sim, Cancelar",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      // ✅ AGORA SIM: Chamando a função SQL que tem permissão para alterar
      const { error } = await supabaseBrowser.rpc("update_fulfillment_status", {
        p_log_id: log.id,
        p_tenant_id: tenantId,
        p_status: "manual_cancelled", // ✅ Corrigido para Cancelado Manual
      });

      if (error) throw error;

      // ✅ NOVO: resolve as notificações do sino ligadas a este pagamento
      // (tenta os dois tipos possíveis — o que não bater simplesmente não encontra linha)
      try {
        await supabaseBrowser.rpc("resolve_notification", {
          p_tenant_id: tenantId,
          p_type: "manual_pending",
          p_source_id: log.id,
        });
        await supabaseBrowser.rpc("resolve_notification", {
          p_tenant_id: tenantId,
          p_type: "transfer_aguardando",
          p_source_id: log.id,
        });
      } catch {}

      addToast(
        "success",
        "Ação Encerrada",
        "A renovação foi marcada como cancelada.",
      );
      loadData();
    } catch (e: any) {
      addToast("error", "Erro ao cancelar", e.message);
    }
  };

  // ✅ NOVO: Confirma recebimento de transferência bancária e abre modal de renovação
  const handleConfirmarTransferencia = async (log: LogRow) => {
    if (!tenantId) return;

    const ok = await confirm({
      title: "Confirmar Recebimento",
      subtitle: "O dinheiro já caiu na conta? Isso vai abrir o painel de renovação.",
      tone: "sky",
      icon: "🏦",
      details: [
        `Cliente: ${log.client_name}`,
        `Login: ${log.server_username}`,
        `Valor: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: log.price_currency || "BRL" }).format(log.price_amount)}`,
      ],
      confirmText: "Recebido - Renovar",
      cancelText: "Voltar",
    });

    if (!ok) return;

    // ✅ Só abre o modal — o onSuccess cuida de atualizar tudo ao concluir
    setRenewState({
      logId: log.id,
      clientId: log.client_id,
      clientName: log.client_name,
      wasAwaitingTransfer: true,
    });
  };

  // ✅ NOVA FUNÇÃO: Reenvia apenas o WhatsApp direto, sem abrir o modal
  const handleReenviarWhatsapp = async (log: LogRow) => {
    if (!tenantId) return;

    const ok = await confirm({
      title: "Reenviar WhatsApp",
      subtitle:
        "A renovação já foi feita no servidor. Deseja reenviar apenas o comprovante via WhatsApp?",
      tone: "sky",
      icon: "💬",
      details: [`Cliente: ${log.client_name}`, `Login: ${log.server_username}`],
      confirmText: "Sim, Reenviar",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      setLoading(true);

      // 1. Busca o template de pagamento exatamente como o webhook faz
      const { data: tmpl } = await supabaseBrowser
        .from("message_templates")
        .select("id, content, image_url")
        .eq("tenant_id", tenantId)
        .or("name.ilike.%pagamento%,name.ilike.%pago%,name.ilike.%realizado%")
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!tmpl || !tmpl.content) {
        throw new Error(
          "Template de 'Pagamento Realizado' não encontrado no banco.",
        );
      }

      const { data: sessionData } = await supabaseBrowser.auth.getSession();
      const token = sessionData.session?.access_token;

      // 2. Dispara a API de envio agora
      const res = await fetch("/api/whatsapp/envio_agora", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          client_id: log.client_id,
          message: tmpl.content,
          message_template_id: tmpl.id,
          image_url: tmpl.image_url,
          // Se quiser forçar uma sessão específica, adicione whatsapp_session: "session2"
        }),
      });

      if (!res.ok) {
        throw new Error("A API recusou o envio ou a VM está offline.");
      }

      // 3. Atualiza o status do banco para sucesso (via RPC SECURITY DEFINER — RLS bloqueia UPDATE direto)
      const { error: rpcErr } = await supabaseBrowser.rpc("update_whatsapp_status", {
        p_log_id: log.id,
        p_tenant_id: tenantId,
        p_status: "sent",
      });
      if (rpcErr) throw rpcErr;

      // ✅ NOVO: resolve a notificação de falha de WhatsApp, se existir
      try {
        await supabaseBrowser.rpc("resolve_notification", {
          p_tenant_id: tenantId,
          p_type: "whatsapp_falha",
          p_source_id: log.id,
        });
      } catch {}

      addToast(
        "success",
        "Mensagem enviada",
        "Comprovante enviado com sucesso!",
      );
      loadData();
    } catch (err: any) {
      addToast("error", "Erro ao reenviar", err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- HELPERS VISUAIS (Com Bloqueio de Fluxo) ---
  function getPaymentBadge(status: string, paymentMethod: string) {
    if (status === "approved" || status === "PAGO")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-emerald-500/10 text-emerald-500 text-[10px] font-medium uppercase border border-emerald-500/20">
          Aprovado
        </span>
      );
    if (status === "pending") {
if (paymentMethod === "manual") {
        return (
          <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-purple-500/10 text-purple-500 text-[10px] font-medium uppercase border border-purple-500/20">
            Renovação Manual
          </span>
        );
      }
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-amber-500/10 text-amber-500 text-[10px] font-medium uppercase border border-amber-500/20">
          Pendente
        </span>
      );
    }

    // ✅ NOVO: pagamento manual confirmado por você
    if (status === "manual_approved") {
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-emerald-500/10 text-emerald-500 text-[10px] font-medium uppercase border border-emerald-500/20">
          Aprovado Manualmente
        </span>
      );
    }
    if (status === "rejected" || status === "cancelled")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-rose-500/10 text-rose-500 text-[10px] font-medium uppercase border border-rose-500/20">
          Recusado
        </span>
      );
    return (
      <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-muted text-muted-foreground text-[10px] font-medium uppercase border border-border">
        {status}
      </span>
    );
  }

  function getFulfillmentBadge(status: string, paymentStatus: string, createdAt: string) {
    const bucket = getFulfillmentBucket(status, paymentStatus, createdAt);

    if (bucket === "manual_cancelled" || bucket === "cancelled") {
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-rose-500/10 text-rose-500 text-[10px] font-medium uppercase border border-rose-500/20">
          {bucket === "manual_cancelled" ? "Cancelada Manualmente" : "Cancelada"}
        </span>
      );
    }

    if (bucket === "awaiting_transfer") {
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-sky-500/10 text-sky-500 text-[10px] font-medium uppercase border border-sky-500/20">
          Aguard. Transferência
        </span>
      );
    }

    if (bucket === "aguardando_pagamento") {
      return (
        <span className="text-muted-foreground/60 font-medium">—</span>
      );
    }

    if (bucket === "done")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-emerald-500/10 text-emerald-500 text-[10px] font-medium uppercase border border-emerald-500/20">
          Concluído
        </span>
      );
    if (bucket === "manual_done")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-sky-500/10 text-sky-500 text-[10px] font-medium uppercase border border-sky-500/20">
          Concluído Manualmente
        </span>
      );
    if (bucket === "manual_pending")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-purple-500/10 text-purple-500 text-[10px] font-medium uppercase border border-purple-500/20">
          Ação Manual
        </span>
      );
    if (bucket === "error")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-rose-500/10 text-rose-500 text-[10px] font-medium uppercase border border-rose-500/20">
          Erro API
        </span>
      );
    if (bucket === "stuck")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-amber-500/10 text-amber-500 text-[10px] font-medium uppercase border border-amber-500/20 animate-pulse">
          Travada
        </span>
      );

    return (
      <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-transparent text-muted-foreground text-[10px] font-medium uppercase border border-border">
        Processando
      </span>
    );
  }

  function getWhatsappBadge(
    status: string | null,
    paymentStatus: string,
    fulfillmentStatus: string,
  ) {
    // 1. Se o pagamento NÃO foi aprovado, a mensagem nunca é enviada.
if (paymentStatus !== "approved" && paymentStatus !== "PAGO" && paymentStatus !== "manual_approved") {
      return (
        <span className="text-muted-foreground/60 font-medium">—</span>
      );
    }

    // 2. ✅ NOVO: Se a renovação foi cancelada (manual ou sistema), não há mensagem.
    if (
      fulfillmentStatus === "manual_cancelled" ||
      fulfillmentStatus === "cancelled"
    ) {
      return (
        <span className="text-muted-foreground/60 font-medium">—</span>
      );
    }

    // 3. Se a renovação ainda não terminou (processando ou erro), o zap ainda não "nasceu" no fluxo.
    if (fulfillmentStatus !== "done" && fulfillmentStatus !== "manual_done") {
      return (
        <span className="text-muted-foreground/60 font-medium">—</span>
      );
    }

    // 4. Se a renovação deu certo, mostramos o status real vindo do campo whatsapp_status
    if (status === "sent")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-emerald-500/10 text-emerald-500 text-[10px] font-medium uppercase border border-emerald-500/20">
          Enviado
        </span>
      );
    if (status === "error")
      return (
        <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-rose-500/10 text-rose-500 text-[10px] font-medium uppercase border border-rose-500/20">
          Erro
        </span>
      );
    return (
      <span className="gap-1 px-2 py-1 rounded-lg shadow-sm tracking-tight bg-transparent text-muted-foreground text-[10px] font-medium uppercase border border-border">
        Aguardando
      </span>
    );
  }

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors" id="dashboard-values">
      {/* TOPO */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate flex items-center gap-2">
              Auditoria do Portal
            </h1>
            <EyeToggle />
          </div>
          <p className="text-xs sm:text-sm text-foreground/70 mt-1">
            Log completo de ponta a ponta dos pagamentos e renovações.
          </p>
        </div>
        <div className="flex items-center gap-2 justify-end shrink-0">
          <div className="flex bg-transparent p-1 rounded-xl border border-border">
            <button
              onClick={() => setActiveLogView("iptv")}
              className={`relative px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                activeLogView === "iptv"
                  ? "bg-card text-emerald-500 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>📺</span>
              <span>IPTV</span>
              {iptvActionableCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {iptvActionableCount > 99 ? "99+" : iptvActionableCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveLogView("aplicativos")}
              className={`relative px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                activeLogView === "aplicativos"
                  ? "bg-card text-emerald-500 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>📱</span>
              <span>Aplicativos</span>
              {appRequestsPendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {appRequestsPendingCount > 99 ? "99+" : appRequestsPendingCount}
                </span>
              )}
            </button>
          </div>
          {activeLogView === "iptv" && (
            <button
              onClick={() => loadData(search)}
              className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
            >
              <IconRefresh /> <span className="hidden sm:inline">Atualizar</span>
            </button>
          )}
        </div>
      </div>

      {activeLogView === "aplicativos" && tenantId && (
        <AplicativosLog
          tenantId={tenantId}
          addToast={addToast}
          confirm={confirm}
          onPendingCountChange={setAppRequestsPendingCount}
        />
      )}

      {activeLogView === "iptv" && (
      <>
      {/* FILTROS */}
      <div className="px-3 md:p-4 bg-transparent md:bg-card border-0 md:border md:border-border rounded-none md:rounded-xl shadow-none md:shadow-sm space-y-3 md:space-y-4 mb-6 md:sticky md:top-4 z-20">
        <div className="hidden md:block text-xs font-medium uppercase text-muted-foreground tracking-wider">
          Filtros Rápidos
        </div>

        {/* MOBILE (somente): busca + botão abrir painel */}
        <div className="md:hidden flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar (Pressione Enter)"
              className="w-full h-10 px-3 pr-10 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  loadData("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
                title="Limpar busca"
              >
                <IconX />
              </button>
            )}
          </div>

          <button
            onClick={() => loadData(search)}
            className="h-10 px-3 bg-card border border-border hover:bg-muted text-foreground/90 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            Buscar
          </button>

          <button
            onClick={() => setMobileFiltersOpen((v) => !v)}
            className={`h-10 px-3 rounded-lg border font-medium text-sm transition-colors ${
              hasActiveFilters
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title="Filtros"
          >
            Filtros
          </button>
        </div>

        {/* DESKTOP (somente): tudo na mesma linha */}
        <div className="hidden md:flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] flex gap-2">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Buscar (Pressione Enter)"
                className="w-full h-10 px-3 pr-10 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    loadData("");
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-rose-500"
                  title="Limpar busca"
                >
                  <IconX />
                </button>
              )}
            </div>
            <button
              onClick={() => loadData(search)}
              className="h-10 px-4 bg-card border border-border hover:bg-muted text-foreground/90 rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              Buscar
            </button>
          </div>

          <div className="w-[180px]">
            <select
              value={filterFulfillment}
              onChange={(e) => setFilterFulfillment(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Renovação (Todos)</option>
              {availableFulfillmentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-[170px]">
            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Pagamento (Todos)</option>
              {availablePaymentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-[160px]">
            <select
              value={filterGateway}
              onChange={(e) => setFilterGateway(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Banco (Todos)</option>
              {uniqueGateways.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="w-[170px]">
            <select
              value={filterWhatsapp}
              onChange={(e) => setFilterWhatsapp(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Mensagem WA (Todas)</option>
              {availableWhatsappOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={clearFilters}
            className="h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <IconX /> Limpar
          </button>
        </div>

        {/* Painel de filtros no mobile */}
        {mobileFiltersOpen && (
          <div className="md:hidden mt-1 p-3 rounded-xl border border-border bg-transparent space-y-2">
            <select
              value={filterFulfillment}
              onChange={(e) => setFilterFulfillment(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Renovação (Todos)</option>
              {availableFulfillmentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Pagamento (Todos)</option>
              {availablePaymentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              value={filterGateway}
              onChange={(e) => setFilterGateway(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Banco (Todos)</option>
              {uniqueGateways.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>

            <select
              value={filterWhatsapp}
              onChange={(e) => setFilterWhatsapp(e.target.value)}
              className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm outline-none focus:border-emerald-500/50 text-foreground/90"
            >
              <option value="Todos">Mensagem WA (Todas)</option>
              {availableWhatsappOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                clearFilters();
                setMobileFiltersOpen(false);
              }}
              className="w-full h-10 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 text-sm font-medium hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2"
            >
              <IconX /> Limpar
            </button>
          </div>
        )}
      </div>

      {/* TABELA */}
      {loading ? (
        <div className="p-12 text-center text-muted-foreground animate-pulse bg-card rounded-none sm:rounded-xl border border-border">
          Carregando logs de auditoria...
        </div>
      ) : (
        <div className="bg-card border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible transition-colors sm:mx-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wider text-muted-foreground bg-transparent">
                  <th className="px-4 py-3">Data / Hora</th>
                  <th className="px-4 py-3">Cliente / Login / Servidor</th>
                  <th className="px-4 py-3 text-center">Plano / Telas</th>
                  <th className="px-4 py-3 text-center">Banco</th>
                  <th className="px-4 py-3 text-center">Pagamento</th>
                  <th className="px-4 py-3 text-center">Renovação</th>
                  <th className="px-4 py-3 text-center">Mensagem WA</th>
                  <th className="px-4 py-3 text-center">Valor</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-border">
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="p-8 text-center text-muted-foreground italic"
                    >
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                ) : (
                  visible.map((r) => {
                    const dateObj = new Date(r.created_at);

                    // ✅ Separação clara dos estados
                    const isManualPending =
                      r.fulfillment_status === "manual_pending";
                    const isAwaitingTransfer =
                      r.fulfillment_status === "awaiting_transfer";
                    const isWhatsappError =
                      r.whatsapp_status === "error" &&
                      (r.fulfillment_status === "done" ||
                        r.fulfillment_status === "manual_done");
                    const isStuck = isStuckFulfillment(
                      r.fulfillment_status,
                      r.payment_status,
                      r.created_at,
                    );

                    const canShowAction =
                      isManualPending || isAwaitingTransfer || isWhatsappError || isStuck;

                    return (
                      <tr
                        key={r.id}
                        className="hover:bg-muted/50 transition-colors group"
                      >
                        {/* Data e Hora */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
<span className="text-foreground/90">
                              {dateObj.toLocaleDateString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                              })}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {dateObj.toLocaleTimeString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </td>

                        {/* Cliente / Login / Servidor */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground truncate max-w-[200px]">
                              {r.client_name}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
<span className="text-xs text-muted-foreground">
                                {r.server_username}
                              </span>
<span className="text-muted-foreground/60">
                                •
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {r.server_name}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Plano / Telas */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col gap-0.5 items-center">
<span className="text-xs font-medium text-foreground/80">
                              {r.plan_label ||
                                PERIOD_LABELS[r.period] ||
                                r.period}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {r.screens} {r.screens === 1 ? "tela" : "telas"}
                            </span>
                          </div>
                        </td>

                        {/* Banco */}
                        <td className="px-4 py-3 text-center">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            {r.gateway_name || r.payment_method}
                          </span>
                        </td>

                        {/* Pagamento (Status + Ref) */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col gap-1 items-center">
                            {getPaymentBadge(r.payment_status, r.payment_method)}
                            {r.mp_payment_id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(
                                    r.mp_payment_id!,
                                  );
                                  addToast(
                                    "success",
                                    "Copiado",
                                    "Código da transação copiado!",
                                  );
                                }}
 className="text-[9px] text-muted-foreground bg-transparent px-1.5 py-0.5 rounded border border-border hover:border-emerald-500 hover:text-emerald-500 transition-colors"
                                title="Clique para copiar a referência"
                              >
                                Ref: {String(r.mp_payment_id).slice(-8)}
                              </button>
                            )}
                          </div>
                        </td>
                        {/* Renovação */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col gap-1 items-center">
                                                       {" "}
                            {getFulfillmentBadge(
                              r.fulfillment_status,
                              r.payment_status,
                              r.created_at,
                            )}
                            {/* Cor neutra para todos os fluxos manuais (Pendente, Concluído ou Cancelado) */}
                            {r.fulfillment_status === "manual_pending" ||
                            r.fulfillment_status === "manual_done" ||
                            r.fulfillment_status === "manual_cancelled" ? (
                              <span
                                className="text-[10px] text-muted-foreground leading-tight max-w-[200px] truncate font-medium"
                                title={
                                  r.fulfillment_error || "Renovação Manual"
                                }
                              >
                                {r.fulfillment_error || "Renovação Manual"}
                              </span>
                            ) : (
                              /* Erros reais de API continuam vermelhos */
                              r.fulfillment_error &&
                              r.payment_status === "approved" && (
                                <span
                                  className="text-[10px] text-rose-500 leading-tight max-w-[200px] truncate"
                                  title={r.fulfillment_error}
                                >
                                  {r.fulfillment_error}
                                </span>
                              )
                            )}
                                                     {" "}
                          </div>
                        </td>

                        {/* Mensagem WA */}
                        <td className="px-4 py-3 text-center">
                          {getWhatsappBadge(
                            r.whatsapp_status,
                            r.payment_status,
                            r.fulfillment_status,
                          )}
                        </td>

                        {/* Valor */}
                        <td className="px-4 py-3 text-center">
                          <span className="font-medium text-foreground/90 finance-value">
                            {fmtMoney(r.price_amount, r.price_currency)}
                          </span>
                          {/* ✅ Resumo do valor — só aparece quando não é "só assinatura"
                              (tem cupom e/ou pendência quitada junto), pra dar pra auditar
                              a diferença entre o total e o desconto/pendência aplicados. */}
                          {(r.coupon_code || r.pendencies.length > 0) && (
                            <div className="mt-1 space-y-0.5 finance-value">
                              {r.coupon_code && (
                                <div className="text-[10px] text-emerald-500 leading-tight">
                                  Cupom: {r.coupon_code} (-{fmtMoney(r.coupon_discount_amount || 0, r.price_currency)})
                                </div>
                              )}
                              {r.pendencies.map((p, idx) => (
                                <div
                                  key={idx}
                                  className="text-[10px] text-amber-500 leading-tight max-w-[220px] truncate mx-auto"
                                  title={p.label}
                                >
                                  {p.label} ({fmtMoney(p.amount, r.price_currency)})
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* Ações */}
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {isManualPending && (
                              <>
                                <button
  onClick={() =>
    setRenewState({
      logId: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      wasAwaitingTransfer: false,
    })
  }
                                  className="gap-1 px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-purple-500/30 shadow-sm flex items-center justify-center gap-1"
                                  title="Abrir painel de renovação"
                                >
                                  <IconCheckCircle /> Concluir
                                </button>
                                <button
                                  onClick={() => handleCancelarAcao(r)}
                                  className="gap-1 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-rose-500/20 shadow-sm flex items-center justify-center gap-1"
                                  title="Encerrar esta pendência sem renovar"
                                >
                                  <IconX />
                                </button>
                              </>
                            )}

                            {/* ✅ NOVO: Aguardando transferência bancária */}
                            {isAwaitingTransfer && (
                              <>
                                <button
                                  onClick={() =>
                                    handleConfirmarTransferencia(r)
                                  }
                                  className="gap-1 px-3 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-sky-500/30 shadow-sm flex items-center justify-center gap-1"
                                  title="Confirmar recebimento e renovar"
                                >
                                  <IconCheckCircle /> Confirmar
                                </button>
                                <button
                                  onClick={() => handleCancelarAcao(r)}
                                  className="gap-1 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-rose-500/20 shadow-sm flex items-center justify-center gap-1"
                                  title="Cancelar — cliente não transferiu"
                                >
                                  <IconX />
                                </button>
                              </>
                            )}

                            {/* ✅ NOVO: pagamento aprovado sem fulfillment concluído há mais
                                de 10min — tenta rodar a renovação de novo na hora. */}
                            {isStuck && (
                              <button
                                onClick={() => handleReprocessar(r)}
                                disabled={reprocessingId === r.id}
                                className="gap-1 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-amber-500/30 shadow-sm flex items-center justify-center gap-1 disabled:opacity-50"
                                title="Tentar concluir a renovação automática de novo"
                              >
                                <IconRefresh />{" "}
                                {reprocessingId === r.id ? "Reprocessando..." : "Reprocessar"}
                              </button>
                            )}

                            {/* ✅ NOVO: Botão direto para reenviar o comprovante de WhatsApp */}
                            {isWhatsappError && (
                              <button
                                onClick={() => handleReenviarWhatsapp(r)}
                                className="gap-1 px-3 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-500 text-[10px] font-medium uppercase rounded-lg transition-colors border border-sky-500/30 shadow-sm flex items-center justify-center gap-1"
                                title="Reenviar comprovante via WhatsApp"
                              >
                                💬 Reenviar Zap
                              </button>
                            )}

                            {!canShowAction && (
<span className="text-muted-foreground/60 text-xs font-medium">
                                —
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            pageSizeOptions={[25, 50, 100, 200]}
          />
        </div>
      )}
      </>
      )}

      {/* ✅ Renderiza o Modal de Recarga ao clicar em Concluir */}
      {renewState && (
        <>
          <RecargaCliente
            clientId={renewState.clientId}
            clientName={renewState.clientName}
            paymentLogId={renewState.logId}
            toastKey="auditoria_list_toasts"
            onClose={() => setRenewState(null)}
            onSuccess={async (returnedLogId) => {
  if (!returnedLogId) return;
  try {
    const { error } = await supabaseBrowser.rpc(
      "update_fulfillment_status",
      {
        p_log_id: returnedLogId,
        p_tenant_id: tenantId,
        p_status: "manual_done",
      },
    );
    if (error) throw error;

    // 2. Só marca o pagamento como "aprovado manualmente" se o pagamento em si
    // era manual (transferência aguardando confirmação bancária). Se o pagamento
    // já foi confirmado automaticamente pelo gateway (MP/Stripe) e só faltava
    // a renovação manual no servidor (ex: Elite), o status do pagamento
    // NÃO deve ser tocado — ele já está correto como "approved".
    if (renewState?.wasAwaitingTransfer) {
      await supabaseBrowser.rpc("approve_manual_payment", {
        p_log_id: returnedLogId,
        p_tenant_id: tenantId,
      });
    }

    addToast("success", "Auditoria Atualizada", "Renovação confirmada na Auditoria!");
    setRenewState(null);
    loadData();
  } catch {}
}}
          />
        </>
      )}

      {/* CSS PARA OCULTAR VALORES COM O EYE-TOGGLE */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        #dashboard-values[data-values-hidden="true"] .finance-value {
          filter: blur(8px);
          opacity: 0.6;
          pointer-events: none;
          user-select: none;
        }
      `,
        }}
      />

      {ConfirmUI}
      <div className="relative z-[999999]">
        <ToastNotifications
          toasts={toasts}
          removeToast={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
        />
      </div>
    </div>
  );
}

export default function AuditoriaPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-muted-foreground animate-pulse">
          Carregando Auditoria...
        </div>
      }
    >
      <AuditoriaPageContent />
    </Suspense>
  );
}
