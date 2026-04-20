"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentTenantId } from "@/lib/tenant";
import { supabaseBrowser } from "@/lib/supabase/browser";

// --- HELPERS DE TELEFONE E PAÍSES (alinhados com NovoCliente) ---
type DdiOption = { code: string; label: string; flag: string };
const DDI_OPTIONS: DdiOption[] = [
  { code: "55",   label: "Brasil",             flag: "🇧🇷" },
  { code: "1",    label: "EUA/Canadá",         flag: "🇺🇸" },
  { code: "351",  label: "Portugal",           flag: "🇵🇹" },
  { code: "44",   label: "Reino Unido",        flag: "🇬🇧" },
  { code: "34",   label: "Espanha",            flag: "🇪🇸" },
  { code: "49",   label: "Alemanha",           flag: "🇩🇪" },
  { code: "33",   label: "França",             flag: "🇫🇷" },
  { code: "39",   label: "Itália",             flag: "🇮🇹" },
  { code: "52",   label: "México",             flag: "🇲🇽" },
  { code: "54",   label: "Argentina",          flag: "🇦🇷" },
  { code: "56",   label: "Chile",              flag: "🇨🇱" },
  { code: "57",   label: "Colômbia",           flag: "🇨🇴" },
  { code: "58",   label: "Venezuela",          flag: "🇻🇪" },
  { code: "32",   label: "Bélgica",            flag: "🇧🇪" },
  { code: "46",   label: "Suécia",             flag: "🇸🇪" },
  { code: "31",   label: "Holanda",            flag: "🇳🇱" },
  { code: "41",   label: "Suíça",              flag: "🇨🇭" },
  { code: "45",   label: "Dinamarca",          flag: "🇩🇰" },
  { code: "48",   label: "Polônia",            flag: "🇵🇱" },
  { code: "30",   label: "Grécia",             flag: "🇬🇷" },
  { code: "353",  label: "Irlanda",            flag: "🇮🇪" },
  { code: "507",  label: "Panamá",             flag: "🇵🇦" },
  { code: "506",  label: "Costa Rica",         flag: "🇨🇷" },
  { code: "595",  label: "Paraguai",           flag: "🇵🇾" },
  { code: "591",  label: "Bolívia",            flag: "🇧🇴" },
  { code: "27",   label: "África do Sul",      flag: "🇿🇦" },
  { code: "234",  label: "Nigéria",            flag: "🇳🇬" },
  { code: "254",  label: "Quênia",             flag: "🇰🇪" },
  { code: "20",   label: "Egito",              flag: "🇪🇬" },
  { code: "212",  label: "Marrocos",           flag: "🇲🇦" },
  { code: "86",   label: "China",              flag: "🇨🇳" },
  { code: "91",   label: "Índia",              flag: "🇮🇳" },
  { code: "81",   label: "Japão",              flag: "🇯🇵" },
  { code: "82",   label: "Coreia do Sul",      flag: "🇰🇷" },
  { code: "66",   label: "Tailândia",          flag: "🇹🇭" },
  { code: "62",   label: "Indonésia",          flag: "🇮🇩" },
  { code: "60",   label: "Malásia",            flag: "🇲🇾" },
  { code: "971",  label: "Emirados Árabes",    flag: "🇦🇪" },
  { code: "966",  label: "Arábia Saudita",     flag: "🇸🇦" },
  { code: "98",   label: "Irã",                flag: "🇮🇷" },
  { code: "90",   label: "Turquia",            flag: "🇹🇷" },
  { code: "61",   label: "Austrália",          flag: "🇦🇺" },
  { code: "64",   label: "Nova Zelândia",      flag: "🇳🇿" },
];

function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}

function inferDDIFromDigits(allDigits: string, originalInput?: string): string {
  const digits = onlyDigits(allDigits || "");
  if (!digits) return "55";
  // Testa do maior código pro menor para evitar colisão (ex: 1 vs 1246)
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }
  // Se digitou "+" explicitamente, não força "55"
  if (originalInput && originalInput.trim().startsWith("+")) {
    return digits.slice(0, 3);
  }
  return "55";
}

function ddiMeta(ddi: string) {
  const opt = DDI_OPTIONS.find((o) => o.code === ddi);
  if (!opt) return { label: `DDI Desconhecido (+${ddi})` };
  return { label: `${opt.label} (+${opt.code})` };
}

function formatNational(ddi: string, nationalDigits: string) {
  const d = onlyDigits(nationalDigits);
  if (ddi === "55") {
    const area = d.slice(0, 2);
    const rest = d.slice(2);
    if (!area) return "";
    if (rest.length >= 9) return `${area} ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
    if (rest.length >= 8) return `${area} ${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
    return `${area} ${rest}`.trim();
  }
  // Genérico para outros países
  const groups: string[] = [];
  let i = 0;
  while (i < d.length) {
    const rem = d.length - i;
    const step = rem > 7 ? 3 : 4;
    groups.push(d.slice(i, i + step));
    i += step;
  }
  return groups.join(" ").trim();
}

function applyPhoneNormalization(rawInput: string) {
  const rawDigits = onlyDigits(rawInput);
  if (!rawDigits) {
    return { countryLabel: "—", e164: "", nationalDigits: "", formattedNational: "" };
  }
  const ddi = inferDDIFromDigits(rawDigits, rawInput);
  const meta = ddiMeta(ddi);
  const nationalDigits = rawDigits.startsWith(ddi) ? rawDigits.slice(ddi.length) : rawDigits;
  const formattedNational = formatNational(ddi, nationalDigits);
  const e164 = `+${ddi}${nationalDigits}`;
  return { countryLabel: meta.label, e164, nationalDigits, formattedNational };
}

function toDatetimeLocalValue(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// --- COMPONENTES VISUAIS (PADRÃO page.txt) ---
function IconWa() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
    </svg>
  );
}

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

// ✅ Extrai o DDI numérico do label (ex: "Brasil (+55)" → "55")
function extractDdiFromLabel(label: string): string {
  const match = label.match(/\+(\d+)\)/);
  return match ? match[1] : "55";
}

export default function ResellerFormModal({ resellerToEdit, onClose, onSuccess, onError }: Props) {
  const isEditing = !!resellerToEdit;
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Estados do formulário
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [primaryCountryLabel, setPrimaryCountryLabel] = useState("Brasil (+55)");
  const [primaryPhoneRaw, setPrimaryPhoneRaw] = useState("");
  const [primaryConfirmed, setPrimaryConfirmed] = useState(false);
  const [whatsappUsername, setWhatsappUsername] = useState(""); 
  const [whatsUserTouched, setWhatsUserTouched] = useState(false); // ✅ Trava anti-bumerangue adicionada
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [dontMessageUntil, setDontMessageUntil] = useState("");
  const [notes, setNotes] = useState("");

  type WaValidation = { loading: boolean; exists: boolean; jid?: string } | null;
  const [waValidation, setWaValidation] = useState<WaValidation>(null);
  const waValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function validateWa(username: string) {
    const digits = username.replace(/\D/g, "");
    if (digits.length < 8) { setWaValidation(null); return; }
    setWaValidation({ loading: true, exists: false });
    try {
      const res = await fetch("/api/whatsapp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const json = await res.json().catch(() => ({}));
      setWaValidation({ loading: false, exists: !!json.exists, jid: json.jid });

     // Resolve país pelo JID retornado pelo WhatsApp
      if (json.exists && json.jid) {
        const jidDigits = String(json.jid).split("@")[0].split(":")[0].replace(/\D/g, "");
        if (jidDigits) {
          // Como o JID do WhatsApp vem com o código do país, o applyPhoneNormalization
          // vai conseguir extrair o DDI corretamente.
          const inferred = applyPhoneNormalization(`+${jidDigits}`); 
          setPrimaryCountryLabel(inferred.countryLabel);
          setPrimaryPhoneRaw(inferred.formattedNational || inferred.nationalDigits || "");
        }
      }
    } catch {
      setWaValidation({ loading: false, exists: false });
    }
  }

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
  const norm = applyPhoneNormalization(`+${mainDigits}`);
  setPrimaryCountryLabel(norm.countryLabel);
  setPrimaryPhoneRaw(norm.formattedNational || norm.nationalDigits);
  setPrimaryConfirmed(true);
} else {
  setPrimaryCountryLabel("Brasil (+55)");
  setPrimaryPhoneRaw("");
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
    const rawPrimaryDigits = (primaryPhoneRaw || "").replace(/\D+/g, "");
    if (rawPrimaryDigits.length < 8) {
      setPrimaryConfirmed(false);
      return;
    }
    
    // ✅ Devolvemos a inteligência original: se você colar 54911..., ele descobre sozinho que é Argentina!
    const inferred = applyPhoneNormalization(primaryPhoneRaw);
    setPrimaryCountryLabel(inferred.countryLabel);
    setPrimaryPhoneRaw(inferred.formattedNational || inferred.nationalDigits);
    setPrimaryConfirmed(true);

    // ✅ O Segredo: Só prioriza o WhatsApp antigo se o usuário tiver alterado ele explicitamente
    const finalUser = whatsUserTouched && whatsappUsername.trim() 
      ? whatsappUsername.trim() 
      : inferred.e164.replace(/\D+/g, "");
    
    if (!whatsUserTouched) {
      setWhatsappUsername(finalUser);
    }
    
    void validateWa(finalUser);
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
    const rawPrimaryDigits = (primaryPhoneRaw || "").replace(/\D+/g, "");
    if (rawPrimaryDigits && rawPrimaryDigits.length < 8) out.push("WhatsApp principal inválido.");
    return out;
  }, [name, primaryPhoneRaw]);

  // 3. SALVAR (POST ou PUT)
  async function handleSave() {
    setSubmitAttempted(true);
    if (errors.length > 0) return;
    setLoading(true);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!tenantId || !session) throw new Error("Sessão expirada.");

      // ✅ RESOLUÇÃO FORÇADA DO NÚMERO PRINCIPAL ANTES DE SALVAR
      const rawPrimaryDigits = (primaryPhoneRaw || "").replace(/\D+/g, "");
      const ddi = rawPrimaryDigits ? extractDdiFromLabel(primaryCountryLabel) : "55";
      const natDigits = rawPrimaryDigits.startsWith(ddi) ? rawPrimaryDigits.slice(ddi.length) : rawPrimaryDigits;
      const finalPrimaryE164 = rawPrimaryDigits ? `+${ddi}${natDigits}` : null;

      const safeExtra = extras.filter(e => e.confirmed).map(e => e.e164);

      const payload = {
        tenant_id: tenantId,
        name: name.trim(),
        email: email.trim().toLowerCase() || null,
        whatsapp_primary: finalPrimaryE164,
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
            p_phone_primary_e164: finalPrimaryE164,

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
            p_display_name: name.trim(),
            p_email: email.trim().toLowerCase() || null,
            p_notes: notes.trim() || null,
            p_clear_notes: notes.trim() === "", // Usa a flag nativa para notas se existir
            p_whatsapp_opt_in: Boolean(whatsappOptIn),
            p_whatsapp_username: whatsappUsername.trim() || null,
            p_whatsapp_snooze_until: dontMessageUntil
              ? new Date(dontMessageUntil).toISOString()
              : null,
            p_is_archived: null,
          });

          if (error) throw new Error(error.message);

          // ✅ SOLUÇÃO À PROVA DE BALAS:
          // Se a RPC ignorou os nulos e manteve o valor antigo, forçamos a limpeza direto na tabela.
          const fieldsToClear: any = {};
          if (!email.trim()) fieldsToClear.email = null;
          if (!whatsappUsername.trim()) fieldsToClear.whatsapp_username = null;
          if (!notes.trim()) fieldsToClear.notes = null;

          // Se houver algum campo apagado na tela, roda o update forçado:
          if (Object.keys(fieldsToClear).length > 0) {
            const { error: updateErr } = await supabaseBrowser
              .from("resellers")
              .update(fieldsToClear)
              .eq("id", resellerId)
              .eq("tenant_id", tenantId); // Garantia de segurança

            if (updateErr) console.warn("Falha ao forçar limpeza dos campos:", updateErr.message);
          }
        }

        // =======================
        // TELEFONES (sempre)
        // =======================
        const extrasValidos = extras.filter(e => e.confirmed).map(e => e.e164);

        const { error: phoneErr } = await supabaseBrowser.rpc("set_reseller_phones", {
          p_tenant_id: tenantId,
          p_reseller_id: resellerId,
          p_primary_e164: finalPrimaryE164,
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
  <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden overscroll-contain animate-in fade-in duration-200">
    
    <div
      className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden min-h-0 transition-colors"
      style={{ maxHeight: "90dvh" }}
    >
      
      {/* HEADER */}
      <div className="px-6 py-4 border-b bg-slate-50 dark:bg-white/5 shrink-0 rounded-t-xl">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-white">
          {isEditing ? "Editar Revenda" : "Nova Revenda"}
        </h2>
      </div>


        {/* BODY */}
<div
  className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6"
  style={{ WebkitOverflowScrolling: "touch" }}
>

  {submitAttempted && errors.length > 0 && (
    <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-medium animate-in slide-in-from-top-2">
      <ul className="list-disc pl-4 space-y-0.5">
        {errors.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </div>
  )}

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div className="animate-in slide-in-from-bottom-2 duration-300">
      <Label>Nome completo *</Label>
      <Input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Ex: João Silva"
        autoFocus
      />
    </div>

    <div className="animate-in slide-in-from-bottom-2 duration-300">
      <Label>E-mail comercial</Label>
      <Input
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="joao@exemplo.com"
      />
    </div>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <Label>Telefone principal</Label>
      <div className="flex gap-2">
        <div className="h-10 px-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap font-medium min-w-[120px]">
          {primaryCountryLabel}
        </div>

        <div className="relative flex-1">
          <Input
            value={primaryPhoneRaw}
            onChange={e => {
              setPrimaryPhoneRaw(e.target.value);
              setPrimaryConfirmed(false);
            }}
            placeholder="21 99999-9999"
            className="pr-10"
          />

          <button
            onClick={handlePrimaryValidate}
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded flex items-center justify-center transition-colors ${
              primaryConfirmed
                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                : "text-slate-400 hover:bg-slate-200"
            }`}
          >
            ✓
          </button>
        </div>
      </div>
    </div>

    <div>
      <Label>Identificador WhatsApp (@)</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          @
        </span>
        <Input
          value={whatsappUsername}
          onChange={e => {
            const val = e.target.value;
            setWhatsappUsername(val);
            setWhatsUserTouched(true); // ✅ Avisa o sistema que o usuário mexeu aqui
            setWaValidation(null);
            if (waValidateTimer.current) clearTimeout(waValidateTimer.current);
            waValidateTimer.current = setTimeout(() => void validateWa(val), 800);
          }}
          placeholder="username"
          className="pl-8 pr-10"
        />
{whatsappUsername && (
          <a
            href={`https://wa.me/${whatsappUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-600"
            title="Abrir no WhatsApp"
          >
            <IconWa />
          </a>
        )}
      </div>
      {waValidation && (
        <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-bold ${waValidation.loading ? "text-slate-400" : waValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
          {waValidation.loading ? (
            <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Validando...</>
          ) : waValidation.exists ? <>✅ WhatsApp ativo</> : <>❌ Não encontrado no WhatsApp</>}
        </div>
      )}
    </div>
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
    <textarea
      value={notes}
      onChange={e => setNotes(e.target.value)}
      className="w-full h-24 p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-colors"
      placeholder="Anotações sobre este revendedor..."
    />
  </div>

</div>

        {/* FOOTER FIXO */}
      <div className="px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t bg-slate-50 dark:bg-white/5 shrink-0 rounded-b-xl flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 h-10 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-sm font-semibold hover:bg-slate-100 dark:hover:bg-white/5 transition"
        >
          Cancelar
        </button>

        <button
          onClick={handleSave}
          disabled={loading}
          className="px-5 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition disabled:opacity-50"
        >
          {loading ? "Salvando..." : "Salvar"}
        </button>
      </div>

    </div>
  </div>,
  document.body
);}