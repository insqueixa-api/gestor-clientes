"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";

// ============================================================
// TIPOS
// ============================================================
interface PlanTier {
  period: string;
  days: number;
  label: string;
  price: number | null;
  credits: number;
}

interface MessageTemplate {
  id: string;
  name: string;
  content: string;
}

interface Props {
  tenantId: string;
  role: "MASTER" | "USER";
  saasPlanTableId: string | null;
  creditBalance: number;
  currentExpiry: string | null;
  whatsappSessions: number;
  onClose: () => void;
  onSuccess: () => void;
}

// ============================================================
// CONSTANTES
// ============================================================
const PERIODS: { period: string; days: number; label: string }[] = [
  { period: "MONTHLY",    days: 30,  label: "Mensal"     },
  { period: "BIMONTHLY",  days: 60,  label: "Bimestral"  },
  { period: "QUARTERLY",  days: 90,  label: "Trimestral" },
  { period: "SEMIANNUAL", days: 180, label: "Semestral"  },
  { period: "ANNUAL",     days: 365, label: "Anual"      },
];

const BILLING_TZ = "America/Sao_Paulo";

function fmtDate(s?: string | null) {
  if (!s) return "--";
  return new Date(s).toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}

function calcNewExpiry(currentExpiry: string | null, days: number): string {
  const base = currentExpiry ? new Date(currentExpiry) : new Date();
  const isActive = currentExpiry ? new Date(currentExpiry) > new Date() : false;
  const start = isActive ? base : new Date();
  const result = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return result.toLocaleDateString("pt-BR", { timeZone: BILLING_TZ });
}

// --- HELPERS WHATSAPP ---
function extractWaNumberFromJid(jid?: unknown): string {
  if (typeof jid !== "string") return "";
  return jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
}
function formatBRPhoneFromDigits(digits: string): string {
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return `+${digits}`;
}
function buildWhatsAppSessionLabel(profile: any, sessionName: string): string {
  if (!profile?.connected) return `${sessionName} (não conectado)`;
  const digits = extractWaNumberFromJid(profile?.jid);
  const pretty = formatBRPhoneFromDigits(digits);
  return `${sessionName} • ${pretty || "Conectado"}`;
}

function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`relative w-12 h-7 rounded-full transition-colors border ${checked ? "bg-emerald-600 border-emerald-600" : "bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/10"}`}
      aria-pressed={checked}>
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// ============================================================
// MODAL PRINCIPAL
// ============================================================
export default function SaasProfileRenewModal({
  tenantId,
  role,
  saasPlanTableId,
  creditBalance,
  currentExpiry,
  whatsappSessions,
  onClose,
  onSuccess,
}: Props) {
  // "select" | "own_balance" | "auto" | "buy_credits"
  const [step, setStep] = useState<"select" | "own_balance" | "auto" | "buy_credits">(
    role === "USER" ? "auto" : "select"
  );

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingText, setLoadingText] = useState("Renovando...");
  const [error, setError] = useState<string | null>(null);

  // Plano
  const [tiers, setTiers] = useState<PlanTier[]>([]);
  const [currency, setCurrency] = useState("BRL");
  const [selectedPeriod, setSelectedPeriod] = useState("MONTHLY");

  // WhatsApp
  const [sendWhats, setSendWhats] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [selectedSession, setSelectedSession] = useState("default");
  const [sessionOptions, setSessionOptions] = useState<{ id: string; label: string }[]>([
    { id: "default", label: "Carregando..." },
  ]);
  const [notes, setNotes] = useState("");

  const isFirstRender = useRef(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTier = useMemo(
    () => tiers.find(t => t.period === selectedPeriod) ?? null,
    [tiers, selectedPeriod]
  );

  const creditsNeeded = useMemo(() => {
    if (!selectedTier) return 0;
    return selectedTier.credits * whatsappSessions;
  }, [selectedTier, whatsappSessions]);

  const hasSufficientBalance = creditsNeeded <= creditBalance;

  const newExpiry = useMemo(() => {
    if (!selectedTier) return "--";
    return calcNewExpiry(currentExpiry, selectedTier.days);
  }, [selectedTier, currentExpiry]);

  // ── Carrega sessões WA ──
  async function loadSessions() {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/whatsapp/profile", { cache: "no-store" }).catch(() => null),
        fetch("/api/whatsapp/profile2", { cache: "no-store" }).catch(() => null),
      ]);
      const p1 = r1?.ok ? await r1.json().catch(() => ({})) : {};
      const p2 = r2?.ok ? await r2.json().catch(() => ({})) : {};
      const n1 = typeof window !== "undefined" ? localStorage.getItem("wa_label_1") || "Contato Principal" : "Contato Principal";
      const n2 = typeof window !== "undefined" ? localStorage.getItem("wa_label_2") || "Contato Secundário" : "Contato Secundário";
      setSessionOptions([
        { id: "default", label: buildWhatsAppSessionLabel(p1, n1) },
        { id: "session2", label: buildWhatsAppSessionLabel(p2, n2) },
      ]);
    } catch {}
  }

  // ── Carrega tiers quando entra em "own_balance" ──
  useEffect(() => {
    if (step !== "own_balance") return;
    if (!saasPlanTableId) return;

    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [, tblRes, itemsRes, tmplRes] = await Promise.all([
          loadSessions(),
          supabaseBrowser.from("plan_tables").select("currency").eq("id", saasPlanTableId).single(),
          supabaseBrowser.from("plan_table_items")
            .select(`id, period, credits_base, prices:plan_table_item_prices(screens_count, price_amount)`)
            .eq("plan_table_id", saasPlanTableId),
          supabaseBrowser.from("message_templates").select("id, name, content")
            .eq("tenant_id", tenantId).order("name", { ascending: true }),
        ]);

        if (!alive) return;

        if ((tblRes as any).data?.currency) setCurrency((tblRes as any).data.currency);

        const items = (itemsRes as any).data;
        if (items) {
          const mapped: PlanTier[] = PERIODS.map(p => {
            const item = (items as any[]).find(i => i.period === p.period);
            if (!item) return null;
            const priceRow = item.prices?.find((pr: any) => pr.screens_count === 1);
            return { period: p.period, days: p.days, label: p.label, price: priceRow?.price_amount ?? null, credits: item.credits_base ?? 0 };
          }).filter(Boolean) as PlanTier[];
          setTiers(mapped);
          const first = mapped.find(t => t.price !== null);
          if (first) setSelectedPeriod(first.period);
        }

        const tmplData = (tmplRes as any).data;
        if (tmplData) {
          setTemplates(tmplData);
          const def =
            tmplData.find((t: any) => t.name.toLowerCase().includes("saas pagamento")) ||
            tmplData.find((t: any) => t.name.toLowerCase().includes("saas renov")) ||
            null;
          if (def) { setSelectedTemplateId(def.id); setMessageContent(def.content); }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [step, saasPlanTableId, tenantId]);

  // ── Salvar renovação com saldo próprio ──
  async function handleSaveOwnBalance() {
    if (!selectedTier || saving) return;
    if (!hasSufficientBalance) {
      setError(`Saldo insuficiente. Necessário: ${creditsNeeded} cr. Disponível: ${creditBalance} cr.`);
      return;
    }
    setSaving(true);
    setError(null);
    setLoadingText("Renovando licença...");

    try {
      // Renova o próprio tenant — sem price_amount (custo já foi registrado na compra)
      const { error: rpcErr } = await supabaseBrowser.rpc("saas_renew_license", {
        p_tenant_id: tenantId,
        p_days: selectedTier.days,
        p_description: notes.trim() || `Auto-renovação ${selectedTier.label} · ${creditsNeeded} crédito(s)`,
        p_price_amount: null,
        p_price_currency: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      // WhatsApp
      if (sendWhats && messageContent.trim()) {
        setLoadingText("Enviando WhatsApp...");
        try {
          const { data: sess } = await supabaseBrowser.auth.getSession();
          const token = sess?.session?.access_token;
          await fetch("/api/whatsapp/envio_agora", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              tenant_id: tenantId,
              message: messageContent,
              message_template_id: selectedTemplateId || null,
              whatsapp_session: selectedSession,
            }),
          });
        } catch {}
      }

      setLoadingText("Concluído!");
      setTimeout(() => { onSuccess(); onClose(); }, 500);
    } catch (e: any) {
      setError(e?.message || "Erro ao renovar");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden">

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800 dark:text-white tracking-tight">
              {step === "select" ? "Renovar Assinatura" :
               step === "own_balance" ? "Renovar com Saldo" :
               step === "auto" ? "Renovação Automática" :
               "Comprar Créditos"}
            </h2>
            <div className="text-xs text-slate-500 dark:text-white/40 mt-0.5">
              Vence: <strong>{fmtDate(currentExpiry)}</strong>
              {step === "own_balance" && (
                <span className="ml-2">· Saldo: <strong className="text-emerald-600 dark:text-emerald-400">{creditBalance} cr</strong></span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step !== "select" && role === "MASTER" && (
              <button onClick={() => setStep("select")} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white/60 px-2 py-1 rounded border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                ← Voltar
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors">✕</button>
          </div>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-[#161b22]">

          {/* ── STEP: SELEÇÃO (MASTER) ── */}
          {step === "select" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-white/50 mb-4">
                Como deseja renovar sua assinatura?
              </p>

              {/* Opção 1: Renovar com saldo */}
              <button
                onClick={() => setStep("own_balance")}
                disabled={creditBalance <= 0}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-emerald-500/50 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                  🪙
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-white">Renovar com Saldo</div>
                  <div className="text-xs text-slate-400 dark:text-white/40 mt-0.5">
                    {creditBalance > 0
                      ? `Usar seus ${creditBalance} créditos disponíveis`
                      : "Sem créditos disponíveis"}
                  </div>
                </div>
                <span className="text-slate-300 dark:text-white/20 group-hover:text-emerald-500 transition-colors">→</span>
              </button>

              {/* Opção 2: Renovação Automática */}
              <button
                onClick={() => setStep("auto")}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-sky-500/50 hover:bg-sky-50/50 dark:hover:bg-sky-500/5 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 shrink-0 group-hover:bg-sky-500/20 transition-colors">
                  🔄
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-white">Renovação Automática</div>
                  <div className="text-xs text-slate-400 dark:text-white/40 mt-0.5">Pagamento via PIX, cartão ou boleto</div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20">Em breve</span>
              </button>

              {/* Opção 3: Comprar Créditos */}
              <button
                onClick={() => setStep("buy_credits")}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-violet-500/50 hover:bg-violet-50/50 dark:hover:bg-violet-500/5 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-600 shrink-0 group-hover:bg-violet-500/20 transition-colors">
                  💳
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-700 dark:text-white">Comprar Créditos</div>
                  <div className="text-xs text-slate-400 dark:text-white/40 mt-0.5">Adicione créditos à sua conta</div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20">Em breve</span>
              </button>
            </div>
          )}

          {/* ── STEP: RENOVAR COM SALDO PRÓPRIO ── */}
          {step === "own_balance" && (
            <div className="space-y-5">
              {loading ? (
                <div className="py-12 text-center text-slate-400 animate-pulse">Carregando plano...</div>
              ) : !saasPlanTableId ? (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-600 dark:text-amber-400 text-sm">
                  Tabela de renovação não configurada. Contate seu gestor.
                </div>
              ) : (
                <>
                  {error && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm">
                      {error}
                    </div>
                  )}

                  {/* PERÍODOS */}
                  <div className="flex flex-col gap-2">
                    {tiers.map(tier => {
                      const cost = tier.credits * whatsappSessions;
                      const canAfford = cost <= creditBalance;
                      return (
                        <button
                          key={tier.period}
                          type="button"
                          disabled={!canAfford}
                          onClick={() => setSelectedPeriod(tier.period)}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            selectedPeriod === tier.period
                              ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                              : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-emerald-500/50"
                          }`}
                        >
                          <span>{tier.label}</span>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-bold ${selectedPeriod === tier.period ? "text-white/80" : "text-slate-400"}`}>
                              {cost} cr{whatsappSessions > 1 ? ` (${whatsappSessions} sessões)` : ""}
                            </span>
                            <span className={`text-xs font-bold ${selectedPeriod === tier.period ? "text-white/60" : "text-slate-300 dark:text-white/20"}`}>
                              Gratuito
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* RESUMO */}
                  {selectedTier && (
                    <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">Novo Vencimento</div>
                          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{newExpiry}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Saldo após: <strong className={hasSufficientBalance ? "text-slate-700 dark:text-white" : "text-rose-500"}>
                              {creditBalance - creditsNeeded} cr
                            </strong>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">Custo</div>
                          <div className="text-xl font-bold text-slate-700 dark:text-white">{creditsNeeded} cr</div>
                          <div className="text-[10px] text-emerald-500 font-bold">R$ 0,00</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* WHATSAPP */}
                  <div className="bg-slate-50 dark:bg-black/20 p-3 rounded-xl border border-slate-200 dark:border-white/5 space-y-3">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => setSendWhats(v => !v)}>
                      <Switch checked={sendWhats} onChange={setSendWhats} />
                      <span className="text-xs font-bold text-slate-600 dark:text-white/70">Enviar aviso de renovação?</span>
                    </div>
                    {sendWhats && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in duration-200">
                        <Select value={selectedSession} onChange={e => setSelectedSession(e.target.value)}>
                          {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </Select>
                        <Select value={selectedTemplateId} onChange={e => {
                          const id = e.target.value;
                          setSelectedTemplateId(id);
                          const tpl = templates.find(t => t.id === id);
                          if (tpl) setMessageContent(tpl.content);
                        }}>
                          <option value="">-- Personalizado --</option>
                          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </Select>
                      </div>
                    )}
                  </div>

                  {/* OBSERVAÇÕES */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-tight">
                      Observações (opcional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      className="w-full h-14 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-colors"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP: RENOVAÇÃO AUTOMÁTICA (placeholder) ── */}
          {step === "auto" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-3xl">🔄</div>
              <div>
                <div className="text-base font-bold text-slate-700 dark:text-white">Renovação Automática</div>
                <div className="text-sm text-slate-400 dark:text-white/40 mt-1 max-w-xs">
                  Em breve você poderá renovar automaticamente via PIX, cartão de crédito ou boleto.
                </div>
              </div>
              <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-sky-100 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20">
                Em desenvolvimento
              </span>
            </div>
          )}

          {/* ── STEP: COMPRAR CRÉDITOS (placeholder) ── */}
          {step === "buy_credits" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-3xl">💳</div>
              <div>
                <div className="text-base font-bold text-slate-700 dark:text-white">Comprar Créditos</div>
                <div className="text-sm text-slate-400 dark:text-white/40 mt-1 max-w-xs">
                  Em breve você poderá comprar pacotes de créditos diretamente pelo painel.
                </div>
              </div>
              <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20">
                Em desenvolvimento
              </span>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-sm hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            {step === "select" || step === "auto" || step === "buy_credits" ? "Fechar" : "Cancelar"}
          </button>
          {step === "own_balance" && !loading && saasPlanTableId && (
            <button
              onClick={handleSaveOwnBalance}
              disabled={!selectedTier || !hasSufficientBalance || saving}
              className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {saving && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              {saving ? loadingText : `Renovar — ${selectedTier?.label ?? ""}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}