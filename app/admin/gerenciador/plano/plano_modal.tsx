"use client";
// app/admin/gerenciador/plano/plano_modal.tsx

import { useEffect, useState, useRef } from "react";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";

// --- Tipagens Enxutas ---
type Price = {
  screens_count: number;
  price_amount: number | null;
};

type Item = {
  id: string;
  period: string;
  credits_base: number;
  prices: Price[];
};

export type PlanRow = {
  id: string;
  tenant_id: string;
  name: string;
  currency: "BRL" | "USD" | "EUR";
  is_active: boolean;
  is_system_default: boolean;
  table_type: "iptv";
  created_at: string;
  items: Item[];
};

type Props = {
  plan?: PlanRow | null;
  onClose: () => void;
  onSuccess: () => void;
};

type EditableItem = {
  itemId: string;
  period: string;
  credits: number;
  price1: string;
  price2: string;
  price3: string;
};

const PERIOD_ORDER = [
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
];

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

// ✅ Função para enfileirar toasts que a página pai vai ler ao recarregar
function queueListToast(toast: {
  type: "success" | "error" | "warning";
  title: string;
  message?: string;
}) {
  try {
    if (typeof window === "undefined") return;
    const key = "planos_list_toasts"; // Chave específica para a página de planos
    const raw = window.sessionStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    arr.push({ ...toast, ts: Date.now() });
    window.sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

export default function PlanoModal({ plan, onClose, onSuccess }: Props) {
  const tenantId = useTenantId();
  const isEditing = !!plan;

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"BRL" | "USD" | "EUR">("BRL");
  const [originalCurrency, setOriginalCurrency] = useState<
    "BRL" | "USD" | "EUR"
  >("BRL");
  const [items, setItems] = useState<EditableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // --- TOAST STATE ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const TOAST_DURATION = 5000;
  const toastSeq = useRef(1);

  const addToast = (
    type: "success" | "error" | "warning",
    title: string,
    message?: string,
  ) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    setToasts((prev) => [
      ...prev,
      { id, type, title, message, durationMs: TOAST_DURATION },
    ]);
  };
  const removeToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  // Busca os itens da memória, e se estiver corrompido (vazio), gera na tela
  async function loadItemsFromPlan(planId: string) {
    if (!plan) return;

    const existingItems = plan.items || [];

    const ordered: EditableItem[] = PERIOD_ORDER.map((period) => {
      const item = existingItems.find((i) => i.period === period);
      if (item) {
        const pricesArr = Array.isArray(item.prices) ? item.prices : [];
        const p1 = pricesArr.find((p) => p.screens_count === 1);
        const p2 = pricesArr.find((p) => p.screens_count === 2);
        const p3 = pricesArr.find((p) => p.screens_count === 3);

        return {
          itemId: item.id,
          period: item.period,
          credits: item.credits_base || 0,
          price1: p1?.price_amount?.toString() ?? "",
          price2: p2?.price_amount?.toString() ?? "",
          price3: p3?.price_amount?.toString() ?? "",
        };
      } else {
        // ITEM FANTASMA: Resolve o bug visual da tabela vazia
        const creditsMap: Record<string, number> = {
          MONTHLY: 1,
          BIMONTHLY: 2,
          QUARTERLY: 3,
          SEMIANNUAL: 6,
          ANNUAL: 12,
        };
        return {
          itemId: `temp-${period}`,
          period: period,
          credits: creditsMap[period] || 1,
          price1: "",
          price2: "",
          price3: "",
        };
      }
    });

    setItems(ordered);
  }

  // Carregar dados iniciais
  useEffect(() => {
    async function loadData() {
      if (isEditing && plan) {
        setName(plan.name);
        setCurrency(plan.currency);
        setOriginalCurrency(plan.currency);
        await loadItemsFromPlan(plan.id);
      }
      setLoading(false);
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, isEditing]);

  // Clona da tabela padrão
  async function cloneFromDefault(curr: "BRL" | "USD" | "EUR") {
    setLoading(true);
    const supabase = supabaseBrowser;

    try {
      const { data: defaultTable } = await supabase
        .from("plan_tables")
        .select(
          `
          id,
          items:plan_table_items (
            id,
            period,
            months,
            credits_base,
            prices:plan_table_item_prices (
              screens_count,
              price_amount
            )
          )
        `,
        )
        .eq("tenant_id", tenantId)
        .eq("is_system_default", true)
        .eq("currency", curr)
        .eq("table_type", "iptv")
        .single();

      if (defaultTable && defaultTable.items && defaultTable.items.length > 0) {
        const clonedItems = (defaultTable.items as any[]).map(
          (srcItem: any) => {
            const pricesArr = Array.isArray(srcItem.prices)
              ? srcItem.prices
              : [];
            const p1 = pricesArr.find((p: any) => p.screens_count === 1);
            const p2 = pricesArr.find((p: any) => p.screens_count === 2);
            const p3 = pricesArr.find((p: any) => p.screens_count === 3);

            return {
              itemId: `temp-${srcItem.period}`,
              period: srcItem.period,
              credits: srcItem.credits_base || 0,
              price1: p1?.price_amount?.toString() ?? "",
              price2: p2?.price_amount?.toString() ?? "",
              price3: p3?.price_amount?.toString() ?? "",
            };
          },
        );

        const ordered = PERIOD_ORDER.map((period) =>
          clonedItems.find((m) => m.period === period),
        ).filter(Boolean) as EditableItem[];
        setItems(ordered);
      } else {
        const emptyItems: EditableItem[] = PERIOD_ORDER.map((period) => {
          const creditsMap: Record<string, number> = {
            MONTHLY: 1,
            BIMONTHLY: 2,
            QUARTERLY: 3,
            SEMIANNUAL: 6,
            ANNUAL: 12,
          };
          return {
            itemId: `temp-${period}`,
            period,
            credits: creditsMap[period] || 1,
            price1: "",
            price2: "",
            price3: "",
          };
        });
        setItems(emptyItems);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isEditing) {
      if (currency !== originalCurrency) cloneFromDefault(currency);
    } else {
      cloneFromDefault(currency);
    }
  }, [currency]);

  const handlePriceChange = (
    period: string,
    field: "price1" | "price2" | "price3",
    val: string,
  ) => {
    setItems((prev) =>
      prev.map((item) =>
        item.period === period ? { ...item, [field]: val } : item,
      ),
    );
  };

  async function handleSave() {
    if (!name.trim()) {
      addToast("warning", "Atenção", "Informe o nome da tabela.");
      return;
    }

    setSaving(true);
    const supabase = supabaseBrowser;

    if (!tenantId) {
      addToast(
        "error",
        "Erro de sessão",
        "Recarregue a página e tente novamente.",
      );
      setSaving(false);
      return;
    }

    try {
      const maxScreens = 3; // Fixo para IPTV
      const monthsMap: Record<string, number> = {
        MONTHLY: 1,
        BIMONTHLY: 2,
        QUARTERLY: 3,
        SEMIANNUAL: 6,
        ANNUAL: 12,
      };

      if (isEditing && plan) {
        // Atualiza a Tabela
        const { error: updErr } = await supabase
          .from("plan_tables")
          .update({ name: name.trim(), currency })
          .eq("id", plan.id)
          .eq("tenant_id", tenantId);

        if (updErr) throw new Error("Falha ao atualizar a tabela.");

        // ATUALIZAÇÃO SEGURA DOS PREÇOS (Com auto-reparo de tabelas vazias)
        for (const row of items) {
          let currentItemId = row.itemId;

          // Se for temp-, significa que o item fantasma foi preenchido. Vamos recriar no banco!
          if (currentItemId.startsWith("temp-")) {
            const { data: newItem } = await supabase
              .from("plan_table_items")
              .insert({
                tenant_id: tenantId,
                plan_table_id: plan.id,
                period: row.period,
                months: monthsMap[row.period] ?? 1,
                credits_base: row.credits || 1,
              })
              .select()
              .single();

            if (newItem) {
              currentItemId = newItem.id;
              // Insere os espaços de preços
              const pricesToInsert = [1, 2, 3].map((s) => ({
                tenant_id: tenantId,
                plan_table_item_id: currentItemId,
                screens_count: s,
                price_amount: null,
              }));
              await supabase
                .from("plan_table_item_prices")
                .insert(pricesToInsert);
            }
          }

          // Salva os valores digitados
          for (let screen = 1; screen <= maxScreens; screen++) {
            const val = row[`price${screen}` as keyof EditableItem] as string;
            const numVal = val === "" ? null : Number(val);
            if (numVal !== null && numVal < 0)
              throw new Error("Os preços não podem ser negativos.");

            await supabase
              .from("plan_table_item_prices")
              .update({ price_amount: numVal })
              .eq("plan_table_item_id", currentItemId)
              .eq("screens_count", screen);
          }
        }
      } else {
        // Criação de Tabela Nova
        const { data: tableData, error: tableError } = await supabase
          .from("plan_tables")
          .insert({
            tenant_id: tenantId,
            name: name.trim(),
            currency: currency,
            is_system_default: false,
            is_active: true,
            table_type: "iptv",
          })
          .select()
          .single();

        if (tableError) throw new Error("Falha ao criar tabela principal.");
        const newTableId = tableData.id;

        const getSafeNum = (val: string) => {
          if (!val) return null;
          const n = Number(val);
          return n >= 0 ? n : 0;
        };

        for (const item of items) {
          const { data: newItem, error: itemError } = await supabase
            .from("plan_table_items")
            .insert({
              tenant_id: tenantId,
              plan_table_id: newTableId,
              period: item.period,
              months: monthsMap[item.period] ?? 1,
              credits_base: item.credits || 1,
            })
            .select()
            .single();

          if (itemError || !newItem) {
            throw new Error(
              `Erro ao salvar item "${item.period}": ${itemError?.message || "resposta vazia"}`,
            );
          }

          const pricesToInsert = [
            {
              tenant_id: tenantId,
              plan_table_item_id: newItem.id,
              screens_count: 1,
              price_amount: getSafeNum(item.price1),
            },
            {
              tenant_id: tenantId,
              plan_table_item_id: newItem.id,
              screens_count: 2,
              price_amount: getSafeNum(item.price2),
            },
            {
              tenant_id: tenantId,
              plan_table_item_id: newItem.id,
              screens_count: 3,
              price_amount: getSafeNum(item.price3),
            },
          ];

          await supabase.from("plan_table_item_prices").insert(pricesToInsert);
        }
      }

      // ✅ Enfileira o aviso para a página pai exibir após o reload
      queueListToast({
        type: "success",
        title: isEditing ? "Tabela Atualizada" : "Tabela Criada",
        message: "Ação concluída com sucesso!",
      });

      // ✅ NOVO: Pequeno delay visual antes de fechar e recarregar a tabela de fundo
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 500);
    } catch (err: any) {
      addToast(
        "error",
        "Erro ao salvar",
        err?.message || "Ocorreu um erro inesperado.",
      );
    } finally {
      setSaving(false);
    }
  }

  // Adicione o estado 'mounted' logo após os outros states:

  const [mounted, setMounted] = useState(false); // ✅ NOVO

  // Adicione este useEffect para alterar o 'mounted' após o client carregar
  useEffect(() => {
    setMounted(true);
  }, []);

  const formatCurrency = (c: string) =>
    c === "BRL" ? "R$" : c === "USD" ? "$" : "€";

  // ✅ NOVO: Substitui o typeof document por !mounted
  if (!mounted) return null;

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      {/* Sistema de Notificação do Modal */}
      <div className="fixed inset-x-0 top-2 z-[999999] px-3 sm:px-6 pointer-events-none">
        <div className="pointer-events-auto">
          <ToastNotifications toasts={toasts} removeToast={removeToast} />
        </div>
      </div>

      <ModalHeader
        actions={
          <>
            <button
              onClick={onClose}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-muted-foreground hover:bg-muted text-xs sm:text-sm font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-3 sm:px-6 py-1.5 sm:py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs sm:text-sm font-medium shadow-lg shadow-emerald-900/20 transition-all"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </>
        }
      >
        <h2 className="text-base sm:text-lg font-medium text-foreground tracking-tight">
          {isEditing ? "Editar Tabela" : "Nova Tabela de Preço"}
        </h2>
      </ModalHeader>

          <ModalBody className="bg-card">
            <div className="p-4 sm:p-6 border-b border-border space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Nome da tabela</Label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Tabela especial revenda"
                    className="w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground/90 placeholder-muted-foreground outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50"
                  />
                </div>
                <div>
                  <Label>Moeda</Label>
                  <div className="flex bg-transparent border border-border rounded-lg p-1">
                    {(["BRL", "USD", "EUR"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCurrency(c)}
                        className={`flex-1 py-2 rounded-md text-xs font-medium transition-all uppercase tracking-wider
                          ${
                            currency === c
                              ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {isEditing && currency !== originalCurrency && (
                    <p className="text-[10px] text-amber-500 mt-2 italic">
                      * Atenção: valores resetados para tabela Padrão {currency}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6 space-y-8">
              {loading ? (
                <div className="text-center py-20 text-muted-foreground animate-pulse font-medium">
                  {isEditing ? "Carregando dados..." : "Preparando tabela..."}
                </div>
              ) : (
                [1, 2, 3].map((screenCount) => (
                  <div
                    key={screenCount}
                    className="animate-in slide-in-from-left-2 duration-300"
                  >
                    <h3 className="text-xs font-medium text-muted-foreground mb-3 ml-1 tracking-tight">
                      Preços para {screenCount}{" "}
                      {screenCount === 1 ? "Tela" : "Telas"}
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                      {PERIOD_ORDER.map((period) => {
                        const item = items.find((i) => i.period === period);
                        if (!item) return null;

                        const currentCredits = item.credits * screenCount;
                        const field = `price${screenCount}` as
                          "price1" | "price2" | "price3";
                        const value = item[field];

                        return (
                          <div
                            key={period}
                            className="bg-transparent border border-border rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col justify-center h-16 sm:h-20 relative focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all group"
                          >
                            <div className="flex justify-between items-center w-full mb-1">
                              <span className="text-[10px] sm:text-[11px] font-medium text-muted-foreground">
                                {PERIOD_LABELS[period]}
                              </span>
                              <span className="text-[8px] sm:text-[9px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-lg border border-emerald-500/10">
                                {currentCredits} cr
                              </span>
                            </div>

                            <div className="relative">
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">
                                {formatCurrency(currency)}
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                value={value}
                                disabled={false}
                                onChange={(e) =>
                                  handlePriceChange(
                                    period,
                                    field,
                                    e.target.value,
                                  )
                                }
                                className="w-full bg-transparent border-none p-0 pl-6 sm:pl-7 text-sm sm:text-base font-medium text-foreground focus:ring-0 outline-none placeholder-muted-foreground/60 transition-colors disabled:opacity-50"
                                placeholder="0,00"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ModalBody>

          <ModalFooter className="flex justify-between items-center">
            <span className="text-[10px] text-muted-foreground italic">
              *{" "}
              {isEditing
                ? "Altere o nome, moeda e valores conforme necessário"
                : "Ajuste os valores clonados da tabela padrão"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              A tabela será criada como <strong>ativa</strong> por padrão
            </span>
          </ModalFooter>
    </Modal>
  );
}
