"use client";
// components/alerts/ClientAlertBell.tsx
// Botão de sino de alerta/pendência financeira — reutilizável (Cliente lista,
// Cliente [id], Teste). Um único sino: se já tem alerta aberto, mostra a
// lista; se não tem nenhum, vai direto pra tela de criar. Grava sempre na
// mesma tabela (client_alerts), do mesmo jeito.

import { useState } from "react";
import { Bell, Pencil, Trash2, ThumbsUp, ThumbsDown, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useConfirm } from "@/hooks/useConfirm";

type AlertKind = "note" | "app_charge" | "generic_charge";

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

function buildAppChargeMessage(appName: string, activationDateISO: string) {
  if (!appName) return "";
  const datePart = activationDateISO
    ? new Date(`${activationDateISO}T12:00:00`).toLocaleDateString("pt-BR")
    : "";
  return datePart
    ? `Ativação do aplicativo ${appName} realizada no dia ${datePart}`
    : `Ativação do aplicativo ${appName}`;
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl border border-border max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="font-bold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
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

export default function ClientAlertBell({
  tenantId,
  clientId,
  clientName,
  alertsCount,
  onChanged,
  addToast,
  size = "sm",
}: {
  tenantId: string | null;
  clientId: string;
  clientName: string;
  alertsCount: number;
  onChanged?: () => void;
  addToast: (
    type: "success" | "error",
    title: string,
    message?: string,
  ) => void;
  size?: "sm" | "lg";
}) {
  const { confirm } = useConfirm();

  const [showList, setShowList] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [toggledPaidIds, setToggledPaidIds] = useState<Set<string>>(
    new Set(),
  );

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

  function openEdit(alert: any) {
    const inferredKind: AlertKind =
      alert.amount == null ? "note" : alert.client_app_id ? "app_charge" : "generic_charge";
    setEditingAlertId(String(alert.id));
    setKind(inferredKind);
    setText(alert.message || "");
    setAmount(alert.amount != null ? String(alert.amount) : "");
    setCurrency(alert.currency || "BRL");
    setClientAppId(alert.client_app_id || "");
    setActivationDate(alert.activation_date || "");
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
          addToast("error", "Selecione um app", "Escolha qual app gerou a pendência.");
          return;
        }
        const app = clientApps.find((a) => a.id === clientAppId);
        payload.client_app_id = clientAppId;
        payload.message =
          text.trim() || buildAppChargeMessage(app?.appName ?? "", activationDate);
        if (activationDate) payload.activation_date = activationDate;
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
      addToast("error", editingAlertId ? "Erro ao atualizar" : "Erro ao criar", e.message);
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

  async function handleSettle(alertId: string) {
    try {
      const { error } = await supabaseBrowser
        .from("client_alerts")
        .update({ status: "CLOSED", closed_at: new Date().toISOString() })
        .eq("id", alertId);
      if (error) throw error;
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      addToast("success", "Marcado como pago", "A pendência foi quitada.");
      onChanged?.();
    } catch (e: any) {
      addToast("error", "Erro ao quitar", e.message);
    }
  }

  const bellSizeClasses = size === "lg" ? "p-2.5" : "p-1.5";
  const bellIconClasses = size === "lg" ? "w-5 h-5" : "w-4 h-4";

  return (
    <>
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

      {showList && (
        <Modal
          title={`Alertas: ${clientName}`}
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
                  | string
                  | undefined;
                const isToggledPaid = toggledPaidIds.has(String(alert.id));
                return (
                  <div
                    key={alert.id}
                    className="p-4 bg-muted/50 border border-border rounded-xl shadow-sm flex justify-between items-center gap-4"
                  >
                    <div className="flex gap-3">
                      <span className="text-rose-500 mt-0.5">
                        {hasAmount ? "💰" : "⚠️"}
                      </span>
                      <div>
                        {hasAmount && (
                          <div className="text-sm font-bold text-foreground mb-0.5">
                            {formatMoney(Number(alert.amount), alert.currency || "BRL")}
                            {appName && (
                              <span className="ml-1.5 font-normal text-xs text-muted-foreground">
                                · {appName}
                              </span>
                            )}
                          </div>
                        )}
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {alert.message || ""}
                        </p>
                        {alert.activation_date && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Ativado em{" "}
                            {new Date(`${alert.activation_date}T12:00:00`).toLocaleDateString(
                              "pt-BR",
                            )}
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
                              if (next.has(String(alert.id))) next.delete(String(alert.id));
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
                          <ActionBtn title="Editar" tone="amber" onClick={() => openEdit(alert)}>
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
                {editingAlertId ? "Editando alerta de" : kind ? "Para" : "Adicionando alerta para"}{" "}
                <strong>{clientName}</strong>
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
                      Pendência de aplicativo
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ativou um app e o cliente ainda não pagou por ele.
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setKind("generic_charge")}
                  className="w-full text-left p-4 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors flex items-center gap-3"
                >
                  <span className="text-xl">💰</span>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      Pendência qualquer
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Outro valor em aberto (ex: pagou a menos numa renovação).
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
                      if (app?.licensePrice != null) setAmount(String(app.licensePrice));
                      setText(buildAppChargeMessage(app?.appName ?? "", activationDate));
                    }}
                    disabled={loadingApps}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                  >
                    <option value="">{loadingApps ? "Carregando..." : "Selecionar..."}</option>
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
                      if (app) setText(buildAppChargeMessage(app.appName, date));
                    }}
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-purple-500 transition-colors"
                  />
                </div>

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
}
