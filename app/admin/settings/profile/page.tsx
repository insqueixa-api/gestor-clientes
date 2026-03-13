"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useTheme } from "@/components/theme/ThemeProvider";
import Link from "next/link";
import QRCode from "qrcode";

// ============================================================================
// HELPERS & CONSTANTES
// ============================================================================

type DdiOption = { code: string; label: string; flag: string };

const DDI_OPTIONS: DdiOption[] = [
  { code: "55", label: "Brasil", flag: "🇧🇷" },
  { code: "1", label: "EUA/Canadá", flag: "🇺🇸" },
  { code: "351", label: "Portugal", flag: "🇵🇹" },
  { code: "44", label: "Reino Unido", flag: "🇬🇧" },
  { code: "34", label: "Espanha", flag: "🇪🇸" },
  { code: "49", label: "Alemanha", flag: "🇩🇪" },
  { code: "33", label: "França", flag: "🇫🇷" },
  { code: "39", label: "Itália", flag: "🇮🇹" },
  { code: "353", label: "Irlanda", flag: "🇮🇪" }, // ✅ ADICIONADO
  { code: "52", label: "México", flag: "🇲🇽" },
  { code: "54", label: "Argentina", flag: "🇦🇷" },
  { code: "56", label: "Chile", flag: "🇨🇱" },
  { code: "57", label: "Colômbia", flag: "🇨🇴" },
  { code: "58", label: "Venezuela", flag: "🇻🇪" },
  { code: "32", label: "Bélgica", flag: "🇧🇪" },
  { code: "46", label: "Suécia", flag: "🇸🇪" },
  { code: "31", label: "Holanda", flag: "🇳🇱" },
  { code: "41", label: "Suíça", flag: "🇨🇭" },
  { code: "45", label: "Dinamarca", flag: "🇩🇰" },
  { code: "48", label: "Polônia", flag: "🇵🇱" },
  { code: "30", label: "Grécia", flag: "🇬🇷" },
  { code: "507", label: "Panamá", flag: "🇵🇦" },
  { code: "506", label: "Costa Rica", flag: "🇨🇷" },
  { code: "595", label: "Paraguai", flag: "🇵🇾" },
  { code: "591", label: "Bolívia", flag: "🇧🇴" },
  { code: "503", label: "El Salvador", flag: "🇸🇻" },
  { code: "502", label: "Guatemala", flag: "🇬🇹" },
  { code: "504", label: "Honduras", flag: "🇭🇳" },
  { code: "27", label: "África do Sul", flag: "🇿🇦" },
  { code: "234", label: "Nigéria", flag: "🇳🇬" },
  { code: "254", label: "Quênia", flag: "🇰🇪" },
  { code: "20", label: "Egito", flag: "🇪🇬" },
  { code: "212", label: "Marrocos", flag: "🇲🇦" },
  { code: "233", label: "Gana", flag: "🇬🇭" },
  { code: "229", label: "Benin", flag: "🇧🇯" },
  { code: "86", label: "China", flag: "🇨🇳" },
  { code: "91", label: "Índia", flag: "🇮🇳" },
  { code: "81", label: "Japão", flag: "🇯🇵" },
  { code: "82", label: "Coreia do Sul", flag: "🇰🇷" },
  { code: "66", label: "Tailândia", flag: "🇹🇭" },
  { code: "62", label: "Indonésia", flag: "🇮🇩" },
  { code: "60", label: "Malásia", flag: "🇲🇾" },
  { code: "970", label: "Palestina", flag: "🇵🇸" },
  { code: "971", label: "Emirados Árabes", flag: "🇦🇪" },
  { code: "966", label: "Arábia Saudita", flag: "🇸🇦" },
  { code: "98", label: "Irã", flag: "🇮🇷" },
  { code: "90", label: "Turquia", flag: "🇹🇷" },
  { code: "964", label: "Iraque", flag: "🇮🇶" },
  { code: "61", label: "Austrália", flag: "🇦🇺" },
  { code: "64", label: "Nova Zelândia", flag: "🇳🇿" },
  { code: "672", label: "Ilhas Norfolk", flag: "🇳🇫" },
];

function onlyDigits(raw: string) {
  return raw.replace(/\D+/g, "");
}

// ✅ 1. Melhorada a função inferDDIFromDigits para aceitar o originalInput
function inferDDIFromDigits(allDigits: string, originalInput?: string): string {
  const digits = onlyDigits(allDigits || "");
  if (!digits) return "55";

  const sorted = [...DDI_OPTIONS].sort((a, b) => b.code.length - a.code.length);
  for (const opt of sorted) {
    if (digits.startsWith(opt.code)) return opt.code;
  }

  // ✅ Se tem "+" explícito, não força "55", extrai os primeiros dígitos possíveis
  if (originalInput && originalInput.trim().startsWith("+")) {
    return digits.slice(0, 3);
  }

  return "55";
}

function ddiMeta(ddi: string) {
  const opt = DDI_OPTIONS.find((o) => o.code === ddi);
  if (!opt) return { 
      label: `DDI Desconhecido (+${ddi})`, 
      code: ddi,
      pretty: `🌍 DDI (+${ddi})` // ✅ Mais seguro e claro
  };
  return { 
      label: `${opt.label} (+${opt.code})`, 
      code: opt.code,
      pretty: `${opt.label} (+${opt.code})` 
  };
}

function formatNational(ddi: string, nationalDigits: string) {
  const d = onlyDigits(nationalDigits);
  if (ddi === "55") {
    const area = d.slice(0, 2);
    const rest = d.slice(2);
    if (!area) return "";
    if (rest.length >= 9) {
      const first = rest.slice(0, 5);
      const last = rest.slice(5, 9);
      return `${area} ${first}${last ? `-${last}` : ""}`.trim();
    }
    if (rest.length >= 8) {
      const first = rest.slice(0, 4);
      const last = rest.slice(4, 8);
      return `${area} ${first}${last ? `-${last}` : ""}`.trim();
    }
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

// ✅ 2. Passar o input cru para a splitE164
function splitE164(raw: string) {
  const digits = onlyDigits(raw);
  const ddi = inferDDIFromDigits(digits, raw);
  const national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  return { ddi, national };
}

// ✅ 3. Passar o input cru para a applyPhoneNormalization
function applyPhoneNormalization(rawInput: string) {
  const rawDigits = onlyDigits(rawInput);
  if (!rawDigits) {
    return { prettyPrefix: "—", e164: "", formattedNational: "", nationalDigits: "" };
  }
  
  // Se o user digitou apenas os 10 ou 11 do Brasil sem +, garante o 55
  let finalInputToInfer = rawInput;
  if (!rawInput.trim().startsWith("+") && (rawDigits.length === 10 || rawDigits.length === 11)) {
     finalInputToInfer = `+55${rawDigits}`;
  }

  const ddi = inferDDIFromDigits(onlyDigits(finalInputToInfer), finalInputToInfer);
  const meta = ddiMeta(ddi);
  const nationalDigits = onlyDigits(finalInputToInfer).startsWith(ddi) ? onlyDigits(finalInputToInfer).slice(ddi.length) : onlyDigits(finalInputToInfer);
  const formattedNational = formatNational(ddi, nationalDigits);
  const e164 = `+${ddi}${nationalDigits}`;
  return { 
      prettyPrefix: meta.pretty, 
      e164, 
      formattedNational, 
      nationalDigits 
  };
}

// ============================================================================
// COMPONENTES UI
// ============================================================================

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">{children}</label>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed read-only:opacity-70 read-only:cursor-pointer read-only:focus:border-emerald-500/30 ${className}`}
    />
  );
}

function PhoneRow({ label, prettyPrefix, rawValue, onRawChange, onDone, ...inputProps }: any) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        {/* ✅ AUMENTADO: Largura min-w-[140px] para caber "Brasil (+55)" */}
<div className="h-10 w-[90px] shrink-0 px-2 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-[11px] font-bold text-slate-700 dark:text-white truncate justify-center">
  {prettyPrefix || "—"}
</div>
        <div className="relative flex-1">
          <Input 
            value={rawValue} 
            onChange={(e) => onRawChange(e.target.value)} 
            placeholder="Telefone" 
            className="pr-12" 
            {...inputProps} 
            onBlur={onDone}
            onKeyDown={(e) => e.key === 'Enter' && onDone()}
          />
          <button 
            type="button" 
            onClick={onDone} 
            disabled={inputProps.readOnly}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ✓
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PÁGINA PRINCIPAL
// ============================================================================

export default function ProfileSettingsPage() {
  const { theme, setTheme } = useTheme();
 
  const [userId, setUserId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

const [email, setEmail] = useState("");
  const [role, setRole] = useState("Carregando...");
  const [roleRaw, setRoleRaw] = useState<string | null>(null);

  // ✅ NOVO: Estados da Assinatura
  const [licenseStatus, setLicenseStatus] = useState("ACTIVE");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);

  // ✅ SaaS: qualquer membro autenticado do tenant pode parear o seu WhatsApp
const canPairWhatsApp = !!userId && !!tenantId;


  // WhatsApp (UI)
const [waLoading, setWaLoading] = useState(false);
const [waConnected, setWaConnected] = useState<boolean>(false);
const [waQr, setWaQr] = useState<string | null>(null);
const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
const [waLastError, setWaLastError] = useState<string | null>(null);

const [waConfigExpanded, setWaConfigExpanded] = useState(false);

// UI: info da sessão WhatsApp (vem do /api/whatsapp/status)
const [waSessionLabel, setWaSessionLabel] = useState<string>("Contato principal");
const [waPushName, setWaPushName] = useState<string | null>(null);
const [waProfilePicUrl, setWaProfilePicUrl] = useState<string | null>(null); // vem do /api/whatsapp/profile (pictureUrl)
// controle cache profile (evita bater na VM toda hora)
const waLastProfileFetchRef = useRef<number>(0);
const [waStatusText, setWaStatusText] = useState<string | null>(null);
const [waRejectCalls, setWaRejectCalls] = useState<boolean>(true);
const [waRejectMessage, setWaRejectMessage] = useState<string>(
  "Olá! Não recebo ligações pelo WhatsApp. Por favor, envie uma mensagem e aguarde meu retorno. Obrigado! 😊"
);
const [waSavingConfig, setWaSavingConfig] = useState(false);
const [waAllowedNumbers, setWaAllowedNumbers] = useState<string>("");

async function fetchWaConfig() {
  try {
    const res = await fetch("/api/whatsapp/config", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
if (res.ok) {
  setWaRejectCalls(json.rejectCalls ?? true);
  setWaRejectMessage(json.rejectMessage ?? "");
  setWaAllowedNumbers((json.allowedNumbers ?? []).join("\n"));
}
  } catch {}
}

async function saveWaConfig() {
  setWaSavingConfig(true);
  try {
    const allowedNumbers = waAllowedNumbers
      .split("\n")
      .map(n => n.replace(/\D/g, ""))
      .filter(Boolean);

    const res = await fetch("/api/whatsapp/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejectCalls: waRejectCalls, rejectMessage: waRejectMessage, allowedNumbers }),
    });
    if (res.ok) addToast("success", "Configuração salva", "Rejeição de chamadas atualizada.");
    else addToast("error", "Erro", "Falha ao salvar configuração.");
} catch (e: any) {
        addToast("error", "Erro ao carregar", e.message);
  } finally {
    setWaSavingConfig(false);
  }
}


  const [name, setName] = useState("");
  const [createdAt, setCreatedAt] = useState<string>(""); 

 
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  // controle do popup de import
  const [showImportModal, setShowImportModal] = useState(false);


  const [phoneRaw, setPhoneRaw] = useState("");
  // Estado para armazenar o prefixo bonito (Ex: Brasil (+55))
  const [phonePrettyPrefix, setPhonePrettyPrefix] = useState("Brasil (+55)");
  
  const [whatsappUsername, setWhatsappUsername] = useState("");

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

      if (json.exists && json.jid) {
        const jidDigits = String(json.jid).split("@")[0].split(":")[0].replace(/\D/g, "");
        if (jidDigits) {
          const norm = applyPhoneNormalization(jidDigits);
          setPhonePrettyPrefix(norm.prettyPrefix);
        }
      }
    } catch {
      setWaValidation({ loading: false, exists: false });
    }
  }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  const toastSeq = useRef(1);

  const addToast = (type: "success" | "error", title: string, message?: string) => {
    const id = Date.now() * 1000 + (toastSeq.current++ % 1000);
    setToasts((prev) => [...prev, { id, type, title, message, durationMs: 5000 }]);
  };
  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // --- CARREGAR DADOS ---
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: { user } } = await supabaseBrowser.auth.getUser();
        if (!user) return;

        setUserId(user.id);
        setEmail(user.email || "");

        if (user.created_at) {
            const d = new Date(user.created_at);
            setCreatedAt(d.toLocaleDateString("pt-BR", { day: '2-digit', month: 'long', year: 'numeric' }));
        }

        const { data: member } = await supabaseBrowser
          .from("tenant_members")
          .select(
            `
              role,
              tenants (
                id,
                name,
                license_status,
                expires_at,
                credit_balance
              )
            `
          )
          .eq("user_id", user.id)
          .maybeSingle();

        let companyName = "";

        if (member) {
          setRoleRaw(member.role || null);

          let roleName = "Visitante";
          if (member.role === "owner" || member.role === "SUPERADMIN") roleName = "SUPERADMIN";
          else if (member.role === "MASTER") roleName = "MASTER";
          else if (member.role === "USER") roleName = "USER";
          else if (member.role) roleName = member.role.toUpperCase();

          setRole(roleName);

          const t: any = member.tenants;
          const currentT = Array.isArray(t) ? t[0] : t;
          
          if (currentT) {
            companyName = currentT.name || "";
            setTenantId(currentT.id || null);
            setLicenseStatus(currentT.license_status || "ACTIVE");
            setExpiresAt(currentT.expires_at || null);
            setCreditBalance(currentT.credit_balance || 0);
          } else {
            setTenantId(null);
          }
        }




        const { data: profile } = await supabaseBrowser
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();

        const metaName = user.user_metadata?.full_name || user.user_metadata?.name;
        const emailName = user.email ? user.email.split("@")[0] : "";
       
        const finalName = profile?.display_name || companyName || metaName || emailName || "";

        if (profile) {
          setName(finalName);
          setWhatsappUsername(profile.whatsapp_username || "");
         
          if (profile.phone) {
            const { ddi, national } = splitE164(profile.phone);
            const meta = ddiMeta(ddi);
            
            // Define prefixo inicial
            setPhonePrettyPrefix(meta.pretty); 
            setPhoneRaw(formatNational(ddi, national));
          }
        } else {
          setName(finalName);
        }

      } catch (e: any) {
        console.error(e);
        addToast("error", "Erro ao carregar", e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
  if (!tenantId) return;
  if (!canPairWhatsApp) return;

  let stopped = false;
  let timer: any = null;

  const INTERVAL_CONNECTED = 5 * 60 * 1000;     // 5 min
  const INTERVAL_DISCONNECTED = 8 * 1000;       // 8s
  const INTERVAL_HIDDEN = 10 * 60 * 1000;       // 10 min

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNext = (ms: number) => {
    clear();
    timer = setTimeout(() => {
      void tick();
    }, ms);
  };

  const tick = async () => {
    if (stopped) return;

    // Se a aba estiver oculta, não martela a VM
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      scheduleNext(INTERVAL_HIDDEN);
      return;
    }

    // roda o refresh
    await refreshWhatsAppPanel();

    // agenda próximo check baseado no status atual
    scheduleNext(waConnected ? INTERVAL_CONNECTED : INTERVAL_DISCONNECTED);
  };

  // primeira rodada
  void tick();

  // ao voltar pra aba, atualiza imediatamente
  const onVis = () => {
    if (document.visibilityState === "visible") {
      void tick();
    }
  };

  document.addEventListener("visibilitychange", onVis);

  return () => {
    stopped = true;
    clear();
    document.removeEventListener("visibilitychange", onVis);
  };
}, [tenantId, canPairWhatsApp, waConnected]);




  function handlePhoneDone() {
    const norm = applyPhoneNormalization(phoneRaw);
    setPhonePrettyPrefix(norm.prettyPrefix);
    setPhoneRaw(norm.formattedNational || norm.nationalDigits || phoneRaw);

    // Sempre atualiza o username com o número normalizado
    if (norm.e164) {
      const digits = onlyDigits(norm.e164);
      setWhatsappUsername(digits);
      setWaValidation(null);
      void validateWa(digits);
    }

    if (isEditing === false) setIsEditing(true);
  }

  // Permite qualquer caractere no WhatsApp
const handleWhatsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setWhatsappUsername(val);
    setWaValidation(null);
    if (waValidateTimer.current) clearTimeout(waValidateTimer.current);
    waValidateTimer.current = setTimeout(() => void validateWa(val), 800);
  };

  async function handleSave() {
    if (!userId) return;
    setSaving(true);
    try {
      const norm = applyPhoneNormalization(phoneRaw);
     
      const { error } = await supabaseBrowser
        .from("profiles")
        .upsert({
          id: userId,
          display_name: name,
          phone: norm.e164,
          whatsapp_username: whatsappUsername,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
      await supabaseBrowser.auth.updateUser({ data: { full_name: name } });
      
      addToast("success", "Perfil salvo", "A página será recarregada...");
      setIsEditing(false);

      setTimeout(() => {
        window.location.reload();
      }, 5000);

    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!confirm(`Enviar link para ${email}?`)) return;
    try {
      const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/auth/update-password",
      });
      if (error) throw error;
      addToast("success", "E-mail enviado", "Verifique sua caixa de entrada.");
    } catch (e: any) {
      addToast("error", "Erro", e.message);
    }
  }

  async function fetchWaStatus() {
  try {
    setWaLastError(null);
    const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(json?.error || "Falha ao consultar status do WhatsApp");
setWaConnected(!!json.connected);
setWaStatusText(json.status ?? null);

// status não traz mais profile/session info
// (isso vem do /api/whatsapp/profile)
if (!json.connected) {
  setWaPushName(null);
  setWaProfilePicUrl(null);
  setWaSessionLabel("Contato principal");
}

return !!json.connected;


} catch (e: any) {
  const msg = e?.message || "Erro ao consultar status do WhatsApp";
  setWaLastError(msg);
  addToast("error", "WhatsApp", msg);
  setWaConnected(false);
  return false;
}

}

async function fetchWaQr() {
  try {
    setWaLastError(null);
    const res = await fetch("/api/whatsapp/qr", { cache: "no-store" });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(json?.error || "Falha ao obter QR");
    setWaQr(json.qr || null);
    return json.qr || null;
  } catch (e: any) {
    setWaLastError(e?.message || "Erro ao obter QR");
    setWaQr(null);
    return null;
  }
}

async function fetchWaProfile() {
  try {
    setWaLastError(null);
    const res = await fetch("/api/whatsapp/profile", { cache: "no-store" });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(json?.error || "Falha ao obter perfil do WhatsApp");

    // payload do back:
    // { connected, status, jid, pushName, pictureUrl }
    setWaPushName(json.pushName ?? null);
    setWaProfilePicUrl(json.pictureUrl ?? null);

    // opcional: label fixa (se quiser no futuro pode vir do back)
    setWaSessionLabel("Contato principal");

    return { pushName: json.pushName ?? null, pictureUrl: json.pictureUrl ?? null };
  } catch (e: any) {
    // não derruba o painel por falha de foto
    // silencioso: falha de foto não é crítica
    return { pushName: null, pictureUrl: null };
  }
}


async function refreshWhatsAppPanel() {
  setWaLoading(true);
  try {
    const connected = await fetchWaStatus();

if (connected) {
  setWaQr(null);
  setWaQrDataUrl(null);
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const needProfile = !waPushName || !waProfilePicUrl || now - waLastProfileFetchRef.current > ONE_DAY;
  if (needProfile) {
    await fetchWaProfile();
    await fetchWaConfig();
    waLastProfileFetchRef.current = now;
  }
  return;
}


const qr = await fetchWaQr();
if (!qr) {
  setWaQrDataUrl(null);
  return;
}
// backend já retorna base64 pronto
setWaQrDataUrl(qr);
  } finally {
    setWaLoading(false);
  }
}


const [exporting, setExporting] = useState(false);

  // Modal de seleção: "export" | "template" | "import" | null
  const [actionModal, setActionModal] = useState<"export" | "template" | "import" | null>(null);

  async function handleExportClients() {
    if (!tenantId) {
      addToast("error", "Tenant não encontrado", "Seu usuário não está vinculado a um tenant.");
      return;
    }
    
  setExporting(true);
    addToast("success", "Iniciando Exportação", "Isto pode demorar alguns segundos...");

    try {
      const res = await fetch(`/api/cliente/export?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "GET",
      });

      if (!res.ok) {
        throw new Error("Falha ao gerar o arquivo de exportação.");
      }

      // Baixa o arquivo gerado via Blob
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      // Tenta pegar o nome do arquivo no Header, senao usa fallback
      const disposition = res.headers.get("Content-Disposition");
      let filename = `clientes_export.xlsx`;
      if (disposition && disposition.includes("filename=")) {
        filename = disposition.split("filename=")[1].replace(/["']/g, "");
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

    } catch (e: any) {
      addToast("error", "Erro ao exportar", e.message);
    } finally {
      setExporting(false);
    }
  }

  function handleImportClick() {
    if (!tenantId) {
      addToast("error", "Tenant não encontrado", "Seu usuário não está vinculado a um tenant.");
      return;
    }
    setShowImportModal(true);
  }

function handleDownloadTemplate() {
    window.location.href = "/api/cliente/template";
  }

  function handleDownloadTemplateApps() {
    window.location.href = "/api/aplicativo/template";
  }

  async function handleExportApps() {
    if (!tenantId) {
      addToast("error", "Tenant não encontrado", "Seu usuário não está vinculado a um tenant.");
      return;
    }

    setExporting(true);
    addToast("success", "Iniciando Exportação", "Isto pode demorar alguns segundos...");

    try {
      const res = await fetch(`/api/aplicativo/export?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "GET",
      });

      if (!res.ok) throw new Error("Falha ao gerar o arquivo de exportação.");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const disposition = res.headers.get("Content-Disposition");
      let filename = `aplicativos_export.xlsx`;
      if (disposition && disposition.includes("filename=")) {
        filename = disposition.split("filename=")[1].replace(/["']/g, "");
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      addToast("error", "Erro ao exportar", e.message);
    } finally {
      setExporting(false);
    }
  }

  const importAppsFileRef = useRef<HTMLInputElement | null>(null);
  const [importingApps, setImportingApps] = useState(false);

  async function handleImportAppsFile(file: File) {
    if (!tenantId) {
      addToast("error", "Tenant não encontrado", "Seu usuário não está vinculado a um tenant.");
      return;
    }

    setImportingApps(true);
    setActionModal(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;

      const res = await fetch(
        `/api/aplicativo/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        }
      );

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const base = json?.details || json?.error || "Falha ao importar";
        const missing = Array.isArray(json?.missing) ? ` | Faltando: ${json.missing.join(", ")}` : "";
        const hint = json?.hint ? ` | ${json.hint}` : "";
        throw new Error(`${base}${missing}${hint}`);
      }

      const errCount = Array.isArray(json?.errors) ? json.errors.length : 0;
      const warnCount = Array.isArray(json?.warnings) ? json.warnings.length : 0;
      const summary = `Total: ${json.total} | Inseridos: ${json.inserted} | Avisos: ${warnCount} | Erros: ${errCount}`;

      if (errCount > 0) {
        addToast("error", "Import concluído com erros", `${summary}. O relatório será descarregado.`);

        let logContent = `RELATÓRIO DE IMPORTAÇÃO DE APLICATIVOS\n`;
        logContent += `Data: ${new Date().toLocaleString("pt-BR")}\n`;
        logContent += `${summary}\n\n--- DETALHE DOS ERROS ---\n`;
        json.errors.forEach((e: any) => { logContent += `Linha ${e.row}: ${e.error}\n`; });
        if (warnCount > 0) {
          logContent += `\n--- DETALHE DOS AVISOS ---\n`;
          json.warnings.forEach((w: any) => { logContent += `Linha ${w.row}: ${w.warning}\n`; });
        }

        const blob = new Blob([logContent], { type: "text/plain;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `relatorio_import_apps_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        return;
      }

      addToast("success", "Import concluído", summary);

      if (warnCount > 0) {
        const topWarnings = (json.warnings || []).slice(0, 3);
        for (const it of topWarnings) {
          addToast("error", "Aviso no import", `Linha ${it.row}: ${it.warning}`);
        }
        if (json.warnings.length > 3) {
          addToast("error", "Mais avisos", `+${json.warnings.length - 3} avisos.`);
        }
      }
    } catch (e: any) {
      addToast("error", "Erro no import de apps", e?.message || "Falha ao importar");
    } finally {
      setImportingApps(false);
    }
  }

  async function handleDisconnectWhatsApp() {
  if (!confirm("Desconectar esta sessão do WhatsApp agora?")) return;

  setWaLoading(true);
  try {
    setWaLastError(null);
    const res = await fetch("/api/whatsapp/disconnect", { method: "POST", cache: "no-store" });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(json?.error || "Falha ao desconectar");

addToast("success", "Desconectado", "Sessão do WhatsApp removida com sucesso.");

// ✅ limpa UI imediatamente (evita avatar/qr “fantasma”)
setWaConnected(false);
setWaStatusText(null);
setWaQr(null);
setWaQrDataUrl(null);
setWaPushName(null);
setWaProfilePicUrl(null);
setWaSessionLabel("Contato principal");

// força refresh da UI
await refreshWhatsAppPanel();

} catch (e: any) {
  const msg = e?.message || "Erro ao desconectar";
  setWaLastError(msg);
  addToast("error", "Falha ao desconectar", msg);
} finally {
  setWaLoading(false);
}

}


  async function handleImportFile(file: File) {
    if (!tenantId) {
      addToast("error", "Tenant não encontrado", "Seu usuário não está vinculado a um tenant.");
      return;
    }

    setImporting(true);
setShowImportModal(false); // ✅ fecha modal ao iniciar
    try {
      const fd = new FormData();
      fd.append("file", file);

      // 👇 INÍCIO DA INJEÇÃO DO TOKEN 👇
      const { data: sess } = await supabaseBrowser.auth.getSession();
      const token = sess?.session?.access_token;
      // 👆 FIM DA INJEÇÃO 👆

      const res = await fetch(
        `/api/cliente/import?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          body: fd,
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}) // 🔒 Envia a credencial
          }
        }
      );


      const json = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const base = json?.details || json?.error || "Falha ao importar";
        const missing = Array.isArray(json?.missing) ? ` | Faltando: ${json.missing.join(", ")}` : "";
        const hint = json?.hint ? ` | ${json.hint}` : "";
        throw new Error(`${base}${missing}${hint}`);
      }


      const errCount = Array.isArray(json?.errors) ? json.errors.length : 0;
      const warnCount = Array.isArray(json?.warnings) ? json.warnings.length : 0;

      const summary = `Total: ${json.total} | Atualizados: ${json.updated} | Inseridos: ${json.inserted} | Avisos: ${warnCount} | Erros: ${errCount}`;

      // ✅ Se teve erro, gera um log para download
      if (errCount > 0) {
        addToast("error", "Import concluído com erros", `${summary}. O relatório de erros será descarregado.`);

        // Criar conteúdo do Log
        let logContent = `RELATÓRIO DE IMPORTAÇÃO DE CLIENTES\n`;
        logContent += `Data: ${new Date().toLocaleString("pt-BR")}\n`;
        logContent += `${summary}\n\n`;
        logContent += `--- DETALHE DOS ERROS ---\n`;
        
        json.errors.forEach((e: any) => {
          logContent += `Linha ${e.row}: ${e.error}\n`;
        });

        if (warnCount > 0) {
          logContent += `\n--- DETALHE DOS AVISOS ---\n`;
          json.warnings.forEach((w: any) => {
            logContent += `Linha ${w.row}: ${w.warning}\n`;
          });
        }

        // Fazer download do Log (.txt)
        const blob = new Blob([logContent], { type: "text/plain;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `relatorio_importacao_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        return; // ✅ não recarrega, pois o utilizador tem de corrigir o ficheiro
      }

// ✅ Sem erro: sucesso de verdade
addToast("success", "Import concluído", summary);

// warnings não bloqueiam
if (warnCount > 0) {
  const topWarnings = (json.warnings || []).slice(0, 3);
  for (const it of topWarnings) {
    addToast("error", "Aviso no import", `Linha ${it.row}: ${it.warning}`);
  }
  if (Array.isArray(json.warnings) && json.warnings.length > 3) {
    addToast("error", "Mais avisos", `+${json.warnings.length - 3} avisos.`);
  }
}


      // se teve warnings, não precisa bloquear, mas informa o primeiro
      if (warnCount > 0) {
        const firstW = json.warnings[0];
        addToast("error", "Avisos no import", `Linha ${firstW.row}: ${firstW.warning}`);
      }

      // recarrega só se não teve erro
      setTimeout(() => window.location.reload(), 1200);

    } catch (e: any) {
      addToast("error", "Erro no import", e?.message || "Falha ao importar");
    } finally {
      setImporting(false);
    }
  }


  if (loading) {
  return (
    <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6 text-zinc-900 dark:text-zinc-100">
      <div className="p-10 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/10">
        Carregando configurações...
      </div>
    </div>
  );
}


return (
  <div className="space-y-6 pt-3 pb-6 px-3 sm:px-6 text-zinc-900 dark:text-zinc-100">

      <ToastNotifications toasts={toasts} removeToast={removeToast} />
     
     {showImportModal && (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">

    <div className="bg-white dark:bg-[#161b22] w-full max-w-md rounded-xl border border-slate-200 dark:border-white/10 shadow-xl p-6 space-y-4">
      
      <h3 className="text-lg font-bold text-slate-800 dark:text-white">
        Importar clientes
      </h3>

      <p className="text-sm text-slate-500 dark:text-white/60">
        Você pode baixar um modelo de planilha ou enviar um arquivo preenchido.
      </p>

      <div className="flex flex-col gap-3 pt-2">
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white font-bold text-sm hover:bg-slate-50 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
        >
          📄 Baixar modelo (Excel)
        </button>

        <button
          type="button"
          disabled={importing}
          onClick={() => {
            // Nao fecha o modal AQUI, senao voce nao ve o loader! O modal fecha na funcao handleImportFile
            importFileRef.current?.click();
          }}
          className="w-full h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Processando e Importando...
            </>
          ) : (
            "⬆️ Selecionar e Importar Planilha"
          )}
        </button>

      </div>

      <button
        type="button"
        onClick={() => setShowImportModal(false)}
        className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white/80 pt-2"
      >
        Cancelar
      </button>
    </div>
  </div>
  )}
      {/* HEADER + BOTÃO DINÂMICO */}
<div className="flex items-center justify-between gap-2 mb-2">
  <div className="min-w-0 text-left">
    <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
      Gerenciar Perfil
    </h1>
  </div>
  <div className="flex items-center gap-2 shrink-0">
    {/* Tema */}
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={`h-9 md:h-10 px-3 rounded-lg border font-bold text-xs flex items-center gap-2 transition-all ${
        theme === "dark"
          ? "bg-slate-800 border-slate-700 text-amber-400"
          : "bg-white border-slate-200 text-slate-600 dark:text-white/60"
      }`}
      title="Alternar tema"
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      )}
      <span className="hidden sm:inline">{theme === "dark" ? "Escuro" : "Claro"}</span>
    </button>
  </div>
</div>

<div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

       
        {/* === COLUNA ESQUERDA (DADOS PESSOAIS) === */}
        <div className="xl:col-span-2 space-y-6">
          <div className={`bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-6 shadow-sm space-y-6 transition-all ${isEditing ? 'ring-1 ring-emerald-500/30' : ''}`}>
<div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
  <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest">
    Dados Pessoais
  </h3>
  <div className="flex items-center gap-2">
    {/* ✅ Botão Renovar SÓ aparece se não for SUPERADMIN */}
    {role !== "SUPERADMIN" && (
      <button
        onClick={() => alert("Abrir checkout ou modal de pagamento")} // 👈 Ajuste com a sua rota/função real de pagamento
        className="h-7 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all flex items-center gap-1.5 shadow-sm shadow-emerald-900/20"
      >
        <IconMoney /> Renovar
      </button>
    )}

    {!isEditing ? (
      <button
        onClick={() => setIsEditing(true)}
        className="h-7 px-3 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 font-bold text-[11px] hover:bg-slate-50 dark:hover:bg-white/10 transition-all flex items-center gap-1.5"
      >
        ✏️ Editar
      </button>
    ) : (
      <button
        onClick={handleSave}
        disabled={saving}
        className="h-7 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] transition-all disabled:opacity-50 flex items-center gap-1.5"
      >
        {saving ? "Salvando..." : "💾 Salvar"}
      </button>
    )}
  </div>
</div>
            
            {/* LINHA 1: NOME + PERFIL */}
            <div className="grid grid-cols-3 md:grid-cols-3 gap-3">
  <div className="col-span-2">
    <Label>Nome Completo</Label>
    <Input
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Seu nome"
      readOnly={!isEditing}
      onFocus={() => setIsEditing(true)}
    />
  </div>
  <div className="col-span-1">
    <Label>Perfil</Label>
    <div className={`h-10 px-2 flex items-center justify-center rounded-lg text-[10px] uppercase font-bold tracking-widest border transition-colors ${
      role === "SUPERADMIN" ? "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200 dark:border-purple-500/20" :
      role === "MASTER" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20" :
      "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60 border-slate-200 dark:border-white/10"
    }`}>
      {role}
    </div>
  </div>
</div>

            {/* LINHA 2: EMAIL + TELEFONE (2 COLUNAS AGORA) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <Label>E-mail</Label>
                <Input value={email} disabled className="opacity-70 bg-slate-100 dark:bg-white/5 cursor-not-allowed" />
              </div>
              <div>
                <PhoneRow 
                    label="Telefone Celular" 
                    prettyPrefix={phonePrettyPrefix} 
                    rawValue={phoneRaw} 
                    onRawChange={setPhoneRaw} 
                    onDone={handlePhoneDone}
                    readOnly={!isEditing} 
                    onFocus={() => setIsEditing(true)} 
                />
              </div>
            </div>

            {/* LINHA 3: WHATSAPP + MEMBRO */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-end">
                <div className="md:col-span-2">
                    <Label>WhatsApp Username</Label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">@</span>
                        
                        {/* MODO LEITURA: Link Clicável */}
                        <Input
                          className="pl-8 pr-10"
                          value={whatsappUsername}
                          onChange={handleWhatsChange}
                          placeholder="5521999999999"
                          readOnly={!isEditing}
                          onFocus={() => setIsEditing(true)}
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
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/>
                            </svg>
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
                
                <div>
                     <Label>Membro desde</Label>
                    <div className="h-10 px-3 flex items-center text-slate-500 dark:text-white/50 text-xs">
                        {createdAt || "—"}
                    </div>
                </div>
            </div> {/* ✅ FECHOU A LINHA 3 AQUI */}

            {/* ✅ LINHA 4 - ASSINATURA */}
            <div className="pt-4 mt-4 border-t border-slate-100 dark:border-white/5">
              <div className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest mb-3">
                Detalhes da Assinatura
              </div>
              <div className="flex flex-wrap gap-10">
                {/* 1. Status: Todos veem */}
                <div>
                  <Label>Status</Label>
                  <div className="h-10 flex items-center">
                    <StatusBadge status={licenseStatus} />
                  </div>
                </div>

                {/* 2. Validade: MASTER e USER veem (Oculto para SUPERADMIN) */}
                {role !== "SUPERADMIN" && (
                  <div>
                    <Label>Validade</Label>
                    <div className="h-10 flex items-center text-sm font-bold text-slate-700 dark:text-white">
                      {expiresAt ? new Date(expiresAt).toLocaleDateString("pt-BR") : "—"}
                    </div>
                  </div>
                )}

                {/* 3. Créditos: APENAS MASTER vê */}
                {role === "MASTER" && (
                  <div>
                    <Label>Saldo de Créditos</Label>
                    <div className="h-10 flex items-center text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      {creditBalance}
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div> {/* ✅ FECHOU O CARD DE DADOS PESSOAIS */}

          {/* DADOS DO SISTEMA */}
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-6 shadow-sm space-y-5">
            <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest border-b border-slate-100 dark:border-white/5 pb-2">Dados do Sistema</h3>
            {/* Modal de seleção: Clientes ou Aplicativos */}
{actionModal && (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
    <div className="bg-white dark:bg-[#161b22] w-full max-w-sm rounded-xl border border-slate-200 dark:border-white/10 shadow-xl p-6 space-y-4">
      <h3 className="text-base font-bold text-slate-800 dark:text-white">
        {actionModal === "export" && "⬇️ Exportar"}
        {actionModal === "template" && "📄 Baixar Template"}
        {actionModal === "import" && "⬆️ Importar"}
      </h3>
      <p className="text-sm text-slate-500 dark:text-white/60">O que você quer {actionModal === "export" ? "exportar" : actionModal === "template" ? "baixar" : "importar"}?</p>

      <div className="flex flex-col gap-3 pt-1">
        {/* Clientes */}
        <button
          type="button"
          onClick={() => {
            setActionModal(null);
            if (actionModal === "export") void handleExportClients();
            else if (actionModal === "template") handleDownloadTemplate();
            else if (actionModal === "import") setShowImportModal(true);
          }}
          className="w-full h-11 px-4 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm font-bold text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center gap-3"
        >
          <span className="text-xl">👥</span>
          <div className="text-left">
            <div className="font-bold">Clientes</div>
            <div className="text-[11px] font-normal text-slate-400">Dados cadastrais dos clientes</div>
          </div>
        </button>

        {/* Aplicativos */}
        <button
          type="button"
          onClick={() => {
            setActionModal(null);
            if (actionModal === "export") void handleExportApps();
            else if (actionModal === "template") handleDownloadTemplateApps();
            else if (actionModal === "import") importAppsFileRef.current?.click();
          }}
          className="w-full h-11 px-4 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm font-bold text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center gap-3"
        >
          <span className="text-xl">📱</span>
          <div className="text-left">
            <div className="font-bold">Aplicativos</div>
            <div className="text-[11px] font-normal text-slate-400">Apps vinculados aos clientes</div>
          </div>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setActionModal(null)}
        className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white/80 pt-1"
      >
        Cancelar
      </button>
    </div>
  </div>
)}

<div className="flex flex-row gap-3">
  {/* EXPORTAR */}
  <button
    type="button"
    onClick={() => setActionModal("export")}
    disabled={!tenantId || exporting}
    className="flex-1 h-10 px-4 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm font-bold text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {exporting
      ? <><svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Processando...</>
      : <><span>⬇️</span> Exportar</>
    }
  </button>

  {/* TEMPLATE */}
  <button
    type="button"
    onClick={() => setActionModal("template")}
    disabled={!tenantId}
    className="flex-1 h-10 px-4 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm font-bold text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <span>📄</span> Template
  </button>

  {/* IMPORTAR */}
  <button
    type="button"
    onClick={() => setActionModal("import")}
    disabled={!tenantId || importing || importingApps}
    className="flex-1 h-10 px-4 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-sm font-bold text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {(importing || importingApps) ? "⏳ Importando..." : <><span>⬆️</span> Importar</>}
  </button>

  {/* Hidden inputs */}
  <input
    ref={importFileRef}
    type="file"
    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    className="hidden"
    onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) void handleImportFile(f); }}
  />
  <input
    ref={importAppsFileRef}
    type="file"
    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    className="hidden"
    onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) void handleImportAppsFile(f); }}
  />
</div>
          </div>
        </div>

        {/* === COLUNA DIREITA (SIDEBAR) === */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-6 shadow-sm space-y-5 relative overflow-hidden">
          <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest border-b border-slate-100 dark:border-white/5 pb-2">
            WhatsApp Web
          </h3>

          <div className="flex flex-col gap-3">

            {/* Segurança SaaS: só o responsável (owner) pode parear */}
            {!canPairWhatsApp ? (
            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs">
              Você precisa estar logado para conectar o WhatsApp.
            </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold px-2 py-1 rounded border ${
                      waConnected
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                    }`}
                  >
                    {waConnected ? "✅ Conectado" : "⚠️ Não conectado"}
                  </span>

                  <button
                    type="button"
                    onClick={() => void refreshWhatsAppPanel()}
                    disabled={waLoading}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {waLoading ? "Atualizando..." : "Atualizar"}
                  </button>
                </div>

                {!!waLastError && (
                  <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-xs">
                    {waLastError}
                  </div>
                )}

<div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-3">
  {waConnected && (
  <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-3 space-y-3">
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-slate-700 dark:text-white">📵 Rejeitar chamadas</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setWaConfigExpanded(v => !v)}
          className="w-6 h-6 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center text-slate-400 transition-colors"
          title={waConfigExpanded ? "Minimizar" : "Expandir"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {waConfigExpanded
              ? <path d="M18 15l-6-6-6 6"/>
              : <path d="M6 9l6 6 6-6"/>
            }
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setWaRejectCalls(v => !v)}
          className={`relative w-10 h-5 rounded-full transition-colors overflow-hidden ${waRejectCalls ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${waRejectCalls ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>
    </div>
{waRejectCalls && waConfigExpanded && (
  <div className="space-y-2">
    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mensagem de resposta</label>
    <p className="text-[10px] text-slate-400 dark:text-white/40">Use as variáveis para inserir na mensagem:</p>
    <div className="flex flex-wrap gap-1">
      {["{saudacao}", "{hora}", "{data}"].map(tag => (
        <button
          key={tag}
          type="button"
          onClick={() => setWaRejectMessage(v => v + tag)}
          className="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-600 dark:text-white font-mono"
        >
          {tag}
        </button>
      ))}
    </div>
    <textarea
      value={waRejectMessage}
      onChange={e => setWaRejectMessage(e.target.value)}
      rows={3}
      placeholder="Ex: {saudacao}! No momento não atendemos ligações. Você ligou às {hora} do dia {data}."
      className="w-full px-3 py-2 text-xs bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none"
    />
    <div className="pt-1">
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
        Números que não serão rejeitados:
      </label>
      <textarea
        value={waAllowedNumbers}
        onChange={e => setWaAllowedNumbers(e.target.value)}
        rows={3}
        placeholder={"553199999999\n553188888888"}
        className="w-full px-3 py-2 text-xs bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 resize-none font-mono"
      />
      <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Um número por linha, com DDI (ex: 5531...). Chamadas desses números serão permitidas.</p>
    </div>
  </div>
)}
{waConfigExpanded && (
      <button
        type="button"
        onClick={() => void saveWaConfig()}
        disabled={waSavingConfig}
        className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors disabled:opacity-50"
      >
        {waSavingConfig ? "Salvando..." : "💾 Salvar configuração"}
      </button>
    )}
  </div>
)}

{waConnected ? (
    <div className="flex items-center gap-4 py-1">
      {/* Avatar */}
      <div className="w-12 h-12 rounded-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 overflow-hidden flex items-center justify-center">
        {waProfilePicUrl ? (
          <img src={waProfilePicUrl} alt="Foto do WhatsApp" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-slate-400">WA</span>
        )}
      </div>

      {/* Infos */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-slate-800 dark:text-white truncate">
          {waSessionLabel || "Contato principal"}
        </div>
        <div className="text-xs text-slate-500 dark:text-white/60 truncate">
          {waPushName ? `Conectado como: ${waPushName}` : "WhatsApp conectado ✅"}
        </div>
        {!!waStatusText && (
          <div className="text-[11px] text-slate-400 dark:text-white/40">
            Status: {waStatusText}
          </div>
        )}
      </div>
    </div>
  ) : waQrDataUrl ? (
    <div className="flex flex-col items-center gap-2">
      <img
        src={waQrDataUrl}
        alt="QR Code do WhatsApp"
        className="w-full max-w-[220px] rounded bg-white p-2"
      />
      <div className="text-[11px] text-slate-500 dark:text-white/50 text-center">
        Abra o WhatsApp no celular → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> e escaneie o QR.
      </div>
    </div>
  ) : (
    <div className="text-xs text-slate-500 dark:text-white/60 text-center">
      QR ainda não disponível. Clique em <b>Atualizar</b>.
    </div>
  )}
</div>


                {waConnected ? (
  <button
    type="button"
    onClick={() => void handleDisconnectWhatsApp()}
    disabled={waLoading}
    className="w-full px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition-colors disabled:opacity-50"
  >
    {waLoading ? "Processando..." : "🔌 Desconectar"}
  </button>
) : (
  <button
    type="button"
    onClick={() => void refreshWhatsAppPanel()}
    disabled={waLoading}
    className="w-full px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors disabled:opacity-50"
  >
    {waLoading ? "Gerando..." : "📲 Gerar QR / Conectar"}
  </button>
)}


                
              </>
            )}
          </div>
        </div>

          <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-xl p-6 shadow-sm space-y-5">
            <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest border-b border-slate-100 dark:border-white/5 pb-2">Segurança</h3>
            <div>
              <Label>Senha</Label>
              <button onClick={handleResetPassword} className="w-full mt-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 font-bold text-sm hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-center justify-center gap-2">
                <span>🔒</span> Redefinir Senha
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function IconMoney() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
    TRIAL:    "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400 border-sky-200 dark:border-sky-500/20",
    EXPIRED:  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/20",
    ARCHIVED: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-white/40 border-slate-200 dark:border-white/10",
    INACTIVE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
  };
  const label: Record<string, string> = {
    ACTIVE: "Ativo", TRIAL: "Trial", EXPIRED: "Expirado", ARCHIVED: "Arquivado", INACTIVE: "Inativo",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border whitespace-nowrap ${map[status] ?? map.INACTIVE}`}>
      {label[status] ?? status}
    </span>
  );
}