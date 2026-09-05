"use client";
// app/admin/gerenciador/pagamento/GatewayModal.tsx
import {
  useState,
  type ReactNode,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTenantId } from "@/lib/tenant-context";
import HelpModal from "./HelpModal";
import {
  type GatewayType,
  type PaymentGateway,
  GATEWAY_META,
  GATEWAY_HELP,
  IconX,
} from "./shared";

function Label({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full px-3 py-2.5 bg-transparent border border-border rounded-lg text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors resize-none ${className}`}
    />
  );
}

export default function GatewayModal({
  gateway,
  onClose,
  onSave,
  addToast,
}: {
  gateway: PaymentGateway | null;
  onClose: () => void;
  onSave: () => void;
  addToast: (
    type: "success" | "error",
    title: string,
    message?: string,
  ) => void;
}) {
  const tenantId = useTenantId();
  const isEdit = !!gateway;

  const [selectedType, setSelectedType] = useState<GatewayType | null>(
    gateway?.type ?? null,
  );
  const [form, setForm] = useState<Record<string, string>>(
    gateway?.config ?? {},
  );
  const [priority, setPriority] = useState(gateway?.priority ?? 1);
  const [isActive, setIsActive] = useState(gateway?.is_active ?? true);
  const [isManualFallback, setIsManualFallback] = useState(
    gateway?.is_manual_fallback ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const meta = GATEWAY_META.find((m) => m.type === selectedType);
  const [helpType, setHelpType] = useState<string | null>(null);

  async function handleSave() {
    if (!selectedType || !meta) return;

    const missingFields = meta.fields
      .filter((f) => f.required && !String(form[f.key] ?? "").trim())
      .map((f) => f.label);

    if (missingFields.length > 0) {
      setError(`Campos obrigatórios: ${missingFields.join(", ")}`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (!tenantId) throw new Error("Sessão inválida. Atualize a página.");

      const supabase = supabaseBrowser;

      const isFallbackType =
        selectedType === "pix_manual" ||
        selectedType === "transfer_manual_eur" ||
        selectedType === "transfer_manual_usd";
      // stripe nunca é fallback — já coberto pois não entra nessa condição

      const basePayload = {
        name: meta.label,
        type: selectedType,
        currency: meta.currencies,
        priority,
        is_active: isActive,
        is_online: meta.is_online,
        is_manual_fallback: isFallbackType ? isManualFallback : false,
        config: form,
        updated_at: new Date().toISOString(),
      };

      if (isEdit && gateway) {
        const { error: err } = await supabase
          .from("payment_gateways")
          .update(basePayload)
          .eq("id", gateway.id)
          .eq("tenant_id", tenantId);

        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("payment_gateways").insert({
          tenant_id: tenantId,
          ...basePayload,
          created_at: new Date().toISOString(),
        });

        if (err) throw err;
      }

      onSave();
      addToast(
        "success",
        isEdit ? "Integração atualizada" : "Integração criada",
        `${meta.label} configurado com sucesso.`,
      );
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-card border border-border rounded-xl shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* HEADER MODAL */}
        <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent rounded-t-xl">
          <div>
            <h2 className="text-lg font-medium text-foreground">
              {isEdit ? "Editar Integração" : "Nova Integração de Pagamento"}
            </h2>
            <p className="text-xs text-foreground/70 mt-0.5">
              {isEdit
                ? "Atualize as configurações da integração"
                : "Configure uma nova forma de recebimento"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <IconX />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 min-h-0 p-6 overflow-y-auto space-y-6">
          {/* Seletor de tipo (só na criação) */}
          {!isEdit && (
            <div className="space-y-3">
              <Label>Tipo de Integração</Label>

              {helpType && (
                <HelpModal type={helpType} onClose={() => setHelpType(null)} />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                               {" "}
                {GATEWAY_META.map((m) => {
                  const selected = selectedType === m.type;
                  const hasHelp = !!GATEWAY_HELP[m.type];
                  return (
                    <div key={m.type} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedType(m.type);
                          setForm({});
                          setError(null);
                        }}
                        className={`w-full p-4 rounded-xl border text-left transition-all ${
                          selected
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-border bg-card hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-transparent flex items-center justify-center text-xl shrink-0">
                            {m.icon}
                          </div>
                          <div className="min-w-0 pr-6">
                            <div className="font-medium text-foreground text-sm">
                              {m.label}
                            </div>
                            <div className="text-xs text-muted-foreground/70 mt-0.5 leading-tight">
                              {m.description}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {m.currencies.map((c) => (
                                <span
                                  key={c}
                                  className="gap-1 px-2 py-1 rounded-lg border border-border bg-muted text-[10px] font-medium tracking-tight shadow-sm text-muted-foreground"
                                >
                                  {c}
                                </span>
                              ))}
                              <span
                                className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm border ${
                                  m.is_online
                                    ? "bg-sky-500/10 text-sky-500 border-sky-500/20"
                                    : "bg-violet-500/10 text-violet-500 border-violet-500/20"
                                }`}
                              >
                                {m.is_online ? "Online" : "Manual"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>

                      {/* Botão de ajuda */}
                      {hasHelp && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHelpType(m.type);
                          }}
                          className="absolute top-3 right-3 w-6 h-6 rounded-full bg-transparent text-muted-foreground hover:bg-sky-500/20 hover:text-sky-500 transition-colors flex items-center justify-center text-xs font-medium"
                          title="Como obter as credenciais"
                        >
                          ?
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Conteúdo do tipo selecionado */}
          {meta && (
            <>
              <div className="p-4 rounded-xl bg-transparent border border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center text-xl overflow-hidden">
                    {gateway?.config?.icon_url ? (
                      <img src={gateway.config.icon_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      meta.icon
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">
                      {meta.label}
                    </div>
                    <div className="text-xs text-muted-foreground/70 truncate">
                      {meta.description}
                    </div>
                  </div>

                  <div className="ml-auto flex gap-1.5">
                    <span
                      className={`gap-1 px-2 py-1 rounded-lg text-[10px] font-medium tracking-tight shadow-sm border ${
                        meta.is_online
                          ? "bg-sky-500/10 text-sky-500 border-sky-500/20"
                          : "bg-violet-500/10 text-violet-500 border-violet-500/20"
                      }`}
                    >
                      {meta.is_online ? "Online" : "Manual"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Fields */}
              <div className="space-y-4">
                {meta.fields.map((field) => (
                  <div key={field.key}>
                    <Label>
                      {field.label}{" "}
                      {field.required && (
                        <span className="text-rose-500">*</span>
                      )}
                    </Label>

                    {field.type === "select" ? (
                      <Select
                        value={form[field.key] || ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Selecione...</option>
                        {field.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    ) : field.type === "textarea" ? (
                      <Textarea
                        rows={3}
                        value={form[field.key] || ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <div className="relative">
                        <Input
                          type={
                            field.type === "password" && !showSecrets[field.key]
                              ? "password"
                              : "text"
                          }
                          value={form[field.key] || ""}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          placeholder={field.placeholder}
                          className={field.type === "password" ? "pr-10" : ""}
                        />
                        {field.type === "password" && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowSecrets((prev) => ({
                                ...prev,
                                [field.key]: !prev[field.key],
                              }))
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/90 text-xs"
                            title={
                              showSecrets[field.key] ? "Ocultar" : "Mostrar"
                            }
                          >
                            {showSecrets[field.key] ? "🙈" : "👁️"}
                          </button>
                        )}
                      </div>
                    )}

                    {field.hint && (
                      <p className="text-[11px] text-muted-foreground/60 mt-1">
                        {field.hint}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Extras */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                <div>
                  <Label>Prioridade</Label>
                  <Select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                  >
                    <option value={1}>1 — Principal</option>
                    <option value={2}>2 — Secundário</option>
                  </Select>
                </div>

                <div>
                  <Label>Status</Label>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    className={`w-full h-10 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      isActive
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                        : "border-border bg-transparent text-muted-foreground"
                    }`}
                  >
                    {isActive ? "✅ Ativo" : "⭕ Inativo"}
                  </button>
                </div>
              </div>

              {/* Fallback Manual */}
              {(selectedType === "pix_manual" ||
                selectedType === "transfer_manual_eur" ||
                selectedType === "transfer_manual_usd") && (
                <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-violet-500">
                        Usar como Fallback
                      </p>
                      <p className="text-xs text-violet-500/70 mt-0.5">
                        Exibir ao cliente quando todos os gateways online
                        falharem
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsManualFallback(!isManualFallback)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        isManualFallback ? "bg-violet-600" : "bg-foreground/20"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 bg-card rounded-full shadow transition-transform ${
                          isManualFallback ? "left-7" : "left-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* FOOTER MODAL */}
        <div className="px-6 py-4 border-t border-border bg-transparent flex justify-end gap-2 sm:rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedType}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving
              ? "Salvando..."
              : isEdit
                ? "Salvar Alterações"
                : "Criar Integração"}
          </button>
        </div>
      </div>
    </div>
  );
}
