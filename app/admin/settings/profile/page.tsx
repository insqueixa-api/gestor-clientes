"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import ToastNotifications, { ToastMessage } from "@/app/admin/ToastNotifications";
import { useTheme } from "@/components/theme/ThemeProvider";
import Link from "next/link";
import { useConfirm } from "@/app/admin/HookuseConfirm";

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
  { code: "353", label: "Irlanda", flag: "🇮🇪" },
  { code: "52", label: "México", flag: "🇲🇽" },
  { code: "54", label: "Argentina", flag: "🇦🇷" },
  { code: "56", label: "Chile", flag: "🇨🇱" },
  { code: "57", label: "Colômbia", flag: "🇨🇴" },
  { code: "58", label: "Venezuela", flag: "🇻🇪" },
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
  if (originalInput && originalInput.trim().startsWith("+")) {
    return digits.slice(0, 3);
  }
  return "55";
}

function ddiMeta(ddi: string) {
  const opt = DDI_OPTIONS.find((o) => o.code === ddi);
  if (!opt) return { label: `DDI Desconhecido (+${ddi})`, code: ddi, pretty: `🌍 DDI (+${ddi})` };
  return { label: `${opt.label} (+${opt.code})`, code: opt.code, pretty: `${opt.label} (+${opt.code})` };
}

function formatNational(ddi: string, nationalDigits: string) {
  const d = onlyDigits(nationalDigits);
  if (ddi === "55") {
    const area = d.slice(0, 2);
    const rest = d.slice(2);
    if (!area) return "";
    if (rest.length >= 9) {
      return `${area} ${rest.slice(0, 5)}-${rest.slice(5, 9)}`.trim();
    }
    if (rest.length >= 8) {
      return `${area} ${rest.slice(0, 4)}-${rest.slice(4, 8)}`.trim();
    }
    return `${area} ${rest}`.trim();
  }
  const groups: string[] = [];
  let i = 0;
  while (i < d.length) {
    const step = d.length - i > 7 ? 3 : 4;
    groups.push(d.slice(i, i + step));
    i += step;
  }
  return groups.join(" ").trim();
}

function splitE164(raw: string) {
  const digits = onlyDigits(raw);
  const ddi = inferDDIFromDigits(digits, raw);
  const national = digits.startsWith(ddi) ? digits.slice(ddi.length) : digits;
  return { ddi, national };
}

function applyPhoneNormalization(rawInput: string) {
  const rawDigits = onlyDigits(rawInput);
  if (!rawDigits) return { prettyPrefix: "—", e164: "", formattedNational: "", nationalDigits: "" };
  let finalInputToInfer = rawInput;
  if (!rawInput.trim().startsWith("+") && (rawDigits.length === 10 || rawDigits.length === 11)) {
    finalInputToInfer = `+55${rawDigits}`;
  }
  const ddi = inferDDIFromDigits(onlyDigits(finalInputToInfer), finalInputToInfer);
  const meta = ddiMeta(ddi);
  const nationalDigits = onlyDigits(finalInputToInfer).startsWith(ddi) ? onlyDigits(finalInputToInfer).slice(ddi.length) : onlyDigits(finalInputToInfer);
  const formattedNational = formatNational(ddi, nationalDigits);
  return { prettyPrefix: meta.pretty, e164: `+${ddi}${nationalDigits}`, formattedNational, nationalDigits };
}

// ============================================================================
// COMPONENTES UI AUXILIARES
// ============================================================================

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold text-slate-400 dark:text-white/40 mb-1 uppercase tracking-wider">{children}</label>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-10 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-800 dark:text-white outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed read-only:opacity-70 read-only:cursor-pointer ${className}`}
    />
  );
}

function PhoneRow({ label, prettyPrefix, rawValue, onRawChange, onDone, ...inputProps }: any) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="h-10 w-[130px] shrink-0 px-2 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg flex items-center text-[11px] font-bold text-slate-700 dark:text-white truncate justify-center">
          {prettyPrefix || "—"}
        </div>
        <div className="relative flex-1">
          <Input 
            value={rawValue} 
            onChange={(e) => onRawChange(e.target.value)} 
            placeholder="Telefone Celular" 
            className="pr-12" 
            {...inputProps} 
            onBlur={onDone}
            onKeyDown={(e) => e.key === 'Enter' && onDone()}
          />
          <button 
            type="button" 
            onClick={onDone} 
            disabled={inputProps.readOnly}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-sm disabled:opacity-30"
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
  const { confirm } = useConfirm();
 
  const [activeTab, setActiveTab] = useState<"profile" | "data">("profile");
  const [userId, setUserId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role] = useState("SUPERADMIN");

  // Configurações do perfil e saúde
  const [name, setName] = useState("");
  const [phoneRaw, setPhoneRaw] = useState("");
  const [phonePrettyPrefix, setPhonePrettyPrefix] = useState("Brasil (+55)");
  const [whatsappUsername, setWhatsappUsername] = useState("");
  const [waUserTouched, setWaUserTouched] = useState(false);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");

  // Quantidade de Sessões Ativas salvas no Banco
  const [whatsappSessions, setWhatsappSessions] = useState(1);

  // Estados do WhatsApp VM (Sessão 1)
  const [waLoading, setWaLoading] = useState(false);
  const [waReconnecting, setWaReconnecting] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean>(false);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [waLastError, setWaLastError] = useState<string | null>(null);
  const [waIsDormant, setWaIsDormant] = useState(true);
  const [waConfigExpanded, setWaConfigExpanded] = useState(false);
  const [waSessionLabel, setWaSessionLabel] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("wa_label_1") || "Contato principal";
    return "Contato principal";
  });
  const [waSessionLabelEditing, setWaSessionLabelEditing] = useState(false);
  const [waPushName, setWaPushName] = useState<string | null>(null);
  const [waProfilePicUrl, setWaProfilePicUrl] = useState<string | null>(null);
  const waLastProfileFetchRef = useRef<number>(0);
  const [waStatusText, setWaStatusText] = useState<string | null>(null);
  const [waRejectCalls, setWaRejectCalls] = useState<boolean>(true);
  const [waRejectMessage, setWaRejectMessage] = useState<string>("{saudacao}! 😊\nNo momento não estou recebendo ligações.");
  const [waSavingConfig, setWaSavingConfig] = useState(false);
  const [waAllowedNumbers, setWaAllowedNumbers] = useState("");

  // Estados e Refs para Importações/Exportações (Aba Secundária)
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const importAppsFileRef = useRef<HTMLInputElement | null>(null);
  const importAutoFileRef = useRef<HTMLInputElement | null>(null);
  const importResellerFileRef = useRef<HTMLInputElement | null>(null);
  const importMessageFileRef = useRef<HTMLInputElement | null>(null);
  const importServerFileRef = useRef<HTMLInputElement | null>(null);
  const importFinanceiroFileRef = useRef<HTMLInputElement | null>(null);

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingApps, setImportingApps] = useState(false);
  const [importingReseller, setImportingReseller] = useState(false);
  const [importingMessage, setImportingMessage] = useState(false);
  const [importingServer, setImportingServer] = useState(false);
  const [importingFinanceiro, setImportingFinanceiro] = useState(false);
  const [importingAuto, setImportingAuto] = useState(false);

  const [actionModal, setActionModal] = useState<"export" | "template" | "import" | null>(null);
  const [showFinanceiroExportModal, setShowFinanceiroExportModal] = useState(false);
  const [finExportYears, setFinExportYears] = useState<number[]>([new Date().getFullYear()]);
  const [finExportStatus, setFinExportStatus] = useState<"todos" | "PAGO" | "PENDENTE">("todos");

  type WaValidation = { loading: boolean; exists: boolean; jid?: string } | null;
  const [waValidation, setWaValidation] = useState<WaValidation>(null);
  const waValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const toastSeq = useRef(1);

  const canPairWhatsApp = !!userId && !!tenantId;

  // --- IMC Dinâmico ---
  const metricsIMC = useMemo(() => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!w || !h || h <= 0) return { val: null, label: "Aguardando dados", color: "text-slate-400 border-slate-200 bg-slate-50 dark:bg-white/5" };
    
    const imc = w / (h * h);
    const formatted = imc.toFixed(1);

    if (imc < 18.5) return { val: formatted, label: "Abaixo do peso", color: "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-500/10" };
    if (imc >= 18.5 && imc < 25) return { val: formatted, label: "Peso Ideal", color: "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10" };
    if (imc >= 25 && imc < 30) return { val: formatted, label: "Sobrepeso", color: "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-500/10" };
    return { val: formatted, label: "Obesidade", color: "text-rose-600 border-rose-200 bg-rose-50 dark:bg-rose-500/10" };
  }, [weight, height]);

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

        const memberRes = await supabaseBrowser
          .from("tenant_members")
          .select("role, tenants(id, name)")
          .eq("user_id", user.id)
          .maybeSingle();

        const member = memberRes.data;
        if (member && member.tenants) {
          const currentT = Array.isArray(member.tenants) ? member.tenants[0] : member.tenants;
          if (currentT) setTenantId(currentT.id || null);
        }

        const { data: profile } = await supabaseBrowser
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();

        if (profile) {
          setName(profile.display_name || "");
          setWhatsappUsername(profile.whatsapp_username || "");
          setWeight(profile.weight ? String(profile.weight) : "");
          setHeight(profile.height ? String(profile.height) : "");
          setWhatsappSessions(profile.whatsapp_sessions || 1);
         
          if (profile.phone) {
            const { ddi, national } = splitE164(profile.phone);
            const meta = ddiMeta(ddi);
            setPhonePrettyPrefix(meta.pretty); 
            setPhoneRaw(formatNational(ddi, national));
          }
        }
      } catch (e: any) {
        addToast("error", "Erro ao carregar", e.message);
      } finally {
        setLoading(false);
      }

      fetchWaStatus().then(async ({ connected, status }) => {
        if (connected || status === "qr" || status === "connecting") {
          setWaIsDormant(false);
          await refreshWhatsAppPanel(false, false);
        }
      });
    }
    load();
  }, []);

  // Polling invisível do WhatsApp (Sessão 1)
  useEffect(() => {
    if (!tenantId || !canPairWhatsApp || waIsDormant) return;
    let stopped = false;
    let timer: any = null;

    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        timer = setTimeout(() => { void tick(); }, 600000);
        return;
      }
      await refreshWhatsAppPanel(false, false);
      timer = setTimeout(() => { void tick(); }, waConnected ? 300000 : 80000);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [tenantId, canPairWhatsApp, waConnected, waIsDormant]);

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

  function handlePhoneDone() {
    const norm = applyPhoneNormalization(phoneRaw);
    setPhonePrettyPrefix(norm.prettyPrefix);
    setPhoneRaw(norm.formattedNational || norm.nationalDigits || phoneRaw);
    if (norm.e164) {
      const digits = onlyDigits(norm.e164);
      const finalUser = waUserTouched && whatsappUsername.trim() ? whatsappUsername.trim() : digits;
      if (!waUserTouched) setWhatsappUsername(finalUser);
      setWaValidation(null);
      void validateWa(finalUser);
    }
    if (!isEditing) setIsEditing(true);
  }

  const handleWhatsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setWhatsappUsername(val);
    setWaUserTouched(true);
    setWaValidation(null);
    if (waValidateTimer.current) clearTimeout(waValidateTimer.current);
    waValidateTimer.current = setTimeout(() => void validateWa(val), 800);
  };

  async function handleSave() {
    if (!userId) return;
    setSaving(true);
    try {
      const norm = applyPhoneNormalization(phoneRaw);
      const { error: profileError } = await supabaseBrowser
        .from("profiles")
        .upsert({
          id: userId,
          display_name: name,
          phone: norm.e164,
          whatsapp_username: whatsappUsername,
          weight: weight ? parseFloat(weight) : null,
          height: height ? parseFloat(height) : null,
          whatsapp_sessions: whatsappSessions,
          updated_at: new Date().toISOString()
        });

      if (profileError) throw profileError;
      await supabaseBrowser.auth.updateUser({ data: { full_name: name } });
      
      addToast("success", "Perfil atualizado com sucesso!", "As configurações foram sincronizadas.");
      setIsEditing(false);
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    const ok = await confirm({
      title: "Redefinir Senha",
      subtitle: `Deseja enviar o link de recuperação para ${email}?`,
      tone: "sky",
      confirmText: "Sim, enviar",
      cancelText: "Voltar"
    });
    if (!ok) return;
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

  // --- WHATSAPP CONFIGS VM SESSÃO 1 ---
  async function fetchWaStatus() {
    try {
      setWaLastError(null);
      const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error || "Falha ao consultar status");
      setWaConnected(!!json.connected);
      setWaStatusText(json.status ?? null);
      if (!json.connected) {
        setWaPushName(null);
        setWaProfilePicUrl(null);
      }
      return { connected: !!json.connected, status: json.status };
    } catch (e: any) {
      setWaConnected(false);
      return { connected: false, status: "error" };
    }
  }

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
      const allowedNumbers = waAllowedNumbers.split("\n").map(n => n.trim()).filter(Boolean);
      const res = await fetch("/api/whatsapp/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectCalls: waRejectCalls, rejectMessage: waRejectMessage, allowedNumbers }),
      });
      if (res.ok) addToast("success", "Salvo", "Configurações de chamadas salvas.");
    } catch (e: any) {
      addToast("error", "Erro ao salvar", e.message);
    } finally {
      setWaSavingConfig(false);
    }
  }

  async function fetchWaQr() {
    try {
      const res = await fetch("/api/whatsapp/qr", { cache: "no-store" });
      const json = await res.json().catch(() => ({} as any));
      return json.qr || null;
    } catch { return null; }
  }

  async function fetchWaProfile() {
    try {
      const res = await fetch("/api/whatsapp/profile", { cache: "no-store" });
      const json = await res.json().catch(() => ({} as any));
      setWaPushName(json.pushName ?? null);
      setWaProfilePicUrl(json.pictureUrl ?? null);
    } catch {}
  }

  async function refreshWhatsAppPanel(forceQr = false, showVisualLoading = true) {
    if (showVisualLoading) setWaLoading(true);
    try {
      const { connected, status } = await fetchWaStatus();
      if (connected) {
        setWaIsDormant(false);
        setWaQrDataUrl(null);
        const now = Date.now();
        if (!waPushName || !waProfilePicUrl || now - waLastProfileFetchRef.current > 86400000) {
          await fetchWaProfile();
          await fetchWaConfig();
          waLastProfileFetchRef.current = now;
        }
        return;
      }
      if (forceQr || status === "qr" || status === "connecting") {
        const qr = await fetchWaQr();
        setWaQrDataUrl(qr);
      } else {
        setWaQrDataUrl(null);
      }
    } finally {
      if (showVisualLoading) setWaLoading(false);
    }
  }

  async function handleDisconnectWhatsApp() {
    const ok = await confirm({ title: "Desconectar?", subtitle: "Sessão 1 será encerrada.", tone: "rose", confirmText: "Desconectar", cancelText: "Voltar" });
    if (!ok) return;
    setWaLoading(true);
    try {
      await fetch("/api/whatsapp/disconnect", { method: "POST", cache: "no-store" });
      setWaConnected(false);
      setWaQrDataUrl(null);
      setWaPushName(null);
      setWaProfilePicUrl(null);
      setWaIsDormant(true);
      addToast("success", "Desconectado");
    } catch {} finally { setWaLoading(false); }
  }

  async function handleReconnectWhatsApp() {
    const ok = await confirm({ title: "Forçar reconexão?", subtitle: "A sessão 1 será reiniciada.", tone: "amber", confirmText: "Reconectar", cancelText: "Voltar" });
    if (!ok) return;
    setWaReconnecting(true);
    try {
      await fetch("/api/whatsapp/reconnect", { method: "POST", cache: "no-store" });
      setWaConnected(false);
      setWaQrDataUrl(null);
      setWaIsDormant(false);
      setTimeout(() => void refreshWhatsAppPanel(true, false), 4000);
    } catch {} finally { setWaReconnecting(false); }
  }

  // --- FUNÇÕES DE IMPORTAÇÃO/EXPORTAÇÃO (MANTIDAS 100% INTACTAS) ---
  async function handleExportApps() {
    if (!tenantId) return; setExporting(true);
    try {
      const res = await fetch(`/api/import_export/aplicativo/export?tenant_id=${encodeURIComponent(tenantId)}`);
      const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `aplicativos_export.xlsx`; a.click();
    } catch {} finally { setExporting(false); }
  }
  function handleDownloadTemplateApps() { window.location.href = "/api/import_export/aplicativo/template"; }
  async function handleImportAppsFile(file: File) {
    if (!tenantId) return; setImportingApps(true); setActionModal(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(`/api/import_export/aplicativo/import?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) }
      });
      addToast("success", "Importado com sucesso");
    } catch {} finally { setImportingApps(false); }
  }
  async function handleExportServers() {
    if (!tenantId) return; setExporting(true);
    try {
      const res = await fetch(`/api/import_export/servidor/export?tenant_id=${encodeURIComponent(tenantId)}`);
      const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `servidores_export.xlsx`; a.click();
    } catch {} finally { setExporting(false); }
  }
  function handleDownloadTemplateServers() { window.location.href = "/api/import_export/servidor/template"; }
  async function handleImportServerFile(file: File) {
    if (!tenantId) return; setImportingServer(true); setActionModal(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(`/api/import_export/servidor/import?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) }
      });
      addToast("success", "Importado");
    } catch {} finally { setImportingServer(false); }
  }
  async function handleExportFinanceiro(years: number[], status: string) {
    if (!tenantId) return; setShowFinanceiroExportModal(false); setExporting(true);
    try {
      const params = new URLSearchParams({ tenant_id: tenantId });
      if (years.length > 0) params.set("years", years.join(","));
      if (status !== "todos") params.set("status", status);
      const res = await fetch(`/api/import_export/financeiro/export?${params.toString()}`);
      const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `financeiro_export.xlsx`; a.click();
    } catch {} finally { setExporting(false); }
  }
  function handleDownloadTemplateFinanceiro() { window.location.href = "/api/import_export/financeiro/template"; }
  async function handleImportFinanceiroFile(file: File) {
    if (!tenantId) return; setImportingFinanceiro(true); setActionModal(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(`/api/import_export/financeiro/import?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) }
      });
      addToast("success", "Importado");
    } catch {} finally { setImportingFinanceiro(false); }
  }
  async function handleExportAuto() {
    if (!tenantId) return; setExporting(true);
    try {
      const res = await fetch(`/api/import_export/cobranca/export?tenant_id=${encodeURIComponent(tenantId)}`);
      const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `automacoes_export.xlsx`; a.click();
    } catch {} finally { setExporting(false); }
  }
  function handleDownloadTemplateAuto() { window.location.href = "/api/import_export/cobranca/template"; }
  async function handleImportAutoFile(file: File) {
    if (!tenantId) return; setImportingAuto(true); setActionModal(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(`/api/import_export/cobranca/import?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) }
      });
      addToast("success", "Importado");
    } catch {} finally { setImportingAuto(false); }
  }
  async function handleExportResellers() {
    if (!tenantId) return; setExporting(true);
    try {
      const res = await fetch(`/api/import_export/revenda/export?tenant_id=${encodeURIComponent(tenantId)}`);
      const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `revendas_export.xlsx`; a.click();
    } catch {} finally { setExporting(false); }
  }
  function handleDownloadTemplateResellers() { window.location.href = "/api/import_export/revenda/template"; }
  async function handleImportResellerFile(file: File) {
    if (!tenantId) return; setImportingReseller(true); setActionModal(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(`/api/import_export/revenda/import?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) }
      });
      addToast("success", "Importado");
    } catch {} finally { setImportingReseller(false); }
  }
  async function handleExportMessages() {
    if (!tenantId) return; setExporting(true);
    try {
      const res = await fetch(`/api/import_export/mensagem/export?tenant_id=${encodeURIComponent(tenantId)}`);
      const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `mensagens_export.xlsx`; a.click();
    } catch {} finally { setExporting(false); }
  }
  function handleDownloadTemplateMessages() { window.location.href = "/api/import_export/mensagem/template"; }
  async function handleImportMessageFile(file: File) {
    if (!tenantId) return; setImportingMessage(true); setActionModal(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(`/api/import_export/mensagem/import?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) }
      });
      addToast("success", "Importado");
    } catch {} finally { setImportingMessage(false); }
  }
  async function handleExportClients() {
    if (!tenantId) return; setExporting(true);
    try {
      const res = await fetch(`/api/import_export/cliente/export?tenant_id=${encodeURIComponent(tenantId)}`);
      const blob = await res.blob(); const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `clientes_export.xlsx`; a.click();
    } catch {} finally { setExporting(false); }
  }
  function handleDownloadTemplate() { window.location.href = "/api/import_export/cliente/template"; }
  async function handleImportFile(file: File) {
    if (!tenantId) return; setImporting(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data: sess } = await supabaseBrowser.auth.getSession();
      await fetch(`/api/import_export/cliente/import?tenant_id=${encodeURIComponent(tenantId)}`, {
        method: "POST", body: fd, headers: { ...(sess?.session?.access_token ? { Authorization: `Bearer ${sess.session.access_token}` } : {}) }
      });
      addToast("success", "Clientes Importados");
    } catch {} finally { setImporting(false); }
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-slate-400 dark:text-white/40 animate-pulse bg-white dark:bg-[#161b22] rounded-xl border border-slate-200 dark:border-white/10 m-6">
        Carregando painel do proprietário...
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4 pb-6 px-4 sm:px-6 text-zinc-900 dark:text-zinc-100">
      <ToastNotifications toasts={toasts} removeToast={removeToast} />

      {/* HEADER DA PÁGINA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-white/5 pb-4">
        <div className="text-left">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
            Configurações da Conta
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Gerencie seu perfil exclusivo, saúde e conexões automatizadas.</p>
        </div>
        
        {/* SISTEMA DE ABAS CENTRALIZADO E BOTÃO TEMA */}
        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
          <div className="flex bg-slate-100 dark:bg-black/30 p-1 rounded-xl border border-slate-200 dark:border-white/5">
            <button
              onClick={() => setActiveTab("profile")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeTab === "profile" ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white/80"}`}
            >
              👤 Perfil & Saúde
            </button>
            <button
              onClick={() => setActiveTab("data")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${activeTab === "data" ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white/80"}`}
            >
              ⚙️ Planilhas e Dados
            </button>
          </div>

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-9 w-9 shrink-0 rounded-xl border font-bold text-xs flex items-center justify-center bg-white dark:bg-[#161b22] border-slate-200 dark:border-white/10 text-slate-600 dark:text-amber-400 transition-all shadow-sm"
            title="Alternar tema"
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* ABA 1: CONFIGURAÇÃO DO PERFIL + COMPONENTES DO WHATSAPP */}
      {activeTab === "profile" && (
        <div className="grid gap-6 grid-cols-1 xl:grid-cols-3">
          
          {/* COLUNA ESQUERDA: DADOS PESSOAIS E SAÚDE */}
          <div className="space-y-6 xl:col-span-2">
            
            {/* CARD 1: DADOS PESSOAIS */}
            <div className={`bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-5 transition-all ${isEditing ? 'ring-1 ring-emerald-500/20' : ''}`}>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
                <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest">
                  Informações de Cadastro
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleResetPassword}
                    className="h-8 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 font-bold text-[11px] hover:bg-slate-100 dark:hover:bg-white/10 transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    🔒 Redefinir Senha
                  </button>
                  {!isEditing ? (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all shadow-md shadow-emerald-900/10 flex items-center gap-1.5"
                    >
                      ✏️ Editar Dados
                    </button>
                  ) : (
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="h-8 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] transition-all shadow-md flex items-center gap-1.5"
                    >
                      {saving ? "Salvando..." : "💾 Salvar Tudo"}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <Label>Nome Completo</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" readOnly={!isEditing} onFocus={() => setIsEditing(true)} />
                </div>
                <div>
                  <Label>Nível de Acesso</Label>
                  <div className="h-10 px-2 flex items-center justify-center rounded-lg text-[10px] uppercase font-bold tracking-widest border bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200 dark:border-purple-500/20">
                    👑 {role}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>E-mail</Label>
                  <Input value={email} disabled className="opacity-70 bg-slate-100 dark:bg-white/5 cursor-not-allowed font-mono text-xs" />
                </div>
                <div>
                  <PhoneRow prettyPrefix={phonePrettyPrefix} rawValue={phoneRaw} onRawChange={setPhoneRaw} onDone={handlePhoneDone} readOnly={!isEditing} onFocus={() => setIsEditing(true)} label="Telefone Celular" />
                </div>
              </div>

              <div>
                <Label>WhatsApp Username</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">@</span>
                  <Input className="pl-8 pr-10" value={whatsappUsername} onChange={handleWhatsChange} placeholder="Ex: 5521999999999" readOnly={!isEditing} onFocus={() => setIsEditing(true)} />
                  {whatsappUsername && (
                    <a href={`https://wa.me/${whatsappUsername}`} target="_blank" rel="noopener noreferrer" className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 hover:text-emerald-600" title="Abrir conversa">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 4.98 0 11.111c0 3.508 1.777 6.64 4.622 8.67L3.333 24l4.444-2.222c1.333.37 2.592.556 4.223.556 6.627 0 12-4.98 12-11.111S18.627 0 12 0zm0 20c-1.37 0-2.703-.247-3.963-.733l-.283-.111-2.592 1.296.852-2.37-.37-.259C3.852 16.37 2.667 13.852 2.667 11.11 2.667 6.148 6.963 2.222 12 2.222c5.037 0 9.333 3.926 9.333 8.889S17.037 20 12 20zm5.037-6.63c-.278-.139-1.63-.815-1.889-.907-.259-.093-.445-.139-.63.139-.185.278-.722.907-.889 1.093-.167.185-.333.208-.611.069-.278-.139-1.167-.43-2.222-1.37-.822-.733-1.37-1.63-1.528-1.907-.157-.278-.017-.43.122-.569.126-.126.278-.333.417-.5.139-.167.185-.278.278-.463.093-.185.046-.347-.023-.486-.069-.139-.63-1.519-.863-2.083-.227-.546-.458-.472-.63-.48l-.54-.01c-.185 0-.486.069-.74.347-.254.278-.972.95-.972 2.315 0 1.365.996 2.685 1.135 2.87.139.185 1.96 2.997 4.87 4.207.681.294 1.213.47 1.628.602.684.217 1.306.187 1.797.113.548-.082 1.63-.667 1.86-1.31.23-.643.23-1.193.162-1.31-.069-.116-.254-.185-.532-.324z"/></svg>
                    </a>
                  )}
                </div>
                {waValidation && (
                  <div className={`mt-1.5 flex items-center gap-1 text-xs font-bold ${waValidation.loading ? "text-slate-400" : waValidation.exists ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                    {waValidation.loading ? "Validando número..." : waValidation.exists ? "✓ Conta ativa no WhatsApp" : "✗ Número sem WhatsApp ativo"}
                  </div>
                )}
              </div>
            </div>

            {/* CARD 2: PAINEL DE MÉTRICAS CORPORAIS PRIVADAS */}
            <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest border-b border-slate-100 dark:border-white/5 pb-2">
                Minhas Métricas (Privado)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <Label>Peso Atual (kg)</Label>
                  <Input type="number" step="0.1" value={weight} onChange={(e) => { setWeight(e.target.value); if(!isEditing) setIsEditing(true); }} placeholder="Ex: 78.5" readOnly={!isEditing} />
                </div>
                <div>
                  <Label>Altura (m)</Label>
                  <Input type="number" step="0.01" value={height} onChange={(e) => { setHeight(e.target.value); if(!isEditing) setIsEditing(true); }} placeholder="Ex: 1.75" readOnly={!isEditing} />
                </div>
                <div>
                  <Label>Índice de Massa Corporal (IMC)</Label>
                  <div className={`h-10 px-3 rounded-lg border flex items-center justify-between text-xs font-bold transition-all ${metricsIMC.color}`}>
                    <span>{metricsIMC.val ? `IMC: ${metricsIMC.val}` : "—"}</span>
                    <span className="text-[10px] uppercase tracking-wider">{metricsIMC.label}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* COLUNA DIREITA: GERENCIADOR DINÂMICO DE SESSÕES DO WHATSAPP */}
          <div className="space-y-6">
            
            {/* SELETOR DE QUANTIDADE DE SESSÕES */}
            <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-3">
              <div>
                <h4 className="text-xs font-bold text-slate-700 dark:text-white">Estrutura de Instâncias</h4>
                <p className="text-[10px] text-slate-400 mt-0.5">Defina quantas sessões paralelas o painel principal operará.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-black/30 p-1 rounded-xl border border-slate-200 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => { setOriginalSessionsCount(1); if(!isEditing) setIsEditing(true); }}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${whatsappSessions === 1 ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-white shadow-sm" : "text-slate-500"}`}
                >
                  1 Instância Ativa
                </button>
                <button
                  type="button"
                  onClick={() => { setOriginalSessionsCount(2); if(!isEditing) setIsEditing(true); }}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${whatsappSessions === 2 ? "bg-white dark:bg-[#161b22] text-emerald-600 dark:text-white shadow-sm" : "text-slate-500"}`}
                >
                  2 Instâncias (Duplo)
                </button>
              </div>
            </div>

            {/* PAINEL SESSÃO 1 */}
            <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
                <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest">
                  WhatsApp — Instância 1
                </h3>
              </div>

              {!canPairWhatsApp ? (
                <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-600 text-xs text-center">Aguardando login estrutural.</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${waConnected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-red-500/30 bg-red-500/10 text-red-500"}`}>
                      {waConnected ? "Online" : "Desconectado"}
                    </span>
                    <button type="button" onClick={() => void refreshWhatsAppPanel()} disabled={waLoading} className="text-[11px] font-bold px-3 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 transition-colors">
                      {waLoading ? "..." : "Sincronizar"}
                    </button>
                  </div>

                  {waIsDormant && !waConnected ? (
                    <button type="button" onClick={() => { setWaIsDormant(false); void refreshWhatsAppPanel(true); }} className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all">
                      📲 Inicializar QR Code
                    </button>
                  ) : (
                    <>
                      {waConnected ? (
                        <div className="flex items-center gap-3 bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-white/5 p-3 rounded-xl">
                          <div className="w-10 h-10 rounded-full bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 overflow-hidden flex items-center justify-center">
                            {waProfilePicUrl ? <img src={waProfilePicUrl} alt="Avatar" className="w-full h-full object-cover" /> : <span className="text-xs text-slate-400">WA</span>}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <div className="text-xs font-bold text-slate-800 dark:text-white truncate">{waSessionLabel}</div>
                            <div className="text-[10px] text-slate-400 truncate">{waPushName ? `Dono: ${waPushName}` : 'Conexão Estabelecida ✅'}</div>
                          </div>
                        </div>
                      ) : waQrDataUrl ? (
                        <div className="flex flex-col items-center p-2 bg-white rounded-lg border">
                          <img src={waQrDataUrl} alt="QR Code" className="w-full max-w-[180px]" />
                        </div>
                      ) : null}

                      <div className="flex gap-2">
                        <button type="button" onClick={() => void handleReconnectWhatsApp()} disabled={waReconnecting} className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white font-bold text-xs hover:bg-amber-400 transition-colors">🔄 Reiniciar</button>
                        {waConnected && <button type="button" onClick={() => void handleDisconnectWhatsApp()} className="flex-1 py-1.5 rounded-lg bg-red-600 text-white font-bold text-xs hover:bg-red-500 transition-colors">🔌 Desligar</button>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* INSTÂNCIA 2 DINÂMICA: APARECE APENAS SE ESTIVER INTEGRADA NO SELETOR */}
            {whatsappSessions >= 2 && (
              <WhatsAppSession2Panel canPair={canPairWhatsApp} tenantId={tenantId} addToast={addToast} />
            )}
          </div>
        </div>
      )}

      {/* ABA 2: GERENCIADOR REORGANIZADO DE PLANILHAS E BANCO (HIDES BULLK AWAY) */}
      {activeTab === "data" && (
        <div className="max-w-4xl mx-auto bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white">Ferramentas Estruturais de Dados</h3>
            <p className="text-xs text-slate-400 mt-1">Realize a ingestão ou backup completo das planilhas integradas do ecossistema.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setActionModal("export")}
              disabled={!tenantId || exporting}
              className="h-12 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-bold text-xs text-slate-700 dark:text-white hover:bg-slate-100 transition-all flex items-center justify-center gap-2"
            >
              ⬇️ Exportar Registros
            </button>
            <button
              type="button"
              onClick={() => setActionModal("template")}
              disabled={!tenantId}
              className="h-12 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-bold text-xs text-slate-700 dark:text-white hover:bg-slate-100 transition-all flex items-center justify-center gap-2"
            >
              📄 Baixar Planilhas Modelos
            </button>
            <button
              type="button"
              onClick={() => setActionModal("import")}
              disabled={!tenantId || importing || importingApps || importingAuto || importingReseller || importingMessage || importingServer}
              className="h-12 px-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 font-bold text-xs text-slate-700 dark:text-white hover:bg-slate-100 transition-all flex items-center justify-center gap-2"
            >
              ⬆️ Importar Cargas Novas
            </button>
          </div>

          {/* INPUTS OCULTOS DE ARQUIVO */}
          <input ref={importFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }} />
          <input ref={importAppsFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportAppsFile(f); }} />
          <input ref={importAutoFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportAutoFile(f); }} />
          <input ref={importResellerFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportResellerFile(f); }} />
          <input ref={importMessageFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportMessageFile(f); }} />
          <input ref={importServerFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportServerFile(f); }} />
          <input ref={importFinanceiroFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFinanceiroFile(f); }} />
        </div>
      )}

      {/* ============================================================================
          MODALS DE SUB-AÇÕES DAS PLANILHAS (MANTIDOS INTACTOS)
         ============================================================================ */}
      {actionModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#161b22] w-full max-w-sm rounded-xl border border-slate-200 dark:border-white/10 shadow-xl p-6 space-y-4 text-left">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white">
              {actionModal === "export" && "⬇️ Exportar Dados"}
              {actionModal === "template" && "📄 Baixar Templates"}
              {actionModal === "import" && "⬆️ Importar Dados"}
            </h3>
            <div className="flex flex-col gap-2">
              {[
                { n: "Servidores", icon: "🖥️", act: () => { if(actionModal==="export") void handleExportServers(); else if(actionModal==="template") handleDownloadTemplateServers(); else importServerFileRef.current?.click(); } },
                { n: "Mensagens WhatsApp", icon: "💬", act: () => { if(actionModal==="export") void handleExportMessages(); else if(actionModal==="template") handleDownloadTemplateMessages(); else importMessageFileRef.current?.click(); } },
                { n: "Automações de Cobrança", icon: "💵", act: () => { if(actionModal==="export") void handleExportAuto(); else if(actionModal==="template") handleDownloadTemplateAuto(); else importAutoFileRef.current?.click(); } },
                { n: "Clientes", icon: "👥", act: () => { if(actionModal==="export") void handleExportClients(); else if(actionModal==="template") handleDownloadTemplate(); else importFileRef.current?.click(); } },
                { n: "Aplicativos vinculados", icon: "📱", act: () => { if(actionModal==="export") void handleExportApps(); else if(actionModal==="template") handleDownloadTemplateApps(); else importAppsFileRef.current?.click(); } },
                { n: "Revendedores", icon: "🤝", act: () => { if(actionModal==="export") void handleExportResellers(); else if(actionModal==="template") handleDownloadTemplateResellers(); else importResellerFileRef.current?.click(); } },
                { n: "Controle Financeiro", icon: "💰", act: () => { if(actionModal==="export") setShowFinanceiroExportModal(true); else if(actionModal==="template") handleDownloadTemplateFinanceiro(); else importFinanceiroFileRef.current?.click(); } }
              ].map((item, idx) => (
                <button key={idx} type="button" onClick={() => { setActionModal(null); item.act(); }} className="w-full text-left text-xs p-3 font-semibold rounded-lg border bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors flex items-center gap-2">
                  <span>{item.icon}</span> {item.n}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setActionModal(null)} className="w-full text-center text-xs font-bold text-slate-400 mt-2">Fechar</button>
          </div>
        </div>
      )}

      {showFinanceiroExportModal && (() => {
        const currentYear = new Date().getFullYear();
        const availableYears = [currentYear - 1, currentYear, currentYear + 1];
        return (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#161b22] w-full max-w-sm rounded-xl p-6 space-y-4 text-left">
              <h3 className="text-sm font-bold">Filtros de Exportação Financeira</h3>
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Anos disponíveis</span>
                <div className="flex gap-2">
                  {availableYears.map(y => (
                    <button key={y} type="button" onClick={() => setFinExportYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y])} className={`px-3 py-1.5 text-xs font-bold rounded border ${finExportYears.includes(y) ? "border-emerald-500 bg-emerald-50 text-emerald-600" : "border-slate-200"}`}>{y}</button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => void handleExportFinanceiro(finExportYears, finExportStatus)} className="w-full py-2 bg-emerald-600 font-bold rounded-lg text-white text-xs">Confirmar e Baixar</button>
              <button type="button" onClick={() => setShowFinanceiroExportModal(false)} className="w-full text-center text-xs text-slate-400">Cancelar</button>
            </div>
          </div>
        );
      })()}
    </div>
  );

  // Helper local interno para acionar o estado de alteração de sessões
  function setOriginalSessionsCount(count: number) {
    setWhatsappSessions(count);
  }
}

// ============================================================================
// SESSÃO WHATSAPP 2 — MANTIDA COM ISOLAMENTO TOTAL DA SESSÃO 1
// ============================================================================
function WhatsAppSession2Panel({ canPair, tenantId, addToast }: { canPair: boolean; tenantId: string | null; addToast: any }) {
  const { confirm } = useConfirm();
  const [waLoading, setWaLoading] = useState(false);
  const [waConnected, setWaConnected] = useState(false);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [isDormant, setIsDormant] = useState(true);
  const [waPushName, setWaPushName] = useState<string | null>(null);
  const [waProfilePicUrl, setWaProfilePicUrl] = useState<string | null>(null);
  const [waStatusText, setWaStatusText] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  async function fetchWaStatus() {
    try {
      const res = await fetch("/api/whatsapp/status2", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setWaConnected(!!json.connected); setWaStatusText(json.status ?? null);
      return { connected: !!json.connected, status: json.status };
    } catch { return { connected: false, status: "error" }; }
  }

  async function refreshPanel(forceQr = false, showVisualLoading = true) {
    if (showVisualLoading) setWaLoading(true);
    try {
      const { connected, status } = await fetchWaStatus();
      if (connected) { setIsDormant(false); setWaQrDataUrl(null); return; }
      if (forceQr || status === "qr" || status === "connecting") {
        const res = await fetch("/api/whatsapp/qr2", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setWaQrDataUrl(json?.qr || null);
      } else { setWaQrDataUrl(null); }
    } finally { if (showVisualLoading) setWaLoading(false); }
  }

  async function handleDisconnect() {
    const ok = await confirm({ title: "Desconectar?", subtitle: "Encerrar sessão 2.", tone: "rose", confirmText: "Desconectar", cancelText: "Voltar" });
    if (!ok) return; setWaLoading(true);
    try {
      await fetch("/api/whatsapp/disconnect2", { method: "POST" });
      setWaConnected(false); setWaQrDataUrl(null); setIsDormant(true);
      addToast("success", "Sessão 2 Desconectada");
    } catch {} finally { setWaLoading(false); }
  }

  async function handleReconnect() {
    const ok = await confirm({ title: "Reiniciar Instância 2?", subtitle: "Forçar reinicialização.", tone: "amber", confirmText: "Reconectar", cancelText: "Voltar" });
    if (!ok) return; setIsReconnecting(true);
    try {
      await fetch("/api/whatsapp/reconnect2", { method: "POST" });
      setWaConnected(false); setWaQrDataUrl(null); setIsDormant(false);
      setTimeout(() => void refreshPanel(true), 4000);
    } catch {} finally { setIsReconnecting(false); }
  }

  return (
    <div className="bg-white dark:bg-[#161b22] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm space-y-4">
      <h3 className="text-xs font-bold text-slate-400 dark:text-white/30 uppercase tracking-widest border-b border-slate-100 dark:border-white/5 pb-2">
        WhatsApp — Instância 2
      </h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${waConnected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-red-500/30 bg-red-500/10 text-red-500"}`}>
            {waConnected ? "Online" : "Desconectado"}
          </span>
          <button type="button" onClick={() => void refreshPanel()} disabled={waLoading} className="text-[11px] font-bold px-3 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 transition-colors">
            Sincronizar
          </button>
        </div>

        {isDormant && !waConnected ? (
          <button type="button" onClick={() => { setIsDormant(false); void refreshPanel(true); }} className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs transition-all">
            📲 Inicializar QR Code 2
          </button>
        ) : (
          <>
            {waConnected ? (
              <div className="text-xs p-3 text-center rounded-xl bg-slate-50 dark:bg-black/20 border text-slate-500">Sessão secundária ativa e operando em paralelo.</div>
            ) : waQrDataUrl ? (
              <div className="flex flex-col items-center p-2 bg-white rounded-lg border">
                <img src={waQrDataUrl} alt="QR Code 2" className="w-full max-w-[180px]" />
              </div>
            ) : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => void handleReconnect()} disabled={isReconnecting} className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white font-bold text-xs hover:bg-amber-400">🔄 Reiniciar</button>
              {waConnected && <button type="button" onClick={() => void handleDisconnect()} className="flex-1 py-1.5 rounded-lg bg-red-600 text-white font-bold text-xs hover:bg-red-500">🔌 Desligar</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}