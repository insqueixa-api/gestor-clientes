"use client";
// app/admin/settings/cupons/cupom_modal.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTenantId } from "@/lib/tenant-context";
import { supabaseBrowser } from "@/lib/supabase/browser";
import FormattedDateInput from "@/components/ui/FormattedDateInput";
import ClientPicker, { PickedClient } from "./client_picker";
import {
  computeCouponImpact,
  computeSingleClientImpact,
  ImpactResult,
  ImpactClientRow,
} from "./impact_preview";

export type CouponEditPayload = {
  id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_total_redemptions: number | null;
  is_active: boolean;
  message_template: string | null;
  client_id: string | null;
  target_status: string[] | null;
  target_server_ids: string[] | null;
  target_plan_labels: string[] | null;
  target_app_names: string[] | null;
  rule_date_field: "vencimento" | "cadastro" | null;
  rule_days_min: number | null;
  rule_days_max: number | null;
  bot_visible: boolean;
};

const STATUS_OPTIONS = [
  { id: "ACTIVE", label: "Ativo" },
  { id: "OVERDUE", label: "Vencido" },
  { id: "TRIAL", label: "Teste" },
];

function fmtMoney(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function CupomModal({
  coupon,
  onClose,
  onSuccess,
  onError,
}: {
  coupon?: CouponEditPayload | null;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const resolvedTenantId = useTenantId();
  const isEdit = !!coupon?.id;

  const [code, setCode] = useState(coupon?.code ?? "");
  const [description, setDescription] = useState(coupon?.description ?? "");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    coupon?.discount_type ?? "percent",
  );
  const [discountValue, setDiscountValue] = useState(
    coupon?.discount_value != null ? String(coupon.discount_value) : "",
  );

  const [hasValidity, setHasValidity] = useState(
    !!(coupon?.starts_at || coupon?.ends_at),
  );
  const [startsAt, setStartsAt] = useState(
    toDateInputValue(coupon?.starts_at ?? null),
  );
  const [endsAt, setEndsAt] = useState(
    toDateInputValue(coupon?.ends_at ?? null),
  );

  const [targetStatus, setTargetStatus] = useState<string[]>(
    coupon?.target_status ?? [],
  );
  const [targetServerIds, setTargetServerIds] = useState<string[]>(
    coupon?.target_server_ids ?? [],
  );
  const [targetPlanLabels, setTargetPlanLabels] = useState<string[]>(
    coupon?.target_plan_labels ?? [],
  );
  const [targetAppNames, setTargetAppNames] = useState<string[]>(
    coupon?.target_app_names ?? [],
  );

  const [hasDateRule, setHasDateRule] = useState(!!coupon?.rule_date_field);
  const [ruleDateField, setRuleDateField] = useState<"vencimento" | "cadastro">(
    coupon?.rule_date_field ?? "cadastro",
  );
  const [hasMin, setHasMin] = useState(coupon?.rule_days_min != null);
  const [minSign, setMinSign] = useState<1 | -1>(
    coupon?.rule_days_min != null && coupon.rule_days_min < 0 ? -1 : 1,
  );
  const [minValue, setMinValue] = useState(
    coupon?.rule_days_min != null
      ? String(Math.abs(coupon.rule_days_min))
      : "365",
  );
  const [hasMax, setHasMax] = useState(coupon?.rule_days_max != null);
  const [maxSign, setMaxSign] = useState<1 | -1>(
    coupon?.rule_days_max != null && coupon.rule_days_max < 0 ? -1 : 1,
  );
  const [maxValue, setMaxValue] = useState(
    coupon?.rule_days_max != null
      ? String(Math.abs(coupon.rule_days_max))
      : "730",
  );

  const [auxServers, setAuxServers] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [auxApps, setAuxApps] = useState<{ id: string; label: string }[]>([]);
  const [auxPlans, setAuxPlans] = useState<{ id: string; label: string }[]>([]);

  const [hasMaxUses, setHasMaxUses] = useState(
    coupon?.max_total_redemptions != null,
  );
  const [maxTotalRedemptions, setMaxTotalRedemptions] = useState(
    coupon?.max_total_redemptions != null
      ? String(coupon.max_total_redemptions)
      : "",
  );

  const [messageTemplate, setMessageTemplate] = useState(
    coupon?.message_template ?? "",
  );
  const [isActive, setIsActive] = useState<boolean>(coupon?.is_active ?? true);
  const [botVisible, setBotVisible] = useState<boolean>(
    coupon?.bot_visible ?? false,
  );
  const [saving, setSaving] = useState(false);

  const [hasPersonalClient, setHasPersonalClient] = useState(
    !!coupon?.client_id,
  );
  const [personalClient, setPersonalClient] = useState<PickedClient | null>(
    null,
  );
  const [tenantId, setTenantId] = useState(resolvedTenantId || "");

  // Opções pros multi-selects de segmentação — mesmas fontes de
  // app/admin/gerenciador/cobranca/page.tsx (servers/apps/planos únicos).
  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    (async () => {
      const [srvRes, appRes, cliRes] = await Promise.all([
        supabaseBrowser
          .from("servers")
          .select("id, name")
          .eq("tenant_id", tenantId),
        supabaseBrowser
          .from("apps")
          .select("id, name")
          .eq("tenant_id", tenantId),
        supabaseBrowser
          .from("vw_clients_list_active")
          .select("plan_name")
          .eq("tenant_id", tenantId),
      ]);
      if (!alive) return;
      setAuxServers(
        ((srvRes.data as any[]) || []).map((s) => ({
          id: s.id,
          label: s.name,
        })),
      );
      // target_app_names guarda NOME (a view só expõe nome de app, não id).
      setAuxApps(
        ((appRes.data as any[]) || []).map((a) => ({
          id: a.name,
          label: a.name,
        })),
      );
      const uniquePlans = Array.from(
        new Set(
          ((cliRes.data as any[]) || [])
            .map((c) => c.plan_name)
            .filter(Boolean),
        ),
      );
      setAuxPlans(
        uniquePlans.map((p) => ({ id: String(p), label: String(p) })),
      );
    })();
    return () => {
      alive = false;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!coupon?.client_id) return;
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser
        .from("clients")
        .select("id, display_name, username:server_username")
        .eq("id", coupon.client_id)
        .maybeSingle();
      if (alive && data) setPersonalClient(data as PickedClient);
    })();
    return () => {
      alive = false;
    };
  }, [coupon?.client_id]);

  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [showImpactClients, setShowImpactClients] = useState(false);

  const [personalImpact, setPersonalImpact] = useState<ImpactClientRow | null>(
    null,
  );
  const [personalImpactLoading, setPersonalImpactLoading] = useState(false);

  function resolveDateRule() {
    if (!hasDateRule)
      return {
        ruleDateField: null,
        ruleDaysMin: null,
        ruleDaysMax: null,
      } as const;
    return {
      ruleDateField,
      ruleDaysMin: hasMin ? Number(minValue) * minSign : null,
      ruleDaysMax: hasMax ? Number(maxValue) * maxSign : null,
    };
  }

  async function handleCalculateImpact() {
    const val = Number(discountValue.replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) return;
    setImpactLoading(true);
    setImpactError(null);
    setImpactResult(null);
    try {
      if (!tenantId) throw new Error("Tenant não encontrado.");
      const result = await computeCouponImpact({
        tenantId,
        discountType,
        discountValue: val,
        excludeCouponId: coupon?.id,
        targetStatus: targetStatus.length ? targetStatus : null,
        targetServerIds: targetServerIds.length ? targetServerIds : null,
        targetPlanLabels: targetPlanLabels.length ? targetPlanLabels : null,
        targetAppNames: targetAppNames.length ? targetAppNames : null,
        ...resolveDateRule(),
      });
      setImpactResult(result);
    } catch (e: any) {
      setImpactError(e?.message || "Falha ao calcular impacto.");
    } finally {
      setImpactLoading(false);
    }
  }

  async function handleCalculatePersonalImpact() {
    if (!personalClient) return;
    const val = Number(discountValue.replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) return;
    setPersonalImpactLoading(true);
    setPersonalImpact(null);
    try {
      if (!tenantId) throw new Error("Tenant não encontrado.");
      const result = await computeSingleClientImpact({
        tenantId,
        clientId: personalClient.id,
        discountType,
        discountValue: val,
      });
      setPersonalImpact(result);
    } finally {
      setPersonalImpactLoading(false);
    }
  }

  const canSave = useMemo(() => {
    if (!code.trim()) return false;
    const val = Number(discountValue.replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) return false;
    if (discountType === "percent" && val > 100) return false;
    if (hasPersonalClient && !personalClient) return false;
    if (hasDateRule) {
      if (
        hasMin &&
        (!Number.isFinite(Number(minValue)) || Number(minValue) < 0)
      )
        return false;
      if (
        hasMax &&
        (!Number.isFinite(Number(maxValue)) || Number(maxValue) < 0)
      )
        return false;
      if (!hasMin && !hasMax) return false;
      if (hasMin && hasMax) {
        const min = Number(minValue) * minSign;
        const max = Number(maxValue) * maxSign;
        if (min > max) return false;
      }
    }
    if (hasMaxUses) {
      const max = Number(maxTotalRedemptions);
      if (!Number.isFinite(max) || max <= 0) return false;
    }
    return true;
  }, [
    code,
    discountValue,
    discountType,
    hasPersonalClient,
    personalClient,
    hasDateRule,
    hasMin,
    minValue,
    minSign,
    hasMax,
    maxValue,
    maxSign,
    hasMaxUses,
    maxTotalRedemptions,
  ]);

  async function handleSave() {
    if (!canSave) return;

    try {
      setSaving(true);
      if (!tenantId) throw new Error("Tenant não encontrado.");

      const dateRule = resolveDateRule();
      // Regras de segmentação e limite total de usos não fazem sentido pra
      // cupom pessoal (1 cliente só, autodesativa a cada uso).
      const payload: any = {
        code: code.trim().toUpperCase(),
        description: description.trim() || null,
        discount_type: discountType,
        discount_value: Number(discountValue.replace(",", ".")),
        currency: discountType === "fixed" ? "BRL" : null,
        client_id: hasPersonalClient ? (personalClient?.id ?? null) : null,
        target_status:
          !hasPersonalClient && targetStatus.length ? targetStatus : null,
        target_server_ids:
          !hasPersonalClient && targetServerIds.length ? targetServerIds : null,
        target_plan_labels:
          !hasPersonalClient && targetPlanLabels.length
            ? targetPlanLabels
            : null,
        target_app_names:
          !hasPersonalClient && targetAppNames.length ? targetAppNames : null,
        rule_date_field: !hasPersonalClient ? dateRule.ruleDateField : null,
        rule_days_min: !hasPersonalClient ? dateRule.ruleDaysMin : null,
        rule_days_max: !hasPersonalClient ? dateRule.ruleDaysMax : null,
        starts_at:
          hasValidity && startsAt
            ? new Date(`${startsAt}T00:00:00`).toISOString()
            : null,
        ends_at:
          hasValidity && endsAt
            ? new Date(`${endsAt}T23:59:59`).toISOString()
            : null,
        max_total_redemptions:
          !hasPersonalClient && hasMaxUses ? Number(maxTotalRedemptions) : null,
        message_template: messageTemplate.trim() || null,
        is_active: isActive,
        bot_visible: botVisible,
      };

      if (!isEdit) {
        payload.tenant_id = tenantId;
        const { error } = await supabaseBrowser.from("coupons").insert(payload);
        if (error) throw error;
        onSuccess();
        return;
      }

      const { error } = await supabaseBrowser
        .from("coupons")
        .update(payload)
        .eq("id", coupon!.id)
        .eq("tenant_id", tenantId);

      if (error) throw error;
      onSuccess();
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("duplicate key") || msg.includes("unique")) {
        onError("Já existe um cupom com esse código.");
      } else {
        onError(msg || "Falha ao salvar cupom.");
      }
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center px-3">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onMouseDown={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-border bg-transparent shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-medium text-foreground tracking-tight truncate">
                {isEdit ? "Editar Cupom" : "Novo Cupom"}
              </h2>
              <p className="text-xs sm:text-sm text-foreground/70 mt-1">
                Cupom de desconto usado na renovação pelo portal do cliente.
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-9 px-3 rounded-lg border border-border bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/70 transition-colors"
              type="button"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                Código
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ex: BLACKFRIDAY10"
                className="w-full h-10 rounded-xl border border-border bg-transparent px-3 text-sm font-mono text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                Descrição interna
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='Ex: "Campanha Black Friday 2026"'
                className="w-full h-10 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                Tipo de desconto
              </label>
              <select
                value={discountType}
                onChange={(e) =>
                  setDiscountType(e.target.value as "percent" | "fixed")
                }
                className="w-full h-10 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                {discountType === "percent" ? "Percentual" : "Valor"}
              </label>
              <div className="flex gap-2">
                {discountType === "fixed" && (
                  <span className="h-10 px-3 rounded-xl border border-border bg-muted text-sm text-muted-foreground flex items-center shrink-0">
                    R$
                  </span>
                )}
                <input
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === "percent" ? "10" : "10,00"}
                  inputMode="decimal"
                  className="w-full h-10 rounded-xl border border-border bg-transparent px-3 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-foreground/70 -mt-2">
            O desconto incide apenas sobre o valor do plano — pendências
            financeiras continuam cobradas 100%. Cupons funcionam apenas para
            clientes com plano em BRL.
          </p>

          {/* Validade */}
          <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground/90">
                  Validade
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Desligado = cupom definitivo (até ser desativado manualmente).
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHasValidity((v) => !v)}
                className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                  hasValidity
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {hasValidity ? "Definida" : "Sem validade"}
              </button>
            </div>

            {hasValidity && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                    Início
                  </label>
                  <FormattedDateInput
                    type="date"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                    Fim
                  </label>
                  <FormattedDateInput
                    type="date"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Cupom pessoal (indicação) */}
          <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground/90">
                  Cupom pessoal (indicação)
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Preso a um único cliente. Ex: 1 mês grátis por indicação.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHasPersonalClient((v) => !v)}
                className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                  hasPersonalClient
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {hasPersonalClient ? "Pessoal" : "Geral"}
              </button>
            </div>

            {hasPersonalClient && (
              <>
                <ClientPicker
                  tenantId={tenantId}
                  selected={personalClient}
                  onSelect={(c) => {
                    setPersonalClient(c);
                    setPersonalImpact(null);
                  }}
                  onClear={() => {
                    setPersonalClient(null);
                    setPersonalImpact(null);
                  }}
                />
                <p className="text-[11px] text-foreground/70">
                  Esse cupom fica preso a{" "}
                  {personalClient ? (
                    <strong>{personalClient.display_name}</strong>
                  ) : (
                    "este cliente"
                  )}
                  . Ele se autodesativa depois de usado uma vez — reative
                  manualmente quando quiser liberar de novo (ex: numa próxima
                  indicação).
                </p>

                {personalClient && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleCalculatePersonalImpact}
                      disabled={personalImpactLoading}
                      className="h-8 px-3 rounded-lg text-xs font-medium border border-sky-500/30 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                    >
                      {personalImpactLoading ? "Calculando..." : "Ver impacto"}
                    </button>

                    {personalImpact && (
                      <div className="mt-2 text-xs bg-muted/50 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Renovação normal x com cupom
                        </span>
                        <span className="font-medium text-foreground/90">
                          {fmtMoney(personalImpact.normalPrice)} →{" "}
                          <span className="text-emerald-500">
                            {fmtMoney(personalImpact.discountedPrice)}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Segmentação — mesmo motor de regras da Régua de Cobrança (só cupom geral) */}
          {!hasPersonalClient && (
            <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-3">
              <div>
                <div className="text-xs font-medium text-foreground/90">
                  Segmentação
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Vazio = sem filtro nessa dimensão (todos passam). Status vazio
                  = Ativo + Vencido (Teste não entra sem escolher).
                </div>
              </div>

              <MultiSelectDropdown
                label="Status do cliente"
                options={STATUS_OPTIONS}
                selected={targetStatus}
                onChange={setTargetStatus}
                emptyLabel="Ativo + Vencido (padrão)"
              />
              <MultiSelectDropdown
                label="Servidores"
                options={auxServers}
                selected={targetServerIds}
                onChange={setTargetServerIds}
              />
              <MultiSelectDropdown
                label="Planos"
                options={auxPlans}
                selected={targetPlanLabels}
                onChange={setTargetPlanLabels}
              />
              <MultiSelectDropdown
                label="Aplicativos"
                options={auxApps}
                selected={targetAppNames}
                onChange={setTargetAppNames}
              />
            </div>
          )}

          {/* Janela de dias (vencimento ou cadastro) — só cupom geral */}
          {!hasPersonalClient && (
            <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground/90">
                    Janela de dias
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Ex: cadastro entre 1 e 2 anos, ou vencimento entre 3 e 10
                    dias.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHasDateRule((v) => !v)}
                  className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                    hasDateRule
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {hasDateRule ? "Restrito" : "Sem regra"}
                </button>
              </div>

              {hasDateRule && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                      Campo de data
                    </label>
                    <select
                      value={ruleDateField}
                      onChange={(e) =>
                        setRuleDateField(
                          e.target.value as "vencimento" | "cadastro",
                        )
                      }
                      className="w-full h-9 rounded-lg border border-border bg-transparent px-2 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
                    >
                      <option value="cadastro">Cadastro</option>
                      <option value="vencimento">Vencimento</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DayBoundControl
                      label="A partir de"
                      disabledLabel="Sem mínimo"
                      enabled={hasMin}
                      onToggleEnabled={() => setHasMin((v) => !v)}
                      sign={minSign}
                      onSignChange={setMinSign}
                      value={minValue}
                      onValueChange={setMinValue}
                    />
                    <DayBoundControl
                      label="Até"
                      disabledLabel="Sem máximo"
                      enabled={hasMax}
                      onToggleEnabled={() => setHasMax((v) => !v)}
                      sign={maxSign}
                      onSignChange={setMaxSign}
                      value={maxValue}
                      onValueChange={setMaxValue}
                    />
                  </div>
                  <p className="text-[11px] text-foreground/70">
                    "Antes" = dias antes da data (ainda não chegou). "Depois" =
                    dias depois (já passou).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Limite total de usos (só cupom geral) */}
          {!hasPersonalClient && (
            <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground/90">
                    Limite total de usos
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Cada cliente só usa 1 vez de qualquer forma — isso limita o
                    total da campanha.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHasMaxUses((v) => !v)}
                  className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                    hasMaxUses
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {hasMaxUses ? "Limitado" : "Ilimitado"}
                </button>
              </div>

              {hasMaxUses && (
                <input
                  value={maxTotalRedemptions}
                  onChange={(e) => setMaxTotalRedemptions(e.target.value)}
                  placeholder="Ex: 100"
                  inputMode="numeric"
                  className="w-full h-9 rounded-lg border border-border bg-transparent px-2 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              )}
            </div>
          )}

          {/* Prévia de impacto (só cupom geral) */}
          {!hasPersonalClient && (
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground/90">
                    Prévia de impacto
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Quantos clientes seriam elegíveis hoje, e quanto renderia
                    normal x com cupom.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCalculateImpact}
                  disabled={impactLoading}
                  className="h-9 px-3 rounded-lg text-xs font-medium border border-sky-500/30 bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 transition-colors shrink-0 disabled:opacity-50"
                >
                  {impactLoading ? "Calculando..." : "Calcular impacto"}
                </button>
              </div>

              {impactError && (
                <p className="text-[11px] text-rose-500">{impactError}</p>
              )}

              {impactResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs bg-muted/50 rounded-lg px-3 py-2">
                    <span className="text-muted-foreground">
                      {impactResult.totalClients} cliente(s) elegível(is) —
                      estimativa em BRL
                    </span>
                    <span className="font-medium text-foreground/90">
                      {fmtMoney(impactResult.totalNormal)} →{" "}
                      <span className="text-emerald-500">
                        {fmtMoney(impactResult.totalDiscounted)}
                      </span>
                    </span>
                  </div>

                  {impactResult.totalClients > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowImpactClients((v) => !v)}
                      className="text-[11px] text-sky-500 hover:underline"
                    >
                      {showImpactClients
                        ? "Esconder lista de clientes"
                        : "Ver lista de clientes"}
                    </button>
                  )}

                  {showImpactClients && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {impactResult.groups.map((g) =>
                        g.accounts.length === 1 ? (
                          <div
                            key={g.key}
                            className="flex items-center justify-between px-3 py-1.5 text-[11px]"
                          >
                            <span className="text-foreground/90 truncate">
                              {g.name}{" "}
                              <span className="text-muted-foreground">
                                ({g.accounts[0].username})
                              </span>
                            </span>
                            <span className="text-muted-foreground shrink-0 ml-2">
                              {fmtMoney(g.accounts[0].normalPrice!)} →{" "}
                              <span className="text-emerald-500">
                                {fmtMoney(g.accounts[0].discountedPrice!)}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <div
                            key={g.key}
                            className="px-3 py-1.5 text-[11px] space-y-1"
                          >
                            <div className="font-medium text-foreground/90">
                              {g.name}{" "}
                              <span className="text-muted-foreground">
                                — {g.accounts.length} contas
                              </span>
                            </div>
                            <div className="pl-3 space-y-1">
                              {g.accounts.map((a) => (
                                <div
                                  key={a.id}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <span className="text-muted-foreground truncate">
                                    {a.username} ({a.serverName})
                                  </span>
                                  {a.eligible ? (
                                    <span className="text-muted-foreground shrink-0">
                                      {fmtMoney(a.normalPrice!)} →{" "}
                                      <span className="text-emerald-500">
                                        {fmtMoney(a.discountedPrice!)}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground/70 shrink-0">
                                      não elegível
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Frase da automação */}
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
              Frase para {"{cupom_frase}"} (opcional)
            </label>
            <textarea
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              placeholder={`Deixe em branco para usar a frase padrão. Tokens disponíveis: {codigo} e {desconto}.`}
              rows={3}
              className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
            />
            <p className="text-[11px] text-foreground/70 mt-1">
              Usada nas mensagens de cobrança automáticas, se o template incluir
              a tag {"{cupom_frase}"}. Fica vazia quando o cliente não tem cupom
              elegível.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-transparent px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground/90">
                Cupom ativo
              </div>
              <div className="text-[11px] text-muted-foreground">
                Se desativar, ele para de ser oferecido imediatamente.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-500 border-rose-500/20"
              }`}
            >
              {isActive ? "Ativo" : "Inativo"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-transparent px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground/90">
                Visível pro bot de atendimento
              </div>
              <div className="text-[11px] text-muted-foreground">
                Só cupons marcados aqui são elegíveis pro bot do WhatsApp
                mencionar sozinho (menu "Cupom de desconto" e respostas livres).
                Cupons de campanha que você divulga por conta própria devem
                ficar desmarcados.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setBotVisible((v) => !v)}
              className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                botVisible
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {botVisible ? "Visível" : "Oculto"}
            </button>
          </div>
        </div>

        <div className="p-5 border-t border-border bg-transparent flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-border bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/70 transition-colors"
            type="button"
            disabled={saving}
          >
            Cancelar
          </button>

          <button
            onClick={handleSave}
            className={`h-10 px-4 rounded-xl text-xs font-medium transition-colors ${
              canSave
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
            type="button"
            disabled={!canSave || saving}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/** Replica app/admin/gerenciador/cobranca/page.tsx (MultiSelectDropdown) — não é exportado de lá. */
function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  emptyLabel = "Todos (sem filtro)",
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const getLabel = () => {
    if (selected.length === 0) return emptyLabel;
    if (selected.length === 1)
      return options.find((o) => o.id === selected[0])?.label || selected[0];
    return `${selected.length} selecionados`;
  };

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full h-9 px-3 text-left rounded-lg border text-xs flex justify-between items-center transition-all ${
          open
            ? "border-emerald-500 ring-1 ring-emerald-500/20"
            : "border-border bg-transparent text-foreground/90"
        }`}
      >
        <span
          className={
            selected.length === 0
              ? "text-muted-foreground italic"
              : "font-medium"
          }
        >
          {getLabel()}
        </span>
        <span className="text-[10px] text-muted-foreground">▼</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col">
          <div className="max-h-48 overflow-y-auto p-1">
            {options.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Nenhuma opção disponível.
              </div>
            )}
            {options.map((opt) => (
              <div
                key={opt.id}
                onClick={() => toggleOption(opt.id)}
                className="px-3 py-2 hover:bg-muted cursor-pointer flex items-center gap-3 transition-colors rounded-lg"
              >
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                    selected.includes(opt.id)
                      ? "bg-emerald-500 border-emerald-500"
                      : "border-border"
                  }`}
                >
                  {selected.includes(opt.id) && (
                    <span className="text-[10px] text-white">✓</span>
                  )}
                </div>
                <span className="text-xs text-foreground/90 truncate">
                  {opt.label}
                </span>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-border bg-transparent">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium text-[11px] uppercase transition-colors"
            >
              Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Controle de "A partir de"/"Até" da janela de dias — toggle Antes/Depois + número. */
function DayBoundControl({
  label,
  disabledLabel,
  enabled,
  onToggleEnabled,
  sign,
  onSignChange,
  value,
  onValueChange,
}: {
  label: string;
  disabledLabel: string;
  enabled: boolean;
  onToggleEnabled: () => void;
  sign: 1 | -1;
  onSignChange: (s: 1 | -1) => void;
  value: string;
  onValueChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <button
          type="button"
          onClick={onToggleEnabled}
          className={`h-7 px-2 rounded-md text-[10px] font-medium border transition-colors ${
            enabled
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
              : "bg-muted text-muted-foreground border-border"
          }`}
        >
          {enabled ? "Definido" : disabledLabel}
        </button>
      </div>
      {enabled && (
        <div className="flex items-center gap-2">
          <div className="flex items-center shadow-sm rounded-lg overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => onSignChange(-1)}
              className={`px-2.5 py-1.5 border text-[11px] font-medium transition-colors ${
                sign === -1
                  ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
                  : "bg-muted border-border text-muted-foreground"
              }`}
            >
              Antes
            </button>
            <button
              type="button"
              onClick={() => onSignChange(1)}
              className={`px-2.5 py-1.5 border text-[11px] font-medium transition-colors ${
                sign === 1
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                  : "bg-muted border-border text-muted-foreground"
              }`}
            >
              Depois
            </button>
          </div>
          <input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            inputMode="numeric"
            className="w-20 h-8 text-center rounded-lg border border-border bg-transparent text-xs font-medium focus:border-emerald-500/50 outline-none transition-colors"
          />
          <span className="text-[11px] text-muted-foreground">dias</span>
        </div>
      )}
    </div>
  );
}
