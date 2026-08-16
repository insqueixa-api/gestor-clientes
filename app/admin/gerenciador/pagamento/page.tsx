"use client";
// app/admin/gerenciador/pagamento/page.tsx
import { Pencil, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import {
  type PaymentGateway,
  GATEWAY_META,
  PRIORITY_LABELS,
} from "./shared";

const GatewayModal = dynamic(() => import("./GatewayModal"), {
  ssr: false,
});

// ─── CARD DO GATEWAY ──────────────────────────────────────────────────────────

function GatewayCard({
  gateway,
  onEdit,
  onDelete,
  onToggle,
  isDeleting,
}: {
  gateway: PaymentGateway;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  isDeleting?: boolean;
}) {
  const meta = GATEWAY_META.find((m) => m.type === gateway.type);
  if (!meta) return null;

  const priorityLabel =
    PRIORITY_LABELS[gateway.priority] || `P${gateway.priority}`;

  return (
    <div
      className={`bg-card border border-border rounded-xl shadow-sm overflow-hidden transition-opacity ${
        gateway.is_active ? "" : "opacity-70"
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-transparent border-b border-border flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center text-xl shrink-0">
            {meta.icon}
          </div>

          <div className="min-w-0">
            <h3 className="font-medium text-foreground text-sm truncate">
              {gateway.name}
            </h3>

            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="gap-1 px-2 py-1 rounded-lg border border-border bg-muted text-[10px] font-medium tracking-tight shadow-sm text-muted-foreground">
                {priorityLabel}
              </span>

              <span
                className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm border ${
                  gateway.is_online
                    ? "bg-sky-500/10 text-sky-500 border-sky-500/20"
                    : "bg-violet-500/10 text-violet-500 border-violet-500/20"
                }`}
              >
                {gateway.is_online ? "Automático" : "Manual"}
              </span>
            </div>
          </div>
        </div>

        {/* Toggle ativo/inativo */}
        <button
          onClick={onToggle}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            gateway.is_active ? "bg-emerald-600" : "bg-foreground/20"
          }`}
          title={gateway.is_active ? "Desativar" : "Ativar"}
        >
          <span
            className={`absolute top-1 w-4 h-4 bg-card rounded-full shadow transition-transform ${
              gateway.is_active ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Moedas */}
        <div className="flex flex-wrap gap-1.5">
          {gateway.currency.map((c) => (
            <span
              key={c}
              className="gap-1 px-2 py-1 rounded-lg border border-border bg-muted text-[10px] font-medium tracking-tight shadow-sm text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>

        {/* Campos configurados (mascara secrets) */}
        <div className="space-y-1.5">
          {meta.fields.slice(0, 2).map((field) => {
            const val = gateway.config?.[field.key];
            if (!val) return null;

            const raw = String(val);
            const isSecret = field.type === "password";
            const masked = isSecret
              ? `${raw.slice(0, 6)}${"•".repeat(10)}`
              : raw;

            return (
              <div
                key={field.key}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-muted-foreground/60 font-medium truncate">
                  {field.label}:
                </span>
                <span className="text-muted-foreground truncate max-w-[55%]">
                  {masked}
                </span>
              </div>
            );
          })}
        </div>

        {/* Ações */}
        <div className="flex gap-2 pt-2 border-t border-border">
          <button
            onClick={onEdit}
            className="flex-1 h-9 rounded-lg border border-border bg-transparent text-foreground/90 text-xs font-medium hover:bg-muted transition-colors flex items-center justify-center gap-2"
          >
            <IconEdit />
            Editar
          </button>

          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="h-9 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-500 text-xs font-medium hover:bg-rose-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            title="Excluir"
          >
            {isDeleting ? "..." : <IconTrash />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function PagamentosPage() {
  const tenantId = useTenantId();
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGateway, setEditingGateway] = useState<PaymentGateway | null>(
    null,
  );
  const [deleting, setDeleting] = useState<string | null>(null);

  // --- TOAST + CONFIRM (padrão do admin) ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  const removeToast = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const addToast = (
    type: "success" | "error",
    title: string,
    message?: string,
  ) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    const durationMs = 5000;
    setToasts((prev) => [...prev, { id, type, title, message, durationMs }]);
    setTimeout(() => removeToast(id), durationMs);
  };

  const { confirm: confirmDialog, ConfirmUI } = useConfirm();

  const fetchGateways = useCallback(async () => {
    try {
      if (!tenantId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;
      setGateways((data as PaymentGateway[]) || []);
    } catch (err: any) {
      addToast(
        "error",
        "Erro ao carregar gateways",
        err?.message ?? "Erro inesperado.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchGateways();
  }, [fetchGateways]);

  async function handleToggle(gateway: PaymentGateway) {
    try {
      if (!tenantId) {
        addToast(
          "error",
          "Tenant inválido",
          "Não foi possível identificar o tenant atual.",
        );
        return;
      }

      const { error } = await supabaseBrowser
        .from("payment_gateways")
        .update({
          is_active: !gateway.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", gateway.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      setGateways((prev) =>
        prev.map((g) =>
          g.id === gateway.id ? { ...g, is_active: !g.is_active } : g,
        ),
      );
    } catch (err: any) {
      addToast(
        "error",
        "Erro ao atualizar status",
        err?.message ?? "Erro inesperado.",
      );
    }
  }

  async function handleDelete(gateway: PaymentGateway) {
    const ok = await confirmDialog({
      tone: "rose",
      title: "Excluir integração de pagamento?",
      subtitle: `Você está prestes a excluir "${gateway.name}".`,
      details: ["Essa ação não pode ser desfeita."],
      confirmText: "Excluir",
      cancelText: "Voltar",
    });

    if (!ok) return;

    try {
      if (!tenantId) {
        addToast(
          "error",
          "Tenant inválido",
          "Não foi possível identificar o tenant atual.",
        );
        return;
      }

      setDeleting(gateway.id);

      const { error } = await supabaseBrowser
        .from("payment_gateways")
        .delete()
        .eq("id", gateway.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      setGateways((prev) => prev.filter((g) => g.id !== gateway.id));
      addToast("success", "Removido", "Integração excluída com sucesso.");
    } catch (err: any) {
      addToast("error", "Erro ao excluir", err?.message ?? "Erro inesperado.");
    } finally {
      setDeleting(null);
    }
  }

  // Agrupar por moeda
  const brlGateways = gateways.filter((g) => g.currency.includes("BRL"));
  const intlGateways = gateways.filter(
    (g) =>
      g.currency.includes("USD") ||
      g.currency.includes("EUR") ||
      g.currency.includes("INTL"),
  );

  return (
    <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-background transition-colors">
      {/* HEADER (padrão Clientes/Trials) */}
      <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
        <div className="min-w-0 text-left">
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate text-foreground">
              Pagamentos
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            onClick={() => {
              setEditingGateway(null);
              setModalOpen(true);
            }}
            className="h-9 md:h-10 px-3 md:px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2"
          >
            <span className="text-base leading-none">+</span>
            Nova Integração
          </button>
        </div>
      </div>
      {/* CONTEÚDO */}
      <div className="px-3 sm:px-0 space-y-6 pt-3 sm:pt-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : gateways.length === 0 ? (
          <div className="bg-card border border-dashed border-border rounded-xl p-10 text-center mx-0">
            <div className="text-5xl mb-3">💳</div>
            <h3 className="text-lg font-bold text-foreground mb-2">
              Nenhuma integração configurada
            </h3>
            <p className="text-foreground/70 text-sm mb-6">
              Configure ao menos um gateway para habilitar renovações na Área do
              Cliente.
            </p>
            <button
              onClick={() => {
                setEditingGateway(null);
                setModalOpen(true);
              }}
              className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all"
            >
              + Criar primeira integração
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* BRL */}
            {brlGateways.length > 0 && (
              <div className="bg-card border-y sm:border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible -mx-3 sm:mx-0">
                <div className="px-3 sm:px-5 py-3 bg-transparent border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium text-foreground">
                      Gateways BRL
                    </h2>
                    <span className="bg-emerald-500/10 text-emerald-500 gap-1 px-2 py-1 rounded-lg text-xs font-medium tracking-tight shadow-sm">
                      {brlGateways.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    BRL
                  </span>
                </div>

                <div className="p-3 sm:p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {brlGateways.map((g) => (
                      <GatewayCard
                        key={g.id}
                        gateway={g}
                        isDeleting={deleting === g.id}
                        onEdit={() => {
                          setEditingGateway(g);
                          setModalOpen(true);
                        }}
                        onDelete={() => handleDelete(g)}
                        onToggle={() => handleToggle(g)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Internacionais */}
            {intlGateways.length > 0 && (
              <div className="bg-card border-y sm:border border-border rounded-none sm:rounded-xl shadow-sm overflow-visible -mx-3 sm:mx-0">
                <div className="px-3 sm:px-5 py-3 bg-transparent border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium text-foreground">
                      Gateways Internacionais
                    </h2>
                    <span className="bg-emerald-500/10 text-emerald-500 gap-1 px-2 py-1 rounded-lg text-xs font-medium tracking-tight shadow-sm">
                      {intlGateways.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    USD/EUR
                  </span>
                </div>

                <div className="p-3 sm:p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {intlGateways.map((g) => (
                      <GatewayCard
                        key={g.id}
                        gateway={g}
                        isDeleting={deleting === g.id}
                        onEdit={() => {
                          setEditingGateway(g);
                          setModalOpen(true);
                        }}
                        onDelete={() => handleDelete(g)}
                        onToggle={() => handleToggle(g)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* espaço fixo pra não cortar popups */}
            <div className="h-24 md:h-20" />
          </div>
        )}
      </div>
      {/* Modal */}     {" "}
      {modalOpen && (
        <GatewayModal
          gateway={editingGateway}
          onClose={() => {
            setModalOpen(false);
            setEditingGateway(null);
          }}
          onSave={fetchGateways}
          addToast={addToast}
        />
      )}
      {/* Confirmação e Toasts */}
      {ConfirmUI}
      <ToastNotifications toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

function IconEdit() {
  return <Pencil className="w-4 h-4" />;
}
function IconTrash() {
  return <Trash2 className="w-4 h-4" />;
}
