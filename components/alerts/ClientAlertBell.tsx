"use client";
// components/alerts/ClientAlertBell.tsx
// Botão de sino de alerta/pendência financeira — reutilizável (Cliente lista,
// Cliente [id], Teste). Um único sino: se já tem alerta aberto, mostra a
// lista; se não tem nenhum, vai direto pra tela de criar. Grava sempre na
// mesma tabela (client_alerts), do mesmo jeito.

import { forwardRef, useImperativeHandle, useState } from "react";
import { Bell, Pencil, Trash2, ThumbsUp, ThumbsDown, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";
import {
  appActivationMessage as buildAppChargeMessage,
  createAppActivationAlert,
  randomCouponCode,
} from "@/lib/alerts/app-activation-alert";
import {
  Modal as SharedModal,
  ModalHeader,
  ModalBody,
} from "@/components/ui/Modal";

export type ClientAlertBellHandle = {
  openList: () => void;
  openCreate: () => void;
};

// ✅ 02/10/2026 (docs/alertas-confianca/PLANO.md): "generic_charge"
// (Pendência qualquer) não se cria mais — só aparece pra editar as antigas.
type AlertKind = "note" | "app_charge" | "renewal_trust" | "generic_charge";

const PERIODS: { value: string; label: string; months: number }[] = [
  { value: "MONTHLY", label: "Mensal", months: 1 },
  { value: "BIMONTHLY", label: "Bimestral", months: 2 },
  { value: "QUARTERLY", label: "Trimestral", months: 3 },
  { value: "SEMIANNUAL", label: "Semestral", months: 6 },
  { value: "ANNUAL", label: "Anual", months: 12 },
];
const periodFromLabel = (label: string | null | undefined) =>
  PERIODS.find((p) => p.label.toLowerCase() === String(label || "").trim().toLowerCase())?.value || "MONTHLY";

type TrustClientInfo = {
  plan_table_id: string | null;
  screens: number;
  plan_label: string | null;
  price_amount: number | null;
  price_currency: string;
};


type ClientAppOption = {
  id: string;
  appName: string;
  costType: string | null;
  licensePrice: number | null;
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(amount);
}

function buildTrustMessage(periodLabel: string, screens: number, renewalDateISO: string) {
  const datePart = renewalDateISO
    ? new Date(`${renewalDateISO}T12:00:00`).toLocaleDateString("pt-BR")
    : "";
  return `Renovação em confiança: ${periodLabel} · ${screens} tela${screens === 1 ? "" : "s"}${datePart ? ` · dia ${datePart}` : ""}`;
}

function isoDateToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <SharedModal onClose={onClose} maxWidth="max-w-lg">
      <ModalHeader onClose={onClose}>
        <h3 className="font-medium text-foreground">{title}</h3>
      </ModalHeader>
      <ModalBody className="p-5">{children}</ModalBody>
    </SharedModal>
  );
}

function ActionBtn({
  title,
  tone,
  onClick,
  children,
}: {
  title: string;
  tone: "blue" | "green" | "amber" | "red";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const colors = {
    blue: "text-sky-500 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20",
    green:
      "text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20",
    amber:
      "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
    red: "text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  };
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={`p-1.5 rounded-lg border transition-all ${colors[tone]}`}
    >
      {children}
    </button>
  );
}

const ClientAlertBell = forwardRef<
  ClientAlertBellHandle,
  {
    tenantId: string | null;
    clientId: string;
    clientName: string;
    clientUsername?: string;
    alertsCount: number;
    onChanged?: () => void;
    addToast: (
      type: "success" | "error",
      title: string,
      message?: string,
    ) => void;
    size?: "sm" | "lg";
    hideWhenEmpty?: boolean;
  }
>(function ClientAlertBell(
  {
    tenantId,
    clientId,
    clientName,
    clientUsername,
    alertsCount,
    onChanged,
    addToast,
    size = "sm",
    hideWhenEmpty = false,
  },
  ref,
) {
  const { confirm } = useConfirm();

  const [showList, setShowList] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [toggledPaidIds, setToggledPaidIds] = useState<Set<string>>(new Set());

  const [showForm, setShowForm] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [kind, setKind] = useState<AlertKind | null>(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [clientAppId, setClientAppId] = useState("");
  const [activationDate, setActivationDate] = useState("");
  const [clientApps, setClientApps] = useState<ClientAppOption[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  // cupom do app (opcional) — cria cupom pessoal e já desconta no sino
  const [useCoupon, setUseCoupon] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState<"percent" | "fixed">("percent");
  const [couponValue, setCouponValue] = useState("");
  const [lockedCouponLabel, setLockedCouponLabel] = useState<string | null>(null);
  // renovação em confiança (mensalidade)
  const [trustInfo, setTrustInfo] = useState<TrustClientInfo | null>(null);
  const [trustPrices, setTrustPrices] = useState<{ period: string; months: number; screens: number; price: number }[]>([]);
  const [trustPeriod, setTrustPeriod] = useState("MONTHLY");
  const [trustScreens, setTrustScreens] = useState(1);
  const [trustDate, setTrustDate] = useState("");

  function resetForm() {
    setShowForm(false);
    setEditingAlertId(null);
    setKind(null);
    setText("");
    setAmount("");
    setCurrency("BRL");
    setClientAppId("");
    setActivationDate("");
    setClientApps([]);
    setUseCoupon(false);
    setCouponCode("");
    setCouponType("percent");
    setCouponValue("");
    setLockedCouponLabel(null);
    setTrustInfo(null);
    setTrustPrices([]);
    setTrustPeriod("MONTHLY");
    setTrustScreens(1);
    setTrustDate("");
  }

  // valor sugerido da renovação: o preço do cliente se for o período/telas
  // atuais dele (pode ter desconto próprio); senão o da tabela do plano
  function suggestTrustAmount(info: TrustClientInfo | null, prices: typeof trustPrices, period: string, screens: number) {
    if (!info) return "";
    if (period === periodFromLabel(info.plan_label) && screens === info.screens && info.price_amount != null) {
      return String(info.price_amount);
    }
    const p = prices.find((x) => x.period === period && x.screens === screens);
    return p ? String(p.price) : "";
  }

  async function loadTrustInfo(keepAmount = false) {
    try {
      const { data: c, error } = await supabaseBrowser
        .from("clients")
        .select("plan_table_id, screens, plan_label, price_amount, price_currency")
        .eq("id", clientId)
        .single();
      if (error) throw error;
      const info: TrustClientInfo = {
        plan_table_id: c.plan_table_id || null,
        screens: Number(c.screens || 1),
        plan_label: c.plan_label || null,
        price_amount: c.price_amount != null ? Number(c.price_amount) : null,
        price_currency: String(c.price_currency || "BRL"),
      };
      let prices: typeof trustPrices = [];
      if (info.plan_table_id) {
        const { data: items } = await supabaseBrowser
          .from("plan_table_items")
          .select("period, months, plan_table_item_prices(screens_count, price_amount)")
          .eq("plan_table_id", info.plan_table_id);
        prices = ((items as any[]) || []).flatMap((it) =>
          ((it.plan_table_item_prices as any[]) || []).map((p) => ({
            period: String(it.period),
            months: Number(it.months || 1),
            screens: Number(p.screens_count),
            price: Number(p.price_amount),
          })),
        );
      }
      setTrustInfo(info);
      setTrustPrices(prices);
      if (!keepAmount) {
        const period = periodFromLabel(info.plan_label);
        setTrustPeriod(period);
        setTrustScreens(info.screens);
        setCurrency(info.price_currency);
        setAmount(suggestTrustAmount(info, prices, period, info.screens));
        const label = PERIODS.find((p) => p.value === period)?.label || "Mensal";
        setText(buildTrustMessage(label, info.screens, trustDate || isoDateToday()));
      }
    } catch (e: any) {
      addToast("error", "Erro ao carregar o plano do cliente", e.message);
    }
  }

  async function loadClientApps() {
    setLoadingApps(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("client_apps")
        .select("id, apps(name, cost_type, license_price)")
        .eq("client_id", clientId);
      if (error) throw error;
      setClientApps(
        ((data as any[]) || []).map((r) => ({
          id: String(r.id),
          appName: String(r.apps?.name ?? "App"),
          costType: r.apps?.cost_type ?? null,
          licensePrice:
            r.apps?.license_price != null ? Number(r.apps.license_price) : null,
        })),
      );
    } catch (e: any) {
      addToast("error", "Erro ao carregar apps", e.message);
      setClientApps([]);
    } finally {
      setLoadingApps(false);
    }
  }

  async function loadAlerts() {
    setLoadingList(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("client_alerts")
        .select("*, client_apps(apps(name))")
        .eq("tenant_id", tenantId)
        .eq("client_id", clientId)
        .eq("status", "OPEN")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAlerts(data || []);
    } catch (e: any) {
      addToast("error", "Erro ao carregar alertas", e.message);
    } finally {
      setLoadingList(false);
    }
  }

  function openBell() {
    setToggledPaidIds(new Set());
    if (alertsCount > 0) {
      setShowList(true);
      loadAlerts();
    } else {
      resetForm();
      setShowForm(true);
    }
  }

  function openCreateFromList() {
    setShowList(false);
    resetForm();
    setShowForm(true);
  }

  useImperativeHandle(ref, () => ({
    openList: () => {
      setToggledPaidIds(new Set());
      setShowList(true);
      loadAlerts();
    },
    openCreate: () => {
      resetForm();
      setShowForm(true);
    },
  }));

  function openEdit(alert: any) {
    const inferredKind: AlertKind =
      alert.kind === "renewal_trust"
        ? "renewal_trust"
        : alert.amount == null
          ? "note"
          : alert.client_app_id
            ? "app_charge"
            : "generic_charge";
    setEditingAlertId(String(alert.id));
    setKind(inferredKind);
    setText(alert.message || "");
    setAmount(alert.amount != null ? String(alert.amount) : "");
    setCurrency(alert.currency || "BRL");
    setClientAppId(alert.client_app_id || "");
    setActivationDate(alert.activation_date || "");
    setLockedCouponLabel(
      alert.coupon_id && alert.meta?.coupon_code
        ? `${alert.meta.coupon_code} (-${formatMoney(Number(alert.meta.discount_amount || 0), alert.currency || "BRL")})`
        : null,
    );
    if (inferredKind === "renewal_trust") {
      const m = alert.meta || {};
      setTrustPeriod(String(m.period || "MONTHLY"));
      setTrustScreens(Number(m.screens || 1));
      setTrustDate(String(m.renewal_date || ""));
      void loadTrustInfo(true);
    }
    setShowList(false);
    setShowForm(true);
    if (inferredKind === "app_charge") loadClientApps();
  }

  async function handleSave() {
    if (!tenantId || !kind) return;

    const payload: Record<string, any> = {
      tenant_id: tenantId,
      client_id: clientId,
      status: "OPEN",
    };

    if (kind === "note") {
      if (!text.trim()) return;
      payload.message = text.trim();
    } else {
      const amountNum = Number(amount.replace(",", "."));
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        addToast("error", "Valor inválido", "Informe um valor maior que zero.");
        return;
      }
      payload.amount = amountNum;
      payload.currency = currency || "BRL";

      if (kind === "app_charge") {
        if (!clientAppId) {
          addToast(
            "error",
            "Selecione um app",
            "Escolha qual app gerou a pendência.",
          );
          return;
        }
        const app = clientApps.find((a) => a.id === clientAppId);
        payload.client_app_id = clientAppId;
        payload.kind = "app_activation";
        payload.message =
          text.trim() ||
          buildAppChargeMessage(app?.appName ?? "", activationDate);
        if (activationDate) payload.activation_date = activationDate;

        // ✅ criação: lib/alerts/app-activation-alert.ts (sino + cupom
        // pessoal opcional, desconto já no valor). Edição: update normal.
        if (!editingAlertId) {
          const value = Number(couponValue.replace(",", "."));
          const res = await createAppActivationAlert({
            tenantId,
            clientId,
            clientName,
            clientAppId,
            appName: app?.appName || "Aplicativo",
            amount: amountNum,
            currency: currency || "BRL",
            activationDate,
            message: text,
            coupon: useCoupon ? { code: couponCode, type: couponType, value } : null,
          });
          if (res.ok === false) {
            addToast("error", "Não deu pra salvar", res.error);
            return;
          }
          addToast("success", "Alerta criado", "Salvo com sucesso.");
          resetForm();
          onChanged?.();
          return;
        }
      } else if (kind === "renewal_trust") {
        const p = PERIODS.find((x) => x.value === trustPeriod) || PERIODS[0];
        payload.kind = "renewal_trust";
        payload.message = text.trim() || buildTrustMessage(p.label, trustScreens, trustDate);
        payload.meta = {
          period: p.value,
          plan_label: p.label,
          months: p.months,
          screens: trustScreens,
          plan_table_id: trustInfo?.plan_table_id || null,
          renewal_date: trustDate || isoDateToday(),
        };
      } else {
        if (!text.trim()) {
          addToast("error", "Descreva a pendência", "Digite do que se trata.");
          return;
        }
        payload.message = text.trim();
      }
    }

    try {
      const { error } = editingAlertId
        ? await supabaseBrowser
            .from("client_alerts")
            .update(payload)
            .eq("id", editingAlertId)
        : await supabaseBrowser.from("client_alerts").insert(payload);

      if (error) throw error;

      addToast(
        "success",
        editingAlertId ? "Alerta atualizado" : "Alerta criado",
        "Salvo com sucesso.",
      );
      const wasEditing = !!editingAlertId;
      resetForm();
      onChanged?.();
      if (wasEditing) {
        setShowList(true);
        loadAlerts();
      }
    } catch (e: any) {
      addToast(
        "error",
        editingAlertId ? "Erro ao atualizar" : "Erro ao criar",
        e.message,
      );
    }
  }

  async function handleDelete(alertId: string) {
    const alertObj = alerts.find((a) => String(a.id) === String(alertId));
    const ok = await confirm({
      title: "Remover alerta",
      subtitle: "Este alerta será removido e não poderá ser recuperado.",
      tone: "rose",
      icon: "⚠️",
      details: [
        `Cliente: ${clientName}`,
        alertObj?.message
          ? `Alerta: ${String(alertObj.message).slice(0, 140)}`
          : "Alerta: —",
      ],
      confirmText: "Remover",
      cancelText: "Voltar",
    });
    if (!ok) return;

    try {
      const { error } = await supabaseBrowser
        .from("client_alerts")
        .delete()
        .eq("id", alertId);
      if (error) throw error;
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      onChanged?.();
    } catch (e: any) {
      addToast("error", "Erro ao excluir", e.message);
    }
  }

  // ✅ 02/10/2026: baixa manual REGISTRA o pagamento (antes só fechava o
  // sino e o valor nunca entrava no saldo) — settle_client_alert faz tudo
  // numa transação: renovação paga / linha no Log / uso do cupom / fecha.
  async function handleSettle(alertId: string) {
    try {
      const { data, error } = await supabaseBrowser.rpc("settle_client_alert", {
        p_tenant_id: tenantId,
        p_alert_id: alertId,
      });
      if (error) throw error;
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      const k = (data as any)?.kind;
      addToast(
        "success",
        "Marcado como pago",
        k === "renewal_trust"
          ? "Renovação registrada como paga hoje e lançada no Log do Portal."
          : k === "app_activation"
            ? "Pagamento do aplicativo lançado no Log do Portal."
            : "A pendência foi quitada.",
      );
      onChanged?.();
    } catch (e: any) {
      addToast("error", "Erro ao quitar", e.message);
    }
  }

  const bellSizeClasses = size === "lg" ? "p-2" : "p-1.5";
  const bellIconClasses = size === "lg" ? "w-4 h-4" : "w-3.5 h-3.5";
  const showButton = alertsCount > 0 || !hideWhenEmpty;

  return (
    <>
      {showButton && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            openBell();
          }}
          title={alertsCount > 0 ? `${alertsCount} alerta(s)` : "Novo alerta"}
          className={`relative ${bellSizeClasses} rounded-lg border transition-all ${
            alertsCount > 0
              ? "text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20"
              : "text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20"
          }`}
        >
          <Bell className={bellIconClasses} />
          {alertsCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
              {alertsCount}
            </span>
          )}
        </button>
      )}

      {showList && (
        <Modal
          title={`Alertas: ${clientName}${clientUsername ? ` (${clientUsername})` : ""}`}
          onClose={() => setShowList(false)}
        >
          <div className="space-y-3">
            {loadingList ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Carregando...
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/60 border-2 border-dashed border-border rounded-xl">
                <span className="text-2xl mb-2">✅</span>
                <p className="text-sm">Nenhum alerta pendente.</p>
              </div>
            ) : (
              alerts.map((alert) => {
                const hasAmount = alert.amount != null;
                const appName = alert.client_apps?.apps?.name as
                  string | undefined;
                const isToggledPaid = toggledPaidIds.has(String(alert.id));
                return (
                  <div
                    key={alert.id}
                    className="p-4 bg-muted/50 border border-border rounded-xl shadow-sm flex justify-between items-center gap-4"
                  >
                    <div className="text-left">
                      <div>
                        {hasAmount && (
                          <div className="text-sm font-bold text-foreground mb-0.5">
                            {formatMoney(
                              Number(alert.amount),
                              alert.currency || "BRL",
                            )}
                            {appName && (
                              <span className="ml-1.5 font-normal text-xs text-muted-foreground">
                                · {appName}
                              </span>
                            )}
                          </div>
                        )}
                        {alert.kind === "renewal_trust" && (
                          <span className="inline-flex items-center mb-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                            🤝 Em confiança
                          </span>
                        )}
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {alert.message || ""}
                        </p>
                        {alert.activation_date && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Ativado em{" "}
                            {new Date(
                              `${alert.activation_date}T12:00:00`,
                            ).toLocaleDateString("pt-BR")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasAmount && (
                        <ActionBtn
                          title={
                            isToggledPaid
                              ? "Pago (clique em Salvar pra confirmar)"
                              : "Marcar como pago"
                          }
                          tone={isToggledPaid ? "green" : "blue"}
                          onClick={() =>
                            setToggledPaidIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(String(alert.id)))
                                next.delete(String(alert.id));
                              else next.add(String(alert.id));
                              return next;
                            })
                          }
                        >
                          {isToggledPaid ? (
                            <ThumbsUp className="w-4 h-4" />
                          ) : (
                            <ThumbsDown className="w-4 h-4" />
                          )}
                        </ActionBtn>
                      )}
                      {isToggledPaid ? (
                        <button
                          onClick={() => {
                            handleSettle(alert.id);
                            setToggledPaidIds((prev) => {
                              const next = new Set(prev);
                              next.delete(String(alert.id));
                              return next;
                            });
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-colors"
                        >
                          Salvar
                        </button>
                      ) : (
                        <>
                          <ActionBtn
                            title="Editar"
                            tone="amber"
                            onClick={() => openEdit(alert)}
                          >
                            <Pencil className="w-4 h-4" />
                          </ActionBtn>
                          <ActionBtn
                            title="Excluir"
                            tone="red"
                            onClick={() => handleDelete(alert.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </ActionBtn>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            <div className="flex justify-between items-center pt-2 border-t border-border">
              <button
                onClick={openCreateFromList}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold transition-colors"
              >
                + Novo Alerta
              </button>
              <button
                onClick={() => setShowList(false)}
                className="px-4 py-2 rounded-lg text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showForm && (
        <Modal
          title={editingAlertId ? "Editar Alerta" : "Novo Alerta"}
          onClose={resetForm}
        >
          <div className="space-y-4">
            <div className="bg-purple-500/10 border border-purple-500/20 p-3 rounded-lg flex items-center gap-3">
              <span className="text-xl">🔔</span>
              <div className="text-sm text-foreground/90">
                {editingAlertId
                  ? "Editando alerta de"
                  : kind
                    ? "Para"
                    : "Adicionando alerta para"}{" "}
                <strong>{clientName}</strong>
                {clientUsername && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({clientUsername})
                  </span>
                )}
              </div>
            </div>

            {kind === null && (
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setKind("app_charge");
                    setActivationDate(isoDateToday());
                    loadClientApps();
                  }}
                  className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xl">📱</span>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      Ativação de aplicativo
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ativou ou renovou um app em confiança — o cliente ainda vai pagar.
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setKind("renewal_trust");
                    setTrustDate(isoDateToday());
                    void loadTrustInfo();
                  }}
                  className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xl">🤝</span>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      Renovação em confiança
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Renovou a mensalidade antes de receber — o cliente paga depois.
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setKind("note")}
                  className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xl">📝</span>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      Alerta normal
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Só um lembrete/observação, sem valor.
                    </div>
                  </div>
                </button>
              </div>
            )}

            {kind === "app_charge" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Aplicativo
                  </label>
                  <select
                    value={clientAppId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setClientAppId(id);
                      const app = clientApps.find((a) => a.id === id);
                      if (app?.licensePrice != null)
                        setAmount(String(app.licensePrice));
                      setText(
                        buildAppChargeMessage(
                          app?.appName ?? "",
                          activationDate,
                        ),
                      );
                    }}
                    disabled={loadingApps}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                  >
                    <option value="">
                      {loadingApps ? "Carregando..." : "Selecionar..."}
                    </option>
                    {clientApps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.appName}
                        {a.costType === "paid" ? "" : " (não pago)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Valor
                    </label>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Moeda
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    >
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Data de ativação (opcional)
                  </label>
                  <input
                    type="date"
                    value={activationDate}
                    onChange={(e) => {
                      const date = e.target.value;
                      setActivationDate(date);
                      const app = clientApps.find((a) => a.id === clientAppId);
                      if (app)
                        setText(buildAppChargeMessage(app.appName, date));
                    }}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                  />
                </div>

                {lockedCouponLabel ? (
                  <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 px-3 py-2">
                    🏷️ Cupom aplicado: <strong className="text-foreground">{lockedCouponLabel}</strong>
                  </p>
                ) : !editingAlertId && (
                  <div className="rounded-xl border border-border p-3 space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useCoupon}
                        onChange={(e) => {
                          setUseCoupon(e.target.checked);
                          if (e.target.checked && !couponCode) {
                            const app = clientApps.find((a) => a.id === clientAppId);
                            setCouponCode(randomCouponCode(app?.appName || "APP"));
                          }
                        }}
                        className="w-4 h-4 accent-purple-600"
                      />
                      Dar cupom de desconto
                    </label>
                    {useCoupon && (() => {
                      const base = Number(amount.replace(",", ".")) || 0;
                      const v = Number(couponValue.replace(",", ".")) || 0;
                      const disc = Math.min(base, couponType === "percent" ? (base * v) / 100 : v);
                      return (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              value={couponCode}
                              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                              className="col-span-3 sm:col-span-1 h-9 px-2 bg-transparent border border-border rounded-lg text-sm font-mono text-foreground outline-none focus:border-purple-500"
                              title="Código do cupom"
                            />
                            <select
                              value={couponType}
                              onChange={(e) => setCouponType(e.target.value as "percent" | "fixed")}
                              className="h-9 px-2 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                            >
                              <option value="percent">%</option>
                              <option value="fixed">{currency}</option>
                            </select>
                            <input
                              value={couponValue}
                              onChange={(e) => setCouponValue(e.target.value)}
                              placeholder={couponType === "percent" ? "Ex: 50" : "Ex: 10,00"}
                              inputMode="decimal"
                              className="h-9 px-2 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                            />
                          </div>
                          {disc > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Desconto {formatMoney(disc, currency)} → pendência de{" "}
                              <strong className="text-foreground">{formatMoney(base - disc, currency)}</strong>
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Observação
                  </label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full bg-transparent border border-border rounded-xl p-3 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[70px] text-sm resize-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Corrige se estiver errado.
                  </p>
                </div>
              </div>
            )}

            {kind === "renewal_trust" && (() => {
              const periodsAvail = PERIODS.filter(
                (p) => trustPrices.length === 0 || trustPrices.some((x) => x.period === p.value),
              );
              const screensAvail = [...new Set(trustPrices.map((x) => x.screens))].sort((a, b) => a - b);
              const updateAuto = (period: string, screens: number, date: string) => {
                setAmount(suggestTrustAmount(trustInfo, trustPrices, period, screens));
                const label = PERIODS.find((p) => p.value === period)?.label || "Mensal";
                setText(buildTrustMessage(label, screens, date));
              };
              return (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 px-3 py-2">
                    Só registra a pendência — não renova nada e não entra no saldo. Quando o cliente
                    pagar (portal ou baixa aqui no sino), o pagamento é lançado.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Período
                      </label>
                      <select
                        value={trustPeriod}
                        onChange={(e) => {
                          setTrustPeriod(e.target.value);
                          updateAuto(e.target.value, trustScreens, trustDate);
                        }}
                        className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                      >
                        {periodsAvail.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Telas
                      </label>
                      <select
                        value={trustScreens}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setTrustScreens(n);
                          updateAuto(trustPeriod, n, trustDate);
                        }}
                        className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                      >
                        {(screensAvail.length ? screensAvail : [trustScreens]).map((n) => (
                          <option key={n} value={n}>
                            {n} tela{n === 1 ? "" : "s"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Valor ({currency})
                      </label>
                      <input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0,00"
                        inputMode="decimal"
                        className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Renovado em
                      </label>
                      <input
                        type="date"
                        value={trustDate}
                        onChange={(e) => {
                          setTrustDate(e.target.value);
                          const label = PERIODS.find((p) => p.value === trustPeriod)?.label || "Mensal";
                          setText(buildTrustMessage(label, trustScreens, e.target.value));
                        }}
                        className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Observação
                    </label>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      className="w-full bg-transparent border border-border rounded-xl p-3 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[60px] text-sm resize-none"
                    />
                  </div>
                </div>
              );
            })()}

            {kind === "generic_charge" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Descrição da pendência
                  </label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full bg-transparent border border-border rounded-xl p-3 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[90px] text-sm resize-none"
                    placeholder="Ex: pagou R$20 a menos na última renovação"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Valor
                    </label>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                      Moeda
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                    >
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {kind === "note" && (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full bg-transparent border border-border rounded-xl p-4 text-foreground outline-none focus:border-purple-500 transition-colors min-h-[120px] text-sm resize-none"
                placeholder="Descreva o alerta deste cliente..."
                autoFocus
              />
            )}

            {kind !== null && (
              <div className="flex justify-between gap-3 pt-2">
                <button
                  onClick={() => setKind(null)}
                  className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
                >
                  ← Voltar
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={resetForm}
                    className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-medium transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-6 py-2 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-500 shadow-lg shadow-purple-900/20 text-sm transition-all"
                  >
                    {editingAlertId ? "Atualizar" : "Salvar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
});

export default ClientAlertBell;
