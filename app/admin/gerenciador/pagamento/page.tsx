"use client";
// app/admin/gerenciador/pagamento/page.tsx
import { Pencil, Trash2, Camera, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import ToastNotifications, { ToastMessage } from "@/hooks/ToastNotifications";
import { useConfirm } from "@/hooks/useConfirm";
import {
  type PaymentGateway,
  GATEWAY_META,
  priorityLabel,
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
  onIconUpload,
  uploadingIcon,
}: {
  gateway: PaymentGateway;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  isDeleting?: boolean;
  onIconUpload: (file: File) => void;
  uploadingIcon?: boolean;
}) {
  const meta = GATEWAY_META.find((m) => m.type === gateway.type);
  if (!meta) return null;

  // ✅ 05/09/2026: fallback online mostra "Manual" em vez do número de
  // prioridade — o valor numérico dele não decide ordem nenhuma (create-
  // payment só usa is_manual_fallback=true, pega o 1º que achar), então
  // mostrar "2 — Secundário" ali confundia mais do que ajudava.
  const priorityLabelText = gateway.is_manual_fallback
    ? "Manual (fallback)"
    : `${gateway.priority} — ${priorityLabel(gateway.priority)}`;
  const customIconUrl = gateway.config?.icon_url as string | undefined;

  return (
    <div
      className={`bg-card border border-border rounded-xl shadow-sm overflow-hidden transition-opacity ${
        gateway.is_active ? "" : "opacity-70"
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-transparent border-b border-border flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* ✅ 04/09/2026, pedido do Márcio: ícone próprio por gateway
              (upload manual, sobrepõe o emoji padrão) — mesmo mecanismo de
              server_integrations.icon_url em api-server/page.tsx. */}
          <label className="relative w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center text-xl shrink-0 overflow-hidden cursor-pointer group shrink-0">
            {uploadingIcon ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : customIconUrl ? (
              <img src={customIconUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              meta.icon
            )}
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="w-3.5 h-3.5 text-white" />
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onIconUpload(file);
                e.target.value = "";
              }}
            />
          </label>

          <div className="min-w-0">
            <h3 className="font-medium text-foreground text-sm truncate">
              {gateway.name}
            </h3>

            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="gap-1 px-2 py-1 rounded-lg border border-border bg-muted text-[10px] font-medium tracking-tight shadow-sm text-muted-foreground">
                {priorityLabelText}
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
        {/* ✅ 05/09/2026, pedido do Márcio: link do painel do provedor (mesmo
            padrão de apps.info_url) — só aparece se cadastrado. */}
        {gateway.config?.dashboard_url && (
          <a
            href={gateway.config.dashboard_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-500 hover:underline truncate max-w-full block -mt-1"
          >
            🌐 {gateway.config.dashboard_url}
          </a>
        )}

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
  const [uploadingIconFor, setUploadingIconFor] = useState<string | null>(null);

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

  // ✅ 04/09/2026, pedido do Márcio: ícone próprio por gateway, mesmo
  // mecanismo de upload já usado em app/admin/settings/api-server/page.tsx
  // (presign → PUT direto no R2 → grava a URL pública). Aqui grava em
  // payment_gateways.config.icon_url (jsonb já existente, sem migração).
  async function handleIconUpload(gateway: PaymentGateway, file: File) {
    if (!file.type.startsWith("image/")) {
      addToast("error", "Arquivo inválido", "Selecione uma imagem.");
      return;
    }
    if (!tenantId) return;
    try {
      setUploadingIconFor(gateway.id);
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          folder: "payment_gateways",
        }),
      });
      const { presignedUrl, publicUrl } = await presignRes.json();
      await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { error } = await supabaseBrowser
        .from("payment_gateways")
        .update({ config: { ...gateway.config, icon_url: publicUrl } })
        .eq("id", gateway.id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      addToast("success", "Ícone salvo", "Ícone atualizado com sucesso.");
      await fetchGateways();
    } catch (e: any) {
      addToast("error", "Erro no upload", e?.message ?? "Falha ao enviar a imagem.");
    } finally {
      setUploadingIconFor(null);
    }
  }

  // ✅ 05/09/2026, pedido do Márcio: com 3-4+ gateways online na mesma
  // moeda, a ordem na tela deve refletir a sequência real (Principal,
  // Secundário, Terciário...) e os manuais (fallback, sem prioridade real
  // — create-payment só olha is_manual_fallback) sempre por último, nunca
  // misturados no meio pelo número de priority.
  function sortForDisplay(list: PaymentGateway[]): PaymentGateway[] {
    return [...list].sort((a, b) => {
      if (a.is_manual_fallback !== b.is_manual_fallback) {
        return a.is_manual_fallback ? 1 : -1;
      }
      return a.priority - b.priority;
    });
  }

  // Agrupar por moeda
  const brlGateways = sortForDisplay(gateways.filter((g) => g.currency.includes("BRL")));
  const intlGateways = sortForDisplay(
    gateways.filter(
      (g) =>
        g.currency.includes("USD") ||
        g.currency.includes("EUR") ||
        g.currency.includes("INTL"),
    ),
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
                        onIconUpload={(file) => handleIconUpload(g, file)}
                        uploadingIcon={uploadingIconFor === g.id}
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
                        onIconUpload={(file) => handleIconUpload(g, file)}
                        uploadingIcon={uploadingIconFor === g.id}
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
