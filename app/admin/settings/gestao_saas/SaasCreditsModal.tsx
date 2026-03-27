"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getCurrentTenantId } from "@/lib/tenant";

// ============================================================
// TIPOS
// ============================================================
type Currency = "BRL" | "USD" | "EUR";

interface CreditTier {
  period: string;       // C_10, C_20...
  credits: number;      // 10, 20...
  price: number | null; // preço do plano
}

interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  image_url?: string | null; 
  category?: string | null; // ✅ Busca a Categoria
}

interface Props {
  tenantId: string;
  tenantName: string;
  creditsPlanTableId: string | null;
  currentBalance: number;
  isTrial: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

// ============================================================
// HELPERS
// ============================================================
const TIER_ORDER = ["C_10","C_20","C_30","C_50","C_100","C_150","C_200","C_300","C_400","C_500"];
const TIER_LABELS: Record<string, number> = {
  C_10: 10, C_20: 20, C_30: 30, C_50: 50, C_100: 100,
  C_150: 150, C_200: 200, C_300: 300, C_400: 400, C_500: 500,
};

function fmtMoney(currency: string, n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
  }).format(Number.isFinite(n) ? n : 0);
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

// ============================================================
// COMPONENTES VISUAIS
// ============================================================
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight uppercase">
      {children}
    </label>
  );
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
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`relative w-12 h-7 rounded-full transition-colors border ${
        checked ? "bg-emerald-600 border-emerald-600" : "bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/10"
      }`}
      aria-pressed={checked}
    >
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// ============================================================
// MODAL PRINCIPAL
// ============================================================
export default function SaasCreditsModal({
  tenantId: targetTenantId,
  tenantName,
  creditsPlanTableId,
  currentBalance,
  isTrial,
  onClose,
  onSuccess,
  onError,
}: Props) {
  const [myTenantId, setMyTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingText, setLoadingText] = useState("Processando...");

// Tiers do plano
  const [tiers, setTiers] = useState<CreditTier[]>([]);
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [selectedTier, setSelectedTier] = useState<CreditTier | null>(null);

  // Seletor de tabela
  const [availableTables, setAvailableTables] = useState<{ id: string; name: string; currency: Currency }[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>(creditsPlanTableId ?? "");

  // Preço customizado (editável)
  const [customPrice, setCustomPrice] = useState<string>("");

  // WhatsApp
  const [sendWhats, setSendWhats] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [messageContent, setMessageContent] = useState("");
  const [selectedSession, setSelectedSession] = useState("default");
  const [sessionOptions, setSessionOptions] = useState<{ id: string; label: string }[]>([
    { id: "default", label: "Carregando..." },
  ]);

  // Nota interna
  const [notes, setNotes] = useState("");

  // ── Preço efetivo (do plano ou customizado) ──
  const effectivePrice = useMemo(() => {
    const n = Number(String(customPrice || "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : (selectedTier?.price ?? null);
  }, [customPrice, selectedTier]);

  const canSave = useMemo(() => {
    if (isTrial) return false;
    return !!(selectedTier && effectivePrice && effectivePrice > 0 && myTenantId);
  }, [isTrial, selectedTier, effectivePrice, myTenantId]);

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

  const isFirstRenderCredits = useRef(true);

  // ── Load principal ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const tid = await getCurrentTenantId();
        if (!alive) return;
        setMyTenantId(tid);

        const activeTableId = creditsPlanTableId ?? null;

        // Tudo em paralelo — sessões WA não bloqueiam o resto
        const [, allTablesRes, tblRes, itemsRes, tmplRes] = await Promise.all([
          loadSessions(),
          supabaseBrowser.from("plan_tables").select("id, name, currency").eq("table_type", "saas_credits").eq("is_active", true),
          activeTableId ? supabaseBrowser.from("plan_tables").select("currency").eq("id", activeTableId).single() : Promise.resolve({ data: null }),
          activeTableId ? supabaseBrowser.from("plan_table_items").select(`id, period, prices:plan_table_item_prices(screens_count, price_amount)`).eq("plan_table_id", activeTableId) : Promise.resolve({ data: null }),
          supabaseBrowser.from("message_templates").select("id, name, content, image_url, category").eq("tenant_id", tid).order("name", { ascending: true }),
        ]);

        if (!alive) return;

        if ((allTablesRes as any).data) setAvailableTables((allTablesRes as any).data);
        if (activeTableId) setSelectedTableId(activeTableId);
        if ((tblRes as any).data?.currency) setCurrency((tblRes as any).data.currency as Currency);

        const items = (itemsRes as any).data;
        if (items) {
          const mapped: CreditTier[] = TIER_ORDER.map(period => {
            const item = (items as any[]).find(i => i.period === period);
            if (!item) return null;
            const priceRow = item.prices?.find((p: any) => p.screens_count === 1);
            return { period, credits: TIER_LABELS[period] ?? 0, price: priceRow?.price_amount ?? null };
          }).filter(Boolean) as CreditTier[];
          setTiers(mapped);
          const first = mapped.find(t => t.price !== null);
          if (first) setSelectedTier(first);
        }

        const tmplData = (tmplRes as any).data;
        if (tmplData) {
          const mappedTpls = tmplData.map((r: any) => {
            let cat = r.category || "Geral";
            if (!r.category || r.category === "Geral") {
              if (r.name === "Pagamento Realizado" || r.name === "Teste - Boas-vindas") cat = "Cliente IPTV";
              else if (r.name === "Recarga Revenda") cat = "Revenda IPTV";
              else if (String(r.name).toUpperCase().includes("SAAS")) cat = "Revenda SaaS";
            }
            return { ...r, category: cat };
          });

          setTemplates(mappedTpls);
          const def =
            mappedTpls.find((t: any) => t.name.toLowerCase().includes("saas recarga")) ||
            mappedTpls.find((t: any) => t.name.toLowerCase().includes("recarga saas")) ||
            null;
          if (def) { setSelectedTemplateId(def.id); setMessageContent(def.content); }
        }
      } catch (e: any) {
        onError(e?.message || "Erro ao carregar plano de créditos");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [creditsPlanTableId]);

  // ── Recarrega tiers quando muda a tabela (ignora primeiro render) ──
  useEffect(() => {
    if (!selectedTableId) return;
    if (isFirstRenderCredits.current) { isFirstRenderCredits.current = false; return; }
    (async () => {
      const { data: items } = await supabaseBrowser
        .from("plan_table_items")
        .select(`id, period, prices:plan_table_item_prices(screens_count, price_amount)`)
        .eq("plan_table_id", selectedTableId);

      const { data: tbl } = await supabaseBrowser
        .from("plan_tables")
        .select("currency")
        .eq("id", selectedTableId)
        .single();

      if (tbl?.currency) setCurrency(tbl.currency as Currency);

      if (items) {
        const mapped: CreditTier[] = TIER_ORDER
          .map(period => {
            const item = (items as any[]).find(i => i.period === period);
            if (!item) return null;
            const priceRow = item.prices?.find((p: any) => p.screens_count === 1);
            return { period, credits: TIER_LABELS[period] ?? 0, price: priceRow?.price_amount ?? null };
          })
          .filter(Boolean) as CreditTier[];

        setTiers(mapped);
        setSelectedTier(null);
        setCustomPrice("");
        const first = mapped.find(t => t.price !== null);
        if (first) setSelectedTier(first);
      }
    })();
  }, [selectedTableId]);

  // ── Quando muda tier: reseta preço customizado ──
  function selectTier(tier: CreditTier) {
    setSelectedTier(tier);
    setCustomPrice(""); // reseta override, usa o preço do plano
  }

  // ── Salvar ──
  async function handleSave() {
    if (!canSave || saving || !selectedTier || !effectivePrice) return;
    setSaving(true);
    setLoadingText("Transferindo créditos...");

    try {
      const { error } = await supabaseBrowser.rpc("saas_transfer_credits", {
        p_to_tenant_id: targetTenantId,
        p_amount: selectedTier.credits,
        p_description: notes.trim() || `Compra de ${selectedTier.credits} créditos SaaS`,
        p_price_amount: effectivePrice ?? null,
        p_price_currency: currency,
      });
      if (error) throw new Error(error.message);

      // WhatsApp
      if (sendWhats && messageContent.trim()) {
        setLoadingText("Enviando WhatsApp...");
        try {
          const { data: sess } = await supabaseBrowser.auth.getSession();
          const token = sess?.session?.access_token;

          let imageUrlToSend = null;
          if (selectedTemplateId) {
            const tpl = templates.find(t => t.id === selectedTemplateId);
            if (tpl && tpl.image_url) {
              imageUrlToSend = tpl.image_url;
            }
          }

          // ✅ ROTA UNIFICADA DO SISTEMA COM O saas_id
          await fetch("/api/whatsapp/envio_agora", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              tenant_id: myTenantId,
              saas_id: targetTenantId, 
              message: messageContent,
              message_template_id: selectedTemplateId || null,
              image_url: imageUrlToSend, // ✅ ENVIANDO A IMAGEM!
              whatsapp_session: selectedSession,
            }),
          });
        } catch {}
      }

      setLoadingText("Concluído!");
      setTimeout(() => { onSuccess(); onClose(); }, 500);
    } catch (e: any) {
      onError(e?.message || "Erro ao transferir créditos");
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              Venda de Créditos SaaS
            </h2>
            <div className="text-xs text-slate-500 dark:text-white/40 mt-0.5 font-medium">
              {tenantName} · Saldo atual: <strong>{currentBalance}</strong> créditos
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 transition-colors">✕</button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white dark:bg-[#161b22]">
          {loading ? (
            <div className="py-12 text-center text-slate-400 animate-pulse">Carregando pacotes...</div>
          ) : isTrial ? (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400 text-sm font-medium">
              ⛔ Revendedor em período de teste. Renove a licença antes de vender créditos.
            </div>
          ) : !creditsPlanTableId ? (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-600 dark:text-amber-400 text-sm font-medium">
              Este revendedor não tem uma tabela de créditos vinculada. Configure em Editar Perfil.
            </div>
          ) : (
            <>
              {/* SELETOR DE TABELA */}
              {availableTables.length > 1 && (
                <div className="flex items-center justify-between gap-3 px-1">
                  <span className="text-xs font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">
                    Tabela de Preços
                  </span>
                  <select
                    value={selectedTableId}
                    onChange={e => setSelectedTableId(e.target.value)}
                    className="h-8 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-bold text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors min-w-[160px]"
                  >
                    {availableTables.map(t => (
                      <option key={t.id} value={t.id}>{t.name} {t.currency}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* PACOTES — ROW 1: 10 a 100 */}
              <div>
                <Label>Pacotes Pequenos</Label>
                <div className="grid grid-cols-5 gap-2">
                  {tiers.filter(t => t.credits <= 100).map(tier => (
                    <button
                      key={tier.period}
                      type="button"
                      onClick={() => selectTier(tier)}
                      className={`flex flex-col items-center justify-center py-3 rounded-xl border text-xs font-bold transition-all ${
                        selectedTier?.period === tier.period
                          ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                          : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-emerald-500/50"
                      }`}
                    >
                      <span className="text-base font-black">{tier.credits}</span>
                      <span className={`text-[10px] mt-0.5 ${selectedTier?.period === tier.period ? "text-white/80" : "text-slate-400"}`}>
                        {tier.price !== null ? fmtMoney(currency, tier.price) : "—"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* PACOTES — ROW 2: 150 a 500 */}
              <div>
                <Label>Pacotes Grandes</Label>
                <div className="grid grid-cols-5 gap-2">
                  {tiers.filter(t => t.credits >= 150).map(tier => (
                    <button
                      key={tier.period}
                      type="button"
                      onClick={() => selectTier(tier)}
                      className={`flex flex-col items-center justify-center py-3 rounded-xl border text-xs font-bold transition-all ${
                        selectedTier?.period === tier.period
                          ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                          : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-emerald-500/50"
                      }`}
                    >
                      <span className="text-base font-black">{tier.credits}</span>
                      <span className={`text-[10px] mt-0.5 ${selectedTier?.period === tier.period ? "text-white/80" : "text-slate-400"}`}>
                        {tier.price !== null ? fmtMoney(currency, tier.price) : "—"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* RESUMO */}
              {selectedTier && (
                <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/5 animate-in zoom-in-95 duration-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">
                        Pacote selecionado
                      </div>
                      <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {selectedTier.credits} créditos
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Saldo após: <strong className="text-slate-700 dark:text-white">{currentBalance + selectedTier.credits}</strong> créditos
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-1">
                        Valor
                      </div>
                      {/* Preço editável */}
                      <div className="flex items-center gap-1 justify-end">
                        <span className="text-xs font-bold text-slate-400">{currency}</span>
                        <input
                          value={customPrice || (selectedTier.price !== null ? String(selectedTier.price).replace(".", ",") : "")}
                          onChange={e => setCustomPrice(e.target.value)}
                          placeholder="0,00"
                          className="w-24 h-8 px-2 text-right bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-bold text-emerald-600 dark:text-emerald-400 outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 text-right">
                        preço editável
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* WHATSAPP */}
              <div className="bg-slate-50 dark:bg-black/20 p-3 rounded-xl border border-slate-200 dark:border-white/5 space-y-3">
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => setSendWhats(v => !v)}>
                  <Switch checked={sendWhats} onChange={setSendWhats} />
                  <span className="text-xs font-bold text-slate-600 dark:text-white/70">Enviar comprovante?</span>
                </div>

                {sendWhats && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in duration-200">
                      <Select value={selectedSession} onChange={e => setSelectedSession(e.target.value)}>
                        {sessionOptions.map(s => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </Select>
                      <Select
                        value={selectedTemplateId}
                        onChange={e => {
                          const id = e.target.value;
                          setSelectedTemplateId(id);
                          const tpl = templates.find(t => t.id === id);
                          if (tpl) setMessageContent(tpl.content);
                        }}
                      >
                        <option value="">-- Personalizado --</option>
{Object.entries(
  templates
    .filter(t =>
      // mantém apenas os que NÃO são da categoria "Revenda SaaS"
      (t.category !== "Revenda SaaS") &&
      // e que ainda assim atendem ao seu filtro original
      (String(t.name).toUpperCase().includes("SAAS"))
    )
    .reduce((acc, t) => {
      const cat = t.category || "Geral";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(t);
      return acc;
    }, {} as Record<string, typeof templates>)
).map(([catName, tmpls]) => (
  <optgroup key={catName} label={`— ${catName} —`}>
    {tmpls.map((t) => (
      <option key={t.id} value={t.id}>{t.name}</option>
    ))}
  </optgroup>
))}

                      </Select>
                    </div>

                    {/* ✅ PREVIEW DA IMAGEM DO TEMPLATE */}
                    {(() => {
                      const tpl = templates.find((t) => t.id === selectedTemplateId);
                      if (!tpl?.image_url) return null;
                      return (
                        <div className="animate-in fade-in zoom-in-95 duration-200 mt-2">
                          <span className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1.5 uppercase tracking-wider">
                            Imagem Anexada
                          </span>
                          <div className="w-24 h-24 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 shadow-sm relative bg-slate-100 dark:bg-black/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={tpl.image_url} alt="Anexo do template" className="w-full h-full object-cover" />
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>

              {/* OBSERVAÇÕES */}
              <div>
                <Label>Observações internas (opcional)</Label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full h-20 px-3 py-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-colors"
                />
              </div>
            </>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 font-bold text-sm hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving || loading}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {saving && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {saving ? loadingText : "Confirmar venda"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}