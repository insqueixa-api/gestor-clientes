"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";

type Currency = "BRL" | "USD" | "EUR";

type ResellerServerRow = {
  reseller_server_id: string;
  tenant_id: string;

  reseller_id: string;
  reseller_name: string | null;
  reseller_is_archived: boolean | null;

  server_id: string;
  server_name: string | null;
  server_is_archived: boolean | null;

  // pode existir no seu view
  unit_price_override?: number | null;
};

interface Props {
  resellerId: string;
  resellerName: string;
  onClose: () => void;
  onDone: () => void;

  resellerServerId?: string | null;
  lockServer?: boolean;
  onError?: (msg: string) => void;
}

// --- HELPERS (integrais) ---
function onlyDigits(s: string) {
  return (s || "").replace(/\D+/g, "");
}

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function toNumberLoose(v: string) {
  const raw = String(v || "").trim();
  if (!raw) return NaN;

  // aceita pt-BR "1.234,56"
  if (raw.includes(",")) {
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  }

  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function toBRMoneyInput(n: number) {
  if (!Number.isFinite(n)) return "";
  return Number(n).toFixed(2).replace(".", ",");
}

// --- COMPONENTES VISUAIS PADRONIZADOS ---
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({
  children,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

async function loadFxRate(tid: string, currency: Currency) {
  if (currency === "BRL") return { rate: 1, asOf: null as string | null };

  const { data: fx, error: fxErr } = await supabaseBrowser
    .from("tenant_fx_rates")
    .select("usd_to_brl, eur_to_brl, as_of_date")
    .eq("tenant_id", tid)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fxErr) throw new Error(`Falha ao carregar câmbio: ${fxErr.message}`);

  const rate =
    currency === "USD"
      ? Number((fx as any)?.usd_to_brl ?? NaN)
      : Number((fx as any)?.eur_to_brl ?? NaN);

  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Câmbio inválido no tenant_fx_rates");

  const asOf = (fx as any)?.as_of_date ? String((fx as any).as_of_date) : null;
  return { rate, asOf };
}

export default function QuickRechargeModal({
  resellerId,
  resellerName,
  onClose,
  onDone,
  resellerServerId = null,
  lockServer = false,
  onError,
}: Props) {
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [servers, setServers] = useState<ResellerServerRow[]>([]);
  const [selectedResellerServerId, setSelectedResellerServerId] = useState<string>("");

  const [qtyCredits, setQtyCredits] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [unitPriceCurrency, setUnitPriceCurrency] = useState<string>("");

  const [fxRate, setFxRate] = useState<number>(1);
  const [fxAsOf, setFxAsOf] = useState<string | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);

  const [notes, setNotes] = useState<string>("");

  const [saving, setSaving] = useState(false);

  // --- Lógica derivada ---
  const qty = useMemo(() => {
    const n = Math.floor(Number(qtyCredits || 0));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [qtyCredits]);

  const unitCurrency = useMemo(() => toNumberLoose(unitPriceCurrency), [unitPriceCurrency]);

  const selectedLink = useMemo(() => {
    return servers.find((s) => String(s.reseller_server_id) === String(selectedResellerServerId)) || null;
  }, [servers, selectedResellerServerId]);

  const totalCurrency = useMemo(() => {
    if (!qty || !Number.isFinite(unitCurrency) || unitCurrency <= 0) return NaN;
    return qty * unitCurrency;
  }, [qty, unitCurrency]);

  const totalBRL = useMemo(() => {
    if (!Number.isFinite(totalCurrency) || totalCurrency <= 0) return NaN;
    if (currency === "BRL") return totalCurrency;

    if (!Number.isFinite(fxRate) || fxRate <= 0) return NaN;
    return totalCurrency * fxRate;
  }, [totalCurrency, currency, fxRate]);

  const canSave = useMemo(() => {
    if (!tenantId) return false;
    if (!selectedResellerServerId) return false;
    if (!selectedLink?.server_id) return false;

    if (!qty || qty <= 0) return false;
    if (!Number.isFinite(unitCurrency) || unitCurrency <= 0) return false;

    if (currency !== "BRL" && (!Number.isFinite(fxRate) || fxRate <= 0)) return false;
    if (!Number.isFinite(totalBRL) || totalBRL <= 0) return false;

    return true;
  }, [tenantId, selectedResellerServerId, selectedLink, qty, unitCurrency, currency, fxRate, totalBRL]);

  // --- Busca Inteligente: Histórico ou Override ---
  // --- VERSÃO DE DEBUG ---
  // --- Busca Inteligente: Histórico ou Override ---
  async function fetchSmartSuggestion(rsId: string) {
    if (!tenantId || !rsId) return;

    // 1. Tenta buscar a última venda no histórico
    const { data } = await supabaseBrowser.rpc("get_last_reseller_sale", {
      p_tenant_id: tenantId,
      p_reseller_server_id: rsId
    });

    // Se encontrou histórico
    if (data && data.length > 0) {
      const last = data[0];
      
      // Preenche Qtde (Check de null para aceitar 0 se necessário, embora improvável)
      if (last.last_qty != null) {
          setQtyCredits(String(last.last_qty));
      }
      
      // Preenche Preço
      if (last.last_unit_price != null) {
          setUnitPriceCurrency(toBRMoneyInput(Number(last.last_unit_price)));
      }
      
      // Preenche Moeda (Confia que vem certa: BRL, USD ou EUR)
      if (last.last_currency) {
        setCurrency(last.last_currency as Currency);
      }
      
      return; // Histórico venceu
    }

    // 2. Se NÃO tem histórico, tenta o Override
    const link = servers.find(s => String(s.reseller_server_id) === String(rsId));
    
    // Só aplica override se preço estiver vazio
    if (link && link.unit_price_override != null && !unitPriceCurrency) {
       setUnitPriceCurrency(toBRMoneyInput(Number(link.unit_price_override)));
    }
  }


  // --- Load tenant + servers (VIEW) ---
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setLoadErr(null);

        const tid = await getCurrentTenantId();
        if (!alive) return;
        setTenantId(tid);

        const { data, error } = await supabaseBrowser
          .from("vw_reseller_servers")
          .select("*")
          .eq("tenant_id", tid)
          .eq("reseller_id", resellerId)
          .eq("reseller_is_archived", false)
          .eq("server_is_archived", false)
          .order("server_name", { ascending: true });

        if (error) throw new Error(error.message);

        const list = (data || []) as any[];
        const mapped: ResellerServerRow[] = list.map((r) => ({
          reseller_server_id: String(r.reseller_server_id ?? r.id ?? ""),
          tenant_id: String(r.tenant_id ?? tid),

          reseller_id: String(r.reseller_id ?? resellerId),
          reseller_name: r.reseller_name ?? null,
          reseller_is_archived: r.reseller_is_archived ?? false,

          server_id: String(r.server_id ?? ""),
          server_name: r.server_name ?? null,
          server_is_archived: r.server_is_archived ?? false,

          unit_price_override:
            r.unit_price_override != null ? Number(r.unit_price_override) : null,
        }));

        if (!alive) return;
        setServers(mapped);

        // seleção inicial
        const preselect =
          resellerServerId && mapped.some((x) => String(x.reseller_server_id) === String(resellerServerId))
            ? String(resellerServerId)
            : mapped.length === 1
              ? String(mapped[0].reseller_server_id)
              : "";

        setSelectedResellerServerId(preselect);

        // preço default do vínculo (se existir)
        if (preselect) {
          const chosen = mapped.find((x) => String(x.reseller_server_id) === String(preselect));
          if (chosen?.unit_price_override != null && Number.isFinite(chosen.unit_price_override)) {
            setUnitPriceCurrency(toBRMoneyInput(Number(chosen.unit_price_override)));
          }
        }
      } catch (e: any) {
        if (!alive) return;
        setLoadErr(e?.message || "Erro ao carregar servidores vinculados");
        setServers([]);
        setSelectedResellerServerId("");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [resellerId, resellerServerId]);

// Quando troca servidor (ou quando o tenant termina de carregar): Dispara a sugestão
  useEffect(() => {
    // 1. Só roda se tiver servidor selecionado E se já tivermos o ID do tenant
    // Isso impede que rode antes da hora e falhe silenciosamente
    if (!selectedResellerServerId || !tenantId) return;

    // 2. Limpa os campos (opcional, mas bom pra UX)
    setQtyCredits("");
    setUnitPriceCurrency("");
    
    // 3. Chama a busca no banco
    fetchSmartSuggestion(selectedResellerServerId);

  }, [selectedResellerServerId, tenantId]); // <--- AGORA SIM: tenantId adicionado

  // --- FX (do banco) ---
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!tenantId) return;

        if (currency === "BRL") {
          setFxRate(1);
          setFxAsOf(null);
          setFxError(null);
          setFxLoading(false);
          return;
        }

        setFxLoading(true);
        setFxError(null);

        const { rate, asOf } = await loadFxRate(tenantId, currency);
        if (!alive) return;
        setFxRate(rate);
        setFxAsOf(asOf);
      } catch (e: any) {
        if (!alive) return;
        setFxError(e?.message || "Erro ao buscar câmbio");
      } finally {
        if (!alive) return;
        setFxLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [tenantId, currency]);

  async function onSave() {
    if (!canSave || saving) return;

    setSaving(true);
    try {
      if (!tenantId) throw new Error("Tenant inválido");
      if (!selectedLink?.server_id) throw new Error("Servidor inválido no vínculo");

      // 1) Busca dados do servidor para saber se tem integração
      const { data: serverData, error: serverErr } = await supabaseBrowser
        .from("servers")
        .select("panel_integration")
        .eq("id", selectedLink.server_id)
        .single();

      if (serverErr) throw new Error(serverErr.message);

      const hasIntegration = Boolean(serverData?.panel_integration);

      // 2) Prepara payload base
      const payload = {
        p_tenant_id: tenantId,
        p_server_id: selectedLink.server_id,
        p_reseller_server_id: selectedResellerServerId,
        p_credits_sold: qty,
        p_unit_price: unitCurrency,
        p_sale_currency: currency as any,
        p_total_amount_brl: totalBRL,
        p_notes: (notes || "").trim() || null,
      };

      if (hasIntegration) {
        // 3A) Servidor COM integração → salva log + sync
        const { error: saleErr } = await supabaseBrowser.rpc(
          "sell_credits_to_reseller_without_balance",
          payload as any
        );

        if (saleErr) throw new Error(saleErr.message);

        // 3B) Busca provider da integração
        const { data: integData, error: integErr } = await supabaseBrowser
          .from("server_integrations")
          .select("id, provider")
          .eq("id", serverData.panel_integration)
          .single();

        if (integErr) throw new Error(integErr.message);

        const provider = String(integData?.provider || "").toUpperCase();
        const syncUrl = provider === "FAST"
          ? "/api/integrations/fast/sync"
          : "/api/integrations/natv/sync";

        // 3C) Chama sync
        const syncRes = await fetch(syncUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ integration_id: serverData.panel_integration }),
        });

        const syncJson = await syncRes.json().catch(() => ({}));
        if (!syncRes.ok || !syncJson?.ok) {
          throw new Error("Venda registrada, mas falhou ao sincronizar saldo: " + (syncJson?.error || ""));
        }
      } else {
        // 4) Servidor SEM integração → venda normal (desconta saldo)
        const { error } = await supabaseBrowser.rpc(
          "sell_credits_to_reseller_and_log",
          payload as any
        );

        if (error) throw new Error(error.message);
      }

      await onDone();
      onClose();
    } catch (err: any) {
      const msg = err?.message || String(err);
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              Recarga rápida
            </h2>
            <div className="text-xs text-slate-500 dark:text-white/40 mt-0.5 font-medium">
              {resellerName}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors"
            aria-label="Fechar"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-6 overflow-y-auto bg-white dark:bg-[#161b22]">
          {loadErr && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm font-medium animate-in slide-in-from-top-2">
              <span className="font-bold">Erro:</span> {loadErr}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-slate-400 dark:text-white/20 animate-pulse font-medium">
              Carregando servidores...
            </div>
          ) : (
            <div className="space-y-6">
              {/* Servidor Selecionado */}
              <div className="animate-in slide-in-from-bottom-2 duration-300">
                <Label>Servidor vinculado</Label>
                <Select
                  value={selectedResellerServerId}
                  disabled={!!lockServer}
                  onChange={(e) => {
  if (lockServer) return;
  // Apenas atualiza o ID. O useEffect lá em cima fará toda a mágica (buscar histórico ou aplicar override).
  setSelectedResellerServerId(e.target.value);
  setNotes("");
}}
                >
                  <option value="">Selecione o servidor...</option>
                  {servers.map((s) => (
                    <option key={s.reseller_server_id} value={s.reseller_server_id}>
                      {s.server_name || "Servidor"}
                    </option>
                  ))}
                </Select>
                {lockServer && (
                  <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1 italic">
                    * Servidor travado para este contexto.
                  </p>
                )}
              </div>

              {/* Grid Principal */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="animate-in slide-in-from-bottom-3 duration-400">
                  <Label>Quantidade de créditos</Label>
                  <Input
                    value={qtyCredits}
                    onChange={(e) => setQtyCredits(onlyDigits(e.target.value))}
                    placeholder="Ex: 10"
                    className="font-bold text-center text-lg"
                    inputMode="numeric"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-bottom-3 duration-400">
                  <div>
                    <Label>Moeda</Label>
                    <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Preço unit.</Label>
                    <Input
                      value={unitPriceCurrency}
                      onChange={(e) => setUnitPriceCurrency(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                </div>
              </div>

              {/* FX automático (do banco) */}
              {currency !== "BRL" && (
                <div className="p-4 bg-sky-50 dark:bg-sky-500/10 rounded-xl border border-sky-100 dark:border-sky-500/20 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-1">
                    <Label>
                      <span className="flex justify-between">
                        Câmbio {currency} → BRL{" "}
                        {fxLoading && <span className="animate-pulse">...</span>}
                      </span>
                    </Label>

                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        step="0.0001"
                        value={Number.isFinite(fxRate) ? Number(fxRate).toFixed(4) : ""}
                        onChange={(e) => setFxRate(Number(e.target.value))}
                        className="col-span-2 h-10 px-3 bg-white dark:bg-black/30 border border-sky-200 dark:border-sky-500/30 rounded-lg text-slate-700 dark:text-white font-bold font-mono outline-none"
                      />
                      <div className="h-10 flex items-center justify-center px-2 bg-white dark:bg-black/30 border border-sky-200 dark:border-sky-500/30 rounded-lg text-[10px] text-slate-500 dark:text-white/50 font-semibold">
                        {fxError ? "Erro" : fxAsOf ? "AUTO" : "—"}
                      </div>
                    </div>

                    {fxError && (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                        {fxError}
                      </div>
                    )}

                    {fxAsOf && !fxError && (
                      <div className="text-[10px] text-slate-400 dark:text-white/30">
                        Última taxa registrada: <span className="font-mono">{fxAsOf}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label>Subtotal ({currency})</Label>
                    <div className="h-10 flex items-center px-3 bg-white dark:bg-black/30 border border-sky-200 dark:border-sky-500/30 rounded-lg text-slate-700 dark:text-white font-bold font-mono">
                      {Number.isFinite(totalCurrency) ? fmtMoney(currency, totalCurrency) : "—"}
                    </div>
                  </div>
                </div>
              )}

              {/* Totais Finais */}
              <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/5 flex justify-between items-center animate-in zoom-in-95 duration-500">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest">
                    Valor contábil final
                  </span>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight">
                    {Number.isFinite(totalBRL) ? fmtMoney("BRL", totalBRL) : "—"}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 dark:text-white/20 italic text-right max-w-[160px]">
                  Contabilidade processada em Reais (BRL).
                </div>
              </div>

              <div className="animate-in slide-in-from-bottom-4 duration-500">
                <Label>Observações internas (opcional)</Label>
                <textarea
                  className="w-full h-24 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-colors"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onSave().catch((err) => {
                      const msg = err?.message || String(err);
                      onError?.(msg);
                      setSaving(false);
                    })
                  }
                  disabled={!canSave || saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:hover:bg-emerald-600 disabled:opacity-50 text-white font-bold transition-colors"
                >
                  {saving ? "Salvando..." : "Confirmar recarga"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    typeof document !== "undefined" ? document.body : null
  );
}
