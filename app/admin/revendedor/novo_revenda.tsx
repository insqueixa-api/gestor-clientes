"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

// --- HELPERS DE TELEFONE E PAÍSES (Integrais) ---
const COUNTRIES = [
  { name: "Estados Unidos", code: "1" },
  { name: "Brasil", code: "55" },
  { name: "Portugal", code: "351" },
  { name: "Reino Unido", code: "44" },
  { name: "Espanha", code: "34" },
  { name: "Argentina", code: "54" },
];

function normalizeE164(raw: string) {
  const digits = raw.replace(/\D+/g, "");
  return digits ? `+${digits}` : "";
}

function applyPhoneNormalization(rawInput: string) {
  const digits = (rawInput || "").replace(/\D+/g, "");
  if (!digits) {
    return { countryLabel: "—", e164: "", nationalDigits: "", formattedNational: "" };
  }

  // 1) Se o usuário digitou só número local BR (10/11), assume DDI 55
  const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  const hasKnownDDI = sorted.some((c) => digits.startsWith(c.code));

  const e164 = !hasKnownDDI && (digits.length === 10 || digits.length === 11)
    ? `+55${digits}`
    : `+${digits}`;

  // 2) Deriva país + número local e formata pra UI
  const info = splitE164Advanced(e164); // usa seu helper existente
  const nationalDigits = info.localNumber || "";
  const formattedNational = formatLocalNumber(nationalDigits);

  const countryLabel = `${info.countryName} (+${info.countryCode})`;

  return { countryLabel, e164, nationalDigits, formattedNational };
}



function splitE164Advanced(e164: string) {
  const digits = e164.replace(/\D+/g, "");
  const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  const country = sorted.find(c => digits.startsWith(c.code));
  if (!country) return { countryName: "País", countryCode: "00", localNumber: digits };
  return { countryName: country.name, countryCode: country.code, localNumber: digits.slice(country.code.length) };
}

function formatLocalNumber(num: string) {
  if (!num) return "";
  if (num.length === 10) return num.replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3");
  if (num.length === 11) return num.replace(/(\d{2})(\d{5})(\d{4})/, "$1 $2 $3");
  return num;
}

function toDatetimeLocalValue(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// --- COMPONENTES VISUAIS (PADRÃO page.txt) ---
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight">{children}</label>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors ${className}`} />;
}

function ToggleLine({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="w-full h-10 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/5 transition flex items-center justify-between"
    >
      <span className="text-slate-800 dark:text-white font-semibold text-sm">{label}</span>
      <div className={`w-10 h-5 rounded-full border relative transition-colors ${value ? "bg-emerald-500/60 border-emerald-500/50" : "bg-white/10 border-slate-300 dark:border-white/20"}`}>
        <div className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white transition-all ${value ? "left-[22px]" : "left-[4px]"}`} />
      </div>
    </button>
  );
}

interface Props {
  resellerToEdit?: any | null; // Recebe o objeto da revenda para edição
  onClose: () => void;
  onSuccess: () => void;
  onError?: (msg: string) => void;
}

export default function ResellerFormModal({ resellerToEdit, onClose, onSuccess, onError }: Props) {
  const isEditing = !!resellerToEdit;
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Estados do formulário
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [primaryWhatsappE164, setPrimaryWhatsappE164] = useState(""); 
  const [primaryDisplay, setPrimaryDisplay] = useState(""); 
  const [primaryConfirmed, setPrimaryConfirmed] = useState(false);
  const [whatsappUsername, setWhatsappUsername] = useState(""); 
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [dontMessageUntil, setDontMessageUntil] = useState("");
  const [notes, setNotes] = useState("");

  type ExtraPhone = { id: number; e164: string; display: string; username: string; confirmed: boolean };
  const [extras, setExtras] = useState<ExtraPhone[]>([]);

  // 1. CARREGAMENTO DE DADOS (CREATE/EDIT)
  useEffect(() => {
    let alive = true;
    (async () => {
      const tid = await getCurrentTenantId();
      if (!alive) return;
      setTenantId(tid);

      if (resellerToEdit) {
        // --- NOME & EMAIL ---
        const displayName = String(resellerToEdit.display_name ?? resellerToEdit.name ?? "").trim();
        setName(displayName);
        setEmail(String(resellerToEdit.email ?? "").trim());
        setNotes(String(resellerToEdit.notes ?? ""));

        // --- WHATSAPP CONFIGS ---
        setWhatsappUsername(
          resellerToEdit.whatsapp_username != null
            ? String(resellerToEdit.whatsapp_username)
            : String(resellerToEdit.username ?? "").trim()
        );

        // Se undefined, assume true (opt-in padrão)
        setWhatsappOptIn(resellerToEdit.whatsapp_opt_in !== false);

        setDontMessageUntil(
          toDatetimeLocalValue(resellerToEdit.whatsapp_snooze_until ?? resellerToEdit.dont_message_until ?? null)
        );

        // --- TELEFONE PRINCIPAL ---
        const mainRaw =
          resellerToEdit.whatsapp_e164 ??
          resellerToEdit.whatsapp_primary ??
          resellerToEdit.primary_whatsapp_e164 ??
          resellerToEdit.primary_phone ?? // caso venha formatado da listagem
          "";

        const mainDigits = String(mainRaw || "").replace(/\D+/g, "");

        if (mainDigits) {
          const inferred = applyPhoneNormalization(mainDigits);
          setPrimaryWhatsappE164(inferred.e164);
          setPrimaryDisplay(inferred.formattedNational || inferred.nationalDigits || "");
          setPrimaryConfirmed(true);
        } else {
          setPrimaryWhatsappE164("");
          setPrimaryDisplay("");
          setPrimaryConfirmed(false);
        }

        // --- TELEFONES EXTRAS ---
        let extraRaw = resellerToEdit.whatsapp_extra ?? resellerToEdit.whatsapp_secondary ?? [];
        
        // Proteção contra JSON stringificado incorretamente
        if (typeof extraRaw === 'string') {
            try { extraRaw = JSON.parse(extraRaw); } catch(e) { extraRaw = []; }
        }
        
        const extraArr = Array.isArray(extraRaw) ? extraRaw : [];

        setExtras(
          extraArr
            .map((ex: any, idx: number) => {
              const digits = String(ex ?? "").replace(/\D+/g, "");
              if (!digits) return null;
              const inferred = applyPhoneNormalization(digits);
              return {
                id: Date.now() + idx,
                e164: inferred.e164,
                display: inferred.formattedNational || inferred.nationalDigits || "",
                username: "",
                confirmed: true,
              };
            })
            .filter(Boolean) as any
        );
      }
    })();
    return () => { alive = false; };
  }, [resellerToEdit]);

  // 2. HANDLERS DE WHATSAPP
    
    function handlePrimaryValidate() {
      const rawDigits = (primaryDisplay || "").replace(/\D+/g, "");
      if (rawDigits.length < 8) {
        setPrimaryConfirmed(false);
        return;
      }

      // 🔥 mesmo comportamento do cliente: inferir DDI + formatar nacional + salvar E.164
      const inferred = applyPhoneNormalization(rawDigits);



      setPrimaryWhatsappE164(inferred.e164);
      setPrimaryDisplay(inferred.formattedNational || inferred.nationalDigits || primaryDisplay);
      setPrimaryConfirmed(true);

      // username default (se vazio)
      if (!whatsappUsername.trim()) {
        setWhatsappUsername(inferred.e164.replace(/\D+/g, "")); // DDI + número
      }
    }



  function addExtra() { setExtras(prev => [...prev, { id: Date.now(), e164: "", display: "", username: "", confirmed: false }]); }
  function removeExtra(id: number) { setExtras(prev => prev.filter(e => e.id !== id)); }
  function validateExtra(id: number) {
    setExtras((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;

        const rawDigits = (e.display || "").replace(/\D+/g, "");
        if (rawDigits.length < 8) {
          return { ...e, confirmed: false };
        }

        const inferred = applyPhoneNormalization(rawDigits);



        return {
          ...e,
          e164: inferred.e164,
          display: inferred.formattedNational || inferred.nationalDigits || e.display,
          confirmed: true,
        };
      })
    );
  }



  const errors = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push("O nome é obrigatório.");
    if (primaryWhatsappE164 && primaryWhatsappE164.length < 8) out.push("WhatsApp principal inválido.");
    return out;
  }, [name, primaryWhatsappE164]);

  // 3. SALVAR (POST ou PUT)
  async function handleSave() {
    setSubmitAttempted(true);
    if (errors.length > 0) return;
    setLoading(true);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!tenantId || !session) throw new Error("Sessão expirada.");

      const safeExtra = extras.filter(e => e.confirmed).map(e => e.e164);

      const payload = {
        tenant_id: tenantId,
        name: name.trim(),
        email: email.trim().toLowerCase() || null,
        whatsapp_primary: primaryWhatsappE164 || null,
        whatsapp_username: whatsappUsername.trim() || null,
        whatsapp_secondary: safeExtra,
        whatsapp_opt_in: whatsappOptIn,
        whatsapp_opt_out_until: dontMessageUntil ? new Date(dontMessageUntil).toISOString() : null,
        notes: notes.trim() || null
      };

        // =======================
        // CREATE ou UPDATE
        // =======================
        let resellerId = isEditing ? resellerToEdit.id : null;

        // ➕ CREATE
        if (!isEditing) {
          const { data, error } = await supabaseBrowser.rpc("create_reseller_and_setup", {
            p_tenant_id: tenantId,
            p_display_name: name.trim(),
            p_email: email.trim().toLowerCase() || null,
            p_notes: notes.trim() || null,

            // ✅ obrigatório na criação
            p_phone_primary_e164: primaryWhatsappE164 || null,

            // flags WhatsApp
            p_whatsapp_opt_in: Boolean(whatsappOptIn),
            p_whatsapp_username: whatsappUsername.trim() || null,
            p_whatsapp_snooze_until: dontMessageUntil
              ? new Date(dontMessageUntil).toISOString()
              : null,
          });

          // ⚠️ mantém sua regra de pegar o id retornado
          if (error) throw new Error(error.message);

          // ⚠️ mantém sua regra de pegar o id retornado
          const resellerIdToUse = String(
            (data as any)?.reseller_id ??
            (data as any)?.id ??
            data
          );

          if (!resellerIdToUse) {
            throw new Error("RPC não retornou reseller_id");
          }

          resellerId = resellerIdToUse;

        }

        // ✏️ UPDATE
        if (isEditing) {
          const { error } = await supabaseBrowser.rpc("update_reseller", {
  p_tenant_id: tenantId,
  p_reseller_id: resellerId,

  // ✅ nome correto do campo
  p_display_name: name.trim(),

  p_email: email.trim().toLowerCase() || null,

  // ✅ notas NUNCA limpam automaticamente
  p_notes: notes.trim() || null,
  p_clear_notes: false,

  // ✅ whatsapp
  p_whatsapp_opt_in: Boolean(whatsappOptIn),
  p_whatsapp_username: whatsappUsername.trim() || null,
  p_whatsapp_snooze_until: dontMessageUntil
    ? new Date(dontMessageUntil).toISOString()
    : null,

  // pode manter null se sua função tratar como "não alterar"
  p_is_archived: null,
});

if (error) throw new Error(error.message);

        }

        // =======================
        // TELEFONES (sempre)
        // =======================
        const extrasValidos = extras.filter(e => e.confirmed).map(e => e.e164);

        const { error: phoneErr } = await supabaseBrowser.rpc("set_reseller_phones", {
          p_tenant_id: tenantId,
          p_reseller_id: resellerId,
          p_primary_e164: primaryWhatsappE164 || null,
          p_secondary_e164: extrasValidos,
        });

        if (phoneErr) throw new Error(phoneErr.message);

        // FINAL
        onSuccess();
        onClose();


    } catch (err: any) {
      if (onError) onError(err.message);
      else alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[95vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-colors">
        
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-white/5">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
            {isEditing ? `Editar revendedor: ${resellerToEdit.display_name ?? resellerToEdit.name ?? ""}` : "Novo revendedor"}

          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white transition-colors">✕</button>
        </div>

        {/* BODY */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-white dark:bg-[#161b22]">

          
          
          {submitAttempted && errors.length > 0 && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-medium animate-in slide-in-from-top-2">
              <ul className="list-disc pl-4 space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="animate-in slide-in-from-bottom-2 duration-300">
              <Label>Nome completo *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: João Silva" autoFocus />
            </div>
            <div className="animate-in slide-in-from-bottom-2 duration-300">
              <Label>E-mail comercial</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="joao@exemplo.com" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  <div>
    <Label>Telefone principal</Label>
    <div className="flex gap-2">
      <div className="h-10 px-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap font-medium min-w-[120px]">
        {splitE164Advanced(primaryWhatsappE164).countryName} (+{splitE164Advanced(primaryWhatsappE164).countryCode})
      </div>
      <div className="relative flex-1">
        <Input 
          value={primaryDisplay} 
          onChange={e => { setPrimaryDisplay(e.target.value); setPrimaryConfirmed(false); }} 
          placeholder="21 99999-9999" 
          className="pr-10" 
        />
        <button 
          onClick={handlePrimaryValidate} 
          className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded flex items-center justify-center transition-colors ${primaryConfirmed ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:bg-slate-200'}`}
        >
          ✓
        </button>
      </div>
    </div>
  </div>
  <div>
    <Label>Identificador WhatsApp (@)</Label>
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">@</span>
      <Input value={whatsappUsername} onChange={e => setWhatsappUsername(e.target.value)} placeholder="username" className="pl-8" />
    </div>
  </div>
</div>

{/* Botão movido para fora do grid, logo abaixo, com margem pequena */}
<div className="flex justify-end -mt-2 relative z-10 mb-">
  <button 
    onClick={addExtra} 
    className="text-[10px] px-2 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold transition-colors uppercase tracking-wider"
  >
    + Adicionar
  </button>
</div>

{/* Lista de extras renderizada abaixo */}
<div className="space-y-4 mt-4">
  {extras.map(ex => (
    // ... resto do seu código de mapeamento dos extras
              <div key={ex.id} className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-white/5 p-3 rounded-xl border border-slate-200 dark:border-white/10 relative animate-in zoom-in-95">
                <button onClick={() => removeExtra(ex.id)} className="absolute top-2 right-2 text-rose-500 hover:scale-110 transition-transform">✕</button>
                <div className="flex gap-2">
                  <div className="h-10 px-3 bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-xs text-slate-500 font-medium">+{splitE164Advanced(ex.e164).countryCode}</div>
                  <div className="relative flex-1">
                    <Input value={ex.display} onChange={e => {
                        const val = e.target.value;
                        setExtras(prev => prev.map(item => item.id === ex.id ? {...item, display: val, confirmed: false} : item));
                    }} placeholder="Número extra" className="pr-10" />
                    <button onClick={() => validateExtra(ex.id)} className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded flex items-center justify-center ${ex.confirmed ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-400'}`}>✓</button>
                  </div>
                </div>
                <Input value={ex.username} onChange={e => {
                    const val = e.target.value;
                    setExtras(prev => prev.map(item => item.id === ex.id ? {...item, username: val} : item));
                }} placeholder="Username extra" />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 items-end">
            <div className="space-y-1.5">
              <Label>WhatsApp</Label>
              <ToggleLine
                label="Deseja receber mensagens?"
                value={whatsappOptIn}
                onChange={setWhatsappOptIn}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Não perturbar até</Label>
              <Input
                type="datetime-local"
                value={dontMessageUntil}
                onChange={(e) => setDontMessageUntil(e.target.value)}
                className="dark:[color-scheme:dark]"
              />
            </div>
          </div>


          <div>
            <Label>Observações internas</Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full h-24 p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-colors" placeholder="Anotações sobre este revendedor..." />
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 flex justify-end gap-3 transition-colors">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-sm font-semibold transition-colors">Cancelar</button>
          <button 
            onClick={handleSave} 
            disabled={loading} 
            className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-50"
          > 
            {loading ? "Processando..." : isEditing ? "Salvar alterações" : "Criar revendedor"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}