"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom"; // Faltava importar o createPortal
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { ServerRow } from "./page"; // Importamos o tipo do servidor

// --- COMPONENTES VISUAIS (Mesmo padrão do novo_servidor) ---
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">{children}</label>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors ${className}`} />;
}

function Select({ children, className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors ${className}`}>
      {children}
    </select>
  );
}

// ✅ Props ajustadas para bater com o page.tsx
type Props = {
  server: ServerRow; 
  onClose: () => void;
  onSuccess: () => void;
};

export default function RecargaServidorModal({ server, onClose, onSuccess }: Props) {
  const [saving, setSaving] = useState(false);
  
  // ✅ Pega dados iniciais do objeto server passado
  const defaultUnitCost = server.credit_unit_cost_brl ?? server.default_credit_unit_price ?? 0;
  const defaultCurrency = server.default_currency || "BRL";

  // Form State
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState(defaultUnitCost.toString());
  const [currency, setCurrency] = useState(defaultCurrency);
  const [fxRate, setFxRate] = useState("1"); // Câmbio para BRL
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [purchasedAt, setPurchasedAt] = useState(new Date().toISOString().slice(0, 16)); // datetime-local
  const [notes, setNotes] = useState("");

  // Cálculos em Tempo Real
  const totalOriginal = (Number(qty) || 0) * (Number(unitCost) || 0);
  const totalBrl = currency === "BRL" ? totalOriginal : totalOriginal * (Number(fxRate) || 1);

  // ✅ Busca cotação automaticamente se não for BRL
  useEffect(() => {
    async function fetchFx() {
        if (currency === 'BRL') {
            setFxRate("1");
            return;
        }
        try {
            const tenantId = await getCurrentTenantId();
            const supabase = supabaseBrowser;
            const { data } = await supabase
                .from("tenant_fx_rates")
                .select("usd_to_brl, eur_to_brl")
                .eq("tenant_id", tenantId)
                .order("as_of_date", { ascending: false })
                .limit(1)
                .maybeSingle();
            
            if (data) {
                if (currency === 'USD') setFxRate(data.usd_to_brl?.toString() || "1");
                if (currency === 'EUR') setFxRate(data.eur_to_brl?.toString() || "1");
            }
        } catch (err) {
            console.error("Erro ao buscar cambio", err);
        }
    }
    fetchFx();
  }, [currency]);

  async function handleSave() {
    if (!qty || Number(qty) <= 0) return alert("Quantidade inválida");
    setSaving(true);

    try {
      const tenantId = await getCurrentTenantId();
      const supabase = supabaseBrowser;
      
      // Chamada da RPC conforme Contrato
      const { error } = await supabase.rpc("topup_server_credits_and_log", {
        p_tenant_id: tenantId,
        p_server_id: server.id,
        p_credits_qty: Number(qty),
        p_unit_price: Number(unitCost),
        p_purchase_currency: currency,
        p_total_amount_brl: totalBrl,
        p_fx_rate_to_brl: Number(fxRate), // Faltava passar isso
        // p_payment_method: paymentMethod, // ⚠️ Verifique se sua RPC aceita isso. Se não, remova ou ponha em notes.
        p_notes: `[${paymentMethod}] ${notes}`, // Juntei metodo nas notas pra garantir
      });

      if (error) throw error;

      onSuccess(); // O page.tsx já vai exibir o toast e atualizar a lista
    } catch (error: any) {
      console.error("Erro na recarga:", error);
      alert("Erro ao recarregar: " + error.message);
    } finally {
      setSaving(false);
    }
  }

  // Previne erro de hidratação
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              Nova Recarga
            </h2>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">
              {server.name}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60">✕</button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Data da compra</Label>
              <Input 
                type="datetime-local"
                value={purchasedAt}
                onChange={e => setPurchasedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Meio de pagamento</Label>
              <Select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="PIX">PIX</option>
                <option value="USDT">USDT</option>
                <option value="CARTAO">Cartão de Crédito</option>
                <option value="SALDO">Saldo em Conta</option>
                <option value="OUTRO">Outro</option>
              </Select>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 space-y-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4 space-y-1">
                <Label>Qtd. Créditos</Label>
                <Input 
                  type="number" 
                  value={qty} 
                  onChange={e => setQty(e.target.value)} 
                  placeholder="0"
                  autoFocus
                  className="font-bold text-emerald-600"
                />
              </div>
              <div className="col-span-4 space-y-1">
                  <Label>Moeda</Label>
                  <Select value={currency} onChange={e => setCurrency(e.target.value as any)}>
                    <option value="BRL">BRL (R$)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </Select>
              </div>
              <div className="col-span-4 space-y-1">
                <Label>Custo Unit.</Label>
                <Input 
                  type="number" step="0.01"
                  value={unitCost} 
                  onChange={e => setUnitCost(e.target.value)} 
                />
              </div>
            </div>

            {/* Câmbio (se não for BRL) */}
            {currency !== "BRL" && (
               <div className="space-y-1 animate-in slide-in-from-top-2">
                  <Label>Cotação para BRL (R$)</Label>
                  <Input 
                    type="number" step="0.01"
                    value={fxRate}
                    onChange={e => setFxRate(e.target.value)}
                    placeholder={`1 ${currency} = ? BRL`}
                  />
               </div>
            )}
          </div>

          {/* TOTALIZADORES */}
          <div className="flex justify-between items-end bg-slate-100 dark:bg-black/20 p-3 rounded-lg border border-slate-200 dark:border-white/5">
             <div>
                <div className="text-[10px] uppercase font-bold text-slate-400">Total Original</div>
                <div className="font-mono text-sm font-bold text-slate-600 dark:text-slate-300">
                   {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency }).format(totalOriginal)}
                </div>
             </div>
             <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-slate-400">Total em BRL (Custo Real)</div>
                <div className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">
                   {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBrl)}
                </div>
             </div>
          </div>

          <div className="space-y-1">
            <Label>Observações</Label>
            <input 
              className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none text-slate-700 dark:text-white"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opcional..."
            />
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 flex justify-end gap-3 bg-slate-50 dark:bg-white/5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/5 text-sm font-semibold transition-colors">
            Cancelar
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all"
          >
            {saving ? "Registrando..." : "Confirmar Recarga"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}