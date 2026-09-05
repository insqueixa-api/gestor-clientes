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
  priorityLabel,
  MAX_PRIORITY,
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

  // ✅ 05/09/2026, pedido do Márcio: a lista de tipos ficava toda visível de
  // uma vez (8 cards) — feio e confuso, principalmente com FastPay/
  // FastFlow/DePix somados ao que já existia. Vira um assistente em 2
  // passos: 1) escolhe BRL ou Internacional, 2) só aí vê os tipos daquela
  // moeda, e ao escolher um, os outros somem (não é mais "grid + resumo
  // embaixo", é troca de tela mesmo). Editando um gateway existente pula
  // os 2 passos (já sabe currency+type).
  const isIntlType = (t: GatewayType) => {
    const m2 = GATEWAY_META.find((x) => x.type === t);
    return !!m2 && !m2.currencies.includes("BRL");
  };
  const [currencyGroup, setCurrencyGroup] = useState<"BRL" | "INTL" | null>(
    gateway ? (isIntlType(gateway.type) ? "INTL" : "BRL") : null,
  );
  const visibleMeta = GATEWAY_META.filter((m2) =>
    currencyGroup === "INTL" ? !m2.currencies.includes("BRL") : m2.currencies.includes("BRL"),
  );

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

      // ✅ 04/09/2026, pedido do Márcio: FastDePix não mostra o webhook
      // secret na tela de criação de chave (é um cadastro separado, "não
      // tenho acesso a isso") — o UniGestor cadastra o webhook sozinho
      // (POST /webhooks/register) toda vez que a Chave API muda, sem pedir
      // pro admin ver/colar nada. Só chama de novo se a chave mudou (ou
      // ainda não tem webhook_secret salvo) — não fica recadastrando à toa
      // a cada edição de outro campo (prioridade, status etc).
      let finalForm = form;
      if (
        (selectedType === "fastpay" || selectedType === "fastflow" || selectedType === "depix") &&
        form.api_key?.trim() &&
        (form.api_key !== gateway?.config?.api_key || !gateway?.config?.webhook_secret)
      ) {
        const { data: sess } = await supabase.auth.getSession();
        const accessToken = sess.session?.access_token;
        if (!accessToken) throw new Error("Sessão inválida. Atualize a página.");

        const whRes = await fetch("/api/admin/fastdepix/register-webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ api_key: form.api_key.trim() }),
        });
        const whJson = await whRes.json().catch(() => ({}));
        if (!whRes.ok || !whJson?.webhook_secret) {
          throw new Error(whJson?.error || "Falha ao cadastrar o webhook na FastDePix — confira se a Chave API está correta.");
        }
        finalForm = { ...form, webhook_secret: whJson.webhook_secret };
      }

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
        config: finalForm,
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
          {!isEdit && !currencyGroup && (
            <div className="space-y-3">
              <Label>Moeda</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCurrencyGroup("BRL")}
                  className="w-full p-5 rounded-xl border border-border bg-card hover:bg-muted/30 hover:border-emerald-500/40 transition-all text-left"
                >
                  <div className="text-2xl mb-1">🇧🇷</div>
                  <div className="font-medium text-foreground text-sm">BRL</div>
                  <div className="text-xs text-muted-foreground/70 mt-0.5">
                    Mercado Pago, FastPay, FastFlow, DePix, PIX Manual
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrencyGroup("INTL")}
                  className="w-full p-5 rounded-xl border border-border bg-card hover:bg-muted/30 hover:border-emerald-500/40 transition-all text-left"
                >
                  <div className="text-2xl mb-1">🌍</div>
                  <div className="font-medium text-foreground text-sm">Internacional</div>
                  <div className="text-xs text-muted-foreground/70 mt-0.5">
                    Stripe, Transferência (EUR/USD)
                  </div>
                </button>
              </div>
            </div>
          )}

          {!isEdit && currencyGroup && !selectedType && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Tipo de Integração ({currencyGroup === "INTL" ? "Internacional" : "BRL"})</Label>
                <button
                  type="button"
                  onClick={() => setCurrencyGroup(null)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Trocar moeda
                </button>
              </div>

              {helpType && (
                <HelpModal type={helpType} onClose={() => setHelpType(null)} />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleMeta.map((m) => {
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

          {/* Conteúdo do tipo selecionado — a partir daqui os passos 1/2 somem
              por completo (não fica grid + resumo juntos). */}
          {meta && (
            <>
              {!isEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedType(null);
                    setForm({});
                    setError(null);
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Trocar tipo
                </button>
              )}
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

                {/* ✅ 05/09/2026, pedido do Márcio: link externo pro painel do
                    provedor (mesmo padrão de apps.info_url) — opcional, guardado
                    em config.dashboard_url (jsonb, sem coluna/view nova). Só
                    aparece no card se preenchido. */}
                <div>
                  <Label>Link do Painel (opcional)</Label>
                  <Input
                    type="text"
                    value={form.dashboard_url || ""}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, dashboard_url: e.target.value }))
                    }
                    placeholder="https://..."
                  />
                  <p className="text-[11px] text-muted-foreground/60 mt-1">
                    Atalho pro dashboard do provedor — aparece como link no card, se preenchido.
                  </p>
                </div>
              </div>

              {/* Extras */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                <div>
                  <Label>Prioridade</Label>
                  <Select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                  >
                    {Array.from({ length: MAX_PRIORITY }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>{p} — {priorityLabel(p)}</option>
                    ))}
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
