"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useConfirm } from "@/app/admin/HookuseConfirm";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type GatewayType = "mercadopago" | "wise" | "pix_manual";

interface PaymentGateway {
  id: string;
  tenant_id: string;
  name: string;
  type: GatewayType;
  currency: string[];
  priority: number;
  is_active: boolean;
  is_online: boolean;
  is_manual_fallback: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface GatewayMeta {
  type: GatewayType;
  label: string;
  description: string;
  currencies: string[];
  is_online: boolean;
  icon: string;
  color: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "textarea";
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
}

// ─── GATEWAY METADATA ─────────────────────────────────────────────────────────

const GATEWAY_META: GatewayMeta[] = [
  {
    type: "mercadopago",
    label: "Mercado Pago",
    description: "PIX automático via API. Gateway principal para BRL.",
    currencies: ["BRL"],
    is_online: true,
    icon: "💳",
    color: "from-blue-500 to-cyan-500",
    fields: [
      {
        key: "access_token",
        label: "Access Token",
        type: "password",
        placeholder: "APP_USR-...",
        hint: "Encontre em: Mercado Pago → Credenciais → Credenciais de produção",
        required: true,
      },
      {
        key: "webhook_secret",
        label: "Webhook Secret",
        type: "password",
        placeholder: "Chave secreta para validar webhooks",
        hint: "Opcional — adicione uma chave aleatória para maior segurança",
      },
    ],
  },
  
  {
    type: "wise",
    label: "Wise",
    description: "Transferências internacionais em USD e EUR.",
    currencies: ["USD", "EUR"],
    is_online: true,
    icon: "🌍",
    color: "from-emerald-500 to-teal-500",
    fields: [
      {
        key: "api_token",
        label: "API Token",
        type: "password",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        hint: "Encontre em: Wise Business → Configurações → API tokens",
        required: true,
      },
      {
        key: "profile_id",
        label: "Profile ID",
        type: "text",
        placeholder: "12345678",
        hint: "ID do perfil business (visível na URL após login)",
        required: true,
      },
      {
        key: "source_currency",
        label: "Moeda de Origem",
        type: "select",
        options: [
          { value: "BRL", label: "BRL (Real Brasileiro)" },
          { value: "USD", label: "USD (Dólar Americano)" },
          { value: "EUR", label: "EUR (Euro)" },
        ],
        hint: "Moeda da sua conta Wise",
        required: true,
      },
    ],
  },
  {
    type: "pix_manual",
    label: "PIX Manual",
    description: "Chave PIX para templates de mensagem e fallback offline.",
    currencies: ["BRL"],
    is_online: false,
    icon: "📱",
    color: "from-violet-500 to-purple-500",
    fields: [
      {
        key: "pix_key",
        label: "Chave PIX",
        type: "text",
        placeholder: "CPF, CNPJ, email, telefone ou chave aleatória",
        required: true,
      },
      {
        key: "pix_key_type",
        label: "Tipo da Chave",
        type: "select",
        options: [
          { value: "cpf", label: "CPF" },
          { value: "cnpj", label: "CNPJ" },
          { value: "email", label: "E-mail" },
          { value: "phone", label: "Telefone" },
          { value: "random", label: "Chave Aleatória" },
        ],
        required: true,
      },
      {
        key: "holder_name",
        label: "Nome do Titular",
        type: "text",
        placeholder: "Nome que aparece no PIX",
        required: true,
      },
      {
        key: "bank_name",
        label: "Banco",
        type: "text",
        placeholder: "Ex: Mercado Pago, Wise, Itaú...",
      },
      {
        key: "instructions",
        label: "Instruções para o Cliente",
        type: "textarea",
        placeholder: "Ex: Após o pagamento, envie o comprovante pelo WhatsApp.",
        hint: "Texto exibido ao cliente quando o fallback manual for acionado",
      },
    ],
  },
];

const PRIORITY_LABELS: Record<number, string> = {
  1: "Principal",
  2: "Fallback",
};

// ─── UI (padrão Admin) ────────────────────────────────────────────────────────
function Label({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">
      {children}
    </label>
  );
}

function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full px-3 py-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors resize-none ${className}`}
    />
  );
}
// ─── MODAL ────────────────────────────────────────────────────────────────────

function GatewayModal({
  gateway,
  onClose,
  onSave,
}: {
  gateway: PaymentGateway | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const isEdit = !!gateway;

  const [selectedType, setSelectedType] = useState<GatewayType | null>(gateway?.type ?? null);
  const [form, setForm] = useState<Record<string, string>>(gateway?.config ?? {});
  const [priority, setPriority] = useState(gateway?.priority ?? 1);
  const [isActive, setIsActive] = useState(gateway?.is_active ?? true);
  const [isManualFallback, setIsManualFallback] = useState(gateway?.is_manual_fallback ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const meta = GATEWAY_META.find((m) => m.type === selectedType);

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
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Tenant inválido");

      const supabase = supabaseBrowser;

      // ✅ payload base (SEM tenant_id no UPDATE)
      const basePayload = {
        name: meta.label,
        type: selectedType,
        currency: meta.currencies,
        priority,
        is_active: isActive,
        is_online: meta.is_online,
        is_manual_fallback: selectedType === "pix_manual" ? isManualFallback : false,
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
        const { error: err } = await supabase
          .from("payment_gateways")
          .insert({
            tenant_id: tenantId,
            ...basePayload,
            created_at: new Date().toISOString(),
          });

        if (err) throw err;
      }

      onSave();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER MODAL */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 rounded-t-xl">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">
              {isEdit ? "Editar Integração" : "Nova Integração de Pagamento"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-white/60 mt-0.5">
              {isEdit ? "Atualize as configurações da integração" : "Configure uma nova forma de recebimento"}
            </p>
          </div>
<button
  onClick={onClose}
  className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
>
  <IconX />
</button>
        </div>

        {/* BODY */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Seletor de tipo (só na criação) */}
          {!isEdit && (
            <div className="space-y-3">
              <Label>Tipo de Integração</Label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GATEWAY_META.map((m) => {
                  const selected = selectedType === m.type;
                  return (
                    <button
                      key={m.type}
                      type="button"
                      onClick={() => {
                        setSelectedType(m.type);
                        setForm({});
                        setError(null);
                      }}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-500/10"
                          : "border-slate-200 dark:border-white/10 bg-white dark:bg-[#161b22] hover:bg-slate-50 dark:hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-xl">
                          {m.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 dark:text-white text-sm">
                            {m.label}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-white/60 mt-0.5 leading-tight">
                            {m.description}
                          </div>

                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {m.currencies.map((c) => (
                              <span
                                key={c}
                                className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10"
                              >
                                {c}
                              </span>
                            ))}
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                m.is_online
                                  ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                                  : "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
                              }`}
                            >
                              {m.is_online ? "Online" : "Manual"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Conteúdo do tipo selecionado */}
          {meta && (
            <>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-xl">
                    {meta.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 dark:text-white">{meta.label}</div>
                    <div className="text-xs text-slate-500 dark:text-white/60 truncate">{meta.description}</div>
                  </div>

                  <div className="ml-auto flex gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        meta.is_online
                          ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                          : "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
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
                      {field.label} {field.required && <span className="text-rose-500">*</span>}
                    </Label>

                    {field.type === "select" ? (
                      <Select
                        value={form[field.key] || ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
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
                        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <div className="relative">
                        <Input
                          type={field.type === "password" && !showSecrets[field.key] ? "password" : "text"}
                          value={form[field.key] || ""}
                          onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          className={field.type === "password" ? "pr-10" : ""}
                        />
                        {field.type === "password" && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs"
                            title={showSecrets[field.key] ? "Ocultar" : "Mostrar"}
                          >
                            {showSecrets[field.key] ? "🙈" : "👁️"}
                          </button>
                        )}
                      </div>
                    )}

                    {field.hint && (
                      <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">{field.hint}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Extras */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-white/10">
                <div>
                  <Label>Prioridade</Label>
                  <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                    <option value={1}>1 — Principal</option>
                    <option value={2}>2 — Fallback</option>
                  </Select>
                </div>

                <div>
                  <Label>Status</Label>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    className={`w-full h-10 px-3 rounded-lg border text-sm font-bold transition-colors ${
                      isActive
                        ? "border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-slate-600 dark:text-white/60"
                    }`}
                  >
                    {isActive ? "✅ Ativo" : "⭕ Inativo"}
                  </button>
                </div>
              </div>

              {/* PIX Manual — fallback */}
              {selectedType === "pix_manual" && (
                <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-violet-700 dark:text-violet-300">
                        Usar como Fallback
                      </p>
                      <p className="text-xs text-violet-600/80 dark:text-violet-300/70 mt-0.5">
                        Exibir ao cliente quando todos os gateways online falharem
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsManualFallback(!isManualFallback)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        isManualFallback ? "bg-violet-600" : "bg-slate-300 dark:bg-white/20"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
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
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* FOOTER MODAL */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-2 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-sm font-bold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedType}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving ? "Salvando..." : isEdit ? "Salvar Alterações" : "Criar Integração"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  const priorityLabel = PRIORITY_LABELS[gateway.priority] || `P${gateway.priority}`;

  return (
    <div
      className={`bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-sm overflow-hidden transition-opacity ${
        gateway.is_active ? "" : "opacity-70"
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 flex items-center justify-center text-xl shrink-0">
            {meta.icon}
          </div>

          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 dark:text-white text-sm truncate">
              {gateway.name}
            </h3>

            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-black/20 text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10">
                {priorityLabel}
              </span>

              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  gateway.is_online
                    ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                    : "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
                }`}
              >
                {gateway.is_online ? "Online" : "Manual"}
              </span>

              {gateway.is_manual_fallback && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                  Fallback
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Toggle ativo/inativo */}
        <button
          onClick={onToggle}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            gateway.is_active ? "bg-emerald-600" : "bg-slate-300 dark:bg-white/20"
          }`}
          title={gateway.is_active ? "Desativar" : "Ativar"}
        >
          <span
            className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
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
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10"
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
            const masked = isSecret ? `${raw.slice(0, 6)}${"•".repeat(10)}` : raw;

            return (
              <div key={field.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-400 dark:text-white/40 font-medium truncate">
                  {field.label}:
                </span>
                <span className="text-slate-600 dark:text-white/70 font-mono truncate max-w-[55%]">
                  {masked}
                </span>
              </div>
            );
          })}
        </div>

        {/* Ações */}
        <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
<button
  onClick={onEdit}
  className="flex-1 h-9 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 text-slate-700 dark:text-white/70 text-xs font-bold hover:bg-slate-100 dark:hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
>
  <IconEdit />
  Editar
</button>

<button
  onClick={onDelete}
  disabled={isDeleting}
  className="h-9 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-500/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
  title="Excluir"
>
  {isDeleting ? "..." : <IconTrash />}
</button>
        </div>
      </div>
    </div>
  );
}

// ─── FLUXO VISUAL ─────────────────────────────────────────────────────────────

function PaymentFlowDiagram({ gateways }: { gateways: PaymentGateway[] }) {
  const brlOnline = gateways
    .filter((g) => g.is_active && g.is_online && g.currency.includes("BRL"))
    .sort((a, b) => a.priority - b.priority);

  const intlOnline = gateways
    .filter((g) => g.is_active && g.is_online && (g.currency.includes("USD") || g.currency.includes("EUR")))
    .sort((a, b) => a.priority - b.priority);

  const manual = gateways.find((g) => g.type === "pix_manual" && g.is_active);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* BRL */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">
          Pagamentos BRL
        </p>

        <div className="space-y-2">
          {brlOnline.map((g, i) => {
            const meta = GATEWAY_META.find((m) => m.type === g.type);
            return (
              <div
                key={g.id}
                className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10"
              >
                <span className="text-sm">{meta?.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{g.name}</p>
                  <p className="text-[10px] text-slate-400 dark:text-white/40">{i === 0 ? "Principal" : "Fallback"}</p>
                </div>
                <span className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
              </div>
            );
          })}

          {manual && (
            <>
              <div className="flex items-center justify-center">
                <div className="text-[10px] text-slate-400 dark:text-white/40 flex items-center gap-1">
                  <span className="w-8 h-px bg-slate-200 dark:bg-white/10" />
                  se falhar
                  <span className="w-8 h-px bg-slate-200 dark:bg-white/10" />
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <span className="text-sm">📱</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-300 truncate">PIX Manual</p>
                  <p className="text-[10px] text-violet-600/80 dark:text-violet-300/70">Fallback offline</p>
                </div>
                <span className="w-2 h-2 bg-violet-500 rounded-full shrink-0" />
              </div>
            </>
          )}

          {brlOnline.length === 0 && !manual && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">
                ⚠️ Nenhum gateway BRL ativo
              </p>
            </div>
          )}
        </div>
      </div>

      {/* USD/EUR */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">
          Pagamentos USD/EUR
        </p>

        <div className="space-y-2">
          {intlOnline.map((g) => {
            const meta = GATEWAY_META.find((m) => m.type === g.type);
            return (
              <div
                key={g.id}
                className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10"
              >
                <span className="text-sm">{meta?.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{g.name}</p>
                  <p className="text-[10px] text-slate-400 dark:text-white/40">{g.currency.join(", ")}</p>
                </div>
                <span className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
              </div>
            );
          })}

          {intlOnline.length === 0 && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10">
              <p className="text-xs text-slate-400 dark:text-white/40">Nenhum gateway internacional</p>
            </div>
          )}
        </div>
      </div>

      {/* Templates */}
      <div>

        {manual ? (
          <div className="space-y-2">
      

     
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10">
            <p className="text-xs text-slate-400 dark:text-white/40">
              Adicione PIX Manual para usar nos templates
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function PagamentosPage() {
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGateway, setEditingGateway] = useState<PaymentGateway | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

    // --- TOAST + CONFIRM (padrão do admin) ---
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);

  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    const durationMs = 5000;
    setToasts((prev) => [...prev, { id, type, title, message, durationMs }]);
    setTimeout(() => removeToast(id), durationMs);
  };

  const { confirm: confirmDialog, ConfirmUI } = useConfirm();

  const fetchGateways = useCallback(async () => {
    try {
      const tenantId = await getCurrentTenantId();
      const { data, error } = await supabaseBrowser
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;
      setGateways((data as PaymentGateway[]) || []);
    } catch (err: any) {
      addToast("error", "Erro ao carregar gateways", err?.message ?? "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGateways();
  }, [fetchGateways]);

  async function handleToggle(gateway: PaymentGateway) {
    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) {
        addToast("error", "Tenant inválido", "Não foi possível identificar o tenant atual.");
        return;
      }

      const { error } = await supabaseBrowser
        .from("payment_gateways")
        .update({ is_active: !gateway.is_active, updated_at: new Date().toISOString() })
        .eq("id", gateway.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      setGateways((prev) =>
        prev.map((g) => (g.id === gateway.id ? { ...g, is_active: !g.is_active } : g))
      );
    } catch (err: any) {
      addToast("error", "Erro ao atualizar status", err?.message ?? "Erro inesperado.");
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
      const tenantId = await getCurrentTenantId();
      if (!tenantId) {
        addToast("error", "Tenant inválido", "Não foi possível identificar o tenant atual.");
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
    (g) => g.currency.includes("USD") || g.currency.includes("EUR")
  );

    return (
  <div className="space-y-6 pt-0 pb-6 px-0 sm:px-6 min-h-screen bg-slate-50 dark:bg-[#0f141a] transition-colors">
    {/* Toast + Confirm (sempre no topo, z alto) */}
    <div className="relative z-[999999] px-3 sm:px-0">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />
      {ConfirmUI}
    </div>

    {/* HEADER (padrão Clientes/Trials) */}
    <div className="flex items-center justify-between gap-2 mb-2 px-3 sm:px-0">
      <div className="min-w-0 text-left">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate text-slate-800 dark:text-white">
          Pagamentos
        </h1>
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
    <div className="px-3 sm:px-0 space-y-6">
        {/* Fluxo visual */}
        {!loading && gateways.length > 0 && (
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible">
            <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white">Fluxo de Pagamento Atual</h2>
                <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
                  {gateways.length}
                </span>
              </div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-white/50">
                fluxo
              </span>
            </div>

            <div className="p-3 sm:p-4">
              <PaymentFlowDiagram gateways={gateways} />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : gateways.length === 0 ? (
          <div className="bg-white dark:bg-[#161b22] border border-dashed border-slate-300 dark:border-white/10 rounded-none sm:rounded-xl p-10 text-center">
            <div className="text-5xl mb-3">💳</div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">
              Nenhuma integração configurada
            </h3>
            <p className="text-slate-500 dark:text-white/60 text-sm mb-6">
              Configure ao menos um gateway para habilitar renovações na Área do Cliente.
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
              <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible">
                <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white">Gateways BRL</h2>
                    <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
                      {brlGateways.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-white/50">
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
              <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-none sm:rounded-xl shadow-sm overflow-visible">
                <div className="px-3 sm:px-5 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white">Gateways Internacionais</h2>
                    <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
                      {intlGateways.length}
                    </span>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-white/50">
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

      {/* Modal */}
      {modalOpen && (
        <GatewayModal
          gateway={editingGateway}
          onClose={() => {
            setModalOpen(false);
            setEditingGateway(null);
          }}
          onSave={fetchGateways}
        />
      )}
    </div>
  );
}

function IconX() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>; }
function IconEdit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IconTrash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>; }
