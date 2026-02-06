"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { ServerRow } from "./page";

// Helper de Slug
function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w-]+/g, "")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type Currency = "BRL" | "USD" | "EUR";

type Props = {
  server?: ServerRow | null;
  onClose: () => void;
  onSuccess: () => void;
};

// --- COMPONENTES VISUAIS INTERNOS ---
function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">
      {children}
    </label>
  );
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    />
  );
}

function Select({ children, className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

export default function ServerFormModal({ server, onClose, onSuccess }: Props) {
  const isEditing = !!server;
  const [saving, setSaving] = useState(false);

  // States do Form
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [credits, setCredits] = useState<string>("");
  const [whatsapp, setWhatsapp] = useState("");
  const [panelType, setPanelType] = useState<"WEB" | "TELEGRAM" | "">("");
  const [panelValue, setPanelValue] = useState("");
  const [integration, setIntegration] = useState("");
  const [dnsList, setDnsList] = useState<string[]>(["", "", "", "", "", ""]);

  // Carregar dados na Edição
  useEffect(() => {
    if (server) {
      setName(server.name);
      setSlug(server.slug);
      setNotes(server.notes || "");
      setCurrency(server.default_currency as Currency);

      // ✅ custo exibido vem do que a view entrega (alias/custo médio)
      const price = (server.credit_unit_cost_brl ?? server.avg_credit_cost_brl ?? server.default_credit_unit_price) as any;
      setUnitPrice(price != null ? String(price) : "");

      setCredits(server.credits_available?.toString() || "0");
      setWhatsapp(server.whatsapp_session || "");
      setPanelType((server.panel_type as any) || "");

      if (server.panel_type === "WEB") setPanelValue(server.panel_web_url || "");
      else if (server.panel_type === "TELEGRAM") setPanelValue(server.panel_telegram_group || "");
      else setPanelValue("");

      setIntegration(server.panel_integration || "");

      const loadedDns = [...(server.dns || [])];
      while (loadedDns.length < 6) loadedDns.push("");
      setDnsList(loadedDns.slice(0, 6));
    }
  }, [server]);

  const handleDnsChange = (idx: number, val: string) => {
    const newDns = [...dnsList];
    newDns[idx] = val;
    setDnsList(newDns);
  };

  async function handleSave() {
    if (!name.trim()) return alert("Nome é obrigatório");
    setSaving(true);

    try {
      const tenantId = await getCurrentTenantId();
      const supabase = supabaseBrowser;

      const cleanDns = dnsList.map((d) => d.trim()).filter((d) => d !== "");

      const baseSlug = (isEditing && slug) ? slug : slugify(name);
      const safeBaseSlug = baseSlug || slugify(`server_${Date.now()}`);

      // ✅ garante slug único (evita servers_slug_unique)
      async function ensureUniqueSlug(desired: string) {
        if (isEditing && server) return desired;

        let candidate = desired;
        let i = 2;

        while (true) {
          const { data, error } = await supabase
            .from("servers")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("slug", candidate)
            .limit(1);

          if (error) throw error;

          if (!data || data.length === 0) return candidate;

          candidate = `${desired}_${i}`;
          i++;
        }
      }

      const finalSlug = await ensureUniqueSlug(safeBaseSlug);

      // ✅ Payload REAL da tabela public.servers
      // NÃO enviamos credits_available aqui no update normal para evitar conflito com gatilhos
      const payload = {
        tenant_id: tenantId,
        name: name.trim(),
        slug: finalSlug,
        notes: notes?.trim() ? notes.trim() : null,
        default_currency: currency,
        whatsapp_session: whatsapp || null,
        panel_type: panelType || null,
        panel_web_url: panelType === "WEB" ? panelValue : null,
        panel_telegram_group: panelType === "TELEGRAM" ? panelValue : null,
        panel_integration: integration || null,
        dns: cleanDns,
      };

      let serverId: string | null = server?.id ?? null;

      if (isEditing && server) {
        
        // --- ⚡️ LÓGICA DE AJUSTE MANUAL DE SALDO (SEM LOG) ---
        const currentCredits = Number(server.credits_available || 0);
        const newCredits = Number(credits || 0);

        if (currentCredits !== newCredits) {
            const { error: adjErr } = await supabase.rpc("update_server_credits_manual", {
                p_server_id: server.id,
                p_new_credits: newCredits
                // Removido p_reason conforme solicitado
            });

            if (adjErr) throw new Error(`Erro ao ajustar saldo: ${adjErr.message}`);
        }
        // -----------------------------------------------------

        const { error } = await supabase
          .from("servers")
          .update(payload)
          .eq("id", server.id)
          .eq("tenant_id", tenantId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("servers")
          .insert({ ...payload, is_archived: false })
          .select("id")
          .single();

        if (error) throw error;

        serverId = data?.id ?? null;
      }

      // ✅ Saldo inicial (somente no CREATE)
      const initialCredits = Number(credits) || 0;
      const initialUnitPrice = Number(unitPrice) || 0;

      // valida moeda
      const safeCurrency: Currency = (currency === "USD" || currency === "EUR") ? currency : "BRL";

      // Se for CRIAÇÃO, mantém a lógica original de compra inicial
      if (!isEditing && serverId && initialCredits > 0) {
        if (initialUnitPrice <= 0) {
          alert("Servidor criado, mas o saldo inicial não foi aplicado: informe o custo unitário.");
        } else {
          let fxRateToBrl = 1;

          if (safeCurrency !== "BRL") {
            const { data: fx, error: fxErr } = await supabase
              .from("tenant_fx_rates")
              .select("usd_to_brl, eur_to_brl, as_of_date")
              .eq("tenant_id", tenantId)
              .order("as_of_date", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (fxErr) throw fxErr;

            fxRateToBrl =
              safeCurrency === "USD"
                ? Number(fx?.usd_to_brl || 0)
                : Number(fx?.eur_to_brl || 0);

            if (!fxRateToBrl || fxRateToBrl <= 0) {
              throw new Error("FX inválido em tenant_fx_rates (usd_to_brl/eur_to_brl).");
            }
          }

          const totalAmountBrl = initialCredits * initialUnitPrice * fxRateToBrl;

          const { error: topupErr } = await supabase.rpc("topup_server_credits_and_log", {
            p_tenant_id: tenantId,
            p_server_id: serverId,
            p_credits_qty: initialCredits,
            p_unit_price: initialUnitPrice,

            // ✅ manda string válida; no banco isso deve ser currency_code
            p_purchase_currency: safeCurrency,

            p_total_amount_brl: totalAmountBrl,
            p_fx_rate_to_brl: fxRateToBrl,
            p_notes: "Saldo inicial (criação do servidor)",
          });

          if (topupErr) {
            throw new Error(
              `Servidor criado, mas falhou ao aplicar saldo inicial: ${topupErr.message}`
            );
          }
        }
      }

      setSaving(false);
      onSuccess();
    } catch (error: any) {
      console.error(error);
      alert(`Erro ao salvar: ${error?.message || "Erro desconhecido"}`);
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-5xl max-h-[90vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              {isEditing ? `Editar: ${server?.name}` : "Novo servidor"}
            </h2>
            <div className="text-xs text-slate-500 dark:text-white/40 mt-0.5 font-medium">
              Configurações de conexão, custos e saldo.
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* CORPO */}
        <div className="p-6 space-y-6 overflow-y-auto bg-white dark:bg-[#161b22]">
          <div className="grid grid-cols-12 gap-4">
            <div
              className={`${
                panelType ? "col-span-12 md:col-span-4" : "col-span-12 md:col-span-8"
              } space-y-1 animate-in slide-in-from-bottom-2 duration-300`}
            >
              <Label>Nome do servidor</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: UniTV Principal"
                autoFocus
              />
            </div>

            <div className="col-span-12 md:col-span-4 space-y-1 animate-in slide-in-from-bottom-2 duration-300">
              <Label>Tipo de painel</Label>
              <Select value={panelType} onChange={(e) => setPanelType(e.target.value as any)}>
                <option value="">Nenhum</option>
                <option value="WEB">Painel Web</option>
                <option value="TELEGRAM">Telegram</option>
              </Select>
            </div>

            {panelType && (
              <div className="col-span-12 md:col-span-4 space-y-1 animate-in slide-in-from-left-2 duration-300">
                <Label>{panelType === "WEB" ? "Url do painel" : "Link ou grupo telegram"}</Label>
                <Input
                  value={panelValue}
                  onChange={(e) => setPanelValue(e.target.value)}
                  placeholder={panelType === "WEB" ? "https://painel.exemplo.com" : "@meugrupo"}
                />
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 grid grid-cols-1 md:grid-cols-3 gap-5 animate-in slide-in-from-bottom-3 duration-400">
            <div className="space-y-1">
              <Label>Moeda padrão</Label>
              <div className="flex bg-slate-200/50 dark:bg-black/20 rounded-lg p-1 border border-slate-200 dark:border-white/10 h-10">
                {(["BRL", "USD", "EUR"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
                    className={`flex-1 h-full rounded-md text-xs font-bold transition-all ${
                      currency === c
                        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-sm"
                        : "text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Custo unitário</Label>
              <Input
                type="number"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-1">
              <Label>Saldo de créditos</Label>
              <Input
                type="number"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="0"
                // ✅ CAMPO LIBERADO
                className={isEditing ? "font-bold text-emerald-600 dark:text-emerald-400" : ""}
              />
              {isEditing && (
                <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded text-[10px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <span className="font-bold shrink-0">⚠️ Atenção:</span>
                  <span>Ajuste manual de balanço (não gera registro financeiro). Para compras, use "Recarregar".</span>
                </div>
              )}
              {!isEditing && (
                <p className="text-[10px] text-emerald-600/80 italic px-1">
                  * Saldo inicial do servidor (registrado como compra).
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-1">
              <Label>Sessão whatsapp</Label>
              <Select value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}>
                <option value="">Selecione uma sessão...</option>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Api integração</Label>
              <Select value={integration} onChange={(e) => setIntegration(e.target.value)}>
                <option value="">Selecione a integração...</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2 animate-in slide-in-from-bottom-5 duration-600">
            <Label>Dns configurados</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dnsList.map((dns, idx) => (
                <div key={idx} className="relative group">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/20 text-[10px] font-mono font-bold">
                    {idx + 1}.
                  </span>
                  <Input
                    value={dns}
                    onChange={(e) => handleDnsChange(idx, e.target.value)}
                    className="pl-8 font-mono text-xs"
                    placeholder={`dns${idx + 1}.exemplo.com`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notas internas</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-white outline-none h-20 resize-none focus:border-emerald-500/50 transition-colors"
              placeholder="Anotações visíveis apenas para admins..."
            />
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 flex justify-end gap-3 bg-slate-50 dark:bg-white/5 transition-colors">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/5 transition-colors text-sm font-semibold"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold transition-all shadow-lg shadow-emerald-900/20"
          >
            {saving ? "Processando..." : isEditing ? "Salvar alterações" : "Criar servidor"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}