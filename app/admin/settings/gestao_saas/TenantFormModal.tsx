"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { SaasTenant } from "./page";

// ============================================================
// HELPERS DE TELEFONE
// ============================================================
type DdiOption = { code: string; label: string };
const DDI_OPTIONS: DdiOption[] = [
  { code: "55",  label: "Brasil"          },
  { code: "1",   label: "EUA/Canadá"      },
  { code: "351", label: "Portugal"        },
  { code: "44",  label: "Reino Unido"     },
  { code: "34",  label: "Espanha"         },
  { code: "49",  label: "Alemanha"        },
  { code: "33",  label: "França"          },
  { code: "39",  label: "Itália"          },
  { code: "52",  label: "México"          },
  { code: "54",  label: "Argentina"       },
  { code: "56",  label: "Chile"           },
  { code: "57",  label: "Colômbia"        },
  { code: "58",  label: "Venezuela"       },
  { code: "32",  label: "Bélgica"         },
  { code: "46",  label: "Suécia"          },
  { code: "31",  label: "Holanda"         },
  { code: "41",  label: "Suíça"           },
  { code: "45",  label: "Dinamarca"       },
  { code: "48",  label: "Polônia"         },
  { code: "30",  label: "Grécia"          },
  { code: "353", label: "Irlanda"         },
  { code: "507", label: "Panamá"          },
  { code: "506", label: "Costa Rica"      },
  { code: "595", label: "Paraguai"        },
  { code: "591", label: "Bolívia"         },
  { code: "27",  label: "África do Sul"   },
  { code: "234", label: "Nigéria"         },
  { code: "254", label: "Quênia"          },
  { code: "20",  label: "Egito"           },
  { code: "212", label: "Marrocos"        },
  { code: "86",  label: "China"           },
  { code: "91",  label: "Índia"           },
  { code: "81",  label: "Japão"           },
  { code: "82",  label: "Coreia do Sul"   },
  { code: "66",  label: "Tailândia"       },
  { code: "62",  label: "Indonésia"       },
  { code: "60",  label: "Malásia"         },
  { code: "971", label: "Emirados Árabes" },
  { code: "966", label: "Arábia Saudita"  },
  { code: "98",  label: "Irã"             },
  { code: "90",  label: "Turquia"         },
  { code: "61",  label: "Austrália"       },
  { code: "64",  label: "Nova Zelândia"   },
];

function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}

function inferDDIFromDigits(allDigits: string, originalInput?: string): string {
  const digits = onlyDigits(allDigits || "");
  if (!digits) return "55";
  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }
  if (originalInput && originalInput.trim().startsWith("+")) return digits.slice(0, 3);
  return "55";
}

function ddiLabel(ddi: string): string {
  const opt = DDI_OPTIONS.find((o) => o.code === ddi);
  return opt ? `${opt.label} (+${opt.code})` : `DDI Desconhecido (+${ddi})`;
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
  const nationalDigits = rawDigits.startsWith(ddi) ? rawDigits.slice(ddi.length) : rawDigits;
  const formattedNational = formatNational(ddi, nationalDigits);
  const e164 = `+${ddi}${nationalDigits}`;
  return { countryLabel: ddiLabel(ddi), e164, nationalDigits, formattedNational };
}

// ============================================================
// COMPONENTES AUXILIARES UI
// ============================================================
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-bold text-slate-500 dark:text-white/40 mb-1.5 tracking-tight uppercase">{children}</label>;
}

function FieldInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white placeholder-slate-400 dark:placeholder-white/20 outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40 whitespace-nowrap">{children}</span>
      <div className="flex-1 h-px bg-slate-100 dark:bg-white/5" />
    </div>
  );
}

// ============================================================
// ÍCONES
// ============================================================
function IconWa() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
    </svg>
  );
}
function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/>
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
    </svg>
  );
}
function IconEyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"/>
    </svg>
  );
}

// ============================================================
// COMPONENTE PRINCIPAL DO MODAL
// ============================================================
export default function TenantFormModal({ mode, tenant, myRole, parentTenantId, sessionOptions, onClose, onSuccess, onError }: {
  mode: "new" | "edit";
  tenant?: SaasTenant;
  myRole: string;
  parentTenantId: string | null;
  sessionOptions: { id: string; label: string }[];
  onClose: () => void;
  onSuccess: () => void;
  onError: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [selectedSession, setSelectedSession] = useState(tenant?.auto_whatsapp_session || "default");

  // Conta
  const [name, setName] = useState(tenant?.name ?? "");
  const [email, setEmail] = useState(tenant?.contact_email ?? tenant?.auth_email ?? "");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"MASTER" | "USER">(
    mode === "edit" ? (tenant?.role === "USER" ? "USER" : "MASTER") : "MASTER"
  );
  const [trialDays, setTrialDays] = useState(7);

  const trialExpires = useMemo(() => {
    const now = new Date();
    const target = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
    }).format(target) + " às 23:59";
  }, [trialDays]);

  // Contato e Observações
  const [responsibleName, setResponsibleName] = useState(tenant?.responsible_name ?? "");
  const [notes, setNotes] = useState(tenant?.notes ?? "");
  
  // ✅ Módulos Modulares
  const [activeModules, setActiveModules] = useState<string[]>(
    tenant?.active_modules || ["iptv", "financeiro"]
  );

  const handleModuleToggle = (mod: string) => {
    setActiveModules(prev => 
      prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]
    );
  };

  // Tabelas de plano SaaS
  const [saasTables, setSaasTables] = useState<{ id: string; name: string }[]>([]);
  const [creditsTables, setCreditsTables] = useState<{ id: string; name: string }[]>([]);
  const [saasPlanTableId, setSaasPlanTableId] = useState<string>(tenant?.saas_plan_table_id ?? "");
  const [creditsPlanTableId, setCreditsPlanTableId] = useState<string>(tenant?.credits_plan_table_id ?? "");

  useEffect(() => {
    async function loadPlanTables() {
      if (!parentTenantId) return;
      const { data } = await supabaseBrowser
        .from("plan_tables")
        .select("id, name, table_type")
        .eq("tenant_id", parentTenantId)
        .in("table_type", ["saas", "saas_credits"])
        .eq("is_active", true);

      if (!data) return;
      setSaasTables(data.filter((t: any) => t.table_type === "saas"));
      setCreditsTables(data.filter((t: any) => t.table_type === "saas_credits"));

      if (!saasPlanTableId) {
        const def = data.find((t: any) => t.table_type === "saas");
        if (def) setSaasPlanTableId(def.id);
      }
      if (!creditsPlanTableId) {
        const def = data.find((t: any) => t.table_type === "saas_credits");
        if (def) setCreditsPlanTableId(def.id);
      }
    }
    loadPlanTables();
  }, []);

  // Telefone / WhatsApp
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [phoneCountryLabel, setPhoneCountryLabel] = useState("Brasil (+55)");
  const [phoneE164, setPhoneE164] = useState(tenant?.phone_e164 ?? "");
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);

  const [waUsername, setWaUsername] = useState(tenant?.whatsapp_username ?? "");
  const [waUserTouched, setWaUserTouched] = useState(false);
  type WaValidation = { loading: boolean; exists: boolean; jid?: string } | null;
  const [waValidation, setWaValidation] = useState<WaValidation>(null);
  const waTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (tenant?.phone_e164) {
      const norm = applyPhoneNormalization(tenant.phone_e164);
      setPhoneCountryLabel(norm.countryLabel);
      setPhoneDisplay(norm.formattedNational || norm.nationalDigits);
      setPhoneE164(norm.e164);
      setPhoneConfirmed(true);
    }
  }, [tenant?.phone_e164]);

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
    } catch {
      setWaValidation({ loading: false, exists: false });
    }
  }

  function handlePhoneValidate() {
    const rawDigits = onlyDigits(phoneDisplay);
    if (rawDigits.length < 8) { setPhoneConfirmed(false); return; }
    const norm = applyPhoneNormalization(phoneDisplay);
    setPhoneCountryLabel(norm.countryLabel);
    setPhoneE164(norm.e164);
    setPhoneDisplay(norm.formattedNational || norm.nationalDigits || phoneDisplay);
    setPhoneConfirmed(true);

    const finalUser = waUserTouched && waUsername.trim()
      ? waUsername.trim()
      : onlyDigits(norm.e164);
    if (!waUserTouched) setWaUsername(finalUser);

    setWaValidation(null);
    void validateWa(finalUser);
  }

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push("Nome é obrigatório.");
    if (mode === "new" && !email.trim()) out.push("E-mail é obrigatório.");
    if (mode === "new" && password.length < 8) out.push("Senha deve ter pelo menos 8 caracteres.");
    return out;
  }, [name, email, password, mode]);

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    if (errors.length > 0) return;
    setSaving(true);
    try {
      if (mode === "new") {
        const res = await fetch("/api/saas/provision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              email: email.trim().toLowerCase(),
              password,
              role,
              trial_days: trialDays,
              credits_initial: 0,
              responsible_name: responsibleName.trim() || name.trim(),
              phone_e164: phoneE164 || null,
              whatsapp_username: waUsername.trim() || null,
              notes: notes.trim() || null,
              saas_plan_table_id: saasPlanTableId || null,
              credits_plan_table_id: role === "MASTER" ? (creditsPlanTableId || null) : null,
              whatsapp_session: selectedSession, 
              active_modules: activeModules, // ✅ ENVIO MODULAR
            }),
          });
        const data = await res.json();
        if (!res.ok) throw new Error(data.hint || data.error || "Falha ao criar revenda.");
      } else {
        const { error } = await supabaseBrowser.rpc("saas_update_profile", {
          p_tenant_id:         tenant!.id,
          p_responsible_name:  responsibleName.trim() || null,
          p_phone_e164:        phoneE164 || null,
          p_whatsapp_username: waUsername.trim() || null,
          p_notes:             notes.trim() || null,
          p_active_modules:    activeModules, // ✅ ATUALIZAÇÃO MODULAR
        });
        if (error) throw new Error(error.message);

        const { error: roleErr } = await supabaseBrowser.rpc("saas_update_role", {
          p_tenant_id: tenant!.id,
          p_role: role,
        });
        if (roleErr) throw new Error(roleErr.message);

        const { data: sess } = await supabaseBrowser.auth.getSession();
        const token = sess?.session?.access_token;
        
        const resPlans = await fetch("/api/saas/update-child-plans", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            child_tenant_id: tenant!.id,
            saas_plan_table_id: saasPlanTableId || null,
            credits_plan_table_id: role === "MASTER" ? (creditsPlanTableId || null) : null,
            auto_whatsapp_session: selectedSession,
          }),
        });
        
        if (!resPlans.ok) {
          const planData = await resPlans.json().catch(() => ({}));
          throw new Error(planData.error || "Falha ao vincular tabelas de plano.");
        }

        if (newEmail.trim() && newEmail.trim() !== email) {
          const res = await fetch("/api/saas/update-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenant_id: tenant!.id, new_email: newEmail.trim().toLowerCase() }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.hint || data.error || "Falha ao atualizar e-mail.");
        }
      }
      onSuccess();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden">
      <div className="w-full max-w-2xl max-h-[90dvh] bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 shrink-0">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">
            {mode === "new" ? "Novo Cliente/Revendedor" : `Editar: ${tenant?.name}`}
          </h2>
        </div>

        {/* BODY */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5" style={{ WebkitOverflowScrolling: "touch" }}>

          {submitAttempted && errors.length > 0 && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-medium">
              <ul className="list-disc pl-4 space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          {/* Seção: Conta */}
          {mode === "new" && (
            <>
              <SectionTitle>Dados da Conta</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <FieldLabel>Nome *</FieldLabel>
                  <FieldInput value={name} onChange={e => setName(e.target.value)} placeholder="Ex: João Silva" autoFocus />
                </div>
                <div>
                  <FieldLabel>E-mail *</FieldLabel>
                  <FieldInput type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="joao@email.com" />
                </div>
                <div>
                  <FieldLabel>Senha *</FieldLabel>
                  <div className="relative">
                    <FieldInput
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mín. 8 caracteres"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/80 transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <FieldLabel>Papel (Perfil)</FieldLabel>
                <div className="flex gap-2 mt-1">
                  {(["MASTER", "USER"] as const).map(r => (
                    <button key={r} onClick={() => setRole(r)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-all ${
                        role === r
                          ? r === "MASTER" ? "bg-amber-500 border-amber-500 text-white" : "bg-slate-700 dark:bg-slate-600 border-slate-700 text-white"
                          : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50"
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Dias de Teste</FieldLabel>
                  <select
                    value={trialDays}
                    onChange={e => setTrialDays(Number(e.target.value))}
                    className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
                  >
                    <option value={0}>Sem Teste (0 dias)</option>
                    <option value={1}>1 dia</option>
                    <option value={2}>2 dias</option>
                    <option value={3}>3 dias</option>
                    <option value={5}>5 dias</option>
                    <option value={7}>7 dias (Máximo)</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Vencimento do Teste</FieldLabel>
                  <div className="h-10 w-full px-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-sm font-bold text-slate-700 dark:text-white">
                    {trialDays === 0 ? (
                      <span className="text-slate-400 dark:text-white/30 font-normal">Sem teste</span>
                    ) : trialExpires}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Seção: Email Edit */}
          {mode === "edit" && (
            <>
              <SectionTitle>Acesso</SectionTitle>
              <div>
                <FieldLabel>E-mail atual</FieldLabel>
                <FieldInput value={email} disabled className="opacity-50 cursor-not-allowed" />
              </div>
              <div>
                <FieldLabel>Novo e-mail (deixe em branco para não alterar)</FieldLabel>
                <FieldInput
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="novo@email.com"
                />
              </div>
              <div>
                <FieldLabel>Perfil (Role)</FieldLabel>
                <div className="flex gap-2 mt-1">
                  {(["MASTER", "USER"] as const).map(r => (
                    <button key={r} type="button" onClick={() => setRole(r)}
                      className={`flex-1 py-2 rounded-lg border text-xs font-bold transition-all ${
                        role === r
                          ? r === "MASTER" ? "bg-amber-500 border-amber-500 text-white" : "bg-slate-700 dark:bg-slate-600 border-slate-700 text-white"
                          : "bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50"
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Seção: WhatsApp */}
          <SectionTitle>Contato WhatsApp</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Telefone principal</FieldLabel>
              <div className="flex gap-2">
                <div className="h-10 px-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-xs text-slate-500 dark:text-white/40 whitespace-nowrap font-medium min-w-[120px] shrink-0">
                  {phoneCountryLabel}
                </div>
                <div className="relative flex-1">
                  <FieldInput
                    value={phoneDisplay}
                    onChange={e => { setPhoneDisplay(e.target.value); setPhoneConfirmed(false); }}
                    placeholder="21 99999-9999"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={handlePhoneValidate}
                    title="Confirmar número"
                    className={`absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded flex items-center justify-center text-base transition-colors ${
                      phoneConfirmed
                        ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                        : "text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
                    }`}
                  >
                    ✓
                  </button>
                </div>
              </div>
            </div>

            <div>
              <FieldLabel>WhatsApp Username</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">@</span>
                <FieldInput
                  value={waUsername}
                  onChange={e => {
                    const v = e.target.value.replace("@", "");
                    setWaUsername(v);
                    setWaUserTouched(true);
                    setWaValidation(null);
                    if (waTimerRef.current) clearTimeout(waTimerRef.current);
                    waTimerRef.current = setTimeout(() => void validateWa(v), 800);
                  }}
                  placeholder="usuario"
                  className="pl-7 pr-10"
                />
                {waUsername && (
                  <a
                    href={`https://wa.me/${waUsername.replace(/\D/g, "")}`}
                    target="_blank" rel="noopener noreferrer"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-400 transition-colors"
                    title="Abrir no WhatsApp"
                  >
                    <IconWa />
                  </a>
                )}
              </div>
              {waValidation && (
                <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-bold ${
                  waValidation.loading ? "text-slate-400" : waValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
                }`}>
                  {waValidation.loading ? (
                    <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Validando...</>
                  ) : waValidation.exists ? <>✅ WhatsApp ativo</> : <>❌ Não encontrado</>}
                </div>
              )}
            </div>
          </div>

          {/* Tabelas de Plano */}
          <SectionTitle>Tabelas de Plano</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Renovação do Sistema</FieldLabel>
              <select
                value={saasPlanTableId}
                onChange={e => setSaasPlanTableId(e.target.value)}
                className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
              >
                <option value="">— Selecionar —</option>
                {saasTables.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            {role === "MASTER" && (
              <div>
                <FieldLabel>Venda de Créditos SaaS</FieldLabel>
                <select
                  value={creditsPlanTableId}
                  onChange={e => setCreditsPlanTableId(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
                >
                  <option value="">— Selecionar —</option>
                  {creditsTables.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <SectionTitle>Envio de Mensagens</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Sessão de Disparo (WhatsApp)</FieldLabel>
              <select
                value={selectedSession}
                onChange={e => setSelectedSession(e.target.value)}
                className="w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 transition-colors"
              >
                {sessionOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* MÓDULOS MODULARES */}
          <SectionTitle>Módulos Habilitados</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 mt-2">
            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${activeModules.includes('iptv') ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              <input type="checkbox" checked={activeModules.includes('iptv')} onChange={() => handleModuleToggle('iptv')} className="mt-1 w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500/50 cursor-pointer" />
              <div>
                <div className="text-sm font-bold text-slate-700 dark:text-white">IPTV & SaaS</div>
                <div className="text-[10px] text-slate-500 dark:text-white/50 leading-tight mt-0.5">Gestão de Servidores, Aplicativos e Clientes.</div>
              </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${activeModules.includes('financeiro') ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              <input type="checkbox" checked={activeModules.includes('financeiro')} onChange={() => handleModuleToggle('financeiro')} className="mt-1 w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500/50 cursor-pointer" />
              <div>
                <div className="text-sm font-bold text-slate-700 dark:text-white">Gestão Financeira</div>
                <div className="text-[10px] text-slate-500 dark:text-white/50 leading-tight mt-0.5">Faturas automáticas, Pix e fluxo de caixa.</div>
              </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${activeModules.includes('academia') ? 'border-sky-500 bg-sky-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              <input type="checkbox" checked={activeModules.includes('academia')} onChange={() => handleModuleToggle('academia')} className="mt-1 w-4 h-4 text-sky-600 rounded focus:ring-sky-500/50 cursor-pointer" />
              <div>
                <div className="text-sm font-bold text-slate-700 dark:text-white flex items-center gap-1.5">
                  Academia <span className="text-[8px] bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400 px-1.5 py-0.5 rounded uppercase font-black tracking-wider">Novo</span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-white/50 leading-tight mt-0.5">Gestão de alunos, mensalidades e treinos.</div>
              </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${activeModules.includes('condominio') ? 'border-purple-500 bg-purple-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              <input type="checkbox" checked={activeModules.includes('condominio')} onChange={() => handleModuleToggle('condominio')} className="mt-1 w-4 h-4 text-purple-600 rounded focus:ring-purple-500/50 cursor-pointer" />
              <div>
                <div className="text-sm font-bold text-slate-700 dark:text-white flex items-center gap-1.5">
                  Condomínio <span className="text-[8px] bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 px-1.5 py-0.5 rounded uppercase font-black tracking-wider">Em breve</span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-white/50 leading-tight mt-0.5">Moradores, encomendas, estoque e reservas.</div>
              </div>
            </label>
          </div>

          <div className="mt-2">
            <FieldLabel>Observações Internas (Opcional)</FieldLabel>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-700 dark:text-white outline-none focus:border-emerald-500/50 resize-none transition-colors"
              placeholder="Notas internas sobre este cliente..."
            />
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 shrink-0 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 h-10 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-sm font-semibold hover:bg-slate-100 dark:hover:bg-white/5 transition">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-6 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition shadow-lg shadow-emerald-900/20 disabled:opacity-50">
            {saving ? "Salvando..." : mode === "new" ? "Criar Revendedor" : "Salvar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}