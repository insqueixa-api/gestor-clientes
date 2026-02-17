"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";

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
  3: "Secundário",
};

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
  const [selectedType, setSelectedType] = useState<GatewayType | null>(
    gateway?.type ?? null
  );
  const [form, setForm] = useState<Record<string, string>>(
    gateway?.config ?? {}
  );
  const [priority, setPriority] = useState(gateway?.priority ?? 1);
  const [isActive, setIsActive] = useState(gateway?.is_active ?? true);
  const [isManualFallback, setIsManualFallback] = useState(
    gateway?.is_manual_fallback ?? false
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const meta = GATEWAY_META.find((m) => m.type === selectedType);

  async function handleSave() {
    if (!selectedType || !meta) return;

    const missingFields = meta.fields
      .filter((f) => f.required && !form[f.key]?.trim())
      .map((f) => f.label);

    if (missingFields.length > 0) {
      setError(`Campos obrigatórios: ${missingFields.join(", ")}`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const tenantId = await getCurrentTenantId();
      const supabase = supabaseBrowser;

      const payload = {
        tenant_id: tenantId,
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
          .update(payload)
          .eq("id", gateway.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from("payment_gateways")
          .insert({ ...payload, created_at: new Date().toISOString() });
        if (err) throw err;
      }

      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {isEdit ? "Editar Integração" : "Nova Integração de Pagamento"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEdit ? "Atualize as configurações da integração" : "Configure uma nova forma de recebimento"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Seletor de tipo (só na criação) */}
          {!isEdit && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3">
                Tipo de Integração
              </label>
              <div className="grid grid-cols-2 gap-3">
                {GATEWAY_META.map((m) => (
                  <button
                    key={m.type}
                    onClick={() => {
                      setSelectedType(m.type);
                      setForm({});
                    }}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      selectedType === m.type
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="text-2xl mb-1">{m.icon}</div>
                    <div className="font-bold text-slate-800 text-sm">{m.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-tight">{m.description}</div>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {m.currencies.map((c) => (
                        <span key={c} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded">
                          {c}
                        </span>
                      ))}
                      <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${m.is_online ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>
                        {m.is_online ? "Online" : "Manual"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Campos do gateway selecionado */}
          {meta && (
            <>
              <div className={`p-3 rounded-xl bg-gradient-to-r ${meta.color} text-white`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{meta.icon}</span>
                  <div>
                    <div className="font-bold">{meta.label}</div>
                    <div className="text-xs text-white/80">{meta.description}</div>
                  </div>
                </div>
              </div>

              {meta.fields.map((field) => (
                <div key={field.key}>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    {field.label} {field.required && <span className="text-red-400">*</span>}
                  </label>

                  {field.type === "select" ? (
                    <select
                      value={form[field.key] || ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    >
                      <option value="">Selecione...</option>
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      rows={3}
                      value={form[field.key] || ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
                    />
                  ) : (
                    <div className="relative">
                      <input
                        type={field.type === "password" && !showSecrets[field.key] ? "password" : "text"}
                        value={form[field.key] || ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 pr-10"
                      />
                      {field.type === "password" && (
                        <button
                          type="button"
                          onClick={() => setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                        >
                          {showSecrets[field.key] ? "🙈" : "👁️"}
                        </button>
                      )}
                    </div>
                  )}

                  {field.hint && (
                    <p className="text-[11px] text-slate-400 mt-1">{field.hint}</p>
                  )}
                </div>
              ))}

              {/* Configurações extras */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Prioridade
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    <option value={1}>1 — Principal</option>
                    <option value={2}>2 — Fallback</option>
                    <option value={3}>3 — Secundário</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    className={`w-full px-3 py-2.5 rounded-lg border-2 text-sm font-bold transition-all ${
                      isActive
                        ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  >
                    {isActive ? "✅ Ativo" : "⭕ Inativo"}
                  </button>
                </div>
              </div>

              {/* PIX Manual — fallback */}
              {selectedType === "pix_manual" && (
                <div className="p-3 rounded-xl bg-violet-50 border border-violet-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-violet-800">Usar como Fallback</p>
                      <p className="text-xs text-violet-600 mt-0.5">
                        Exibir ao cliente quando todos os gateways online falharem
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsManualFallback(!isManualFallback)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${isManualFallback ? "bg-violet-500" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isManualFallback ? "left-7" : "left-1"}`} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 bg-slate-50">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedType}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-sm hover:from-blue-600 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-200"
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
}: {
  gateway: PaymentGateway;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const meta = GATEWAY_META.find((m) => m.type === gateway.type);
  if (!meta) return null;

  return (
    <div className={`bg-white rounded-2xl border-2 shadow-sm transition-all ${gateway.is_active ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
      {/* Header do card */}
      <div className={`bg-gradient-to-r ${meta.color} p-4 rounded-t-2xl`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-2xl">
              {meta.icon}
            </div>
            <div>
              <h3 className="font-bold text-white text-base">{gateway.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-white/80 text-xs">
                  {PRIORITY_LABELS[gateway.priority] || `P${gateway.priority}`}
                </span>
                <span className="text-white/40">•</span>
                <span className="text-white/80 text-xs">
                  {gateway.currency.join(", ")}
                </span>
              </div>
            </div>
          </div>

          {/* Toggle ativo/inativo */}
          <button
            onClick={onToggle}
            className={`relative w-11 h-6 rounded-full transition-colors ${gateway.is_active ? "bg-white/30" : "bg-black/20"}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${gateway.is_active ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Status badges */}
        <div className="flex flex-wrap gap-2">
          <span className={`px-2 py-1 rounded-lg text-xs font-bold ${gateway.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {gateway.is_active ? "● Ativo" : "○ Inativo"}
          </span>
          <span className={`px-2 py-1 rounded-lg text-xs font-bold ${gateway.is_online ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"}`}>
            {gateway.is_online ? "⚡ Online" : "📋 Manual"}
          </span>
          {gateway.is_manual_fallback && (
            <span className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-700">
              🔄 Fallback
            </span>
          )}
        </div>

        {/* Campos configurados (mascara os secrets) */}
        <div className="space-y-1.5">
          {meta.fields.slice(0, 2).map((field) => {
            const val = gateway.config[field.key];
            if (!val) return null;
            const isSecret = field.type === "password";
            return (
              <div key={field.key} className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">{field.label}:</span>
                <span className="text-slate-600 font-mono">
                  {isSecret ? `${val.slice(0, 8)}${"•".repeat(8)}` : val}
                </span>
              </div>
            );
          })}
        </div>

        {/* Ações */}
        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button
            onClick={onEdit}
            className="flex-1 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold transition-colors border border-slate-200"
          >
            ✏️ Editar
          </button>
          <button
            onClick={onDelete}
            className="py-2 px-3 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 text-xs font-bold transition-colors border border-red-100"
          >
            🗑️
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
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        <span className="w-6 h-6 bg-slate-100 rounded-lg flex items-center justify-center text-xs">🔀</span>
        Fluxo de Pagamento Atual
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* BRL */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Pagamentos BRL</p>
          <div className="space-y-1.5">
            {brlOnline.map((g, i) => {
              const meta = GATEWAY_META.find((m) => m.type === g.type);
              return (
                <div key={g.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-sm">{meta?.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-700 truncate">{g.name}</p>
                    <p className="text-[10px] text-slate-400">{i === 0 ? "Principal" : "Fallback"}</p>
                  </div>
                  <span className="w-2 h-2 bg-emerald-400 rounded-full shrink-0" />
                </div>
              );
            })}
            {manual && (
              <>
                <div className="flex items-center justify-center">
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span className="w-8 h-px bg-slate-200" />
                    se falhar
                    <span className="w-8 h-px bg-slate-200" />
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-violet-50 border border-violet-100">
                  <span className="text-sm">📱</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-violet-700 truncate">PIX Manual</p>
                    <p className="text-[10px] text-violet-400">Fallback offline</p>
                  </div>
                  <span className="w-2 h-2 bg-violet-400 rounded-full shrink-0" />
                </div>
              </>
            )}
            {brlOnline.length === 0 && !manual && (
              <div className="p-2 rounded-lg bg-red-50 border border-red-100">
                <p className="text-xs text-red-500 font-medium">⚠️ Nenhum gateway BRL ativo</p>
              </div>
            )}
          </div>
        </div>

        {/* USD/EUR */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Pagamentos USD/EUR</p>
          <div className="space-y-1.5">
            {intlOnline.map((g) => {
              const meta = GATEWAY_META.find((m) => m.type === g.type);
              return (
                <div key={g.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-sm">{meta?.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-700 truncate">{g.name}</p>
                    <p className="text-[10px] text-slate-400">{g.currency.join(", ")}</p>
                  </div>
                  <span className="w-2 h-2 bg-emerald-400 rounded-full shrink-0" />
                </div>
              );
            })}
            {intlOnline.length === 0 && (
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                <p className="text-xs text-slate-400">Nenhum gateway internacional</p>
              </div>
            )}
          </div>
        </div>

        {/* Templates */}
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Templates WhatsApp</p>
          {manual ? (
            <div className="space-y-1.5">
              <div className="p-2 rounded-lg bg-violet-50 border border-violet-100">
                <p className="text-xs font-bold text-violet-700">{'{{pix_key}}'}</p>
                <p className="text-[10px] text-violet-500 mt-0.5 truncate">
                  {manual.config.pix_key || "Chave não configurada"}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-violet-50 border border-violet-100">
                <p className="text-xs font-bold text-violet-700">{'{{pix_holder}}'}</p>
                <p className="text-[10px] text-violet-500 mt-0.5 truncate">
                  {manual.config.holder_name || "Titular não configurado"}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
              <p className="text-xs text-slate-400">Adicione PIX Manual para usar nos templates</p>
            </div>
          )}
        </div>
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
    } catch (err) {
      console.error("Erro ao carregar gateways:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGateways();
  }, [fetchGateways]);

  async function handleToggle(gateway: PaymentGateway) {
    const { error } = await supabaseBrowser
      .from("payment_gateways")
      .update({ is_active: !gateway.is_active, updated_at: new Date().toISOString() })
      .eq("id", gateway.id);

    if (!error) {
      setGateways((prev) =>
        prev.map((g) => (g.id === gateway.id ? { ...g, is_active: !g.is_active } : g))
      );
    }
  }

  async function handleDelete(gateway: PaymentGateway) {
    if (!confirm(`Deletar integração "${gateway.name}"?`)) return;
    setDeleting(gateway.id);
    await supabaseBrowser.from("payment_gateways").delete().eq("id", gateway.id);
    setGateways((prev) => prev.filter((g) => g.id !== gateway.id));
    setDeleting(null);
  }

  // Agrupar por moeda
  const brlGateways = gateways.filter((g) => g.currency.includes("BRL"));
  const intlGateways = gateways.filter(
    (g) => g.currency.includes("USD") || g.currency.includes("EUR")
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              💳 Integrações de Pagamento
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Gerencie os gateways de pagamento usados na Área do Cliente
            </p>
          </div>
          <button
            onClick={() => {
              setEditingGateway(null);
              setModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-sm rounded-xl shadow-md shadow-blue-200 hover:from-blue-600 hover:to-indigo-700 transition-all"
          >
            <span className="text-base">+</span>
            Nova Integração
          </button>
        </div>

        {/* Fluxo visual */}
        {!loading && gateways.length > 0 && (
          <PaymentFlowDiagram gateways={gateways} />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : gateways.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
            <div className="text-5xl mb-4">💳</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Nenhuma integração configurada</h3>
            <p className="text-slate-500 text-sm mb-6">
              Configure ao menos um gateway de pagamento para habilitar renovações na Área do Cliente
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-sm rounded-xl shadow-md shadow-blue-200 hover:opacity-90 transition-opacity"
            >
              + Criar primeira integração
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* BRL */}
            {brlGateways.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-5 h-5 bg-slate-200 rounded flex items-center justify-center text-[10px]">R$</span>
                  Gateways BRL
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {brlGateways.map((g) => (
                    <GatewayCard
                      key={g.id}
                      gateway={g}
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
            )}

            {/* Internacional */}
            {intlGateways.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-5 h-5 bg-slate-200 rounded flex items-center justify-center text-[10px]">$€</span>
                  Gateways Internacionais
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {intlGateways.map((g) => (
                    <GatewayCard
                      key={g.id}
                      gateway={g}
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
            )}
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
