"use client";
// app/admin/settings/cupons/cupom_modal.tsx

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
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
  min_account_age_days: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_total_redemptions: number | null;
  is_active: boolean;
  message_template: string | null;
  client_id: string | null;
};

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
  const isEdit = !!coupon?.id;

  const [code, setCode] = useState(coupon?.code ?? "");
  const [description, setDescription] = useState(coupon?.description ?? "");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(
    coupon?.discount_type ?? "percent",
  );
  const [discountValue, setDiscountValue] = useState(
    coupon?.discount_value != null ? String(coupon.discount_value) : "",
  );

  const [hasValidity, setHasValidity] = useState(!!(coupon?.starts_at || coupon?.ends_at));
  const [startsAt, setStartsAt] = useState(toDateInputValue(coupon?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toDateInputValue(coupon?.ends_at ?? null));

  const [hasAgeRule, setHasAgeRule] = useState(coupon?.min_account_age_days != null);
  const [minAccountAgeDays, setMinAccountAgeDays] = useState(
    coupon?.min_account_age_days != null ? String(coupon.min_account_age_days) : "365",
  );

  const [hasMaxUses, setHasMaxUses] = useState(coupon?.max_total_redemptions != null);
  const [maxTotalRedemptions, setMaxTotalRedemptions] = useState(
    coupon?.max_total_redemptions != null ? String(coupon.max_total_redemptions) : "",
  );

  const [messageTemplate, setMessageTemplate] = useState(coupon?.message_template ?? "");
  const [isActive, setIsActive] = useState<boolean>(coupon?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const [hasPersonalClient, setHasPersonalClient] = useState(!!coupon?.client_id);
  const [personalClient, setPersonalClient] = useState<PickedClient | null>(null);
  const [tenantId, setTenantId] = useState("");

  useEffect(() => {
    getCurrentTenantId().then((tid) => setTenantId(tid || ""));
  }, []);

  useEffect(() => {
    if (!coupon?.client_id) return;
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser
        .from("clients")
        .select("id, display_name, username")
        .eq("id", coupon.client_id)
        .maybeSingle();
      if (alive && data) setPersonalClient(data as PickedClient);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupon?.client_id]);

  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [showImpactClients, setShowImpactClients] = useState(false);

  const [personalImpact, setPersonalImpact] = useState<ImpactClientRow | null>(null);
  const [personalImpactLoading, setPersonalImpactLoading] = useState(false);

  async function handleCalculateImpact() {
    const val = Number(discountValue.replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) return;
    setImpactLoading(true);
    setImpactError(null);
    setImpactResult(null);
    try {
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");
      const result = await computeCouponImpact({
        tenantId,
        discountType,
        discountValue: val,
        minAccountAgeDays: hasAgeRule ? Number(minAccountAgeDays) : null,
        excludeCouponId: coupon?.id,
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
      const tenantId = await getCurrentTenantId();
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
    if (hasAgeRule) {
      const days = Number(minAccountAgeDays);
      if (!Number.isFinite(days) || days <= 0) return false;
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
    hasAgeRule,
    minAccountAgeDays,
    hasMaxUses,
    maxTotalRedemptions,
  ]);

  async function handleSave() {
    if (!canSave) return;

    try {
      setSaving(true);
      const tenantId = await getCurrentTenantId();
      if (!tenantId) throw new Error("Tenant não encontrado.");

      const payload: any = {
        code: code.trim().toUpperCase(),
        description: description.trim() || null,
        discount_type: discountType,
        discount_value: Number(discountValue.replace(",", ".")),
        currency: discountType === "fixed" ? "BRL" : null,
        client_id: hasPersonalClient ? (personalClient?.id ?? null) : null,
        // Regra de campanha e limite total de usos não fazem sentido pra
        // cupom pessoal (1 cliente só, autodesativa a cada uso).
        min_account_age_days: !hasPersonalClient && hasAgeRule ? Number(minAccountAgeDays) : null,
        starts_at: hasValidity && startsAt ? new Date(`${startsAt}T00:00:00`).toISOString() : null,
        ends_at: hasValidity && endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
        max_total_redemptions: !hasPersonalClient && hasMaxUses ? Number(maxTotalRedemptions) : null,
        message_template: messageTemplate.trim() || null,
        is_active: isActive,
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
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
                onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")}
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
            O desconto incide apenas sobre o valor do plano — pendências financeiras continuam cobradas 100%.
            Cupons funcionam apenas para clientes com plano em BRL.
          </p>

          {/* Validade */}
          <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground/90">Validade</div>
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
                <div className="text-xs font-medium text-foreground/90">Cupom pessoal (indicação)</div>
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
                  {personalClient ? <strong>{personalClient.display_name}</strong> : "este cliente"}. Ele se
                  autodesativa depois de usado uma vez — reative manualmente quando quiser liberar de novo
                  (ex: numa próxima indicação).
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
                        <span className="text-muted-foreground">Renovação normal x com cupom</span>
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

          {/* Regra de campanha: idade da conta (só cupom geral) */}
          {!hasPersonalClient && (
          <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground/90">Regra de campanha</div>
                <div className="text-[11px] text-muted-foreground">
                  Ex: só clientes com mais de 1 ano de cadastro.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHasAgeRule((v) => !v)}
                className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                  hasAgeRule
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {hasAgeRule ? "Restrito" : "Todo mundo"}
              </button>
            </div>

            {hasAgeRule && (
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Cliente cadastrado há pelo menos (dias)
                </label>
                <input
                  value={minAccountAgeDays}
                  onChange={(e) => setMinAccountAgeDays(e.target.value)}
                  placeholder="365"
                  inputMode="numeric"
                  className="w-full h-9 rounded-lg border border-border bg-transparent px-2 text-sm text-foreground/90 outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
            )}
          </div>
          )}

          {/* Limite total de usos (só cupom geral) */}
          {!hasPersonalClient && (
          <div className="rounded-xl border border-border bg-transparent px-3 py-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground/90">Limite total de usos</div>
                <div className="text-[11px] text-muted-foreground">
                  Cada cliente só usa 1 vez de qualquer forma — isso limita o total da campanha.
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
                  <div className="text-xs font-medium text-foreground/90">Prévia de impacto</div>
                  <div className="text-[11px] text-muted-foreground">
                    Quantos clientes seriam elegíveis hoje, e quanto renderia normal x com cupom.
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

              {impactError && <p className="text-[11px] text-rose-500">{impactError}</p>}

              {impactResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs bg-muted/50 rounded-lg px-3 py-2">
                    <span className="text-muted-foreground">
                      {impactResult.totalClients} cliente(s) elegível(is) — estimativa em BRL
                    </span>
                    <span className="font-medium text-foreground/90">
                      {fmtMoney(impactResult.totalNormal)} →{" "}
                      <span className="text-emerald-500">{fmtMoney(impactResult.totalDiscounted)}</span>
                    </span>
                  </div>

                  {impactResult.totalClients > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowImpactClients((v) => !v)}
                      className="text-[11px] text-sky-500 hover:underline"
                    >
                      {showImpactClients ? "Esconder lista de clientes" : "Ver lista de clientes"}
                    </button>
                  )}

                  {showImpactClients && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {impactResult.clients.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between px-3 py-1.5 text-[11px]"
                        >
                          <span className="text-foreground/90 truncate">
                            {c.name} <span className="text-muted-foreground">({c.username})</span>
                          </span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            {fmtMoney(c.normalPrice)} →{" "}
                            <span className="text-emerald-500">{fmtMoney(c.discountedPrice)}</span>
                          </span>
                        </div>
                      ))}
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
              Usada nas mensagens de cobrança automáticas, se o template incluir a tag{" "}
              {"{cupom_frase}"}. Fica vazia quando o cliente não tem cupom elegível.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-transparent px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground/90">Cupom ativo</div>
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
